/**
 * Request-body schemas for the store APIs (DATABASE_DESIGN.md §9,
 * PERMISSIONS.md store rows). Shape validation only; referential rules
 * (slug/SKU uniqueness, category/media existence, stock) live in the
 * service. Money inputs are DECIMAL strings in the shared money format —
 * never numbers — so no binary floating point ever enters a price.
 *
 * The checkout schema deliberately has NO price/total fields: totals are
 * computed server-side from live product rows (§9.8). Unknown keys are
 * stripped by Zod, so a client that submits prices anyway has them
 * ignored by construction.
 */
import { isMoneyString } from "@bodhisattva/shared/money";
import { slugSchema } from "@bodhisattva/shared/ids";
import { z } from "zod";

const nullableText = (max: number) =>
  z.string().max(max).nullable().optional();

const nullableLongText = z.string().max(20000).nullable().optional();

/** A media-asset reference: positive id, or explicit null to clear. */
const mediaRef = z.number().int().positive().nullable().optional();

/** A DECIMAL money string ("4500.00"); may be negative where deltas allow. */
const moneyString = (allowNegative = false) =>
  z
    .string()
    .max(20)
    .refine((value) => isMoneyString(value), "Must be a decimal amount, e.g. '4500.00'")
    .refine(
      (value) => allowNegative || !value.startsWith("-"),
      "Amount must not be negative",
    );

const nonEmptyPatch = (patch: Record<string, unknown>) =>
  Object.keys(patch).length > 0;

// ---------------------------------------------------------------------------
// Public shop queries
// ---------------------------------------------------------------------------

export const shopListQuerySchema = z.object({
  category: z.string().trim().max(140).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z
    .enum(["featured", "price-asc", "price-desc", "name"])
    .default("featured"),
});

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const addCartItemSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().min(1).max(10000),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(10000),
});

// ---------------------------------------------------------------------------
// Addresses (§9.7)
// ---------------------------------------------------------------------------

const addressFields = {
  label: nullableText(60),
  recipientName: z.string().min(1).max(120),
  phone: z.string().min(1).max(32),
  addressLine: z.string().min(1).max(255),
  city: z.string().min(1).max(120),
  district: nullableText(120),
  postalCode: nullableText(20),
  deliveryNotes: nullableText(500),
  isDefault: z.boolean().optional(),
};

export const createAddressSchema = z.object({ ...addressFields });

export const updateAddressSchema = z
  .object({
    label: addressFields.label,
    recipientName: addressFields.recipientName.optional(),
    phone: addressFields.phone.optional(),
    addressLine: addressFields.addressLine.optional(),
    city: addressFields.city.optional(),
    district: addressFields.district,
    postalCode: addressFields.postalCode,
    deliveryNotes: addressFields.deliveryNotes,
    isDefault: addressFields.isDefault,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

/** Inline delivery details for checkout (same shape as an address minus label/default). */
export const checkoutAddressSchema = z.object({
  recipientName: addressFields.recipientName,
  phone: addressFields.phone,
  addressLine: addressFields.addressLine,
  city: addressFields.city,
  district: addressFields.district,
  postalCode: addressFields.postalCode,
  deliveryNotes: addressFields.deliveryNotes,
});

// ---------------------------------------------------------------------------
// Checkout (§9.8, amendment A2)
// ---------------------------------------------------------------------------

export const checkoutSchema = z
  .object({
    addressId: z.number().int().positive().optional(),
    address: checkoutAddressSchema.optional(),
    /** Client-generated submission key (A2); required, ≤ 64 chars. */
    idempotencyKey: z.string().min(1).max(64),
    notes: z.string().max(500).optional(),
  })
  .refine((body) => (body.addressId === undefined) !== (body.address === undefined), {
    message: "Provide exactly one of addressId or address.",
  });

// ---------------------------------------------------------------------------
// Admin — product categories (§9.1)
// ---------------------------------------------------------------------------

const productCategoryFields = {
  slug: slugSchema,
  name: z.string().min(1).max(140),
  description: nullableText(500),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
};

export const createProductCategorySchema = z.object({
  ...productCategoryFields,
});

export const updateProductCategorySchema = z
  .object({
    slug: productCategoryFields.slug.optional(),
    name: productCategoryFields.name.optional(),
    description: productCategoryFields.description,
    sortOrder: productCategoryFields.sortOrder,
    isActive: productCategoryFields.isActive,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Admin — products (§9.2)
// ---------------------------------------------------------------------------

export const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

const productFields = {
  slug: slugSchema,
  sku: z.string().min(1).max(60).nullable().optional(),
  name: z.string().min(1).max(220),
  categoryId: mediaRef,
  shortDescription: nullableText(500),
  description: nullableLongText,
  price: moneyString(),
  salePrice: moneyString().nullable().optional(),
  trackInventory: z.boolean().optional(),
  status: productStatusSchema.optional(),
  isFeatured: z.boolean().optional(),
};

export const createProductSchema = z.object({
  ...productFields,
  /** Opening on-hand stock; written as an OPENING ledger movement. */
  stockQty: z.number().int().min(0).max(1000000).optional(),
});

export const updateProductSchema = z
  .object({
    slug: productFields.slug.optional(),
    sku: productFields.sku,
    name: productFields.name.optional(),
    categoryId: productFields.categoryId,
    shortDescription: productFields.shortDescription,
    description: productFields.description,
    price: productFields.price.optional(),
    salePrice: productFields.salePrice,
    trackInventory: productFields.trackInventory,
    status: productFields.status,
    isFeatured: productFields.isFeatured,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Admin — product images (§9.3) and variants (§9.4)
// ---------------------------------------------------------------------------

export const createProductImageSchema = z
  .object({
    mediaId: z.number().int().positive().nullable().optional(),
    imageUrl: nullableText(1000),
    altText: nullableText(255),
    sortOrder: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((body) => body.mediaId != null || body.imageUrl != null, {
    message: "Provide a mediaId or an imageUrl.",
  });

export const updateProductImageSchema = z
  .object({
    mediaId: z.number().int().positive().nullable().optional(),
    imageUrl: nullableText(1000),
    altText: nullableText(255),
    sortOrder: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

const variantFields = {
  sku: z.string().min(1).max(60).nullable().optional(),
  name: z.string().min(1).max(160),
  priceDelta: moneyString(true).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createVariantSchema = z.object({
  ...variantFields,
  /** Opening variant stock; written as an OPENING ledger movement. */
  stockQty: z.number().int().min(0).max(1000000).optional(),
});

export const updateVariantSchema = z
  .object({
    sku: variantFields.sku,
    name: variantFields.name.optional(),
    priceDelta: variantFields.priceDelta,
    isActive: variantFields.isActive,
    sortOrder: variantFields.sortOrder,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Admin — inventory (§9.5)
// ---------------------------------------------------------------------------

export const adjustInventorySchema = z
  .object({
    variantId: z.number().int().positive().nullable().optional(),
    /** Signed delta applied to on-hand stock… */
    quantity: z.number().int().min(-1000000).max(1000000).optional(),
    /** …or the absolute on-hand quantity to set. Exactly one is required. */
    setQuantity: z.number().int().min(0).max(1000000).optional(),
    reason: z.string().max(255).optional(),
  })
  .refine((body) => (body.quantity === undefined) !== (body.setQuantity === undefined), {
    message: "Provide exactly one of quantity or setQuantity.",
  })
  .refine((body) => body.quantity !== 0, {
    message: "quantity must not be zero.",
  });

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CheckoutAddressInput = z.infer<typeof checkoutAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CreateProductCategoryInput = z.infer<
  typeof createProductCategorySchema
>;
export type UpdateProductCategoryInput = z.infer<
  typeof updateProductCategorySchema
>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateProductImageInput = z.infer<typeof createProductImageSchema>;
export type UpdateProductImageInput = z.infer<typeof updateProductImageSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
