/**
 * Orders service (Phase 7, spec Part 11, ARCHITECTURE.md §13,
 * DATABASE_DESIGN.md §9.8–§9.10).
 *
 * `transitionOrder` is the ONLY writer of `orders.status`. Every
 * transition runs in ONE READ COMMITTED transaction following the
 * global lock order documented here (Phase 6 review, disposition 2 —
 * the canonical inventory protocol):
 *
 *   1. `invoice_sequences` row for 'INVOICE:<year>' (approve only —
 *      §10.2 prescribes the sequence lock first; its scope is distinct
 *      from checkout's 'ORDER:<year>' row, so the two never contend)
 *   2. the order row, FOR UPDATE — state is validated under the lock
 *   3. product rows, FOR UPDATE, ascending id
 *   4. variant rows, FOR UPDATE, ascending id
 *
 * …then the conditional status update (exactly one affected row),
 * inventory effects, invoice creation (approve), outbox enqueue,
 * status history and the audit row — all inside the same transaction.
 *
 * Inventory semantics per state (schema/store.ts deviation 2 — the
 * reservation ledger):
 *  - approve: the reservation is finalised per line as an
 *    ORDER_DEDUCT (−qty against stock_qty) + RELEASE (+qty closing
 *    the reservation) pair; availability is unchanged by the pair.
 *  - cancel/reject from PENDING_APPROVAL: the reservation is still
 *    open, so a RELEASE (+qty) per line restores availability;
 *    stock_qty is untouched (nothing was ever deducted).
 *  - cancel from APPROVED/PROCESSING: approval already deducted, so
 *    an ORDER_RESTORE (+qty against stock_qty) per line returns the
 *    units. Each path runs exactly once — the state validation under
 *    the order-row lock makes a second cancel a 422, never a second
 *    restoration.
 *  - An order cancelled after approval keeps its invoice (§10.1):
 *    invoices are accounting records and are never deleted in v1.
 *    Phase 8 adds the reversal document: the same cancellation
 *    transaction also issues a credit note against that invoice
 *    (credit-notes.service.ts; the 'CREDIT_NOTE:<year>' sequence row
 *    takes the step-1 lock position for cancels).
 *
 * Phase 8 also wraps the whole transition in the deadlock retry
 * (database/tx-retry.ts): a 1213/1205 victim failure re-runs the
 * transaction, whose in-lock state validation makes the retry safe.
 *
 * Step-up: PERMISSIONS.md §7 reserves step-up MFA for invitations,
 * role assignment, global settings and MFA resets. Order transitions
 * are permission-gated (store.orders.approve / .cancel / .update) but
 * NOT step-up-gated — the Phase 2 pattern, applied consistently.
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "../../database/client.js";
import {
  inventoryMovements,
  invoices,
  orderItems,
  orderStatusHistory,
  orders,
  products,
  productVariants,
} from "../../database/schema/index.js";
import { withDeadlockRetry } from "../../database/tx-retry.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import {
  insufficientStock,
  likePattern,
  reservedQty,
  toOrderView,
  type DbLike,
  type OrderView,
  type RequestMeta,
} from "../store/service.js";
import {
  createCreditNoteForInvoice,
  getCreditNoteByOrderId,
  getCreditNotePdfBuffer,
  lockCreditNoteSequence,
  type CreditNoteRow,
} from "./credit-notes.service.js";
import {
  createInvoiceForOrder,
  getInvoiceByOrderId,
  getInvoicePdfBuffer,
  lockInvoiceSequence,
  toInvoiceView,
  type InvoiceView,
} from "./invoices.service.js";
import type { AdminOrderListQuery } from "./orders.schemas.js";
import {
  drainOutboxSoon,
  enqueueEmail,
  type OrdersDeps,
} from "./outbox.service.js";

export interface OrdersActor {
  userId: number;
  email: string;
  /** Role snapshot for status history (e.g. "STORE_ADMIN"). */
  role: string | null;
}

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;

/** Drizzle/mysql2 update results are [header, fields] (codebase pattern). */
function affectedRowsOf(result: unknown): number {
  const header = (result as [{ affectedRows?: unknown }] | null)?.[0];
  return typeof header?.affectedRows === "number" ? header.affectedRows : 0;
}

// ---------------------------------------------------------------------------
// Transition matrix (ARCHITECTURE.md §13)
// ---------------------------------------------------------------------------

export type OrderAction =
  | "approve"
  | "reject"
  | "process"
  | "ship"
  | "deliver"
  | "cancel";

interface TransitionRule {
  from: readonly string[];
  to: string;
  reasonRequired: boolean;
}

export const ORDER_TRANSITIONS: Record<OrderAction, TransitionRule> = {
  approve: { from: ["PENDING_APPROVAL"], to: "APPROVED", reasonRequired: false },
  reject: { from: ["PENDING_APPROVAL"], to: "CANCELLED", reasonRequired: true },
  process: { from: ["APPROVED"], to: "PROCESSING", reasonRequired: false },
  ship: { from: ["PROCESSING"], to: "SHIPPED", reasonRequired: false },
  deliver: { from: ["SHIPPED"], to: "DELIVERED", reasonRequired: false },
  cancel: {
    from: ["PENDING_APPROVAL", "APPROVED", "PROCESSING"],
    to: "CANCELLED",
    reasonRequired: true,
  },
};

function invalidTransition(order: OrderRow, action: OrderAction): AppError {
  return new AppError(
    "INVALID_STATE_TRANSITION",
    `An order in status ${order.status} cannot be ${action}d via this action.`,
    [
      {
        field: "status",
        issue: `Order is ${order.status}; this action requires ${ORDER_TRANSITIONS[action].from.join(" or ")}.`,
      },
    ],
  );
}

function auditActionFor(action: OrderAction): string {
  switch (action) {
    case "approve":
      return AUDIT_ACTIONS.storeOrdersApprove;
    case "reject":
      return AUDIT_ACTIONS.storeOrdersReject;
    case "cancel":
      return AUDIT_ACTIONS.storeOrdersCancel;
    default:
      return AUDIT_ACTIONS.storeOrdersUpdate;
  }
}

// ---------------------------------------------------------------------------
// Inventory effects (all inside the caller's transaction)
// ---------------------------------------------------------------------------

interface LockedInventory {
  productById: Map<number, ProductRow>;
  variantById: Map<number, VariantRow>;
}

/** Lock the order lines' product rows, then variant rows (id order). */
async function lockLineInventory(
  tx: DbLike,
  items: OrderItemRow[],
): Promise<LockedInventory> {
  const productIds = [
    ...new Set(
      items
        .map((item) => item.productId)
        .filter((id): id is number => id !== null),
    ),
  ].sort((a, b) => a - b);
  const productById = new Map<number, ProductRow>();
  if (productIds.length > 0) {
    const rows = await tx
      .select()
      .from(products)
      .where(inArray(products.id, productIds))
      .orderBy(asc(products.id))
      .for("update");
    for (const row of rows) productById.set(row.id, row);
  }
  const variantIds = [
    ...new Set(
      items
        .map((item) => item.variantId)
        .filter((id): id is number => id !== null),
    ),
  ].sort((a, b) => a - b);
  const variantById = new Map<number, VariantRow>();
  if (variantIds.length > 0) {
    const rows = await tx
      .select()
      .from(productVariants)
      .where(inArray(productVariants.id, variantIds))
      .orderBy(asc(productVariants.id))
      .for("update");
    for (const row of rows) variantById.set(row.id, row);
  }
  return { productById, variantById };
}

/** products.stock_qty mirrors the variant sum (§9.4) — the admin
 * inventory service's rule, applied after any variant stock change. */
async function syncProductStockMirror(tx: DbLike, productId: number): Promise<void> {
  const [row] = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${productVariants.stockQty}), 0)`,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
  await tx
    .update(products)
    .set({ stockQty: Number(row?.total ?? 0) })
    .where(eq(products.id, productId));
}

interface LineContext {
  item: OrderItemRow;
  product: ProductRow;
  variant: VariantRow | null;
}

function trackedLines(
  items: OrderItemRow[],
  locked: LockedInventory,
): LineContext[] {
  const lines: LineContext[] = [];
  for (const item of items) {
    if (item.productId === null) continue;
    const product = locked.productById.get(item.productId);
    if (!product || !product.trackInventory) continue;
    lines.push({
      item,
      product,
      variant:
        item.variantId !== null
          ? (locked.variantById.get(item.variantId) ?? null)
          : null,
    });
  }
  return lines;
}

/** Approve: ORDER_DEDUCT + RELEASE pair per line (see module header). */
async function finaliseInventoryOnApprove(
  tx: DbLike,
  order: OrderRow,
  items: OrderItemRow[],
  actor: OrdersActor,
): Promise<void> {
  const locked = await lockLineInventory(tx, items);
  const mirrored = new Set<number>();
  for (const { item, product, variant } of trackedLines(items, locked)) {
    const qty = item.quantity;
    const reservedBefore = await reservedQty(tx, product.id, item.variantId);
    const stockNow = variant ? variant.stockQty : product.stockQty;
    const newStock = stockNow - qty;
    if (newStock < 0) {
      throw insufficientStock(
        [{ field: "items", issue: `Stock for '${product.name}' no longer covers this order.` }],
        `Insufficient stock for '${product.name}'.`,
      );
    }
    if (variant) {
      await tx
        .update(productVariants)
        .set({ stockQty: newStock })
        .where(eq(productVariants.id, variant.id));
      mirrored.add(product.id);
    } else {
      await tx
        .update(products)
        .set({ stockQty: newStock })
        .where(eq(products.id, product.id));
    }
    await tx.insert(inventoryMovements).values({
      productId: product.id,
      variantId: variant?.id ?? null,
      movementType: "ORDER_DEDUCT",
      quantity: -qty,
      balanceAfter: newStock,
      orderId: order.id,
      actorId: actor.userId,
      reason: `Order ${order.orderNumber} approved — stock deducted`,
    });
    await tx.insert(inventoryMovements).values({
      productId: product.id,
      variantId: variant?.id ?? null,
      movementType: "RELEASE",
      quantity: qty,
      // Available after the pair: on-hand fell by qty and the held
      // reservation closed, so availability is unchanged overall.
      balanceAfter: newStock - (reservedBefore - qty),
      orderId: order.id,
      actorId: actor.userId,
      reason: `Order ${order.orderNumber} approved — reservation closed`,
    });
  }
  for (const productId of mirrored) await syncProductStockMirror(tx, productId);
}

/** Cancel from PENDING_APPROVAL: RELEASE per line; stock untouched. */
async function releaseReservationsOnCancel(
  tx: DbLike,
  order: OrderRow,
  items: OrderItemRow[],
  actor: OrdersActor,
): Promise<void> {
  const locked = await lockLineInventory(tx, items);
  for (const { item, product, variant } of trackedLines(items, locked)) {
    const reservedBefore = await reservedQty(tx, product.id, item.variantId);
    if (reservedBefore <= 0) continue;
    const qty = Math.min(item.quantity, reservedBefore);
    const stockNow = variant ? variant.stockQty : product.stockQty;
    await tx.insert(inventoryMovements).values({
      productId: product.id,
      variantId: variant?.id ?? null,
      movementType: "RELEASE",
      quantity: qty,
      balanceAfter: stockNow - (reservedBefore - qty),
      orderId: order.id,
      actorId: actor.userId,
      reason: `Order ${order.orderNumber} cancelled — reservation released`,
    });
  }
}

/** Cancel from APPROVED/PROCESSING: ORDER_RESTORE per line. */
async function restoreStockOnCancel(
  tx: DbLike,
  order: OrderRow,
  items: OrderItemRow[],
  actor: OrdersActor,
): Promise<void> {
  const locked = await lockLineInventory(tx, items);
  const mirrored = new Set<number>();
  for (const { item, product, variant } of trackedLines(items, locked)) {
    const qty = item.quantity;
    const stockNow = variant ? variant.stockQty : product.stockQty;
    const newStock = stockNow + qty;
    if (variant) {
      await tx
        .update(productVariants)
        .set({ stockQty: newStock })
        .where(eq(productVariants.id, variant.id));
      mirrored.add(product.id);
    } else {
      await tx
        .update(products)
        .set({ stockQty: newStock })
        .where(eq(products.id, product.id));
    }
    await tx.insert(inventoryMovements).values({
      productId: product.id,
      variantId: variant?.id ?? null,
      movementType: "ORDER_RESTORE",
      quantity: qty,
      balanceAfter: newStock,
      orderId: order.id,
      actorId: actor.userId,
      reason: `Order ${order.orderNumber} cancelled — stock restored`,
    });
  }
  for (const productId of mirrored) await syncProductStockMirror(tx, productId);
}

// ---------------------------------------------------------------------------
// The transition function — the only writer of orders.status
// ---------------------------------------------------------------------------

export interface TransitionResult {
  detail: AdminOrderDetail;
  invoiceId: number | null;
  /** Phase 8: set when a post-approval cancel created a credit note. */
  creditNoteId: number | null;
}

export async function transitionOrder(
  deps: OrdersDeps,
  orderId: number,
  action: OrderAction,
  actor: OrdersActor,
  reason: string | undefined,
  meta: RequestMeta,
): Promise<TransitionResult> {
  const rule = ORDER_TRANSITIONS[action];
  if (rule.reasonRequired && !reason) {
    throw AppError.validation(
      [{ field: "reason", issue: "A reason is required for this action." }],
      "A reason is required for this action.",
    );
  }
  const { db } = deps;
  let invoiceId: number | null = null;
  let creditNoteId: number | null = null;
  let enqueuedMail = false;

  // Phase 8 (Phase 7 review disposition 4): a deadlock/lock-wait
  // victim retries the WHOLE transaction. Safe because the body
  // re-reads the order and re-validates its state under the row lock
  // at the top of every attempt — a retry after a rival transition
  // committed fails with 422 instead of double-applying. Per-attempt
  // outputs are reset at the top of each attempt.
  await withDeadlockRetry(async () => {
    invoiceId = null;
    creditNoteId = null;
    enqueuedMail = false;
    await db.transaction(
    async (tx) => {
      const at = new Date();
      // Lock order (global order, module header): sequence row first
      // for approve (§10.2) and for cancel (the CREDIT_NOTE scope —
      // locked even though most cancels create no note, so the order
      // is uniform), then the order row.
      if (action === "approve") await lockInvoiceSequence(tx, at);
      if (rule.to === "CANCELLED") await lockCreditNoteSequence(tx, at);
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1)
        .for("update");
      if (!order) throw AppError.notFound("Order not found.");
      if (!rule.from.includes(order.status)) throw invalidTransition(order, action);

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .orderBy(asc(orderItems.id));

      const patch: Partial<OrderRow> = { status: rule.to };
      if (action === "approve") {
        patch.approvedAt = at;
        patch.approvedBy = actor.userId;
      }
      if (rule.to === "CANCELLED") {
        patch.cancelledAt = at;
        patch.cancelledBy = actor.userId;
        patch.cancellationReason = reason ?? null;
      }
      const updated = await tx
        .update(orders)
        .set(patch)
        .where(and(eq(orders.id, orderId), eq(orders.status, order.status)));
      if (affectedRowsOf(updated) !== 1) throw invalidTransition(order, action);

      if (action === "approve") {
        await finaliseInventoryOnApprove(tx, order, items, actor);
        const created = await createInvoiceForOrder(tx, order, items, actor, at);
        invoiceId = created.invoice.id;
        enqueuedMail = true;
      } else if (rule.to === "CANCELLED") {
        if (order.status === "PENDING_APPROVAL") {
          await releaseReservationsOnCancel(tx, order, items, actor);
        } else {
          await restoreStockOnCancel(tx, order, items, actor);
        }
        // Phase 8 (Phase 7 review disposition 1): an order cancelled
        // AFTER approval carries an issued invoice — reverse it in
        // full with a credit note in this same transaction (the note's
        // email is enqueued by the credit-notes service). A cancel
        // from PENDING_APPROVAL has no invoice, hence no note.
        const [existingInvoice] = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.orderId, orderId))
          .limit(1);
        if (existingInvoice) {
          const createdNote = await createCreditNoteForInvoice(
            tx,
            existingInvoice,
            order,
            reason!,
            actor,
            at,
          );
          creditNoteId = createdNote.creditNote.id;
        }
        await enqueueEmail(tx, {
          type: "ORDER_CANCELLED",
          recipientEmail: order.customerEmailSnapshot,
          recipientUserId: order.userId,
          subject: `Your order ${order.orderNumber} was cancelled`,
          text:
            `Dear ${order.shipRecipientName},\n\n` +
            `Your order ${order.orderNumber} has been cancelled.\n` +
            `Reason: ${reason}\n\n` +
            `If you believe this is a mistake, please contact us.`,
          relatedType: "order",
          relatedId: order.id,
        });
        enqueuedMail = true;
      } else if (action === "ship" || action === "deliver") {
        const verb = action === "ship" ? "shipped" : "delivered";
        await enqueueEmail(tx, {
          type: action === "ship" ? "ORDER_SHIPPED" : "ORDER_DELIVERED",
          recipientEmail: order.customerEmailSnapshot,
          recipientUserId: order.userId,
          subject: `Your order ${order.orderNumber} has been ${verb}`,
          text:
            `Dear ${order.shipRecipientName},\n\n` +
            `Good news — your order ${order.orderNumber} has been ${verb}.\n\n` +
            `Thank you for shopping with us.`,
          relatedType: "order",
          relatedId: order.id,
        });
        enqueuedMail = true;
      }

      await tx.insert(orderStatusHistory).values({
        orderId,
        fromStatus: order.status,
        toStatus: rule.to,
        actorId: actor.userId,
        actorRole: actor.role,
        reason: reason ?? null,
      });

      await writeAudit(tx as unknown as Database, {
        actorId: actor.userId,
        actorType: "ADMIN",
        actorEmail: actor.email,
        actorRole: actor.role,
        action: auditActionFor(action),
        resourceType: "order",
        resourceId: orderId,
        result: "SUCCESS",
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        metadata: {
          orderNumber: order.orderNumber,
          fromStatus: order.status,
          toStatus: rule.to,
          ...(reason ? { reason } : {}),
          ...(invoiceId !== null ? { invoiceId } : {}),
        },
      });
      if (invoiceId !== null) {
        await writeAudit(tx as unknown as Database, {
          actorId: actor.userId,
          actorType: "ADMIN",
          actorEmail: actor.email,
          actorRole: actor.role,
          action: AUDIT_ACTIONS.storeInvoicesCreate,
          resourceType: "invoice",
          resourceId: invoiceId,
          result: "SUCCESS",
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
          metadata: { orderId, orderNumber: order.orderNumber },
        });
      }
      if (creditNoteId !== null) {
        await writeAudit(tx as unknown as Database, {
          actorId: actor.userId,
          actorType: "ADMIN",
          actorEmail: actor.email,
          actorRole: actor.role,
          action: AUDIT_ACTIONS.storeInvoicesCreditNote,
          resourceType: "credit_note",
          resourceId: creditNoteId,
          result: "SUCCESS",
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
          metadata: { orderId, orderNumber: order.orderNumber, reason },
        });
      }
      // READ COMMITTED is load-bearing (Phase 6 protocol): post-lock
      // availability reads must see reservations committed by racing
      // transactions.
    },
    { isolationLevel: "read committed" },
    );
  });

  // Post-commit, best-effort: warm the invoice PDF cache so the first
  // download/email attach is instant. A failure here is harmless —
  // downloads and the drain re-render deterministically from the
  // snapshot.
  if (invoiceId !== null) {
    const invoice = await getInvoiceByOrderId(db, orderId);
    if (invoice) {
      try {
        await getInvoicePdfBuffer(deps, invoice);
      } catch {
        // cache warm-up only
      }
    }
  }
  if (creditNoteId !== null) {
    // Same warm-up for the credit-note PDF (cache only).
    const creditNote = await getCreditNoteByOrderId(db, orderId);
    if (creditNote) {
      try {
        await getCreditNotePdfBuffer(deps, creditNote);
      } catch {
        // cache warm-up only
      }
    }
  }
  if (enqueuedMail) drainOutboxSoon(deps);

  const detail = await getAdminOrderDetail(deps, orderId);
  if (!detail) throw AppError.notFound("Order not found.");
  return { detail, invoiceId, creditNoteId };
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export interface AdminOrderListItem extends OrderView {
  userId: number;
  /** Milliseconds since placement — the queue-age signal (§7 brief). */
  ageMs: number;
}

export async function listAdminOrders(
  deps: OrdersDeps,
  query: AdminOrderListQuery,
  pagination: PaginationParams,
): Promise<{ items: AdminOrderListItem[]; total: number }> {
  const { db } = deps;
  const conditions = [];
  if (query.status) conditions.push(eq(orders.status, query.status));
  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        like(orders.orderNumber, pattern),
        like(orders.customerEmailSnapshot, pattern),
        like(orders.shipRecipientName, pattern),
      )!,
    );
  }
  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(orders.placedAt, from));
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime())) {
      // A bare date means "through the end of that day".
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setUTCDate(to.getUTCDate() + 1);
      conditions.push(lte(orders.placedAt, to));
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  // The approval queue works oldest-first (Phase 6 review disposition
  // 1: pending orders hold stock, so age is the priority); everything
  // else is newest-first.
  const orderBy =
    query.status === "PENDING_APPROVAL" ? asc(orders.placedAt) : desc(orders.placedAt);
  const rows = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(orderBy)
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  const [totalRow] = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(orders)
    .where(where);
  const now = Date.now();
  const items: AdminOrderListItem[] = [];
  for (const row of rows) {
    const itemRows = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id))
      .orderBy(asc(orderItems.id));
    items.push({
      ...toOrderView(row, itemRows),
      userId: row.userId,
      ageMs: Math.max(0, now - row.placedAt.getTime()),
    });
  }
  return { items, total: Number(totalRow?.value ?? 0) };
}

export interface AdminOrderDetail {
  order: OrderView & { userId: number };
  customer: { userId: number; email: string };
  history: {
    id: number;
    fromStatus: string | null;
    toStatus: string;
    actorId: number | null;
    actorRole: string | null;
    reason: string | null;
    createdAt: Date;
  }[];
  invoice: InvoiceView | null;
}

export async function getAdminOrderDetail(
  deps: OrdersDeps,
  orderId: number,
): Promise<AdminOrderDetail | null> {
  const { db } = deps;
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id));
  const history = await db
    .select()
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, orderId))
    .orderBy(asc(orderStatusHistory.id));
  const invoice = await getInvoiceByOrderId(db, orderId);
  return {
    order: { ...toOrderView(order, itemRows), userId: order.userId },
    customer: { userId: order.userId, email: order.customerEmailSnapshot },
    history: history.map((row) => ({
      id: row.id,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorId: row.actorId,
      actorRole: row.actorRole,
      reason: row.reason,
      createdAt: row.createdAt,
    })),
    invoice: invoice ? toInvoiceView(invoice, order.orderNumber) : null,
  };
}

// ---------------------------------------------------------------------------
// Customer invoice access (ownership — cross-owner is a 404, §6/A6)
// ---------------------------------------------------------------------------

export async function getOwnInvoice(
  deps: OrdersDeps,
  userId: number,
  orderId: number,
): Promise<{ invoice: typeof invoices.$inferSelect; order: OrderRow }> {
  const { db } = deps;
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.userId !== userId) {
    throw AppError.notFound("Order not found.");
  }
  const invoice = await getInvoiceByOrderId(db, orderId);
  if (!invoice) throw AppError.notFound("Invoice not found.");
  return { invoice, order };
}

/** Phase 8: the caller's own credit note for an order (same ownership
 * discipline — another customer's order or an order without a credit
 * note is a 404). */
export async function getOwnCreditNote(
  deps: OrdersDeps,
  userId: number,
  orderId: number,
): Promise<{ creditNote: CreditNoteRow; order: OrderRow }> {
  const { db } = deps;
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.userId !== userId) {
    throw AppError.notFound("Order not found.");
  }
  const creditNote = await getCreditNoteByOrderId(db, orderId);
  if (!creditNote) throw AppError.notFound("Credit note not found.");
  return { creditNote, order };
}
