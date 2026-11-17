/**
 * Inventory reconciliation (Phase 8d ops utility).
 *
 * Recomputes the truth from the append-only `inventory_movements`
 * ledger and compares it with the cached balances and the order /
 * invoice records (DATABASE_DESIGN.md §9.5: "the reconciliation check
 * compares the on-hand movement sum against stock_qty"). The ledger
 * tracks two balances (see the store schema header):
 *
 *   on-hand   = SUM(quantity) over OPENING, PURCHASE, ADJUSTMENT_IN,
 *               ADJUSTMENT_OUT, ORDER_DEDUCT, ORDER_RESTORE, CORRECTION
 *   available = stock_qty + SUM(quantity) over RESERVE, RELEASE (≤ 0)
 *
 * Checks performed (report-only — this module NEVER writes):
 *   1. per product (no variants) / per variant: ledger on-hand vs the
 *      stored stock_qty; for variant products, products.stock_qty vs
 *      the sum of its variants (the §9.4 mirror);
 *   2. negative ledger-derived availability anywhere;
 *   3. per order line: RESERVE/RELEASE and ORDER_DEDUCT/ORDER_RESTORE
 *      nets vs the line quantity, with expectations per order status
 *      (pending: reserved, not deducted; approved+: reservation
 *      closed, deducted; cancelled: everything netted to zero);
 *   4. invoices whose order is missing; orders APPROVED or beyond
 *      with no invoice; credit notes whose invoice is missing.
 *
 * Lines of untracked products (track_inventory = false) and lines
 * whose product row is gone carry no movements by design and are
 * counted as skipped, never flagged.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { creditNotes, invoices } from "../../database/schema/invoices.js";
import {
  inventoryMovements,
  orderItems,
  orders,
  products,
  productVariants,
} from "../../database/schema/store.js";

const ON_HAND_TYPES = [
  "OPENING",
  "PURCHASE",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "ORDER_DEDUCT",
  "ORDER_RESTORE",
  "CORRECTION",
] as const;

export interface Discrepancy {
  check: string;
  detail: string;
}

export interface StockLine {
  label: string;
  storedStock: number;
  ledgerOnHand: number;
  reservedOutstanding: number;
  ledgerAvailable: number;
}

export interface ReconcileReport {
  stockLines: StockLine[];
  productsChecked: number;
  variantsChecked: number;
  ordersChecked: number;
  invoicesChecked: number;
  creditNotesChecked: number;
  orderLinesSkipped: number;
  discrepancies: Discrepancy[];
}

type MovementKey = string;
const keyOf = (productId: number, variantId: number | null): MovementKey =>
  `${productId}:${variantId ?? "null"}`;

export async function reconcileInventory(
  db: Database,
): Promise<ReconcileReport> {
  const discrepancies: Discrepancy[] = [];
  const flag = (check: string, detail: string) =>
    discrepancies.push({ check, detail });

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      stockQty: products.stockQty,
      trackInventory: products.trackInventory,
    })
    .from(products);
  const variantRows = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      name: productVariants.name,
      stockQty: productVariants.stockQty,
    })
    .from(productVariants);

  // Movement sums grouped by (product, variant, type).
  const movementRows = await db
    .select({
      productId: inventoryMovements.productId,
      variantId: inventoryMovements.variantId,
      movementType: inventoryMovements.movementType,
      total: sql<number>`CAST(SUM(${inventoryMovements.quantity}) AS SIGNED)`,
    })
    .from(inventoryMovements)
    .groupBy(
      inventoryMovements.productId,
      inventoryMovements.variantId,
      inventoryMovements.movementType,
    );

  const onHandByScope = new Map<MovementKey, number>();
  const poolByScope = new Map<MovementKey, number>();
  for (const row of movementRows) {
    const key = keyOf(row.productId, row.variantId);
    const total = Number(row.total);
    if ((ON_HAND_TYPES as readonly string[]).includes(row.movementType)) {
      onHandByScope.set(key, (onHandByScope.get(key) ?? 0) + total);
    } else if (
      row.movementType === "RESERVE" ||
      row.movementType === "RELEASE"
    ) {
      poolByScope.set(key, (poolByScope.get(key) ?? 0) + total);
    } else {
      flag(
        "unknown-movement-type",
        `movement type '${row.movementType}' on product ${row.productId} is not a known ledger type`,
      );
    }
  }

  const variantsByProduct = new Map<number, typeof variantRows>();
  for (const variant of variantRows) {
    const list = variantsByProduct.get(variant.productId) ?? [];
    list.push(variant);
    variantsByProduct.set(variant.productId, list);
  }

  // -- Checks 1 + 2: stored balances vs the ledger --------------------
  const stockLines: StockLine[] = [];
  let variantsChecked = 0;
  for (const product of productRows) {
    if (!product.trackInventory) continue;
    const variants = variantsByProduct.get(product.id) ?? [];
    if (variants.length === 0) {
      const key = keyOf(product.id, null);
      const ledgerOnHand = onHandByScope.get(key) ?? 0;
      const reservedOutstanding = -(poolByScope.get(key) ?? 0);
      const ledgerAvailable = product.stockQty - reservedOutstanding;
      stockLines.push({
        label: product.name,
        storedStock: product.stockQty,
        ledgerOnHand,
        reservedOutstanding,
        ledgerAvailable,
      });
      if (ledgerOnHand !== product.stockQty) {
        flag(
          "stock-vs-ledger",
          `product ${product.id} (${product.name}): stored stock_qty=${product.stockQty} but on-hand ledger sum=${ledgerOnHand}`,
        );
      }
      if (ledgerAvailable < 0) {
        flag(
          "negative-availability",
          `product ${product.id} (${product.name}): ledger-derived availability is ${ledgerAvailable}`,
        );
      }
    } else {
      const productLevelOnHand = onHandByScope.get(keyOf(product.id, null));
      if (productLevelOnHand !== undefined && productLevelOnHand !== 0) {
        flag(
          "stock-vs-ledger",
          `product ${product.id} (${product.name}): has variants but also product-level on-hand movements summing to ${productLevelOnHand}`,
        );
      }
      let variantStockSum = 0;
      for (const variant of variants) {
        variantsChecked += 1;
        variantStockSum += variant.stockQty;
        const key = keyOf(product.id, variant.id);
        const ledgerOnHand = onHandByScope.get(key) ?? 0;
        const reservedOutstanding = -(poolByScope.get(key) ?? 0);
        const ledgerAvailable = variant.stockQty - reservedOutstanding;
        stockLines.push({
          label: `${product.name} / ${variant.name}`,
          storedStock: variant.stockQty,
          ledgerOnHand,
          reservedOutstanding,
          ledgerAvailable,
        });
        if (ledgerOnHand !== variant.stockQty) {
          flag(
            "stock-vs-ledger",
            `variant ${variant.id} (${product.name} / ${variant.name}): stored stock_qty=${variant.stockQty} but on-hand ledger sum=${ledgerOnHand}`,
          );
        }
        if (ledgerAvailable < 0) {
          flag(
            "negative-availability",
            `variant ${variant.id} (${product.name} / ${variant.name}): ledger-derived availability is ${ledgerAvailable}`,
          );
        }
      }
      if (product.stockQty !== variantStockSum) {
        flag(
          "stock-mirror",
          `product ${product.id} (${product.name}): products.stock_qty=${product.stockQty} but the variant sum is ${variantStockSum}`,
        );
      }
    }
  }

  // -- Check 3: per-order-line movement nets --------------------------
  const orderRows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
    })
    .from(orders);
  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
    })
    .from(orderItems);
  const orderMovementRows = await db
    .select({
      orderId: inventoryMovements.orderId,
      productId: inventoryMovements.productId,
      variantId: inventoryMovements.variantId,
      movementType: inventoryMovements.movementType,
      total: sql<number>`CAST(SUM(${inventoryMovements.quantity}) AS SIGNED)`,
    })
    .from(inventoryMovements)
    .groupBy(
      inventoryMovements.orderId,
      inventoryMovements.productId,
      inventoryMovements.variantId,
      inventoryMovements.movementType,
    );

  const orderNet = new Map<
    string,
    { reserveNet: number; deductNet: number }
  >();
  for (const row of orderMovementRows) {
    if (row.orderId === null) continue;
    const key = `${row.orderId}:${keyOf(row.productId, row.variantId)}`;
    const entry = orderNet.get(key) ?? { reserveNet: 0, deductNet: 0 };
    if (
      row.movementType === "RESERVE" ||
      row.movementType === "RELEASE"
    ) {
      entry.reserveNet += Number(row.total);
    } else if (
      row.movementType === "ORDER_DEDUCT" ||
      row.movementType === "ORDER_RESTORE"
    ) {
      entry.deductNet += Number(row.total);
    }
    orderNet.set(key, entry);
  }

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const orderById = new Map(orderRows.map((o) => [o.id, o]));
  const lineQty = new Map<string, number>();
  let orderLinesSkipped = 0;
  for (const item of itemRows) {
    if (item.productId === null) {
      orderLinesSkipped += 1;
      continue;
    }
    const product = productById.get(item.productId);
    if (!product || !product.trackInventory) {
      orderLinesSkipped += 1;
      continue;
    }
    const key = `${item.orderId}:${keyOf(item.productId, item.variantId)}`;
    lineQty.set(key, (lineQty.get(key) ?? 0) + item.quantity);
  }

  for (const [key, qty] of lineQty) {
    const orderId = Number(key.split(":")[0]);
    const order = orderById.get(orderId);
    if (!order) continue;
    const nets = orderNet.get(key) ?? { reserveNet: 0, deductNet: 0 };
    const expect = (reserveNet: number, deductNet: number) => {
      if (nets.reserveNet !== reserveNet || nets.deductNet !== deductNet) {
        flag(
          "order-movements",
          `order ${order.orderNumber} (${order.status}) line ${key.split(":").slice(1).join(":")}: expected RESERVE/RELEASE net=${reserveNet} and ORDER_DEDUCT/RESTORE net=${deductNet} for quantity ${qty}, found ${nets.reserveNet} / ${nets.deductNet}`,
        );
      }
    };
    switch (order.status) {
      case "PENDING_APPROVAL":
        expect(-qty, 0);
        break;
      case "APPROVED":
      case "PROCESSING":
      case "SHIPPED":
      case "DELIVERED":
        expect(0, -qty);
        break;
      case "CANCELLED":
        expect(0, 0);
        break;
      default:
        flag(
          "order-movements",
          `order ${order.orderNumber} has unknown status '${order.status}'`,
        );
    }
  }

  // -- Check 4: invoice / credit-note referential sanity --------------
  const invoiceRows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      orderId: invoices.orderId,
    })
    .from(invoices);
  const invoicedOrderIds = new Set(invoiceRows.map((i) => i.orderId));
  for (const invoice of invoiceRows) {
    if (!orderById.has(invoice.orderId)) {
      flag(
        "invoice-without-order",
        `invoice ${invoice.invoiceNumber} references missing order ${invoice.orderId}`,
      );
    }
  }
  for (const order of orderRows) {
    if (
      ["APPROVED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(
        order.status,
      ) &&
      !invoicedOrderIds.has(order.id)
    ) {
      flag(
        "order-without-invoice",
        `order ${order.orderNumber} is ${order.status} but has no invoice`,
      );
    }
  }
  const creditNoteRows = await db
    .select({
      id: creditNotes.id,
      creditNoteNumber: creditNotes.creditNoteNumber,
      invoiceId: creditNotes.invoiceId,
    })
    .from(creditNotes);
  const invoiceIds = new Set(invoiceRows.map((i) => i.id));
  for (const note of creditNoteRows) {
    if (!invoiceIds.has(note.invoiceId)) {
      flag(
        "credit-note-without-invoice",
        `credit note ${note.creditNoteNumber} references missing invoice ${note.invoiceId}`,
      );
    }
  }

  return {
    stockLines,
    productsChecked: productRows.filter((p) => p.trackInventory).length,
    variantsChecked,
    ordersChecked: orderRows.length,
    invoicesChecked: invoiceRows.length,
    creditNotesChecked: creditNoteRows.length,
    orderLinesSkipped,
    discrepancies,
  };
}
