/**
 * Store service — admin half (DATABASE_DESIGN.md §9.1–§9.5,
 * PERMISSIONS.md store rows).
 *
 *  - Products are archived, never deleted (§9.2): DELETE sets
 *    status = ARCHIVED. The `deleted_at` column stays unused by this
 *    service (reserved for pre-sale mistake purges, which no endpoint
 *    performs).
 *  - The inventory service is the ONLY writer of `inventory_movements`
 *    (§9.5 rule 1): every stock change — product/variant creation
 *    opening balances and manual adjustments — writes the cached
 *    `stock_qty` and its ledger row in one transaction, with the
 *    product row locked. Adjustments may not push on-hand stock below
 *    the currently reserved quantity (those units are promised to
 *    pending orders) nor below zero.
 *  - Variants (§9.4): when a product has variants, stock lives on the
 *    variants and `products.stock_qty` mirrors their sum — every
 *    variant stock change recomputes the mirror in the same
 *    transaction. Product-level adjustment of a variant-carrying
 *    product is refused; the caller must name the variant.
 *
 * Every admin mutation is audited (store.* actions).
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  cartItems,
  inventoryMovements,
  mediaAssets,
  orderItems,
  productCategories,
  productImages,
  products,
  productVariants,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import {
  definedPatch,
  insufficientStock,
  isDuplicateKeyError,
  likePattern,
  liveMediaIdSet,
  loadProductImages,
  productAvailableQty,
  reservedQty,
  resolveProductImage,
  variantAvailableQty,
  type DbLike,
  type RequestMeta,
  type ResolvedImage,
  type StoreActor,
  type StoreDeps,
} from "./service.js";
import type {
  AdjustInventoryInput,
  CreateProductCategoryInput,
  CreateProductImageInput,
  CreateProductInput,
  CreateVariantInput,
  UpdateProductCategoryInput,
  UpdateProductImageInput,
  UpdateProductInput,
  UpdateVariantInput,
} from "./store.schemas.js";

export interface StoreAdminDeps {
  db: Database;
  config: AppConfig;
}

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;
type ProductImageRow = typeof productImages.$inferSelect;
type ProductCategoryRow = typeof productCategories.$inferSelect;
type MovementRow = typeof inventoryMovements.$inferSelect;

async function audit(
  deps: StoreAdminDeps,
  actor: StoreActor,
  action: string,
  resourceType: string,
  resourceId: number | null,
  meta: RequestMeta,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await writeAudit(deps.db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action,
    resourceType,
    resourceId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata,
  });
}

async function assertMediaExists(
  db: Database,
  mediaId: number,
  field: string,
): Promise<void> {
  const [asset] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, mediaId), isNull(mediaAssets.deletedAt)))
    .limit(1);
  if (!asset) {
    throw AppError.validation(
      [{ field, issue: "Media asset not found." }],
      "The submitted data is invalid.",
    );
  }
}

// ---------------------------------------------------------------------------
// Categories (§9.1)
// ---------------------------------------------------------------------------

export type ProductCategoryAdminView = ProductCategoryRow;

async function getCategoryOrThrow(
  db: DbLike,
  id: number,
): Promise<ProductCategoryRow> {
  const [row] = await db
    .select()
    .from(productCategories)
    .where(eq(productCategories.id, id))
    .limit(1);
  if (!row) throw AppError.notFound("Product category not found.");
  return row;
}

async function assertCategorySlugFree(
  db: DbLike,
  slug: string,
  excludeId?: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(
      `A product category with slug '${slug}' already exists.`,
    );
  }
}

export async function listAdminCategories(
  deps: StoreAdminDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: ProductCategoryAdminView[]; total: number }> {
  const { db } = deps;
  const where = search
    ? like(productCategories.name, likePattern(search))
    : undefined;
  const [totalRow] = await db
    .select({ value: count() })
    .from(productCategories)
    .where(where);
  const rows = await db
    .select()
    .from(productCategories)
    .where(where)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function getAdminCategory(
  deps: StoreAdminDeps,
  id: number,
): Promise<ProductCategoryAdminView> {
  return getCategoryOrThrow(deps.db, id);
}

export async function createCategory(
  deps: StoreAdminDeps,
  actor: StoreActor,
  input: CreateProductCategoryInput,
  meta: RequestMeta,
): Promise<ProductCategoryAdminView> {
  const { db } = deps;
  await assertCategorySlugFree(db, input.slug);
  let id = 0;
  try {
    const [inserted] = await db
      .insert(productCategories)
      .values({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      })
      .$returningId();
    id = inserted.id;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(
        `A product category with slug '${input.slug}' already exists.`,
      );
    }
    throw err;
  }
  const row = await getCategoryOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.storeCategoriesCreate, "product_category", id, meta, { slug: row.slug });
  return row;
}

export async function updateCategory(
  deps: StoreAdminDeps,
  actor: StoreActor,
  id: number,
  input: UpdateProductCategoryInput,
  meta: RequestMeta,
): Promise<ProductCategoryAdminView> {
  const { db } = deps;
  await getCategoryOrThrow(db, id);
  if (input.slug !== undefined) await assertCategorySlugFree(db, input.slug, id);
  try {
    await db
      .update(productCategories)
      .set(definedPatch(input))
      .where(eq(productCategories.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(
        `A product category with slug '${input.slug}' already exists.`,
      );
    }
    throw err;
  }
  const row = await getCategoryOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.storeCategoriesUpdate, "product_category", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteCategory(
  deps: StoreAdminDeps,
  actor: StoreActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getCategoryOrThrow(db, id);
  // The FK is RESTRICT, so ANY referencing product row blocks — count
  // them all, including archived ones (same rule as news categories).
  const [ref] = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.categoryId, id));
  if ((ref?.value ?? 0) > 0) {
    throw AppError.conflict(
      "This category is referenced by products and cannot be deleted.",
    );
  }
  await db.delete(productCategories).where(eq(productCategories.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.storeCategoriesDelete, "product_category", id, meta);
}

// ---------------------------------------------------------------------------
// Products (§9.2)
// ---------------------------------------------------------------------------

export interface ProductAdminView extends ProductRow {
  categorySlug: string | null;
  reservedQty: number;
  availableQty: number;
  image: ResolvedImage | null;
}

async function getProductOrThrow(db: DbLike, id: number): Promise<ProductRow> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), isNull(products.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("Product not found.");
  return row;
}

async function assertProductSlugFree(
  db: DbLike,
  slug: string,
  excludeId?: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A product with slug '${slug}' already exists.`);
  }
}

async function assertProductSkuFree(
  db: DbLike,
  sku: string,
  excludeId?: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.sku, sku))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A product with SKU '${sku}' already exists.`);
  }
}

async function assertCategoryExists(
  db: DbLike,
  categoryId: number,
): Promise<void> {
  await getCategoryOrThrow(db, categoryId).catch(() => {
    throw AppError.validation(
      [{ field: "categoryId", issue: "Product category not found." }],
      "The submitted data is invalid.",
    );
  });
}

async function toProductAdminView(
  db: DbLike,
  row: ProductRow,
): Promise<ProductAdminView> {
  let categorySlug: string | null = null;
  if (row.categoryId !== null) {
    const [category] = await db
      .select({ slug: productCategories.slug })
      .from(productCategories)
      .where(eq(productCategories.id, row.categoryId))
      .limit(1);
    categorySlug = category?.slug ?? null;
  }
  const imagesByProduct = await loadProductImages(db, [row.id]);
  const imageRows = imagesByProduct.get(row.id) ?? [];
  const liveMedia = await liveMediaIdSet(db, imageRows);
  return {
    ...row,
    categorySlug,
    reservedQty: await reservedQty(db, row.id),
    availableQty: await productAvailableQty(db, row),
    image: resolveProductImage(row.name, imageRows, liveMedia),
  };
}

export async function listAdminProducts(
  deps: StoreAdminDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: ProductAdminView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(products.deletedAt)];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(
      or(
        like(products.name, pattern),
        like(products.sku, pattern),
        like(products.slug, pattern),
      )!,
    );
  }
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(products).where(where);
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  const items: ProductAdminView[] = [];
  for (const row of rows) items.push(await toProductAdminView(db, row));
  return { items, total: totalRow?.value ?? 0 };
}

export async function getAdminProduct(
  deps: StoreAdminDeps,
  id: number,
): Promise<ProductAdminView> {
  return toProductAdminView(deps.db, await getProductOrThrow(deps.db, id));
}

export async function createProduct(
  deps: StoreAdminDeps,
  actor: StoreActor,
  input: CreateProductInput,
  meta: RequestMeta,
): Promise<ProductAdminView> {
  const { db } = deps;
  await assertProductSlugFree(db, input.slug);
  if (input.sku != null) await assertProductSkuFree(db, input.sku);
  if (input.categoryId != null) await assertCategoryExists(db, input.categoryId);

  let createdId = 0;
  try {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(products)
        .values({
          slug: input.slug,
          sku: input.sku ?? null,
          name: input.name,
          categoryId: input.categoryId ?? null,
          shortDescription: input.shortDescription ?? null,
          description: input.description ?? null,
          price: input.price,
          salePrice: input.salePrice ?? null,
          stockQty: 0,
          trackInventory: input.trackInventory ?? true,
          status: input.status ?? "DRAFT",
          isFeatured: input.isFeatured ?? false,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .$returningId();
      createdId = inserted.id;
      const opening = input.stockQty ?? 0;
      if (opening > 0) {
        await tx
          .update(products)
          .set({ stockQty: opening })
          .where(eq(products.id, createdId));
        await tx.insert(inventoryMovements).values({
          productId: createdId,
          variantId: null,
          movementType: "OPENING",
          quantity: opening,
          balanceAfter: opening,
          actorId: actor.userId,
          reason: "Opening stock",
        });
      }
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict("A product with this slug or SKU already exists.");
    }
    throw err;
  }
  const view = await getAdminProduct(deps, createdId);
  await audit(deps, actor, AUDIT_ACTIONS.storeProductsCreate, "product", createdId, meta, {
    slug: view.slug,
    sku: view.sku,
  });
  return view;
}

export async function updateProduct(
  deps: StoreAdminDeps,
  actor: StoreActor,
  id: number,
  input: UpdateProductInput,
  meta: RequestMeta,
): Promise<ProductAdminView> {
  const { db } = deps;
  await getProductOrThrow(db, id);
  if (input.slug !== undefined) await assertProductSlugFree(db, input.slug, id);
  if (input.sku != null) await assertProductSkuFree(db, input.sku, id);
  if (input.categoryId != null) await assertCategoryExists(db, input.categoryId);
  try {
    await db
      .update(products)
      .set({ ...definedPatch(input), updatedBy: actor.userId })
      .where(eq(products.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict("A product with this slug or SKU already exists.");
    }
    throw err;
  }
  const view = await getAdminProduct(deps, id);
  await audit(deps, actor, AUDIT_ACTIONS.storeProductsUpdate, "product", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return view;
}

/** DELETE = archive (§9.2). Already-archived products archive idempotently. */
export async function archiveProduct(
  deps: StoreAdminDeps,
  actor: StoreActor,
  id: number,
  meta: RequestMeta,
): Promise<ProductAdminView> {
  const { db } = deps;
  const product = await getProductOrThrow(db, id);
  if (product.status !== "ARCHIVED") {
    await db
      .update(products)
      .set({ status: "ARCHIVED", updatedBy: actor.userId })
      .where(eq(products.id, id));
    await audit(deps, actor, AUDIT_ACTIONS.storeProductsArchive, "product", id, meta, {
      slug: product.slug,
    });
  }
  return getAdminProduct(deps, id);
}

// ---------------------------------------------------------------------------
// Product images (§9.3)
// ---------------------------------------------------------------------------

export type ProductImageAdminView = ProductImageRow;

export async function listProductImages(
  deps: StoreAdminDeps,
  productId: number,
): Promise<ProductImageAdminView[]> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  return db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder), asc(productImages.id));
}

export async function createProductImage(
  deps: StoreAdminDeps,
  actor: StoreActor,
  productId: number,
  input: CreateProductImageInput,
  meta: RequestMeta,
): Promise<ProductImageAdminView> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  if (input.mediaId != null) await assertMediaExists(db, input.mediaId, "mediaId");
  let created: ProductImageRow | undefined;
  await db.transaction(async (tx) => {
    if (input.isPrimary === true) {
      await tx
        .update(productImages)
        .set({ isPrimary: false })
        .where(eq(productImages.productId, productId));
    }
    const [inserted] = await tx
      .insert(productImages)
      .values({
        productId,
        mediaId: input.mediaId ?? null,
        imageUrl: input.imageUrl ?? null,
        altText: input.altText ?? null,
        placement: input.placement ?? null,
        sortOrder: input.sortOrder ?? 0,
        isPrimary: input.isPrimary ?? false,
      })
      .$returningId();
    const [row] = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.id, inserted.id))
      .limit(1);
    created = row;
  });
  await audit(deps, actor, AUDIT_ACTIONS.storeProductImagesCreate, "product_image", created!.id, meta, {
    productId,
  });
  return created!;
}

async function getProductImageOrThrow(
  db: DbLike,
  imageId: number,
): Promise<ProductImageRow> {
  const [row] = await db
    .select()
    .from(productImages)
    .where(eq(productImages.id, imageId))
    .limit(1);
  if (!row) throw AppError.notFound("Product image not found.");
  return row;
}

export async function updateProductImage(
  deps: StoreAdminDeps,
  actor: StoreActor,
  imageId: number,
  input: UpdateProductImageInput,
  meta: RequestMeta,
): Promise<ProductImageAdminView> {
  const { db } = deps;
  const image = await getProductImageOrThrow(db, imageId);
  if (input.mediaId != null) await assertMediaExists(db, input.mediaId, "mediaId");
  const patch = definedPatch(input);
  // Placement invariant (0025, mirroring the 0024 cover rule): a
  // placement describes THIS image. If the update changes the image
  // source — media asset or legacy URL — the old placement is cleared
  // server-side, unless the same payload explicitly supplies one
  // (an explicit placement, including null, always wins). Omission
  // with an unchanged source preserves the stored placement.
  const nextMediaId = "mediaId" in patch ? patch.mediaId : image.mediaId;
  const nextImageUrl = "imageUrl" in patch ? patch.imageUrl : image.imageUrl;
  const sourceChanged = nextMediaId !== image.mediaId || nextImageUrl !== image.imageUrl;
  if (sourceChanged && !("placement" in patch)) {
    patch.placement = null;
  }
  await db.transaction(async (tx) => {
    if (input.isPrimary === true) {
      await tx
        .update(productImages)
        .set({ isPrimary: false })
        .where(eq(productImages.productId, image.productId));
    }
    await tx
      .update(productImages)
      .set(patch)
      .where(eq(productImages.id, imageId));
  });
  const row = await getProductImageOrThrow(db, imageId);
  await audit(deps, actor, AUDIT_ACTIONS.storeProductImagesUpdate, "product_image", imageId, meta, {
    productId: image.productId,
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteProductImage(
  deps: StoreAdminDeps,
  actor: StoreActor,
  imageId: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  const image = await getProductImageOrThrow(db, imageId);
  await db.delete(productImages).where(eq(productImages.id, imageId));
  await audit(deps, actor, AUDIT_ACTIONS.storeProductImagesDelete, "product_image", imageId, meta, {
    productId: image.productId,
  });
}

// ---------------------------------------------------------------------------
// Variants (§9.4)
// ---------------------------------------------------------------------------

export type VariantAdminView = VariantRow;

async function getVariantOrThrow(db: DbLike, id: number): Promise<VariantRow> {
  const [row] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id))
    .limit(1);
  if (!row) throw AppError.notFound("Variant not found.");
  return row;
}

async function assertVariantSkuFree(
  db: DbLike,
  sku: string,
  excludeId?: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.sku, sku))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A variant with SKU '${sku}' already exists.`);
  }
}

/** Recompute products.stock_qty as the sum of its variants' stock (§9.4 mirror). */
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

export async function listVariants(
  deps: StoreAdminDeps,
  productId: number,
): Promise<VariantAdminView[]> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  return db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.id));
}

export async function createVariant(
  deps: StoreAdminDeps,
  actor: StoreActor,
  productId: number,
  input: CreateVariantInput,
  meta: RequestMeta,
): Promise<VariantAdminView> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  if (input.sku != null) await assertVariantSkuFree(db, input.sku);
  let created: VariantRow | undefined;
  try {
    await db.transaction(async (tx) => {
      const opening = input.stockQty ?? 0;
      const [inserted] = await tx
        .insert(productVariants)
        .values({
          productId,
          sku: input.sku ?? null,
          name: input.name,
          priceDelta: input.priceDelta ?? "0.00",
          stockQty: opening,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 0,
        })
        .$returningId();
      if (opening > 0) {
        await tx.insert(inventoryMovements).values({
          productId,
          variantId: inserted.id,
          movementType: "OPENING",
          quantity: opening,
          balanceAfter: opening,
          actorId: actor.userId,
          reason: "Opening stock (variant)",
        });
      }
      await syncProductStockMirror(tx, productId);
      const [row] = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, inserted.id))
        .limit(1);
      created = row;
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict("A variant with this SKU already exists.");
    }
    throw err;
  }
  await audit(deps, actor, AUDIT_ACTIONS.storeVariantsCreate, "product_variant", created!.id, meta, {
    productId,
  });
  return created!;
}

export async function updateVariant(
  deps: StoreAdminDeps,
  actor: StoreActor,
  productId: number,
  variantId: number,
  input: UpdateVariantInput,
  meta: RequestMeta,
): Promise<VariantAdminView> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  const variant = await getVariantOrThrow(db, variantId);
  if (variant.productId !== productId) throw AppError.notFound("Variant not found.");
  if (input.sku != null) await assertVariantSkuFree(db, input.sku, variantId);
  try {
    await db
      .update(productVariants)
      .set(definedPatch(input))
      .where(eq(productVariants.id, variantId));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict("A variant with this SKU already exists.");
    }
    throw err;
  }
  const row = await getVariantOrThrow(db, variantId);
  await audit(deps, actor, AUDIT_ACTIONS.storeVariantsUpdate, "product_variant", variantId, meta, {
    productId,
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteVariant(
  deps: StoreAdminDeps,
  actor: StoreActor,
  productId: number,
  variantId: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  const variant = await getVariantOrThrow(db, variantId);
  if (variant.productId !== productId) throw AppError.notFound("Variant not found.");
  // Referenced variants are history — refuse and let the admin deactivate
  // instead (the RESTRICT FKs would reject the delete anyway).
  const [movementRef] = await db
    .select({ value: count() })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId));
  const [orderRef] = await db
    .select({ value: count() })
    .from(orderItems)
    .where(eq(orderItems.variantId, variantId));
  const [cartRef] = await db
    .select({ value: count() })
    .from(cartItems)
    .where(eq(cartItems.variantId, variantId));
  if (
    (movementRef?.value ?? 0) > 0 ||
    (orderRef?.value ?? 0) > 0 ||
    (cartRef?.value ?? 0) > 0
  ) {
    throw AppError.conflict(
      "This variant is referenced by stock history, carts or orders and cannot be deleted. Deactivate it instead.",
    );
  }
  await db.transaction(async (tx) => {
    await tx.delete(productVariants).where(eq(productVariants.id, variantId));
    await syncProductStockMirror(tx, productId);
  });
  await audit(deps, actor, AUDIT_ACTIONS.storeVariantsDelete, "product_variant", variantId, meta, {
    productId,
  });
}

// ---------------------------------------------------------------------------
// Inventory (§9.5 — this service is the ledger's only writer)
// ---------------------------------------------------------------------------

export interface InventorySummary {
  productId: number;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  variants: {
    variantId: number;
    name: string;
    stockQty: number;
    reservedQty: number;
    availableQty: number;
  }[];
}

export async function getInventorySummary(
  deps: StoreAdminDeps,
  productId: number,
): Promise<InventorySummary> {
  const { db } = deps;
  const product = await getProductOrThrow(db, productId);
  const variantRows = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.id));
  const variants = [];
  for (const variant of variantRows) {
    variants.push({
      variantId: variant.id,
      name: variant.name,
      stockQty: variant.stockQty,
      reservedQty: await reservedQty(db, productId, variant.id),
      availableQty: await variantAvailableQty(db, product, variant, productId),
    });
  }
  return {
    productId,
    stockQty: product.stockQty,
    reservedQty: await reservedQty(db, productId),
    availableQty: await productAvailableQty(db, product),
    variants,
  };
}

export async function listInventoryMovements(
  deps: StoreAdminDeps,
  productId: number,
  pagination: PaginationParams,
): Promise<{ items: MovementRow[]; total: number }> {
  const { db } = deps;
  await getProductOrThrow(db, productId);
  const where = eq(inventoryMovements.productId, productId);
  const [totalRow] = await db
    .select({ value: count() })
    .from(inventoryMovements)
    .where(where);
  const rows = await db
    .select()
    .from(inventoryMovements)
    .where(where)
    .orderBy(desc(inventoryMovements.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function adjustInventory(
  deps: StoreAdminDeps,
  actor: StoreActor,
  productId: number,
  input: AdjustInventoryInput,
  meta: RequestMeta,
): Promise<InventorySummary> {
  const { db } = deps;
  await getProductOrThrow(db, productId);

  await db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .for("update");
    if (!product) throw AppError.notFound("Product not found.");

    const variantRows = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    const activeVariants = variantRows.filter((row) => row.isActive);

    let variant: VariantRow | null = null;
    if (input.variantId != null) {
      variant = variantRows.find((row) => row.id === input.variantId) ?? null;
      if (!variant) {
        throw AppError.validation(
          [{ field: "variantId", issue: "Variant not found for this product." }],
          "The submitted data is invalid.",
        );
      }
    } else if (activeVariants.length > 0) {
      throw AppError.validation(
        [
          {
            field: "variantId",
            issue: "This product tracks stock per variant — specify variantId.",
          },
        ],
        "The submitted data is invalid.",
      );
    }

    const current = variant ? variant.stockQty : product.stockQty;
    const reserved = await reservedQty(tx, productId, variant ? variant.id : undefined);
    const delta =
      input.quantity !== undefined
        ? input.quantity
        : input.setQuantity! - current;
    if (delta === 0) {
      throw AppError.validation(
        [{ field: "quantity", issue: "The adjustment does not change the stock." }],
        "The submitted data is invalid.",
      );
    }
    const next = current + delta;
    if (next < 0) {
      throw insufficientStock(
        [{ field: "quantity", issue: "Stock cannot go below zero." }],
        "Stock cannot go below zero.",
      );
    }
    if (next < reserved) {
      throw insufficientStock(
        [
          {
            field: "quantity",
            issue: `${reserved} unit(s) are reserved by pending orders; stock cannot drop below that.`,
          },
        ],
        "Stock cannot drop below the reserved quantity.",
      );
    }

    if (variant) {
      await tx
        .update(productVariants)
        .set({ stockQty: next })
        .where(eq(productVariants.id, variant.id));
    } else {
      await tx
        .update(products)
        .set({ stockQty: next })
        .where(eq(products.id, productId));
    }
    await tx.insert(inventoryMovements).values({
      productId,
      variantId: variant?.id ?? null,
      movementType: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      quantity: delta,
      balanceAfter: next,
      actorId: actor.userId,
      reason: input.reason ?? null,
    });
    if (variant) await syncProductStockMirror(tx, productId);
    // READ COMMITTED, like checkout: the reserved-quantity floor must be
    // computed from the latest committed reservations, not a snapshot.
  }, { isolationLevel: "read committed" });

  const summary = await getInventorySummary(deps, productId);
  await audit(deps, actor, AUDIT_ACTIONS.storeInventoryAdjust, "product", productId, meta, {
    variantId: input.variantId ?? null,
    quantity: input.quantity ?? null,
    setQuantity: input.setQuantity ?? null,
    reason: input.reason ?? null,
    stockQty: summary.stockQty,
  });
  return summary;
}

// Re-exported for routes that need the raw row type.
export type { MovementRow };
