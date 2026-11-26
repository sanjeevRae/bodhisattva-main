/**
 * Store service — customer-facing half (DATABASE_DESIGN.md §9,
 * spec Part 10, Phase 0 amendments A1/A2).
 *
 *  - Public shop: categories, product list/detail, store config. Only
 *    ACTIVE, non-deleted products are visible; prices are always read
 *    live from `products` (effective = COALESCE(sale_price, price) +
 *    variant delta) and converted to integer paisa via the shared
 *    money helpers — no binary floating point anywhere.
 *  - Cart: one per user, lines carry NO price (§9.6); every view and
 *    mutation re-reads live prices and validates against availability.
 *    Carts do not reserve stock.
 *  - Availability (amendment A1, schema/store.ts deviation 2):
 *      available = stock_qty + SUM(quantity of RESERVE/RELEASE rows)
 *    computed per product (all movements) or per variant (movements
 *    carrying that variant_id). Checkout is the only writer of RESERVE
 *    rows here; fulfilment/cancellation (Phase 7) write the rest.
 *  - Checkout: ONE transaction at READ COMMITTED isolation — idempotency
 *    re-check, product rows locked FOR UPDATE in id order (the oversell
 *    barrier: a concurrent checkout for the last unit blocks on the
 *    lock, then re-reads availability including the winner's RESERVE
 *    rows and fails). READ COMMITTED is load-bearing here: under
 *    InnoDB's default REPEATABLE READ the availability SUM would read
 *    the transaction's early snapshot and miss a just-committed
 *    reservation, overselling the last unit. Totals recomputed from
 *    live rows, order + snapshot items + status-history + RESERVE
 *    movements written together, cart cleared. Any failure rolls
 *    everything back: no orphan order, no stray reservation, cart
 *    untouched.
 *  - Idempotency (amendment A2): (user_id, idempotency_key) is UNIQUE;
 *    a repeat submission returns the original order (HTTP 200) with no
 *    side effects — checked before the transaction, again inside it,
 *    and survived via the unique index if two submissions race.
 */
import {
  AppError,
  type FieldIssue,
} from "@bodhisattva/shared/errors";
import {
  minorUnitsToMoneyString,
  parseMoneyToMinorUnits,
} from "@bodhisattva/shared/money";
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import pino from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { withDeadlockRetry } from "../../database/tx-retry.js";
import {
  cartItems,
  carts,
  customerAddresses,
  inventoryMovements,
  invoiceSequences,
  mediaAssets,
  orderItems,
  orderStatusHistory,
  orders,
  productCategories,
  productImages,
  products,
  productVariants,
  roles,
  siteSettings,
  userRoles,
  users,
} from "../../database/schema/index.js";
import { createRateLimiter } from "../../security/rate-limit.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import {
  drainOutboxSoon,
  enqueueEmail,
} from "../orders/outbox.service.js";
import { normalizePhone } from "../../utils/phone.js";
import { mediaFileUrl } from "../media/media.service.js";
import { placementSchema } from "../cms/registry.js";
import type {
  AddCartItemInput,
  CheckoutInput,
  CreateAddressInput,
  ImagePlacementValue,
  UpdateAddressInput,
  UpdateCartItemInput,
} from "./store.schemas.js";

export interface StoreDeps {
  db: Database;
  config: AppConfig;
}

export interface StoreActor {
  userId: number;
  email: string;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The app database or an open transaction — same query API. */
export type DbLike =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;
type ProductImageRow = typeof productImages.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type AddressRow = typeof customerAddresses.$inferSelect;

// ---------------------------------------------------------------------------
// Shared internal helpers (also used by admin.service.ts)
// ---------------------------------------------------------------------------

export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function definedPatch<T extends object>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

export function isDuplicateKeyError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { errno?: unknown; code?: unknown; cause?: unknown };
    if (candidate.errno === 1062 || candidate.code === "ER_DUP_ENTRY") return true;
    current = candidate.cause;
  }
  return false;
}

export function insufficientStock(details: FieldIssue[], message?: string): AppError {
  return new AppError("INSUFFICIENT_STOCK", message, details);
}

/** Effective unit price in paisa: COALESCE(sale, price) + variant delta, floored at 0. */
export function effectivePricePaisa(
  product: Pick<ProductRow, "price" | "salePrice">,
  variant?: Pick<VariantRow, "priceDelta"> | null,
): number {
  const base = parseMoneyToMinorUnits(product.salePrice ?? product.price);
  const delta = variant ? parseMoneyToMinorUnits(variant.priceDelta) : 0;
  return Math.max(0, base + delta);
}

/**
 * Units of a product (or one variant) currently held by reservations:
 * the negated sum of RESERVE/RELEASE movement quantities (RESERVE rows
 * store −qty, RELEASE rows +qty, so the raw sum is ≤ 0).
 * `variantId === undefined` sums every movement of the product.
 */
export async function reservedQty(
  db: DbLike,
  productId: number,
  variantId?: number | null,
): Promise<number> {
  const conditions = [
    eq(inventoryMovements.productId, productId),
    inArray(inventoryMovements.movementType, ["RESERVE", "RELEASE"]),
  ];
  if (variantId !== undefined) {
    conditions.push(
      variantId === null
        ? isNull(inventoryMovements.variantId)
        : eq(inventoryMovements.variantId, variantId),
    );
  }
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${inventoryMovements.quantity}), 0)` })
    .from(inventoryMovements)
    .where(and(...conditions));
  return -Number(row?.total ?? 0);
}

/**
 * Reserved quantities for many products in ONE grouped query — the
 * batch twin of reservedQty() with variantId undefined: same movement
 * types, same sign convention. Products with no RESERVE/RELEASE
 * movements are absent from the map; callers default them to 0.
 */
export async function reservedQtyByProduct(
  db: DbLike,
  productIds: number[],
): Promise<Map<number, number>> {
  const byProduct = new Map<number, number>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .select({
      productId: inventoryMovements.productId,
      total: sql<number>`COALESCE(SUM(${inventoryMovements.quantity}), 0)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        inArray(inventoryMovements.productId, productIds),
        inArray(inventoryMovements.movementType, ["RESERVE", "RELEASE"]),
      ),
    )
    .groupBy(inventoryMovements.productId);
  for (const row of rows) byProduct.set(row.productId, -Number(row.total ?? 0));
  return byProduct;
}

/** Available units of a product as a whole (its stock mirrors variant sums). */
export async function productAvailableQty(
  db: DbLike,
  product: Pick<ProductRow, "id" | "stockQty" | "trackInventory">,
): Promise<number> {
  if (!product.trackInventory) return product.stockQty;
  return product.stockQty - (await reservedQty(db, product.id));
}

/** Available units of one variant. Untracked products never run out. */
export async function variantAvailableQty(
  db: DbLike,
  product: Pick<ProductRow, "trackInventory">,
  variant: Pick<VariantRow, "id" | "stockQty">,
  productId: number,
): Promise<number> {
  if (!product.trackInventory) return variant.stockQty;
  return variant.stockQty - (await reservedQty(db, productId, variant.id));
}

export interface ResolvedImage {
  url: string;
  alt: string;
  /** Set only when the image row carries a valid placement (0025). */
  placement?: ImagePlacementValue;
}

/**
 * Defensive placement read (the 0024 rule): a stored value that fails
 * the shared schema — hand-edited DB row, legacy drift — is omitted,
 * never thrown, so a bad placement can never break a public read.
 */
export function parseImagePlacement(raw: unknown): ImagePlacementValue | undefined {
  if (raw == null) return undefined;
  const parsed = placementSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Primary image of a product from pre-loaded image rows (media wins per row). */
export function resolveProductImage(
  productName: string,
  images: ProductImageRow[],
  liveMediaIds: Set<number>,
): ResolvedImage | null {
  const ordered = [...images].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.sortOrder - b.sortOrder ||
      a.id - b.id,
  );
  for (const image of ordered) {
    const placement = parseImagePlacement(image.placement);
    if (image.mediaId != null && liveMediaIds.has(image.mediaId)) {
      return {
        url: mediaFileUrl(image.mediaId, "master"),
        alt: image.altText ?? productName,
        ...(placement ? { placement } : {}),
      };
    }
    if (image.imageUrl) {
      return {
        url: image.imageUrl,
        alt: image.altText ?? productName,
        ...(placement ? { placement } : {}),
      };
    }
  }
  return null;
}

/** Load image rows for many products, grouped by product id. */
export async function loadProductImages(
  db: DbLike,
  productIds: number[],
): Promise<Map<number, ProductImageRow[]>> {
  const grouped = new Map<number, ProductImageRow[]>();
  if (productIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.sortOrder), asc(productImages.id));
  for (const row of rows) {
    const list = grouped.get(row.productId) ?? [];
    list.push(row);
    grouped.set(row.productId, list);
  }
  return grouped;
}

/** Ids of media assets that exist and are not soft-deleted. */
export async function liveMediaIdSet(
  db: DbLike,
  images: ProductImageRow[],
): Promise<Set<number>> {
  const ids = [
    ...new Set(
      images
        .map((image) => image.mediaId)
        .filter((id): id is number => id != null),
    ),
  ];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), isNull(mediaAssets.deletedAt)));
  return new Set(rows.map((row) => row.id));
}

// ---------------------------------------------------------------------------
// Store settings / public config
// ---------------------------------------------------------------------------

export interface StoreConfig {
  currency: "NPR";
  shippingFeePaisa: number;
  taxRatePercent: number;
  codEnabled: boolean;
}

function parseSettingValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function settingToPaisa(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    try {
      return parseMoneyToMinorUnits(value);
    } catch {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
    }
  }
  return 0;
}

function settingToRate(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function settingToBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  if (typeof value === "number") return value !== 0;
  return fallback;
}

/** Store configuration from site_settings (store.* keys; defaults 0 / 0 / COD on). */
export async function getStoreConfig(db: DbLike): Promise<StoreConfig> {
  const rows = await db
    .select()
    .from(siteSettings)
    .where(
      inArray(siteSettings.settingKey, [
        "store.shipping_flat_fee",
        "store.tax_rate_percent",
        "store.cod_enabled",
      ]),
    );
  const byKey = new Map(
    rows.map((row) => [row.settingKey, parseSettingValue(row.settingValue)]),
  );
  return {
    currency: "NPR",
    shippingFeePaisa: settingToPaisa(byKey.get("store.shipping_flat_fee")),
    taxRatePercent: settingToRate(byKey.get("store.tax_rate_percent")),
    codEnabled: settingToBool(byKey.get("store.cod_enabled"), true),
  };
}

// ---------------------------------------------------------------------------
// Public shop
// ---------------------------------------------------------------------------

export interface ShopCategoryView {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  productCount: number;
}

export async function listPublicCategories(
  deps: StoreDeps,
): Promise<ShopCategoryView[]> {
  const { db } = deps;
  const rows = await db
    .select({
      id: productCategories.id,
      slug: productCategories.slug,
      name: productCategories.name,
      description: productCategories.description,
      sortOrder: productCategories.sortOrder,
      productCount: count(products.id),
    })
    .from(productCategories)
    .leftJoin(
      products,
      and(
        eq(products.categoryId, productCategories.id),
        eq(products.status, "ACTIVE"),
        isNull(products.deletedAt),
      ),
    )
    .where(eq(productCategories.isActive, true))
    .groupBy(productCategories.id)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.id));
  return rows.map((row) => ({ ...row, productCount: Number(row.productCount) }));
}

export interface ShopProductView {
  id: number;
  slug: string;
  sku: string | null;
  name: string;
  detail: string | null;
  pricePaisa: number;
  salePricePaisa: number | null;
  effectivePricePaisa: number;
  categorySlug: string | null;
  image: ResolvedImage | null;
  availableQty: number;
  inStock: boolean;
  isFeatured: boolean;
}

function toShopProductView(
  product: ProductRow,
  categorySlug: string | null,
  images: ProductImageRow[],
  liveMediaIds: Set<number>,
  availableQty: number,
): ShopProductView {
  return {
    id: product.id,
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    detail: product.shortDescription,
    pricePaisa: parseMoneyToMinorUnits(product.price),
    salePricePaisa:
      product.salePrice === null
        ? null
        : parseMoneyToMinorUnits(product.salePrice),
    effectivePricePaisa: effectivePricePaisa(product),
    categorySlug,
    image: resolveProductImage(product.name, images, liveMediaIds),
    availableQty,
    inStock: product.trackInventory ? availableQty > 0 : true,
    isFeatured: product.isFeatured,
  };
}

export interface ShopListQuery {
  category?: string;
  search?: string;
  sort: "featured" | "price-asc" | "price-desc" | "name";
}

export async function listPublicProducts(
  deps: StoreDeps,
  query: ShopListQuery,
  pagination: PaginationParams,
): Promise<{ items: ShopProductView[]; total: number }> {
  const { db } = deps;
  const conditions = [eq(products.status, "ACTIVE"), isNull(products.deletedAt)];
  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        like(products.name, pattern),
        like(products.shortDescription, pattern),
        like(products.sku, pattern),
      )!,
    );
  }
  if (query.category) {
    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.slug, query.category))
      .limit(1);
    if (!category) return { items: [], total: 0 };
    conditions.push(eq(products.categoryId, category.id));
  }
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(products).where(where);
  const orderBy =
    query.sort === "price-asc"
      ? [asc(sql`COALESCE(${products.salePrice}, ${products.price})`), asc(products.id)]
      : query.sort === "price-desc"
        ? [desc(sql`COALESCE(${products.salePrice}, ${products.price})`), asc(products.id)]
        : query.sort === "name"
          ? [asc(products.name), asc(products.id)]
          : // "featured": flagged products first, then creation order (id) —
            // preserves the shop's original merchandising order for the
            // seeded catalogue instead of re-sorting it alphabetically.
            [desc(products.isFeatured), asc(products.id)];
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(...orderBy)
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);

  const categorySlugs = await categorySlugMap(
    db,
    rows.map((row) => row.categoryId),
  );
  const imagesByProduct = await loadProductImages(
    db,
    rows.map((row) => row.id),
  );
  const liveMedia = await liveMediaIdSet(
    db,
    [...imagesByProduct.values()].flat(),
  );
  const items: ShopProductView[] = [];
  for (const row of rows) {
    items.push(
      toShopProductView(
        row,
        row.categoryId === null ? null : (categorySlugs.get(row.categoryId) ?? null),
        imagesByProduct.get(row.id) ?? [],
        liveMedia,
        await productAvailableQty(db, row),
      ),
    );
  }
  return { items, total: totalRow?.value ?? 0 };
}

async function categorySlugMap(
  db: DbLike,
  categoryIds: (number | null)[],
): Promise<Map<number, string>> {
  const ids = [...new Set(categoryIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: productCategories.id, slug: productCategories.slug })
    .from(productCategories)
    .where(inArray(productCategories.id, ids));
  return new Map(rows.map((row) => [row.id, row.slug]));
}

export interface ShopProductDetailView extends ShopProductView {
  description: string | null;
  categoryName: string | null;
  images: (ResolvedImage & { id: number; isPrimary: boolean })[];
  variants: {
    id: number;
    name: string;
    sku: string | null;
    priceDeltaPaisa: number;
    effectivePricePaisa: number;
    availableQty: number;
    inStock: boolean;
  }[];
}

export async function getPublicProductBySlug(
  deps: StoreDeps,
  slug: string,
): Promise<ShopProductDetailView> {
  const { db } = deps;
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.slug, slug),
        eq(products.status, "ACTIVE"),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!product) throw AppError.notFound("Product not found.");

  const imagesByProduct = await loadProductImages(db, [product.id]);
  const imageRows = imagesByProduct.get(product.id) ?? [];
  const liveMedia = await liveMediaIdSet(db, imageRows);
  const availableQty = await productAvailableQty(db, product);

  let categorySlug: string | null = null;
  let categoryName: string | null = null;
  if (product.categoryId !== null) {
    const [category] = await db
      .select({ slug: productCategories.slug, name: productCategories.name })
      .from(productCategories)
      .where(eq(productCategories.id, product.categoryId))
      .limit(1);
    categorySlug = category?.slug ?? null;
    categoryName = category?.name ?? null;
  }

  const variantRows = await db
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, product.id),
        eq(productVariants.isActive, true),
      ),
    )
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.id));
  const variants = [];
  for (const variant of variantRows) {
    const variantAvailable = await variantAvailableQty(db, product, variant, product.id);
    variants.push({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      priceDeltaPaisa: parseMoneyToMinorUnits(variant.priceDelta),
      effectivePricePaisa: effectivePricePaisa(product, variant),
      availableQty: variantAvailable,
      inStock: product.trackInventory ? variantAvailable > 0 : true,
    });
  }

  const images = imageRows
    .map((image) => {
      const resolved = resolveProductImage(product.name, [image], liveMedia);
      return resolved ? { id: image.id, isPrimary: image.isPrimary, ...resolved } : null;
    })
    .filter((image): image is NonNullable<typeof image> => image !== null);

  return {
    ...toShopProductView(product, categorySlug, imageRows, liveMedia, availableQty),
    description: product.description,
    categoryName,
    images,
    variants,
  };
}

// ---------------------------------------------------------------------------
// Cart (§9.6 — no prices stored; every read is live)
// ---------------------------------------------------------------------------

export interface CartItemView {
  id: number;
  productId: number;
  variantId: number | null;
  name: string;
  sku: string | null;
  variantName: string | null;
  image: ResolvedImage | null;
  unitPricePaisa: number;
  quantity: number;
  lineTotalPaisa: number;
  availableQty: number;
  productStatus: string;
}

export interface CartView {
  items: CartItemView[];
  subtotalPaisa: number;
  itemCount: number;
}

async function getOrCreateCartId(db: DbLike, userId: number): Promise<number> {
  const [existing] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.userId, userId))
    .limit(1);
  if (existing) return existing.id;
  try {
    const [inserted] = await db
      .insert(carts)
      .values({ userId })
      .$returningId();
    return inserted.id;
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const [row] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);
    return row.id;
  }
}

export async function getCartView(
  deps: StoreDeps,
  userId: number,
): Promise<CartView> {
  const { db } = deps;
  const cartId = await getOrCreateCartId(db, userId);
  const lines = await db
    .select({ item: cartItems, product: products, variant: productVariants })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .leftJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.id));

  const imagesByProduct = await loadProductImages(
    db,
    lines.map((line) => line.product.id),
  );
  const liveMedia = await liveMediaIdSet(
    db,
    [...imagesByProduct.values()].flat(),
  );

  const items: CartItemView[] = [];
  let subtotalPaisa = 0;
  let itemCount = 0;
  for (const line of lines) {
    const unitPricePaisa = effectivePricePaisa(line.product, line.variant);
    const availableQty = line.variant
      ? await variantAvailableQty(db, line.product, line.variant, line.product.id)
      : await productAvailableQty(db, line.product);
    const lineTotalPaisa = unitPricePaisa * line.item.quantity;
    subtotalPaisa += lineTotalPaisa;
    itemCount += line.item.quantity;
    items.push({
      id: line.item.id,
      productId: line.product.id,
      variantId: line.item.variantId,
      name: line.product.name,
      sku: line.variant?.sku ?? line.product.sku,
      variantName: line.variant?.name ?? null,
      image: resolveProductImage(
        line.product.name,
        imagesByProduct.get(line.product.id) ?? [],
        liveMedia,
      ),
      unitPricePaisa,
      quantity: line.item.quantity,
      lineTotalPaisa,
      availableQty,
      productStatus: line.product.status,
    });
  }
  return { items, subtotalPaisa, itemCount };
}

async function loadPurchasableProduct(
  db: DbLike,
  productId: number,
): Promise<ProductRow> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.deletedAt)))
    .limit(1);
  if (!product || product.status !== "ACTIVE") {
    throw AppError.notFound("Product not found.");
  }
  return product;
}

async function loadVariantForProduct(
  db: DbLike,
  productId: number,
  variantId: number,
): Promise<VariantRow> {
  const [variant] = await db
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(productVariants.productId, productId),
      ),
    )
    .limit(1);
  if (!variant || !variant.isActive) {
    throw AppError.validation(
      [{ field: "variantId", issue: "Variant not found for this product." }],
      "The submitted data is invalid.",
    );
  }
  return variant;
}

async function assertCartQuantityFits(
  db: DbLike,
  product: ProductRow,
  variant: VariantRow | null,
  quantity: number,
): Promise<void> {
  if (!product.trackInventory) return;
  const available = variant
    ? await variantAvailableQty(db, product, variant, product.id)
    : await productAvailableQty(db, product);
  if (quantity > available) {
    throw insufficientStock(
      [
        {
          field: "quantity",
          issue: `Only ${available} unit(s) available for '${product.name}'.`,
        },
      ],
      `Insufficient stock for '${product.name}'.`,
    );
  }
}

export async function addCartItem(
  deps: StoreDeps,
  userId: number,
  input: AddCartItemInput,
): Promise<CartView> {
  const { db } = deps;
  const product = await loadPurchasableProduct(db, input.productId);
  const variant =
    input.variantId != null
      ? await loadVariantForProduct(db, product.id, input.variantId)
      : null;

  const cartId = await getOrCreateCartId(db, userId);
  const lineConditions = [
    eq(cartItems.cartId, cartId),
    eq(cartItems.productId, product.id),
    variant
      ? eq(cartItems.variantId, variant.id)
      : isNull(cartItems.variantId),
  ];
  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(...lineConditions))
    .limit(1);
  const resultingQty = (existing?.quantity ?? 0) + input.quantity;
  await assertCartQuantityFits(db, product, variant, resultingQty);

  if (existing) {
    await db
      .update(cartItems)
      .set({ quantity: resultingQty })
      .where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({
      cartId,
      productId: product.id,
      variantId: variant?.id ?? null,
      quantity: input.quantity,
    });
  }
  return getCartView(deps, userId);
}

async function loadOwnCartItem(
  db: DbLike,
  userId: number,
  itemId: number,
): Promise<{ id: number; cartId: number; productId: number; variantId: number | null; quantity: number }> {
  const [row] = await db
    .select({ item: cartItems })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .where(and(eq(cartItems.id, itemId), eq(carts.userId, userId)))
    .limit(1);
  if (!row) throw AppError.notFound("Cart item not found.");
  return row.item;
}

export async function updateCartItem(
  deps: StoreDeps,
  userId: number,
  itemId: number,
  input: UpdateCartItemInput,
): Promise<CartView> {
  const { db } = deps;
  const item = await loadOwnCartItem(db, userId, itemId);
  const product = await loadPurchasableProduct(db, item.productId);
  const variant =
    item.variantId != null
      ? await loadVariantForProduct(db, product.id, item.variantId)
      : null;
  await assertCartQuantityFits(db, product, variant, input.quantity);
  await db
    .update(cartItems)
    .set({ quantity: input.quantity })
    .where(eq(cartItems.id, item.id));
  return getCartView(deps, userId);
}

export async function removeCartItem(
  deps: StoreDeps,
  userId: number,
  itemId: number,
): Promise<CartView> {
  const { db } = deps;
  const item = await loadOwnCartItem(db, userId, itemId);
  await db.delete(cartItems).where(eq(cartItems.id, item.id));
  return getCartView(deps, userId);
}

export async function clearCart(
  deps: StoreDeps,
  userId: number,
): Promise<CartView> {
  const { db } = deps;
  const cartId = await getOrCreateCartId(db, userId);
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
  return getCartView(deps, userId);
}

// ---------------------------------------------------------------------------
// Customer addresses (§9.7 — at most one default per user; the first
// address becomes default automatically)
// ---------------------------------------------------------------------------

export type AddressView = AddressRow;

export async function listAddresses(
  deps: StoreDeps,
  userId: number,
): Promise<AddressView[]> {
  return deps.db
    .select()
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.userId, userId),
        isNull(customerAddresses.deletedAt),
      ),
    )
    .orderBy(desc(customerAddresses.isDefault), asc(customerAddresses.id));
}

async function getOwnAddressOrThrow(
  db: DbLike,
  userId: number,
  addressId: number,
): Promise<AddressRow> {
  const [row] = await db
    .select()
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.userId, userId),
        isNull(customerAddresses.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw AppError.notFound("Address not found.");
  return row;
}

export async function createAddress(
  deps: StoreDeps,
  userId: number,
  input: CreateAddressInput,
): Promise<AddressView> {
  const { db } = deps;
  // Plan-validated, stored in E.164 form (utils/phone.ts).
  const phone = normalizePhone(input.phone, input.phoneCountry);
  let created: AddressRow | undefined;
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.userId, userId),
          isNull(customerAddresses.deletedAt),
        ),
      )
      .limit(1);
    const makeDefault = input.isDefault === true || existing.length === 0;
    if (makeDefault) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false })
        .where(eq(customerAddresses.userId, userId));
    }
    const [inserted] = await tx
      .insert(customerAddresses)
      .values({
        userId,
        label: input.label ?? null,
        recipientName: input.recipientName,
        phone,
        addressLine: input.addressLine,
        city: input.city,
        district: input.district ?? null,
        postalCode: input.postalCode ?? null,
        deliveryNotes: input.deliveryNotes ?? null,
        isDefault: makeDefault,
      })
      .$returningId();
    const [row] = await tx
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.id, inserted.id))
      .limit(1);
    created = row;
  });
  return created!;
}

export async function updateAddress(
  deps: StoreDeps,
  userId: number,
  addressId: number,
  input: UpdateAddressInput,
): Promise<AddressView> {
  const { db } = deps;
  await getOwnAddressOrThrow(db, userId, addressId);
  // phoneCountry is an input hint, never a column: strip it from the
  // patch, and normalise a supplied phone to E.164 before storing.
  const { phoneCountry, phone: rawPhone, ...rest } = input;
  const patch = definedPatch({
    ...rest,
    ...(rawPhone !== undefined
      ? { phone: normalizePhone(rawPhone, phoneCountry) }
      : {}),
  });
  await db.transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false })
        .where(eq(customerAddresses.userId, userId));
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(customerAddresses)
        .set(patch)
        .where(eq(customerAddresses.id, addressId));
    }
  });
  return getOwnAddressOrThrow(db, userId, addressId);
}

export async function deleteAddress(
  deps: StoreDeps,
  userId: number,
  addressId: number,
): Promise<void> {
  const { db } = deps;
  await getOwnAddressOrThrow(db, userId, addressId);
  await db
    .update(customerAddresses)
    .set({ deletedAt: new Date() })
    .where(eq(customerAddresses.id, addressId));
}

// ---------------------------------------------------------------------------
// Orders — views
// ---------------------------------------------------------------------------

export interface OrderItemView {
  id: number;
  productId: number | null;
  variantId: number | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  unitPricePaisa: number;
  quantity: number;
  lineTotalPaisa: number;
}

export interface OrderView {
  id: number;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  currency: string;
  subtotalPaisa: number;
  shippingFeePaisa: number;
  discountTotalPaisa: number;
  taxTotalPaisa: number;
  grandTotalPaisa: number;
  customerEmail: string;
  delivery: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    district: string | null;
    postalCode: string | null;
    notes: string | null;
  };
  items: OrderItemView[];
  placedAt: Date;
}

function toOrderItemView(row: OrderItemRow): OrderItemView {
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    name: row.productNameSnapshot,
    variantName: row.variantNameSnapshot,
    sku: row.skuSnapshot,
    unitPricePaisa: parseMoneyToMinorUnits(row.unitPrice),
    quantity: row.quantity,
    lineTotalPaisa: parseMoneyToMinorUnits(row.lineTotal),
  };
}

/** Exported for the Phase 7 orders module (admin views share the shape). */
export function toOrderView(order: OrderRow, items: OrderItemRow[]): OrderView {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotalPaisa: parseMoneyToMinorUnits(order.subtotal),
    shippingFeePaisa: parseMoneyToMinorUnits(order.shippingFee),
    discountTotalPaisa: parseMoneyToMinorUnits(order.discountTotal),
    taxTotalPaisa: parseMoneyToMinorUnits(order.taxTotal),
    grandTotalPaisa: parseMoneyToMinorUnits(order.grandTotal),
    customerEmail: order.customerEmailSnapshot,
    delivery: {
      recipientName: order.shipRecipientName,
      phone: order.shipPhone,
      addressLine: order.shipAddressLine,
      city: order.shipCity,
      district: order.shipDistrict,
      postalCode: order.shipPostalCode,
      notes: order.shipNotes,
    },
    items: items.map(toOrderItemView),
    placedAt: order.placedAt,
  };
}

async function findOrderByIdempotencyKey(
  db: DbLike,
  userId: number,
  idempotencyKey: string,
): Promise<OrderView | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!order) return null;
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id));
  return toOrderView(order, items);
}

export async function getOwnOrder(
  deps: StoreDeps,
  userId: number,
  orderId: number,
): Promise<OrderView> {
  const { db } = deps;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!order) throw AppError.notFound("Order not found.");
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id));
  return toOrderView(order, items);
}

export async function listOwnOrders(
  deps: StoreDeps,
  userId: number,
  pagination: PaginationParams,
): Promise<{ items: OrderView[]; total: number }> {
  const { db } = deps;
  const [totalRow] = await db
    .select({ value: count() })
    .from(orders)
    .where(eq(orders.userId, userId));
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  const items: OrderView[] = [];
  for (const row of rows) {
    const orderItemRows = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id))
      .orderBy(asc(orderItems.id));
    items.push(toOrderView(row, orderItemRows));
  }
  return { items, total: totalRow?.value ?? 0 };
}

// ---------------------------------------------------------------------------
// Checkout (§9.8 + amendments A1/A2 — see the module header)
// ---------------------------------------------------------------------------

/** Next order number for the current UTC year, via the §10.2 sequence row. */
async function nextOrderNumber(tx: DbLike): Promise<string> {
  const year = new Date().getUTCFullYear();
  const scope = `ORDER:${year}`;
  await tx
    .insert(invoiceSequences)
    .values({ scope, lastValue: 0 })
    .onDuplicateKeyUpdate({ set: { scope } });
  const [row] = await tx
    .select({ lastValue: invoiceSequences.lastValue })
    .from(invoiceSequences)
    .where(eq(invoiceSequences.scope, scope))
    .for("update");
  const next = (row?.lastValue ?? 0) + 1;
  await tx
    .update(invoiceSequences)
    .set({ lastValue: next })
    .where(eq(invoiceSequences.scope, scope));
  return `ORD-${year}-${String(next).padStart(6, "0")}`;
}

export interface CheckoutResult {
  order: OrderView;
  /** False when an idempotent replay returned the original order. */
  created: boolean;
}

const log = pino({ name: "store-checkout", level: process.env.LOG_LEVEL ?? "info" });

/**
 * Order-placed emails (owner request, 2026-11-20; plan reviewed by
 * ChatGPT 9.3/10 and Gemini 9.2/10). Enqueued INSIDE the checkout
 * transaction via the orders module's transactional outbox, so an
 * order and its emails commit or roll back together, and the
 * idempotency replay paths (which never reach the fresh-placement
 * code) can never duplicate them. Delivery is at-least-once (the
 * outbox's lease/retry semantics), never exactly-once — SMTP cannot
 * promise more. Recipients are resolved server-side only: the
 * customer at their snapshotted account email, staff from role
 * assignments in the DB. Nothing about recipients comes from the
 * request, and no mail configuration ever reaches the client.
 */
const ORDER_STAFF_ROLES: readonly string[] = ["ADMIN", "SUPER_ADMIN", "STORE_ADMIN"];

/**
 * Placed orders per customer per hour (replays and failed attempts
 * don't count — the hit is recorded in the order's own transaction).
 * 20 is generous for a gift shop (an order every 3 minutes, sustained)
 * while capping one account's staff-notification fan-out.
 */
const CHECKOUT_RATE_LIMIT = 20;
const CHECKOUT_RATE_WINDOW_SECONDS = 3600;

/**
 * Collapse newlines/control characters in free-text values before
 * they are interpolated into a plain-text email body, so a crafted
 * name or address cannot forge fake lines inside the message
 * (body-injection hygiene). Headers never carry user input at all.
 */
function oneLineText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function orderItemLines(itemRows: OrderItemRow[]): string {
  return itemRows
    .map((item) => {
      const name = oneLineText(
        item.variantNameSnapshot
          ? `${item.productNameSnapshot} (${item.variantNameSnapshot})`
          : item.productNameSnapshot,
      );
      return `- ${name} x ${item.quantity} — NPR ${item.lineTotal}`;
    })
    .join("\n");
}

function deliveryBlock(order: OrderRow): string {
  const parts = [
    order.shipAddressLine,
    order.shipCity,
    order.shipDistrict,
    order.shipPostalCode,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map(oneLineText);
  return (
    `Deliver to: ${oneLineText(order.shipRecipientName)}\n` +
    `Address: ${parts.join(", ")}\n` +
    `Phone: ${oneLineText(order.shipPhone)}`
  );
}

async function enqueueOrderPlacedEmails(
  tx: DbLike,
  order: OrderRow,
  itemRows: OrderItemRow[],
  customerUserId: number,
): Promise<void> {
  const lines = orderItemLines(itemRows);
  await enqueueEmail(tx, {
    type: "ORDER_PLACED",
    recipientEmail: order.customerEmailSnapshot,
    recipientUserId: customerUserId,
    subject: `Your order ${order.orderNumber} has been placed`,
    text:
      `Dear ${oneLineText(order.shipRecipientName)},\n\n` +
      `Thank you — your order ${order.orderNumber} has been placed and is awaiting approval.\n\n` +
      `${lines}\n\n` +
      `Subtotal: NPR ${order.subtotal}\n` +
      `Shipping: NPR ${order.shippingFee}\n` +
      `VAT: NPR ${order.taxTotal}\n` +
      `Total on delivery: NPR ${order.grandTotal}\n\n` +
      `${deliveryBlock(order)}\n\n` +
      `Payment is cash on delivery. We will email your invoice once your order is approved.`,
    relatedType: "order",
    relatedId: order.id,
  });

  // Staff recipients: ACTIVE, email-verified holders of the staff
  // roles, deduplicated by normalized email (two accounts sharing an
  // address get one copy). Resolved and snapshotted NOW, at
  // placement — later role changes do not rewrite this order's
  // notifications.
  const staffRows = await tx
    .select({
      userId: users.id,
      email: users.email,
      emailNormalized: users.emailNormalized,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        inArray(roles.code, [...ORDER_STAFF_ROLES]),
        eq(users.status, "ACTIVE"),
        isNotNull(users.emailVerifiedAt),
      ),
    );
  const seen = new Set<string>();
  const staff: { userId: number; email: string }[] = [];
  for (const row of staffRows) {
    const key = row.emailNormalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    staff.push({ userId: row.userId, email: row.email });
  }
  if (staff.length === 0) {
    // Never block the order — but never let it go unnoticed either.
    log.error(
      { orderId: order.id, orderNumber: order.orderNumber },
      "order placed with NO eligible staff notification recipients (no ACTIVE, verified Admin/Super Admin/Store Admin account)",
    );
  }
  for (const recipient of staff) {
    await enqueueEmail(tx, {
      type: "ORDER_PLACED_ADMIN",
      recipientEmail: recipient.email,
      recipientUserId: recipient.userId,
      subject: `New order ${order.orderNumber} — NPR ${order.grandTotal}`,
      text:
        `A new order has been placed on the website and is awaiting approval.\n\n` +
        `Order: ${order.orderNumber}\n` +
        `Customer: ${oneLineText(order.shipRecipientName)}\n` +
        `Phone: ${oneLineText(order.shipPhone)}\n\n` +
        `${lines}\n\n` +
        `Total on delivery: NPR ${order.grandTotal} (cash on delivery)\n\n` +
        `${deliveryBlock(order)}\n\n` +
        `Review and approve it in Admin → Orders.`,
      relatedType: "order",
      relatedId: order.id,
    });
  }
}

export async function checkout(
  deps: StoreDeps,
  actor: StoreActor,
  input: CheckoutInput,
  meta: RequestMeta,
): Promise<CheckoutResult> {
  const { db } = deps;
  const userId = actor.userId;

  // A2 fast path: a replayed submission returns the original order with
  // no side effects — even though the cart has since been cleared.
  const replay = await findOrderByIdempotencyKey(db, userId, input.idempotencyKey);
  if (replay) return { order: replay, created: false };

  // Abuse guard (2026-11-20 review): a genuinely new order also fans
  // out notification emails to every staff account, so cap PLACED
  // orders per customer. Semantics: this peek only gates — the hit is
  // recorded inside the transaction (see below), so replays (above),
  // failed checkouts and rolled-back attempts never consume quota;
  // only orders that actually commit count. The peek-then-record gap
  // lets a small concurrent burst overshoot by its own size, which is
  // acceptable for an abuse guard (it is not a security boundary).
  const rateLimiter = createRateLimiter({
    db,
    keySecret: deps.config.secrets.otpHmacSecret,
  });
  const limit = await rateLimiter.checkLimit(
    "checkout:user",
    String(userId),
    CHECKOUT_RATE_LIMIT,
    CHECKOUT_RATE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    throw new AppError("RATE_LIMITED", undefined, [
      { field: "retryAfter", issue: String(limit.retryAfterSeconds) },
    ]);
  }

  let result: CheckoutResult | undefined;
  try {
    // Phase 8 (Phase 7 review disposition 4): a deadlock/lock-wait
    // victim failure retries the WHOLE transaction. Safe because the
    // body re-reads and re-validates everything under the row locks,
    // and the A2 idempotency key turns a retry after an ambiguous
    // outcome into a replay, never a second order.
    await withDeadlockRetry(async () => {
      result = undefined;
      await db.transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent first submission
      // with the same key may have committed while we waited.
      const inTxReplay = await findOrderByIdempotencyKey(
        tx,
        userId,
        input.idempotencyKey,
      );
      if (inTxReplay) {
        result = { order: inTxReplay, created: false };
        return;
      }

      const cartId = await getOrCreateCartId(tx, userId);
      const lines = await tx
        .select({ item: cartItems })
        .from(cartItems)
        .where(eq(cartItems.cartId, cartId))
        .orderBy(asc(cartItems.id));
      if (lines.length === 0) {
        throw AppError.validation(
          [{ field: "cart", issue: "Your cart is empty." }],
          "Your cart is empty.",
        );
      }

      // Aggregate duplicate lines for the same product+variant (the
      // NULL-variant unique index cannot enforce this at the DB level).
      const aggregated = new Map<
        string,
        { productId: number; variantId: number | null; quantity: number }
      >();
      for (const { item } of lines) {
        const key = `${item.productId}:${item.variantId ?? "null"}`;
        const existing = aggregated.get(key);
        if (existing) existing.quantity += item.quantity;
        else {
          aggregated.set(key, {
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          });
        }
      }
      const orderLines = [...aggregated.values()];

      // Delivery snapshot source.
      let snapshot: {
        recipientName: string;
        phone: string;
        addressLine: string;
        city: string;
        district: string | null;
        postalCode: string | null;
        deliveryNotes: string | null;
      };
      if (input.addressId !== undefined) {
        const address = await getOwnAddressOrThrow(tx, userId, input.addressId);
        snapshot = {
          recipientName: address.recipientName,
          phone: address.phone,
          addressLine: address.addressLine,
          city: address.city,
          district: address.district,
          postalCode: address.postalCode,
          deliveryNotes: address.deliveryNotes,
        };
      } else {
        const address = input.address!;
        snapshot = {
          recipientName: address.recipientName,
          // Inline delivery phone gets the same plan validation +
          // E.164 normalisation as saved addresses (utils/phone.ts).
          phone: normalizePhone(address.phone, address.phoneCountry),
          addressLine: address.addressLine,
          city: address.city,
          district: address.district ?? null,
          postalCode: address.postalCode ?? null,
          deliveryNotes: address.deliveryNotes ?? null,
        };
      }

      // THE oversell barrier: lock every product row in id order. A
      // concurrent checkout touching any of the same products waits,
      // then re-reads availability including this transaction's
      // committed RESERVE rows once it acquires the locks.
      const productIds = [...new Set(orderLines.map((line) => line.productId))].sort(
        (a, b) => a - b,
      );
      const lockedProducts = await tx
        .select()
        .from(products)
        .where(inArray(products.id, productIds))
        .orderBy(asc(products.id))
        .for("update");
      const productById = new Map(lockedProducts.map((row) => [row.id, row]));

      const variantIds = orderLines
        .map((line) => line.variantId)
        .filter((id): id is number => id !== null);
      const variantById = new Map<number, VariantRow>();
      if (variantIds.length > 0) {
        const lockedVariants = await tx
          .select()
          .from(productVariants)
          .where(inArray(productVariants.id, [...new Set(variantIds)]))
          .orderBy(asc(productVariants.id))
          .for("update");
        for (const variant of lockedVariants) variantById.set(variant.id, variant);
      }

      // Re-validate every line against the locked rows and the
      // reservation-aware availability, and price the order from the
      // live rows. Any failure aborts the whole transaction.
      const config = await getStoreConfig(tx);
      if (!config.codEnabled) {
        throw AppError.validation(
          [{ field: "paymentMethod", issue: "Cash on delivery is not available." }],
          "Cash on delivery is not available.",
        );
      }
      let subtotalPaisa = 0;
      const pricedLines: {
        product: ProductRow;
        variant: VariantRow | null;
        quantity: number;
        unitPricePaisa: number;
        lineTotalPaisa: number;
        availableBefore: number;
      }[] = [];
      for (const line of orderLines) {
        const product = productById.get(line.productId);
        if (!product || product.deletedAt !== null || product.status !== "ACTIVE") {
          throw AppError.validation(
            [{ field: "items", issue: "A product in your cart is no longer available." }],
            "A product in your cart is no longer available.",
          );
        }
        let variant: VariantRow | null = null;
        if (line.variantId !== null) {
          variant = variantById.get(line.variantId) ?? null;
          if (!variant || variant.productId !== product.id || !variant.isActive) {
            throw AppError.validation(
              [{ field: "items", issue: "A variant in your cart is no longer available." }],
              "A variant in your cart is no longer available.",
            );
          }
        }
        const available = variant
          ? await variantAvailableQty(tx, product, variant, product.id)
          : await productAvailableQty(tx, product);
        if (product.trackInventory && line.quantity > available) {
          throw insufficientStock(
            [
              {
                field: "items",
                issue: `Only ${available} unit(s) available for '${product.name}'.`,
              },
            ],
            `Insufficient stock for '${product.name}'.`,
          );
        }
        const unitPricePaisa = effectivePricePaisa(product, variant);
        const lineTotalPaisa = unitPricePaisa * line.quantity;
        subtotalPaisa += lineTotalPaisa;
        pricedLines.push({
          product,
          variant,
          quantity: line.quantity,
          unitPricePaisa,
          lineTotalPaisa,
          availableBefore: available,
        });
      }

      const shippingFeePaisa = subtotalPaisa > 0 ? config.shippingFeePaisa : 0;
      const taxTotalPaisa = Math.round(
        (subtotalPaisa * config.taxRatePercent) / 100,
      );
      const discountTotalPaisa = 0;
      const grandTotalPaisa =
        subtotalPaisa + shippingFeePaisa + taxTotalPaisa - discountTotalPaisa;

      const orderNumber = await nextOrderNumber(tx);
      const [insertedOrder] = await tx
        .insert(orders)
        .values({
          orderNumber,
          userId,
          status: "PENDING_APPROVAL",
          paymentMethod: "COD",
          currency: config.currency,
          subtotal: minorUnitsToMoneyString(subtotalPaisa),
          shippingFee: minorUnitsToMoneyString(shippingFeePaisa),
          discountTotal: minorUnitsToMoneyString(discountTotalPaisa),
          taxTotal: minorUnitsToMoneyString(taxTotalPaisa),
          grandTotal: minorUnitsToMoneyString(grandTotalPaisa),
          shipRecipientName: snapshot.recipientName,
          shipPhone: snapshot.phone,
          shipAddressLine: snapshot.addressLine,
          shipCity: snapshot.city,
          shipDistrict: snapshot.district,
          shipPostalCode: snapshot.postalCode,
          shipNotes: input.notes ?? snapshot.deliveryNotes,
          customerEmailSnapshot: actor.email,
          idempotencyKey: input.idempotencyKey,
        })
        .$returningId();
      const orderId = insertedOrder.id;

      for (const line of pricedLines) {
        await tx.insert(orderItems).values({
          orderId,
          productId: line.product.id,
          variantId: line.variant?.id ?? null,
          productNameSnapshot: line.product.name,
          variantNameSnapshot: line.variant?.name ?? null,
          skuSnapshot: line.variant?.sku ?? line.product.sku,
          unitPrice: minorUnitsToMoneyString(line.unitPricePaisa),
          quantity: line.quantity,
          lineTotal: minorUnitsToMoneyString(line.lineTotalPaisa),
        });
        if (line.product.trackInventory) {
          // A1: reserve — stock_qty is untouched; the units leave the
          // available pool via this ledger row.
          await tx.insert(inventoryMovements).values({
            productId: line.product.id,
            variantId: line.variant?.id ?? null,
            movementType: "RESERVE",
            quantity: -line.quantity,
            balanceAfter: line.availableBefore - line.quantity,
            orderId,
            actorId: userId,
            reason: `Reserved for order ${orderNumber}`,
          });
        }
      }

      await tx.insert(orderStatusHistory).values({
        orderId,
        fromStatus: null,
        toStatus: "PENDING_APPROVAL",
        actorId: userId,
        actorRole: "CUSTOMER",
        reason: "Order placed (cash on delivery)",
      });

      // Checkout consumes the cart.
      await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));

      const [orderRow] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      const itemRows = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .orderBy(asc(orderItems.id));
      // Record the rate-limit hit INSIDE the transaction: it commits
      // or rolls back with the order, so only real orders count.
      await createRateLimiter({
        db: tx as unknown as Database,
        keySecret: deps.config.secrets.otpHmacSecret,
      }).recordHit("checkout:user", String(userId), CHECKOUT_RATE_WINDOW_SECONDS);

      // Order-placed emails ride the SAME transaction (transactional
      // outbox): they exist if and only if this order commits.
      await enqueueOrderPlacedEmails(tx, orderRow, itemRows, userId);

      result = { order: toOrderView(orderRow, itemRows), created: true };
      // READ COMMITTED is load-bearing (see the module header): the
      // availability re-check after the product-row locks must see
      // reservations committed by a racing checkout.
      }, { isolationLevel: "read committed" });
    });
  } catch (err) {
    // A2 race survivor: two first submissions with the same key raced;
    // the UNIQUE index rejected one insert and rolled it back. Return
    // the winner's order as a replay instead of an error.
    if (isDuplicateKeyError(err)) {
      const winner = await findOrderByIdempotencyKey(
        db,
        userId,
        input.idempotencyKey,
      );
      if (winner) return { order: winner, created: false };
    }
    throw err;
  }

  if (result!.created) {
    // Post-commit only: nudge the outbox drain (the cron/CLI drain is
    // the reliable backstop if this process dies first).
    drainOutboxSoon(deps);
    await writeAudit(db, {
      actorId: userId,
      actorType: "CUSTOMER",
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.storeOrdersCreate,
      resourceType: "order",
      resourceId: result!.order.id,
      result: "SUCCESS",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: {
        orderNumber: result!.order.orderNumber,
        grandTotalPaisa: result!.order.grandTotalPaisa,
      },
    });
  }
  return result!;
}
