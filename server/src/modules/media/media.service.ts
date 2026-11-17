/**
 * Media service (DATABASE_DESIGN.md §7.7, ARCHITECTURE.md §9).
 *
 * Upload pipeline: size limit (route) → content sniffing with sharp (never
 * the client-supplied type or extension) → re-encode (auto-rotate, all
 * metadata stripped by sharp's default) → random 128-bit storage name →
 * files under `config.uploadDirectory/<first 2 chars of name>/`, outside
 * any web root → `media_assets` row with the sniffed mime and dimensions.
 *
 * Derivatives (`_thumb` 300w, `_medium` 800w, same format as the master)
 * are generated at upload time, only when the master is wider than the
 * derivative; they are files derived from `storage_name`, never rows.
 *
 * Deletes are soft and reference-blocked (§7.7): an asset referenced by a
 * page's og image, by any section config/design, or by a museum-module
 * record (Phase 5: collection/exhibition/news/program covers, gallery
 * items, news documents, testimonial avatars — direct FK columns, counted
 * without a JSON scan) cannot be deleted.
 * Files stay on disk after a soft delete — hard delete is an
 * admin-confirmed purge, out of scope here.
 */
import { randomBytes } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@bodhisattva/shared/errors";
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import { and, count, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import sharp from "sharp";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  collections,
  exhibitions,
  foundationPrograms,
  galleryItems,
  mediaAssets,
  mediaFolders,
  newsArticles,
  pageSections,
  pages,
  productImages,
  testimonials,
} from "../../database/schema/index.js";
import type { AuthContext } from "../../middleware/authorization.js";
import { writeAudit } from "../../services/audit.js";
import type {
  CreateFolderInput,
  UpdateAssetInput,
  UpdateFolderInput,
} from "./media.schemas.js";

/** Hard upload ceiling: 10 MiB, enforced again by multer at the route. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const THUMB_WIDTH = 300;
const MEDIUM_WIDTH = 800;

/** Formats accepted after content sniffing; SVG/executables never pass. */
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

/** Output encoding per accepted input format (gif/avif normalise to webp). */
const OUTPUT_FORMAT: Record<string, "jpeg" | "png" | "webp"> = {
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  gif: "webp",
  avif: "webp",
};
const FORMAT_EXT: Record<"jpeg" | "png" | "webp", string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};
const FORMAT_MIME: Record<"jpeg" | "png" | "webp", string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Server-generated names only — anything else is not a file we wrote. */
const STORAGE_NAME_PATTERN = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

export interface MediaDeps {
  db: Database;
  config: AppConfig;
  logger?: Logger;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type MediaVariant = "master" | "thumb" | "medium";
export const MEDIA_VARIANTS: readonly MediaVariant[] = [
  "master",
  "thumb",
  "medium",
];

export function mediaFileUrl(id: number, variant: MediaVariant): string {
  return `/api/media/${id}/file/${variant}`;
}

export interface MediaAssetView {
  id: number;
  folderId: number | null;
  storageName: string;
  originalName: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  urls: {
    master: string;
    thumb: string | null;
    medium: string | null;
  };
}

export interface MediaFolderView {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: Date;
}

type MediaAssetRow = typeof mediaAssets.$inferSelect;
type MediaFolderRow = typeof mediaFolders.$inferSelect;

function toAssetView(row: MediaAssetRow): MediaAssetView {
  return {
    id: row.id,
    folderId: row.folderId,
    storageName: row.storageName,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    altText: row.altText,
    caption: row.caption,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    urls: {
      master: mediaFileUrl(row.id, "master"),
      thumb:
        row.width !== null && row.width > THUMB_WIDTH
          ? mediaFileUrl(row.id, "thumb")
          : null,
      medium:
        row.width !== null && row.width > MEDIUM_WIDTH
          ? mediaFileUrl(row.id, "medium")
          : null,
    },
  };
}

function toFolderView(row: MediaFolderRow): MediaFolderView {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Storage paths. Every path is built from the server-generated storage name
// stored in the DB — never from user input (§7.7, §9).
// ---------------------------------------------------------------------------

function storageDir(config: AppConfig, storageName: string): string {
  return path.join(
    path.resolve(config.uploadDirectory),
    storageName.slice(0, 2),
  );
}

function variantFileName(
  storageName: string,
  variant: MediaVariant,
): string {
  if (variant === "master") return storageName;
  const dot = storageName.lastIndexOf(".");
  return `${storageName.slice(0, dot)}_${variant}${storageName.slice(dot)}`;
}

function variantFilePath(
  config: AppConfig,
  storageName: string,
  variant: MediaVariant,
): string {
  return path.join(
    storageDir(config, storageName),
    variantFileName(storageName, variant),
  );
}

function variantWidth(variant: MediaVariant): number {
  if (variant === "thumb") return THUMB_WIDTH;
  if (variant === "medium") return MEDIUM_WIDTH;
  return 0;
}

// ---------------------------------------------------------------------------
// Image encoding (sharp). Sharp strips metadata unless told to keep it, so
// a plain re-encode removes EXIF and any payload smuggled in metadata.
// ---------------------------------------------------------------------------

function applyFormat(
  pipeline: sharp.Sharp,
  format: "jpeg" | "png" | "webp",
): sharp.Sharp {
  if (format === "jpeg") return pipeline.jpeg({ quality: 90 });
  if (format === "png") return pipeline.png();
  return pipeline.webp({ quality: 90 });
}

interface EncodedMaster {
  buffer: Buffer;
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
}

/**
 * Decompression-bomb guard (Phase 3 review fix): a small compressed file
 * can declare enormous pixel dimensions. Every decode of user-supplied
 * bytes goes through sharp with an explicit input-pixel ceiling
 * (40 MP ≈ 7300×5500 — far above any legitimate site imagery).
 */
const SHARP_INPUT_OPTIONS = { limitInputPixels: 40_000_000 } as const;

async function encodeMaster(input: Buffer): Promise<EncodedMaster> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, SHARP_INPUT_OPTIONS).metadata();
  } catch {
    throw AppError.validation(
      [{ field: "file", issue: "The uploaded file is not a readable image." }],
      "The uploaded file is not a readable image.",
    );
  }
  const sourceFormat = meta.format;
  if (!sourceFormat || !ACCEPTED_FORMATS.has(sourceFormat)) {
    throw AppError.validation(
      [
        {
          field: "file",
          issue: "Only JPEG, PNG, WebP, GIF or AVIF images can be uploaded.",
        },
      ],
      "Only JPEG, PNG, WebP, GIF or AVIF images can be uploaded.",
    );
  }
  const format = OUTPUT_FORMAT[sourceFormat];
  const animated =
    (meta.pages ?? 1) > 1 &&
    (sourceFormat === "gif" || sourceFormat === "avif");
  let data: Buffer;
  try {
    ({ data } = await applyFormat(
      sharp(input, {
        ...SHARP_INPUT_OPTIONS,
        ...(animated ? { animated: true } : {}),
      }).rotate(),
      format,
    ).toBuffer({ resolveWithObject: true }));
  } catch {
    // Includes the limitInputPixels rejection: an image whose declared
    // dimensions exceed the ceiling is a client error, not a 500.
    throw AppError.validation(
      [{ field: "file", issue: "The uploaded image could not be processed (it may exceed the maximum dimensions)." }],
      "The uploaded image could not be processed.",
    );
  }
  const outMeta = await sharp(data).metadata();
  return {
    buffer: data,
    format,
    width: outMeta.width ?? 0,
    height: outMeta.pageHeight ?? outMeta.height ?? 0,
  };
}

async function encodeDerivative(
  master: Buffer,
  format: "jpeg" | "png" | "webp",
  width: number,
): Promise<Buffer> {
  const meta = await sharp(master).metadata();
  const animated = (meta.pages ?? 1) > 1;
  return applyFormat(
    sharp(master, animated ? { animated: true } : undefined).resize({
      width,
      withoutEnlargement: true,
    }),
    format,
  ).toBuffer();
}

// ---------------------------------------------------------------------------
// Audit helper (action strings per the task contract: "media.upload", …).
// ---------------------------------------------------------------------------

async function audit(
  deps: MediaDeps,
  actor: AuthContext,
  action: string,
  resourceType: "media_asset" | "media_folder",
  resourceId: number,
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
    metadata: metadata ?? null,
  });
}

async function getFolderOrThrow(
  db: Database,
  folderId: number,
): Promise<MediaFolderRow> {
  const [folder] = await db
    .select()
    .from(mediaFolders)
    .where(eq(mediaFolders.id, folderId))
    .limit(1);
  if (!folder) throw AppError.notFound("Media folder not found.");
  return folder;
}

async function getLiveAssetOrThrow(
  db: Database,
  assetId: number,
): Promise<MediaAssetRow> {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), isNull(mediaAssets.deletedAt)))
    .limit(1);
  if (!asset) throw AppError.notFound("Media asset not found.");
  return asset;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadInput {
  buffer: Buffer;
  originalName: string | null;
  folderId?: number;
  altText?: string | null;
  caption?: string | null;
}

export async function uploadMedia(
  deps: MediaDeps,
  actor: AuthContext,
  input: UploadInput,
  meta: RequestMeta,
): Promise<MediaAssetView> {
  const { db, config } = deps;

  if (input.buffer.length === 0) {
    throw AppError.validation(
      [{ field: "file", issue: "The uploaded file is empty." }],
      "The uploaded file is empty.",
    );
  }
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `The file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB upload limit.`,
    );
  }
  if (input.folderId !== undefined) {
    const [folder] = await db
      .select({ id: mediaFolders.id })
      .from(mediaFolders)
      .where(eq(mediaFolders.id, input.folderId))
      .limit(1);
    if (!folder) {
      throw AppError.validation(
        [{ field: "folderId", issue: "Folder not found." }],
        "The target folder does not exist.",
      );
    }
  }

  const master = await encodeMaster(input.buffer);
  const ext = FORMAT_EXT[master.format];

  // Random 128-bit storage name; regenerate on the (astronomically
  // unlikely) collision with an existing row.
  let storageName = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${randomBytes(16).toString("hex")}.${ext}`;
    const [existing] = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.storageName, candidate))
      .limit(1);
    if (!existing) {
      storageName = candidate;
      break;
    }
  }
  if (!storageName) throw AppError.internal();

  const dir = storageDir(config, storageName);
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  try {
    const masterPath = variantFilePath(config, storageName, "master");
    await writeFile(masterPath, master.buffer, { flag: "wx" });
    written.push(masterPath);
    if (master.width > THUMB_WIDTH) {
      const thumbPath = variantFilePath(config, storageName, "thumb");
      await writeFile(
        thumbPath,
        await encodeDerivative(master.buffer, master.format, THUMB_WIDTH),
        { flag: "wx" },
      );
      written.push(thumbPath);
    }
    if (master.width > MEDIUM_WIDTH) {
      const mediumPath = variantFilePath(config, storageName, "medium");
      await writeFile(
        mediumPath,
        await encodeDerivative(master.buffer, master.format, MEDIUM_WIDTH),
        { flag: "wx" },
      );
      written.push(mediumPath);
    }
  } catch (err) {
    await Promise.all(
      written.map((p) => unlink(p).catch(() => undefined)),
    );
    throw AppError.internal(err);
  }

  let assetId: number;
  try {
    const [inserted] = await db
      .insert(mediaAssets)
      .values({
        folderId: input.folderId ?? null,
        storageName,
        originalName: input.originalName
          ? input.originalName.slice(0, 255)
          : null,
        mimeType: FORMAT_MIME[master.format],
        fileSize: master.buffer.length,
        width: master.width,
        height: master.height,
        altText: input.altText ?? null,
        caption: input.caption ?? null,
        uploadedBy: actor.userId,
      })
      .$returningId();
    assetId = inserted.id;
  } catch (err) {
    // The row is the record of the files; without it they are orphans.
    await Promise.all(
      written.map((p) => unlink(p).catch(() => undefined)),
    );
    throw AppError.internal(err);
  }

  const row = await getLiveAssetOrThrow(db, assetId);
  await audit(deps, actor, "media.upload", "media_asset", assetId, meta, {
    storageName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    folderId: row.folderId,
  });
  return toAssetView(row);
}

// ---------------------------------------------------------------------------
// Public file resolution (serve path). Returns null for anything that must
// surface as a 404: unknown id, soft-deleted asset, a variant that was
// never generated, or a file missing from disk.
// ---------------------------------------------------------------------------

export interface ResolvedMediaFile {
  asset: MediaAssetView;
  filePath: string;
  size: number;
  mimeType: string;
}

export async function resolveMediaFile(
  deps: MediaDeps,
  assetId: number,
  variant: MediaVariant,
): Promise<ResolvedMediaFile | null> {
  const { db, config } = deps;
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), isNull(mediaAssets.deletedAt)))
    .limit(1);
  if (!asset) return null;
  if (!STORAGE_NAME_PATTERN.test(asset.storageName)) return null;
  if (variant !== "master") {
    // Derivatives exist only when the master is wider than the derivative.
    if (asset.width === null || asset.width <= variantWidth(variant)) {
      return null;
    }
  }
  const filePath = variantFilePath(config, asset.storageName, variant);
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    return {
      asset: toAssetView(asset),
      filePath,
      size: stats.size,
      mimeType: asset.mimeType,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface ListMediaFilters {
  search?: string;
  folderId?: number;
}

/** Escape LIKE wildcards so a search term matches literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listMedia(
  deps: MediaDeps,
  pagination: PaginationParams,
  filters: ListMediaFilters,
): Promise<{ items: MediaAssetView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(mediaAssets.deletedAt)];
  if (filters.folderId !== undefined) {
    conditions.push(eq(mediaAssets.folderId, filters.folderId));
  }
  if (filters.search) {
    const pattern = likePattern(filters.search);
    const searchCondition = or(
      like(mediaAssets.originalName, pattern),
      like(mediaAssets.altText, pattern),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  const where = and(...conditions);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const [totalRow] = await db
    .select({ value: count() })
    .from(mediaAssets)
    .where(where);
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(where)
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(pagination.pageSize)
    .offset(offset);
  return { items: rows.map(toAssetView), total: totalRow?.value ?? 0 };
}

export async function updateAsset(
  deps: MediaDeps,
  actor: AuthContext,
  assetId: number,
  patch: UpdateAssetInput,
  meta: RequestMeta,
): Promise<MediaAssetView> {
  const { db } = deps;
  await getLiveAssetOrThrow(db, assetId);
  if (patch.folderId !== undefined && patch.folderId !== null) {
    await getFolderOrThrow(db, patch.folderId);
  }
  const set: Partial<MediaAssetRow> = {};
  if (patch.altText !== undefined) set.altText = patch.altText;
  if (patch.caption !== undefined) set.caption = patch.caption;
  if (patch.originalName !== undefined) set.originalName = patch.originalName;
  if (patch.folderId !== undefined) set.folderId = patch.folderId;
  await db
    .update(mediaAssets)
    .set(set)
    .where(eq(mediaAssets.id, assetId));
  const row = await getLiveAssetOrThrow(db, assetId);
  await audit(deps, actor, "media.update", "media_asset", assetId, meta, {
    fields: Object.keys(patch),
    folderId: row.folderId,
  });
  return toAssetView(row);
}

/**
 * Deep-search a parsed JSON value for a `mediaId` key holding exactly this
 * id (strict equality — id 5 must not match a reference to 55).
 */
function containsMediaId(value: unknown, id: number): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsMediaId(item, id));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, child]) =>
        (key === "mediaId" && child === id) || containsMediaId(child, id),
    );
  }
  return false;
}

export async function deleteAsset(
  deps: MediaDeps,
  actor: AuthContext,
  assetId: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getLiveAssetOrThrow(db, assetId);

  // Reference scan (§7.7): page og images first (indexed FK column)…
  const [ogRow] = await db
    .select({ value: count() })
    .from(pages)
    .where(eq(pages.ogImageMediaId, assetId));
  let referenced = (ogRow?.value ?? 0) > 0;

  // …then the museum-module records (Phase 5): plain FK columns, counted
  // directly — every referencing row counts, including soft-deleted ones,
  // exactly like the pages scan above (their FKs are RESTRICT).
  if (!referenced) {
    const museumRefs = await Promise.all([
      db
        .select({ value: count() })
        .from(collections)
        .where(eq(collections.coverMediaId, assetId)),
      db
        .select({ value: count() })
        .from(exhibitions)
        .where(eq(exhibitions.coverMediaId, assetId)),
      db
        .select({ value: count() })
        .from(galleryItems)
        .where(eq(galleryItems.mediaId, assetId)),
      db
        .select({ value: count() })
        .from(newsArticles)
        .where(eq(newsArticles.coverMediaId, assetId)),
      db
        .select({ value: count() })
        .from(newsArticles)
        .where(eq(newsArticles.documentMediaId, assetId)),
      db
        .select({ value: count() })
        .from(foundationPrograms)
        .where(eq(foundationPrograms.coverMediaId, assetId)),
      db
        .select({ value: count() })
        .from(testimonials)
        .where(eq(testimonials.avatarMediaId, assetId)),
    ]);
    referenced = museumRefs.some(([row]) => (row?.value ?? 0) > 0);
  }

  // …then the store (Phase 6): product_images.media_id is a plain FK
  // column (SET NULL on hard delete, but a soft-deleted asset must not
  // silently orphan a product's primary image) — counted the same way.
  if (!referenced) {
    const [productImageRow] = await db
      .select({ value: count() })
      .from(productImages)
      .where(eq(productImages.mediaId, assetId));
    referenced = (productImageRow?.value ?? 0) > 0;
  }

  // …then section configs/designs. The LIKE patterns pre-filter candidate
  // rows in SQL; each candidate's JSON is then checked precisely in code.
  if (!referenced) {
    const patterns = [`%"mediaId":${assetId}%`, `%"mediaId": ${assetId}%`];
    const candidates = await db
      .select({ config: pageSections.config, design: pageSections.design })
      .from(pageSections)
      .where(
        or(
          sql`CAST(${pageSections.config} AS CHAR) LIKE ${patterns[0]}`,
          sql`CAST(${pageSections.config} AS CHAR) LIKE ${patterns[1]}`,
          sql`CAST(${pageSections.design} AS CHAR) LIKE ${patterns[0]}`,
          sql`CAST(${pageSections.design} AS CHAR) LIKE ${patterns[1]}`,
        ),
      );
    referenced = candidates.some(
      (row) =>
        containsMediaId(row.config, assetId) ||
        containsMediaId(row.design, assetId),
    );
  }

  if (referenced) {
    throw AppError.conflict(
      "This media asset is referenced by site content and cannot be deleted.",
    );
  }

  await db
    .update(mediaAssets)
    .set({ deletedAt: new Date() })
    .where(eq(mediaAssets.id, assetId));
  await audit(deps, actor, "media.delete", "media_asset", assetId, meta);
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function listFolders(
  deps: MediaDeps,
): Promise<MediaFolderView[]> {
  const rows = await deps.db
    .select()
    .from(mediaFolders)
    .orderBy(mediaFolders.name);
  return rows.map(toFolderView);
}

export async function createFolder(
  deps: MediaDeps,
  actor: AuthContext,
  input: CreateFolderInput,
  meta: RequestMeta,
): Promise<MediaFolderView> {
  const { db } = deps;
  if (input.parentId !== undefined && input.parentId !== null) {
    await getFolderOrThrow(db, input.parentId);
  }
  const [inserted] = await db
    .insert(mediaFolders)
    .values({ name: input.name, parentId: input.parentId ?? null })
    .$returningId();
  const row = await getFolderOrThrow(db, inserted.id);
  await audit(deps, actor, "media.folder.create", "media_folder", row.id, meta, {
    name: row.name,
    parentId: row.parentId,
  });
  return toFolderView(row);
}

export async function updateFolder(
  deps: MediaDeps,
  actor: AuthContext,
  folderId: number,
  patch: UpdateFolderInput,
  meta: RequestMeta,
): Promise<MediaFolderView> {
  const { db } = deps;
  await getFolderOrThrow(db, folderId);
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === folderId) {
      throw AppError.validation(
        [{ field: "parentId", issue: "A folder cannot be its own parent." }],
        "A folder cannot be its own parent.",
      );
    }
    // Cycle guard: walking up from the proposed parent must never reach
    // this folder (that would make it a descendant of itself).
    let cursor: number | null = patch.parentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (cursor === folderId) {
        throw AppError.validation(
          [
            {
              field: "parentId",
              issue: "A folder cannot be moved into its own descendant.",
            },
          ],
          "A folder cannot be moved into its own descendant.",
        );
      }
      if (seen.has(cursor)) break; // pre-existing loop in data; stop safely
      seen.add(cursor);
      const parent = await getFolderOrThrow(db, cursor);
      cursor = parent.parentId;
    }
  }
  const set: Partial<MediaFolderRow> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  await db
    .update(mediaFolders)
    .set(set)
    .where(eq(mediaFolders.id, folderId));
  const row = await getFolderOrThrow(db, folderId);
  await audit(deps, actor, "media.folder.update", "media_folder", folderId, meta, {
    fields: Object.keys(patch),
  });
  return toFolderView(row);
}

export async function deleteFolder(
  deps: MediaDeps,
  actor: AuthContext,
  folderId: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getFolderOrThrow(db, folderId);
  const [childRow] = await db
    .select({ value: count() })
    .from(mediaFolders)
    .where(eq(mediaFolders.parentId, folderId));
  if ((childRow?.value ?? 0) > 0) {
    throw AppError.conflict(
      "This folder has subfolders and cannot be deleted.",
    );
  }
  // All assets count, including soft-deleted ones: their rows still hold
  // the folder FK (ON DELETE RESTRICT).
  const [assetRow] = await db
    .select({ value: count() })
    .from(mediaAssets)
    .where(eq(mediaAssets.folderId, folderId));
  if ((assetRow?.value ?? 0) > 0) {
    throw AppError.conflict(
      "This folder contains media assets and cannot be deleted.",
    );
  }
  await db.delete(mediaFolders).where(eq(mediaFolders.id, folderId));
  await audit(deps, actor, "media.folder.delete", "media_folder", folderId, meta);
}
