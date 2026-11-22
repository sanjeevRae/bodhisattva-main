/**
 * Request-body schemas for the museum-module APIs (DATABASE_DESIGN.md
 * §8, PERMISSIONS.md museum rows). Shape validation only; referential
 * rules (slug uniqueness, media/category existence) live in the service.
 * Slugs use the shared slug schema (ARCHITECTURE.md §6.1, §8.4).
 */
import { slugSchema } from "@bodhisattva/shared/ids";
import { z } from "zod";
import { placementSchema } from "../cms/registry.js";

/** The placement shape itself (focal point / zoom / fit, per device). */
export type CoverPlacement = z.infer<typeof placementSchema>;

/**
 * Cover placement on create/update (migration 0024): an object sets or
 * replaces it, explicit null clears it, and omitting the field leaves
 * the stored value alone — except that the service clears it whenever
 * the cover source itself changes or disappears.
 */
const coverPlacementField = placementSchema.nullable().optional();

const nullableText = (max: number) =>
  z.string().max(max).nullable().optional();

/** Long-form text (descriptions, summaries, quotes). */
const nullableLongText = z.string().max(20000).nullable().optional();

/** A media-asset reference: positive id, or explicit null to clear. */
const mediaRef = z.number().int().positive().nullable().optional();

/** Calendar date in the schema's string mode ('YYYY-MM-DD'), real dates only. */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(
    (value) =>
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    "Date must be a real calendar date",
  );

const nonEmptyPatch = (patch: Record<string, unknown>) =>
  Object.keys(patch).length > 0;

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const collectionFields = {
  slug: slugSchema,
  name: z.string().min(1).max(200),
  category: nullableText(80),
  periodLabel: nullableText(120),
  description: nullableLongText,
  history: nullableLongText,
  coverMediaId: mediaRef,
  imageUrl: nullableText(1000),
  imageAlt: nullableText(500),
  coverPlacement: coverPlacementField,
  itemCount: z.number().int().min(0).nullable().optional(),
  isFeatured: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createCollectionSchema = z.object({ ...collectionFields });

export const updateCollectionSchema = z
  .object({
    slug: collectionFields.slug.optional(),
    name: collectionFields.name.optional(),
    category: collectionFields.category,
    periodLabel: collectionFields.periodLabel,
    description: collectionFields.description,
    history: collectionFields.history,
    coverMediaId: collectionFields.coverMediaId,
    imageUrl: collectionFields.imageUrl,
    imageAlt: collectionFields.imageAlt,
    coverPlacement: collectionFields.coverPlacement,
    itemCount: collectionFields.itemCount,
    isFeatured: collectionFields.isFeatured,
    isPublished: collectionFields.isPublished,
    sortOrder: collectionFields.sortOrder,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Exhibitions
// ---------------------------------------------------------------------------

export const exhibitionStatusSchema = z.enum(["UPCOMING", "CURRENT", "PAST"]);
export const coverAspectSchema = z.enum(["tall", "standard"]);

const exhibitionFields = {
  slug: slugSchema,
  title: z.string().min(1).max(220),
  description: nullableLongText,
  coverMediaId: mediaRef,
  imageUrl: nullableText(1000),
  imageAlt: nullableText(500),
  coverPlacement: coverPlacementField,
  location: nullableText(160),
  curator: nullableText(160),
  category: nullableText(80),
  startsOn: dateString.nullable().optional(),
  endsOn: dateString.nullable().optional(),
  status: exhibitionStatusSchema.optional(),
  coverAspect: coverAspectSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createExhibitionSchema = z.object({ ...exhibitionFields });

export const updateExhibitionSchema = z
  .object({
    slug: exhibitionFields.slug.optional(),
    title: exhibitionFields.title.optional(),
    description: exhibitionFields.description,
    coverMediaId: exhibitionFields.coverMediaId,
    imageUrl: exhibitionFields.imageUrl,
    imageAlt: exhibitionFields.imageAlt,
    coverPlacement: exhibitionFields.coverPlacement,
    location: exhibitionFields.location,
    curator: exhibitionFields.curator,
    category: exhibitionFields.category,
    startsOn: exhibitionFields.startsOn,
    endsOn: exhibitionFields.endsOn,
    status: exhibitionFields.status,
    coverAspect: exhibitionFields.coverAspect,
    isFeatured: exhibitionFields.isFeatured,
    isPublished: exhibitionFields.isPublished,
    sortOrder: exhibitionFields.sortOrder,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Gallery items
// ---------------------------------------------------------------------------

const galleryItemFields = {
  mediaId: z.number().int().positive(),
  title: nullableText(220),
  caption: nullableText(500),
  category: nullableText(80),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createGalleryItemSchema = z.object({ ...galleryItemFields });

export const updateGalleryItemSchema = z
  .object({
    mediaId: galleryItemFields.mediaId.optional(),
    exhibitionId: mediaRef,
    title: galleryItemFields.title,
    caption: galleryItemFields.caption,
    category: galleryItemFields.category,
    year: galleryItemFields.year,
    isPublished: galleryItemFields.isPublished,
    sortOrder: galleryItemFields.sortOrder,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// News categories + articles
// ---------------------------------------------------------------------------

const newsCategoryFields = {
  slug: slugSchema,
  name: z.string().min(1).max(120),
  colorToken: nullableText(160),
};

export const createNewsCategorySchema = z.object({ ...newsCategoryFields });

export const updateNewsCategorySchema = z
  .object({
    slug: newsCategoryFields.slug.optional(),
    name: newsCategoryFields.name.optional(),
    colorToken: newsCategoryFields.colorToken,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

const newsArticleFields = {
  slug: slugSchema,
  title: z.string().min(1).max(255),
  categoryId: mediaRef,
  outlet: nullableText(160),
  articleType: nullableText(40),
  summary: nullableLongText,
  // The readable article body (migration 0011): rich text, sanitised at
  // save in the service. Generous cap — LONGTEXT storage.
  content: z.string().max(500_000).nullable().optional(),
  author: nullableText(160),
  publishedOn: dateString.nullable().optional(),
  externalUrl: nullableText(500),
  documentMediaId: mediaRef,
  coverMediaId: mediaRef,
  imageUrl: nullableText(1000),
  imageAlt: nullableText(500),
  isPublished: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  // Tag names; the service get-or-creates tags by slug. Sending the array
  // replaces the article's tag set; omitting it leaves tags untouched.
  tags: z
    .array(z.string().trim().min(1).max(80))
    .max(20)
    .optional(),
};

export const createNewsArticleSchema = z.object({ ...newsArticleFields });

export const updateNewsArticleSchema = z
  .object({
    slug: newsArticleFields.slug.optional(),
    title: newsArticleFields.title.optional(),
    categoryId: newsArticleFields.categoryId,
    outlet: newsArticleFields.outlet,
    articleType: newsArticleFields.articleType,
    summary: newsArticleFields.summary,
    content: newsArticleFields.content,
    author: newsArticleFields.author,
    publishedOn: newsArticleFields.publishedOn,
    externalUrl: newsArticleFields.externalUrl,
    documentMediaId: newsArticleFields.documentMediaId,
    coverMediaId: newsArticleFields.coverMediaId,
    imageUrl: newsArticleFields.imageUrl,
    imageAlt: newsArticleFields.imageAlt,
    isPublished: newsArticleFields.isPublished,
    isFeatured: newsArticleFields.isFeatured,
    tags: newsArticleFields.tags,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

/** Bulk lifecycle action over a set of article ids (News Clippings). */
export const newsBulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  action: z.enum(["publish", "unpublish", "archive"]),
});
export type NewsBulkInput = z.infer<typeof newsBulkSchema>;

// ---------------------------------------------------------------------------
// Foundation programs
// ---------------------------------------------------------------------------

const foundationProgramFields = {
  slug: slugSchema,
  name: z.string().min(1).max(200),
  category: nullableText(80),
  description: nullableLongText,
  impactLabel: nullableText(160),
  iconName: nullableText(80),
  coverMediaId: mediaRef,
  imageUrl: nullableText(1000),
  imageAlt: nullableText(500),
  isFeatured: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createFoundationProgramSchema = z.object({
  ...foundationProgramFields,
});

export const updateFoundationProgramSchema = z
  .object({
    slug: foundationProgramFields.slug.optional(),
    name: foundationProgramFields.name.optional(),
    category: foundationProgramFields.category,
    description: foundationProgramFields.description,
    impactLabel: foundationProgramFields.impactLabel,
    iconName: foundationProgramFields.iconName,
    coverMediaId: foundationProgramFields.coverMediaId,
    imageUrl: foundationProgramFields.imageUrl,
    imageAlt: foundationProgramFields.imageAlt,
    isFeatured: foundationProgramFields.isFeatured,
    isPublished: foundationProgramFields.isPublished,
    sortOrder: foundationProgramFields.sortOrder,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Testimonials (no slug — the table has none)
// ---------------------------------------------------------------------------

const testimonialFields = {
  quote: z.string().min(1).max(20000),
  authorName: z.string().min(1).max(120),
  authorRole: nullableText(160),
  avatarMediaId: mediaRef,
  imageUrl: nullableText(1000),
  imageAlt: nullableText(500),
  context: z.string().min(1).max(40).optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createTestimonialSchema = z.object({ ...testimonialFields });

export const updateTestimonialSchema = z
  .object({
    quote: testimonialFields.quote.optional(),
    authorName: testimonialFields.authorName.optional(),
    authorRole: testimonialFields.authorRole,
    avatarMediaId: testimonialFields.avatarMediaId,
    imageUrl: testimonialFields.imageUrl,
    imageAlt: testimonialFields.imageAlt,
    context: testimonialFields.context,
    isPublished: testimonialFields.isPublished,
    sortOrder: testimonialFields.sortOrder,
  })
  .refine(nonEmptyPatch, { message: "At least one field must be provided." });

// ---------------------------------------------------------------------------
// Reorder (collections, exhibitions, gallery items, programs, testimonials)
// ---------------------------------------------------------------------------

export const reorderSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "ids must not contain duplicates.",
    }),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type CreateExhibitionInput = z.infer<typeof createExhibitionSchema>;
export type UpdateExhibitionInput = z.infer<typeof updateExhibitionSchema>;
export type CreateGalleryItemInput = z.infer<typeof createGalleryItemSchema>;
export type UpdateGalleryItemInput = z.infer<typeof updateGalleryItemSchema>;
export type CreateNewsCategoryInput = z.infer<typeof createNewsCategorySchema>;
export type UpdateNewsCategoryInput = z.infer<typeof updateNewsCategorySchema>;
export type CreateNewsArticleInput = z.infer<typeof createNewsArticleSchema>;
export type UpdateNewsArticleInput = z.infer<typeof updateNewsArticleSchema>;
export type CreateFoundationProgramInput = z.infer<
  typeof createFoundationProgramSchema
>;
export type UpdateFoundationProgramInput = z.infer<
  typeof updateFoundationProgramSchema
>;
export type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>;
export type UpdateTestimonialInput = z.infer<typeof updateTestimonialSchema>;
