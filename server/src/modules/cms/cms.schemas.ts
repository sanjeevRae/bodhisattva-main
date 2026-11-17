/**
 * Request-body schemas for the CMS admin API. These validate request
 * SHAPE only; section config content is validated by the registry
 * (registry.ts) in the service, and slug rules by the shared slug schema
 * plus the reserved-slug list.
 */
import { z } from "zod";

const nullableText = (max: number) =>
  z.string().max(max).nullable().optional();

export const createPageSchema = z.object({
  slug: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
  seoTitle: nullableText(200),
  metaDescription: nullableText(320),
  ogImageMediaId: z.number().int().positive().nullable().optional(),
});

export const updatePageSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    slug: z.string().min(1).max(160).optional(),
    seoTitle: nullableText(200),
    metaDescription: nullableText(320),
    ogImageMediaId: z.number().int().positive().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one field must be provided.",
  });

export const sectionInputSchema = z.object({
  type: z.string().min(1).max(60),
  isVisible: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()),
  design: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const saveDraftSchema = z.object({
  expectedVersion: z.number().int().min(1),
  // The exact draft revision the editor loaded (Phase 4 review fix): the
  // service refuses the save when the page's draft pointer has moved since
  // (publish / rollback elsewhere), even if the version coincidentally
  // matches the fresh draft's version.
  revisionId: z.number().int().positive(),
  sections: z.array(sectionInputSchema).max(200),
});

export const replaceMenuItemsSchema = z.object({
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        linkType: z.enum(["PAGE", "EXTERNAL", "ANCHOR"]),
        pageId: z.number().int().positive().nullable().optional(),
        pageSlug: z.string().min(1).max(160).optional(),
        url: z.string().max(500).nullable().optional(),
        sortOrder: z.number().int().optional(),
        isVisible: z.boolean().optional(),
      }),
    )
    .max(200),
});

/** Any JSON value (settings are JSON-encoded at rest, §7.6). */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const updateSettingsSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(80)
          .regex(
            /^[a-z0-9_.]+$/,
            "Setting keys are lowercase letters, numbers, underscores and dots",
          ),
        value: jsonValueSchema,
        isPublic: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
});
