/**
 * Store insights (2026-11-27) — the admin Store dashboard's numbers.
 *
 * Definitions (reviewed 2026-11-27 by ChatGPT Thinking + Gemini):
 *  - "Qualifying" orders = APPROVED, PROCESSING, SHIPPED, DELIVERED.
 *    PENDING_APPROVAL is not yet a sale; CANCELLED never counts (a
 *    cancel after approval carries a full credit note and the order
 *    leaves the qualifying set by status alone).
 *  - Order value = SUM(grand_total) of qualifying orders in the
 *    period (includes shipping + tax — labelled as order value,
 *    never "revenue"). Delivered sales = the DELIVERED-only sum.
 *  - Periods are Asia/Kathmandu wall-clock windows, half-open
 *    [start, end); stored placed_at values are UTC (the connection
 *    is pinned to +00:00), so boundaries are converted to UTC
 *    instants and the filters stay sargable range predicates.
 *  - Money is integer paisa end to end (shared money helpers);
 *    SQL SUMs over DECIMAL columns return strings, converted once.
 *  - Repeat purchase rate = share of the period's purchasers who
 *    hold ≥2 LIFETIME qualifying orders.
 *  - Retail stock value is computed in JS from product/variant
 *    rows (never SQL decimal multiplication): a product with no
 *    variants contributes stock × effective price; a product with
 *    variants contributes ACTIVE variants only (stock × (effective
 *    price + price_delta)); variants present but none active → 0.
 */
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import {
  orderItems,
  orders,
  productVariants,
  products,
  roles,
  userRoles,
  users,
} from "../../database/schema/index.js";
import { parseMoneyToMinorUnits } from "../../utils/money.js";

export type InsightsRange = "7d" | "30d" | "90d" | "12m" | "all";
export const INSIGHTS_RANGES: readonly InsightsRange[] = [
  "7d",
  "30d",
  "90d",
  "12m",
  "all",
];

const QUALIFYING = ["APPROVED", "PROCESSING", "SHIPPED", "DELIVERED"] as const;
const KTM_OFFSET_MIN = 345; // Asia/Kathmandu = UTC+05:45, no DST.
const DAY_MS = 86_400_000;

export interface RangeWindow {
  /** UTC instant of the period start (null = unbounded, range=all). */
  start: Date | null;
  /** UTC instant of the period end (exclusive). */
  end: Date;
  prevStart: Date | null;
  prevEnd: Date | null;
  bucket: "day" | "month";
  /** Kathmandu bucket keys covered by the window, ascending. */
  bucketKeys: string[];
}

function wallToUtc(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day) - KTM_OFFSET_MIN * 60_000);
}

function dayKey(wallMs: number): string {
  const d = new Date(wallMs);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function monthKey(wallMs: number): string {
  const d = new Date(wallMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Resolve a range name to its Kathmandu window at instant `now`. */
export function rangeWindow(range: InsightsRange, now: Date): RangeWindow {
  // Kathmandu wall clock = UTC instant + 5:45; read its UTC fields.
  const wall = new Date(now.getTime() + KTM_OFFSET_MIN * 60_000);
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth();
  const d = wall.getUTCDate();

  if (range === "all") {
    return {
      start: null,
      end: wallToUtc(y, m, d + 1),
      prevStart: null,
      prevEnd: null,
      bucket: "month",
      bucketKeys: [],
    };
  }

  if (range === "12m") {
    const endWall = Date.UTC(y, m + 1, 1);
    const startWall = Date.UTC(y, m + 1 - 12, 1);
    const keys: string[] = [];
    for (let t = startWall; t < endWall; t = Date.UTC(...nextMonth(t))) {
      keys.push(monthKey(t));
    }
    return {
      start: new Date(startWall - KTM_OFFSET_MIN * 60_000),
      end: new Date(endWall - KTM_OFFSET_MIN * 60_000),
      prevStart: new Date(
        Date.UTC(y, m + 1 - 24, 1) - KTM_OFFSET_MIN * 60_000,
      ),
      prevEnd: new Date(startWall - KTM_OFFSET_MIN * 60_000),
      bucket: "month",
      bucketKeys: keys,
    };
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const endWall = Date.UTC(y, m, d + 1);
  const startWall = endWall - days * DAY_MS;
  const keys: string[] = [];
  for (let t = startWall; t < endWall; t += DAY_MS) keys.push(dayKey(t));
  return {
    start: new Date(startWall - KTM_OFFSET_MIN * 60_000),
    end: new Date(endWall - KTM_OFFSET_MIN * 60_000),
    prevStart: new Date(startWall - days * DAY_MS - KTM_OFFSET_MIN * 60_000),
    prevEnd: new Date(startWall - KTM_OFFSET_MIN * 60_000),
    bucket: "day",
    bucketKeys: keys,
  };
}

function nextMonth(wallMs: number): [number, number, number] {
  const d = new Date(wallMs);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, 1];
}

interface PeriodTotals {
  orders: number;
  orderValuePaisa: number;
  deliveredPaisa: number;
}

async function periodTotals(
  db: Database,
  start: Date | null,
  end: Date,
): Promise<PeriodTotals> {
  const conditions = [
    inArray(orders.status, [...QUALIFYING]),
    lt(orders.placedAt, end),
  ];
  if (start) conditions.push(gte(orders.placedAt, start));
  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      value: sql<string>`COALESCE(SUM(${orders.grandTotal}), 0)`,
      delivered: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'DELIVERED' THEN ${orders.grandTotal} ELSE 0 END), 0)`,
    })
    .from(orders)
    .where(and(...conditions));
  return {
    orders: Number(row?.count ?? 0),
    orderValuePaisa: parseMoneyToMinorUnits(String(row?.value ?? "0")) ?? 0,
    deliveredPaisa: parseMoneyToMinorUnits(String(row?.delivered ?? "0")) ?? 0,
  };
}

async function newCustomerAccounts(
  db: Database,
  start: Date | null,
  end: Date,
): Promise<number> {
  const conditions = [
    eq(roles.code, "CUSTOMER"),
    lt(users.createdAt, end),
  ];
  if (start) conditions.push(gte(users.createdAt, start));
  const [row] = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${users.id})` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

/** Repeat rate (0–100, 1 decimal) or null when there were no purchasers. */
async function repeatPurchaseRate(
  db: Database,
  start: Date | null,
  end: Date,
): Promise<number | null> {
  const conditions = [
    inArray(orders.status, [...QUALIFYING]),
    lt(orders.placedAt, end),
  ];
  if (start) conditions.push(gte(orders.placedAt, start));
  const purchasers = await db
    .select({ userId: orders.userId })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.userId);
  if (purchasers.length === 0) return null;
  const ids = purchasers.map((p) => p.userId);
  const lifetime = await db
    .select({ userId: orders.userId, count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(
      and(inArray(orders.status, [...QUALIFYING]), inArray(orders.userId, ids)),
    )
    .groupBy(orders.userId);
  const repeat = lifetime.filter((r) => Number(r.count) >= 2).length;
  return Math.round((repeat / purchasers.length) * 1000) / 10;
}

async function retailStockValuePaisa(db: Database): Promise<number> {
  const productRows = await db
    .select({
      id: products.id,
      price: products.price,
      salePrice: products.salePrice,
      stockQty: products.stockQty,
    })
    .from(products)
    .where(and(eq(products.status, "ACTIVE"), isNull(products.deletedAt)));
  if (productRows.length === 0) return 0;
  const variantRows = await db
    .select({
      productId: productVariants.productId,
      priceDelta: productVariants.priceDelta,
      stockQty: productVariants.stockQty,
      isActive: productVariants.isActive,
    })
    .from(productVariants)
    .where(
      inArray(
        productVariants.productId,
        productRows.map((p) => p.id),
      ),
    );
  const byProduct = new Map<number, typeof variantRows>();
  for (const v of variantRows) {
    const list = byProduct.get(v.productId) ?? [];
    list.push(v);
    byProduct.set(v.productId, list);
  }
  let total = 0;
  for (const p of productRows) {
    const effective =
      parseMoneyToMinorUnits(p.salePrice ?? p.price) ??
      parseMoneyToMinorUnits(p.price) ??
      0;
    const variants = byProduct.get(p.id) ?? [];
    if (variants.length === 0) {
      total += p.stockQty * effective;
      continue;
    }
    for (const v of variants) {
      if (!v.isActive) continue;
      const unit = effective + (parseMoneyToMinorUnits(v.priceDelta) ?? 0);
      total += v.stockQty * unit;
    }
  }
  return total;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export interface StoreInsights {
  range: InsightsRange;
  timezone: "Asia/Kathmandu";
  generatedAt: string;
  kpis: {
    orderValuePaisa: number;
    deliveredSalesPaisa: number;
    orders: number;
    aovPaisa: number;
    newCustomerAccounts: number;
    repeatPurchaseRatePct: number | null;
    pendingApprovals: number;
    activeProducts: number;
    retailStockValuePaisa: number;
  };
  deltas: {
    orderValuePct: number | null;
    deliveredSalesPct: number | null;
    ordersPct: number | null;
    aovPct: number | null;
    newCustomerAccountsPct: number | null;
    repeatPurchaseRatePoints: number | null;
  } | null;
  series: Array<{ bucket: string; orderValuePaisa: number; orders: number }>;
  topProducts: Array<{
    productId: number | null;
    name: string;
    units: number;
    revenuePaisa: number;
  }>;
  topCustomers: Array<{ name: string; orders: number; spendPaisa: number }>;
  recentOrders: Array<{
    id: number;
    orderNumber: string;
    placedAt: string;
    customerName: string;
    status: string;
    grandTotalPaisa: number;
  }>;
}

export async function getStoreInsights(
  db: Database,
  range: InsightsRange,
  now: Date = new Date(),
): Promise<StoreInsights> {
  const w = rangeWindow(range, now);

  const current = await periodTotals(db, w.start, w.end);
  const prev =
    w.prevEnd !== null
      ? await periodTotals(db, w.prevStart, w.prevEnd)
      : null;
  const newCustomers = await newCustomerAccounts(db, w.start, w.end);
  const prevNewCustomers =
    w.prevEnd !== null
      ? await newCustomerAccounts(db, w.prevStart, w.prevEnd)
      : null;
  const repeat = await repeatPurchaseRate(db, w.start, w.end);
  const prevRepeat =
    w.prevEnd !== null
      ? await repeatPurchaseRate(db, w.prevStart, w.prevEnd)
      : null;

  const [pendingRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(eq(orders.status, "PENDING_APPROVAL"));
  const [activeRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(products)
    .where(and(eq(products.status, "ACTIVE"), isNull(products.deletedAt)));
  const stockValue = await retailStockValuePaisa(db);

  // Sales series: group on the Kathmandu-shifted date; the WHERE
  // filter stays a sargable range on placed_at.
  const bucketExpr =
    w.bucket === "day"
      ? sql<string>`DATE_FORMAT(DATE_ADD(${orders.placedAt}, INTERVAL ${KTM_OFFSET_MIN} MINUTE), '%Y-%m-%d')`
      : sql<string>`DATE_FORMAT(DATE_ADD(${orders.placedAt}, INTERVAL ${KTM_OFFSET_MIN} MINUTE), '%Y-%m')`;
  const seriesConditions = [
    inArray(orders.status, [...QUALIFYING]),
    lt(orders.placedAt, w.end),
  ];
  if (w.start) seriesConditions.push(gte(orders.placedAt, w.start));
  const seriesRows = await db
    .select({
      bucket: bucketExpr,
      value: sql<string>`COALESCE(SUM(${orders.grandTotal}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .where(and(...seriesConditions))
    .groupBy(bucketExpr)
    .orderBy(bucketExpr);
  const byBucket = new Map(
    seriesRows.map((r) => [
      r.bucket,
      {
        orderValuePaisa: parseMoneyToMinorUnits(String(r.value)) ?? 0,
        orders: Number(r.count),
      },
    ]),
  );
  const keys =
    w.bucketKeys.length > 0
      ? w.bucketKeys
      : [...byBucket.keys()].sort();
  const series = keys.map((bucket) => ({
    bucket,
    orderValuePaisa: byBucket.get(bucket)?.orderValuePaisa ?? 0,
    orders: byBucket.get(bucket)?.orders ?? 0,
  }));

  const topProductRows = await db
    .select({
      productId: orderItems.productId,
      name: sql<string>`MAX(${orderItems.productNameSnapshot})`,
      units: sql<number>`SUM(${orderItems.quantity})`,
      revenue: sql<string>`COALESCE(SUM(${orderItems.lineTotal}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        inArray(orders.status, [...QUALIFYING]),
        lt(orders.placedAt, w.end),
        ...(w.start ? [gte(orders.placedAt, w.start)] : []),
        sql`${orderItems.productId} IS NOT NULL`,
      ),
    )
    .groupBy(orderItems.productId)
    .orderBy(
      desc(sql`SUM(${orderItems.quantity})`),
      desc(sql`SUM(${orderItems.lineTotal})`),
    )
    .limit(5);

  const topCustomerRows = await db
    .select({
      name: users.fullName,
      count: sql<number>`COUNT(*)`,
      spend: sql<string>`COALESCE(SUM(${orders.grandTotal}), 0)`,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      and(
        inArray(orders.status, [...QUALIFYING]),
        lt(orders.placedAt, w.end),
        ...(w.start ? [gte(orders.placedAt, w.start)] : []),
      ),
    )
    .groupBy(orders.userId, users.fullName)
    .orderBy(desc(sql`SUM(${orders.grandTotal})`))
    .limit(5);

  const recentRows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      placedAt: orders.placedAt,
      status: orders.status,
      grandTotal: orders.grandTotal,
      customerName: users.fullName,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(8);

  const aov =
    current.orders > 0
      ? Math.round(current.orderValuePaisa / current.orders)
      : 0;
  const prevAov =
    prev && prev.orders > 0
      ? Math.round(prev.orderValuePaisa / prev.orders)
      : 0;

  return {
    range,
    timezone: "Asia/Kathmandu",
    generatedAt: now.toISOString(),
    kpis: {
      orderValuePaisa: current.orderValuePaisa,
      deliveredSalesPaisa: current.deliveredPaisa,
      orders: current.orders,
      aovPaisa: aov,
      newCustomerAccounts: newCustomers,
      repeatPurchaseRatePct: repeat,
      pendingApprovals: Number(pendingRow?.count ?? 0),
      activeProducts: Number(activeRow?.count ?? 0),
      retailStockValuePaisa: stockValue,
    },
    deltas: prev
      ? {
          orderValuePct: pctDelta(current.orderValuePaisa, prev.orderValuePaisa),
          deliveredSalesPct: pctDelta(current.deliveredPaisa, prev.deliveredPaisa),
          ordersPct: pctDelta(current.orders, prev.orders),
          aovPct: pctDelta(aov, prevAov),
          newCustomerAccountsPct:
            prevNewCustomers !== null
              ? pctDelta(newCustomers, prevNewCustomers)
              : null,
          repeatPurchaseRatePoints:
            repeat !== null && prevRepeat !== null
              ? Math.round((repeat - prevRepeat) * 10) / 10
              : null,
        }
      : null,
    series,
    topProducts: topProductRows.map((r) => ({
      productId: r.productId,
      name: r.name,
      units: Number(r.units),
      revenuePaisa: parseMoneyToMinorUnits(String(r.revenue)) ?? 0,
    })),
    topCustomers: topCustomerRows.map((r) => ({
      name: r.name,
      orders: Number(r.count),
      spendPaisa: parseMoneyToMinorUnits(String(r.spend)) ?? 0,
    })),
    recentOrders: recentRows.map((r) => ({
      id: r.id,
      orderNumber: r.orderNumber,
      placedAt: r.placedAt.toISOString(),
      customerName: r.customerName,
      status: r.status,
      grandTotalPaisa: parseMoneyToMinorUnits(r.grandTotal) ?? 0,
    })),
  };
}

export interface ExportOrderRow {
  orderNumber: string;
  placedAt: Date;
  customerName: string;
  customerEmail: string;
  status: string;
  items: number;
  subtotal: string;
  shippingFee: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
}

/** All orders in the window (every status), newest first, capped. */
export async function listOrdersForExport(
  db: Database,
  start: Date | null,
  end: Date,
  capPlusOne: number,
): Promise<ExportOrderRow[]> {
  const conditions = [lt(orders.placedAt, end)];
  if (start) conditions.push(gte(orders.placedAt, start));
  const rows = await db
    .select({
      orderNumber: orders.orderNumber,
      placedAt: orders.placedAt,
      customerName: users.fullName,
      customerEmail: users.email,
      status: orders.status,
      items: sql<number>`(SELECT COUNT(*) FROM ${orderItems} WHERE ${orderItems.orderId} = ${orders.id})`,
      subtotal: orders.subtotal,
      shippingFee: orders.shippingFee,
      discountTotal: orders.discountTotal,
      taxTotal: orders.taxTotal,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(...conditions))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(capPlusOne);
  return rows.map((r) => ({ ...r, items: Number(r.items) }));
}

export async function countOrdersInWindow(
  db: Database,
  start: Date | null,
  end: Date,
): Promise<number> {
  const conditions = [lt(orders.placedAt, end)];
  if (start) conditions.push(gte(orders.placedAt, start));
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}
