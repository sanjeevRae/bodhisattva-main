/**
 * Media DTOs (strict — unknown keys rejected, mirroring roles.schemas.ts).
 *
 * The upload body arrives as multipart form fields (strings), so its schema
 * is string-based; everything else is JSON.
 */
import { z } from "zod";

/** Optional text fields that may accompany the multipart upload. */
export const uploadFieldsSchema = z.object({
  folderId: z
    .string()
    .regex(/^\d+$/, "folderId must be a positive integer")
    .transform((v) => Number(v))
    .optional(),
  altText: z.string().trim().max(255).optional(),
  caption: z.string().trim().max(500).optional(),
});
export type UploadFieldsInput = z.infer<typeof uploadFieldsSchema>;

export const createFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    parentId: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    parentId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "No changes supplied.",
  });
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export const updateAssetSchema = z
  .object({
    altText: z.string().trim().max(255).nullable().optional(),
    caption: z.string().trim().max(500).nullable().optional(),
    originalName: z.string().trim().min(1).max(255).optional(),
    folderId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "No changes supplied.",
  });
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

/** Library list filters (pagination is parsed separately, shared schema). */
export const listMediaQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  folderId: z.coerce.number().int().positive().optional(),
});
export type ListMediaQueryInput = z.infer<typeof listMediaQuerySchema>;
