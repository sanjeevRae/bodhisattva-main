/**
 * Invoices service (Phase 7, DATABASE_DESIGN.md §10, spec Parts 11–12).
 *
 *  - Templates: one active template; every edit inserts an immutable
 *    new version and moves `current_version_id` (§10.3). Issued
 *    invoices embed the configuration they were rendered under inside
 *    their snapshot, so template edits apply to the NEXT invoice only.
 *  - Numbers: the §10.2 per-year sequence. `lockInvoiceSequence` takes
 *    the counter row lock FIRST in the approval transaction (the
 *    design's prescribed order — the critical section is short and the
 *    scopes are per-kind, so it cannot deadlock against checkout's
 *    ORDER scope); `takeInvoiceNumber` then increments it after the
 *    order's state has been validated.
 *  - Creation happens inside the approval transaction (orders.service):
 *    the invoice row, its snapshot and the INVOICE outbox row commit
 *    atomically with the status change and the inventory finalisation.
 *    `uq_invoices_order` makes a second invoice for the same order
 *    impossible at the database level.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { parseMoneyToMinorUnits } from "@bodhisattva/shared/money";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import {
  emailOutbox,
  invoices,
  invoiceSequences,
  invoiceTemplates,
  invoiceTemplateVersions,
  orders,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import type { DbLike, RequestMeta, StoreActor } from "../store/service.js";
import {
  getCreditNoteByInvoiceId,
  toCreditNoteSummary,
  type CreditNoteSummary,
} from "./credit-notes.service.js";
import {
  ensureInvoicePdf,
  invoicePdfStorageName,
  resolveInvoiceLogoImage,
} from "./invoice-files.js";
import type { InvoiceSnapshot } from "./invoice-pdf.js";
import {
  invoiceTemplateConfigSchema,
  type InvoiceTemplateConfig,
  type UpdateInvoiceTemplateInput,
} from "./orders.schemas.js";
import {
  enqueueEmail,
  drainOutboxSoon,
  type OrdersDeps,
} from "./outbox.service.js";

type InvoiceRow = typeof invoices.$inferSelect;
type TemplateRow = typeof invoiceTemplates.$inferSelect;
type TemplateVersionRow = typeof invoiceTemplateVersions.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = {
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

// ---------------------------------------------------------------------------
// Template state
// ---------------------------------------------------------------------------

export interface TemplateVersionView {
  id: number;
  versionNo: number;
  config: InvoiceTemplateConfig;
  createdBy: number | null;
  createdAt: Date;
}

export interface TemplateState {
  template: { id: number; name: string; isActive: boolean; currentVersionId: number | null };
  versions: TemplateVersionView[];
  activeVersion: TemplateVersionView | null;
}

function parseConfig(raw: unknown): InvoiceTemplateConfig {
  return invoiceTemplateConfigSchema.parse(raw);
}

function toVersionView(row: TemplateVersionRow): TemplateVersionView {
  return {
    id: row.id,
    versionNo: row.versionNo,
    config: parseConfig(row.config),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function getTemplateState(db: DbLike): Promise<TemplateState> {
  const [template] = await db
    .select()
    .from(invoiceTemplates)
    .where(eq(invoiceTemplates.isActive, true))
    .limit(1);
  if (!template) throw AppError.internal();
  const versionRows = await db
    .select()
    .from(invoiceTemplateVersions)
    .where(eq(invoiceTemplateVersions.templateId, template.id))
    .orderBy(desc(invoiceTemplateVersions.versionNo));
  const versions = versionRows.map(toVersionView);
  return {
    template: {
      id: template.id,
      name: template.name,
      isActive: template.isActive,
      currentVersionId: template.currentVersionId,
    },
    versions,
    activeVersion:
      versions.find((v) => v.id === template.currentVersionId) ?? null,
  };
}

/** The active template + its current version — the issue-time source. */
export async function getActiveTemplateVersion(
  db: DbLike,
): Promise<{ template: TemplateRow; version: TemplateVersionRow; config: InvoiceTemplateConfig }> {
  const [template] = await db
    .select()
    .from(invoiceTemplates)
    .where(eq(invoiceTemplates.isActive, true))
    .limit(1);
  if (!template || template.currentVersionId === null) {
    throw AppError.internal();
  }
  const [version] = await db
    .select()
    .from(invoiceTemplateVersions)
    .where(eq(invoiceTemplateVersions.id, template.currentVersionId))
    .limit(1);
  if (!version) throw AppError.internal();
  return { template, version, config: parseConfig(version.config) };
}

/**
 * Edit the active template: validates the configuration, inserts a new
 * immutable version and moves the pointer. Previously issued invoices
 * are untouched (they carry their own snapshot).
 */
export async function updateTemplate(
  deps: OrdersDeps,
  actor: StoreActor,
  input: UpdateInvoiceTemplateInput,
  meta: RequestMeta,
): Promise<TemplateState> {
  const { db } = deps;
  let newVersionNo = 0;
  await db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.isActive, true))
      .limit(1)
      .for("update");
    if (!template) throw AppError.internal();
    const [maxRow] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${invoiceTemplateVersions.versionNo}), 0)` })
      .from(invoiceTemplateVersions)
      .where(eq(invoiceTemplateVersions.templateId, template.id));
    newVersionNo = Number(maxRow?.max ?? 0) + 1;
    const [version] = await tx
      .insert(invoiceTemplateVersions)
      .values({
        templateId: template.id,
        versionNo: newVersionNo,
        config: input.config,
        createdBy: actor.userId,
      })
      .$returningId();
    await tx
      .update(invoiceTemplates)
      .set({
        ...(input.name ? { name: input.name } : {}),
        currentVersionId: version.id,
        updatedBy: actor.userId,
      })
      .where(eq(invoiceTemplates.id, template.id));
  });
  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.storeInvoiceTemplatesUpdate,
    resourceType: "invoice_template",
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { versionNo: newVersionNo },
  });
  return getTemplateState(db);
}

// ---------------------------------------------------------------------------
// Invoice numbers (§10.2)
// ---------------------------------------------------------------------------

function sequenceScope(year: number): string {
  return `INVOICE:${year}`;
}

/**
 * Lock the current year's INVOICE sequence row. Called FIRST in the
 * approval transaction (§10.2); the increment happens later, only
 * after the order's state validated — a rejected approval consumes no
 * number.
 */
export async function lockInvoiceSequence(tx: DbLike, at: Date): Promise<void> {
  const scope = sequenceScope(at.getUTCFullYear());
  await tx
    .insert(invoiceSequences)
    .values({ scope, lastValue: 0 })
    .onDuplicateKeyUpdate({ set: { scope } });
  await tx
    .select({ lastValue: invoiceSequences.lastValue })
    .from(invoiceSequences)
    .where(eq(invoiceSequences.scope, scope))
    .for("update");
}

/** Increment the (already locked) sequence and format the number. */
export async function takeInvoiceNumber(
  tx: DbLike,
  prefix: string,
  at: Date,
): Promise<string> {
  const year = at.getUTCFullYear();
  const scope = sequenceScope(year);
  const [row] = await tx
    .select({ lastValue: invoiceSequences.lastValue })
    .from(invoiceSequences)
    .where(eq(invoiceSequences.scope, scope))
    .limit(1);
  const next = (row?.lastValue ?? 0) + 1;
  await tx
    .update(invoiceSequences)
    .set({ lastValue: next })
    .where(eq(invoiceSequences.scope, scope));
  return `${prefix}-${year}-${String(next).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Snapshot + creation (inside the approval transaction)
// ---------------------------------------------------------------------------

export function buildInvoiceSnapshot(
  order: OrderRow,
  items: OrderItemRow[],
  invoiceNumber: string,
  issuedAt: Date,
  version: { id: number; versionNo: number },
  config: InvoiceTemplateConfig,
): InvoiceSnapshot {
  return {
    invoiceNumber,
    issuedAt: issuedAt.toISOString(),
    orderNumber: order.orderNumber,
    orderPlacedAt: order.placedAt.toISOString(),
    currency: order.currency,
    paymentMethod: order.paymentMethod,
    seller: {
      name: config.companyName,
      address: config.companyAddress,
      phone: config.companyPhone ?? null,
      email: config.companyEmail ?? null,
      taxRegistrationNumber: config.taxRegistrationNumber ?? null,
      logoMediaId: config.logoMediaId ?? null,
    },
    buyer: {
      name: order.shipRecipientName,
      email: order.customerEmailSnapshot,
      phone: order.shipPhone,
    },
    delivery: {
      recipientName: order.shipRecipientName,
      phone: order.shipPhone,
      addressLine: order.shipAddressLine,
      city: order.shipCity,
      district: order.shipDistrict,
      postalCode: order.shipPostalCode,
      notes: order.shipNotes,
    },
    lines: items.map((item) => ({
      name: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      sku: item.skuSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    totals: {
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      grandTotal: order.grandTotal,
    },
    template: { versionId: version.id, versionNo: version.versionNo, config },
  };
}

export interface CreatedInvoice {
  invoice: InvoiceRow;
  snapshot: InvoiceSnapshot;
}

/**
 * Create the invoice for an order inside the approval transaction and
 * enqueue its email (transactional outbox — the send itself happens
 * later in the drain and can never roll back the approval).
 */
export async function createInvoiceForOrder(
  tx: DbLike,
  order: OrderRow,
  items: OrderItemRow[],
  actor: StoreActor,
  issuedAt: Date,
): Promise<CreatedInvoice> {
  const { version, config } = await getActiveTemplateVersion(tx);
  const invoiceNumber = await takeInvoiceNumber(tx, config.invoicePrefix, issuedAt);
  const snapshot = buildInvoiceSnapshot(
    order,
    items,
    invoiceNumber,
    issuedAt,
    { id: version.id, versionNo: version.versionNo },
    config,
  );
  const pdfStorageName = invoicePdfStorageName(snapshot);
  const [inserted] = await tx
    .insert(invoices)
    .values({
      invoiceNumber,
      orderId: order.id,
      templateVersionId: version.id,
      currency: order.currency,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      grandTotal: order.grandTotal,
      snapshot,
      pdfStorageName,
      emailStatus: "PENDING",
      issuedAt,
      issuedBy: actor.userId,
    })
    .$returningId();
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, inserted.id))
    .limit(1);

  await enqueueEmail(tx, {
    type: "INVOICE",
    recipientEmail: order.customerEmailSnapshot,
    recipientUserId: order.userId,
    subject: `Your order ${order.orderNumber} is approved — invoice ${invoiceNumber}`,
    text:
      `Dear ${order.shipRecipientName},\n\n` +
      `Your order ${order.orderNumber} has been approved. ` +
      `Invoice ${invoiceNumber} for ${order.currency} ${order.grandTotal} is attached as a PDF.\n\n` +
      `Payment is collected on delivery (cash on delivery).\n\n` +
      `${config.companyName}`,
    attachmentStorageName: pdfStorageName,
    relatedType: "invoice",
    relatedId: invoice.id,
  });

  return { invoice, snapshot };
}

// ---------------------------------------------------------------------------
// Views + access
// ---------------------------------------------------------------------------

export interface InvoiceView {
  id: number;
  invoiceNumber: string;
  orderId: number;
  orderNumber: string;
  templateVersionId: number | null;
  currency: string;
  subtotalPaisa: number;
  shippingFeePaisa: number;
  discountTotalPaisa: number;
  taxTotalPaisa: number;
  grandTotalPaisa: number;
  emailStatus: string;
  issuedAt: Date;
  issuedBy: number | null;
}

export function toInvoiceView(invoice: InvoiceRow, orderNumber: string): InvoiceView {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    orderNumber,
    templateVersionId: invoice.templateVersionId,
    currency: invoice.currency,
    subtotalPaisa: parseMoneyToMinorUnits(invoice.subtotal),
    shippingFeePaisa: parseMoneyToMinorUnits(invoice.shippingFee),
    discountTotalPaisa: parseMoneyToMinorUnits(invoice.discountTotal),
    taxTotalPaisa: parseMoneyToMinorUnits(invoice.taxTotal),
    grandTotalPaisa: parseMoneyToMinorUnits(invoice.grandTotal),
    emailStatus: invoice.emailStatus,
    issuedAt: invoice.issuedAt,
    issuedBy: invoice.issuedBy,
  };
}

export async function getInvoiceByOrderId(
  db: DbLike,
  orderId: number,
): Promise<InvoiceRow | null> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .limit(1);
  return invoice ?? null;
}

export async function listAdminInvoices(
  db: DbLike,
  pagination: { page: number; pageSize: number },
): Promise<{ items: InvoiceView[]; total: number }> {
  const rows = await db
    .select({ invoice: invoices, orderNumber: orders.orderNumber })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .orderBy(desc(invoices.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  const [totalRow] = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(invoices);
  return {
    items: rows.map((row) => toInvoiceView(row.invoice, row.orderNumber)),
    total: Number(totalRow?.value ?? 0),
  };
}

export async function getAdminInvoice(
  db: DbLike,
  invoiceId: number,
): Promise<{
  view: InvoiceView;
  snapshot: InvoiceSnapshot;
  invoice: InvoiceRow;
  /** Phase 8: the credit note reversing this invoice, when present. */
  creditNote: CreditNoteSummary | null;
} | null> {
  const [row] = await db
    .select({ invoice: invoices, orderNumber: orders.orderNumber })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!row) return null;
  const creditNote = await getCreditNoteByInvoiceId(db, invoiceId);
  return {
    view: toInvoiceView(row.invoice, row.orderNumber),
    snapshot: row.invoice.snapshot as InvoiceSnapshot,
    invoice: row.invoice,
    creditNote: creditNote ? toCreditNoteSummary(creditNote) : null,
  };
}

/** PDF bytes for an invoice row (stored file, or re-rendered cache). */
export async function getInvoicePdfBuffer(
  deps: OrdersDeps,
  invoice: InvoiceRow,
): Promise<Buffer> {
  if (!invoice.pdfStorageName) throw AppError.internal();
  const snapshot = invoice.snapshot as InvoiceSnapshot;
  const logoImage = await resolveInvoiceLogoImage(deps.db, deps.config, snapshot);
  return ensureInvoicePdf(deps.config, invoice.pdfStorageName, snapshot, logoImage);
}

// ---------------------------------------------------------------------------
// Resend (admin) — re-queues the SAME invoice; never a second invoice
// ---------------------------------------------------------------------------

export async function resendInvoiceEmail(
  deps: OrdersDeps,
  orderId: number,
  actor: StoreActor,
  meta: RequestMeta,
): Promise<InvoiceView> {
  const { db } = deps;
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) throw AppError.notFound("Order not found.");
  const invoice = await getInvoiceByOrderId(db, orderId);
  if (!invoice) throw AppError.notFound("This order has no invoice yet.");

  // Refuse to double-queue: an in-flight row already carries the send.
  // The newest row also supplies the body copy for the re-send, so the
  // customer receives the identical email (same invoice, same PDF).
  const rows = await db
    .select({
      status: emailOutbox.status,
      templateData: emailOutbox.templateData,
    })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.relatedType, "invoice"),
        eq(emailOutbox.relatedId, invoice.id),
        eq(emailOutbox.type, "INVOICE"),
      ),
    )
    .orderBy(desc(emailOutbox.id));
  if (rows.some((row) => row.status === "PENDING" || row.status === "PROCESSING")) {
    throw AppError.conflict("The invoice email is already queued for delivery.");
  }
  const original = rows[0];
  const originalData = (original?.templateData ?? {}) as { text?: string; html?: string };

  await db.transaction(async (tx) => {
    await enqueueEmail(tx, {
      type: "INVOICE",
      recipientEmail: order.customerEmailSnapshot,
      recipientUserId: order.userId,
      subject: `Invoice ${invoice.invoiceNumber} for your order ${order.orderNumber}`,
      text:
        originalData.text ??
        `Your invoice ${invoice.invoiceNumber} for order ${order.orderNumber} is attached as a PDF.`,
      ...(originalData.html ? { html: originalData.html } : {}),
      attachmentStorageName: invoice.pdfStorageName,
      relatedType: "invoice",
      relatedId: invoice.id,
    });
    await tx
      .update(invoices)
      .set({ emailStatus: "PENDING" })
      .where(eq(invoices.id, invoice.id));
  });
  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.storeInvoicesResend,
    resourceType: "invoice",
    resourceId: invoice.id,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { orderId, invoiceNumber: invoice.invoiceNumber },
  });
  drainOutboxSoon(deps);
  return toInvoiceView(invoice, order.orderNumber);
}
