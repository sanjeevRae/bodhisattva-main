/**
 * Museum-module service (DATABASE_DESIGN.md §8, CMS_CONTENT_MAPPING.md
 * §3–§8, PERMISSIONS.md museum rows).
 *
 * Five record modules — collections, exhibitions, news (categories +
 * articles), foundation programs, testimonials — plus gallery items, the
 * exhibitions' image store (§8.3). Unlike CMS pages these are plain
 * records, not revisions: publication is the `is_published` flag, deletes
 * are soft (`deleted_at`), ordering is `sort_order` (admin reorder writes
 * array positions in one transaction). News articles are the exception:
 * §8.4 gives them no `sort_order` — public order is `published_on` DESC,
 * so there is deliberately no article reorder endpoint.
 *
 * Column → payload mapping decisions (Phase 5):
 *  - collections.worksCountLabel is DERIVED from `item_count`
 *    ("1,240 works"); the seed parses the site's display strings into
 *    `item_count`, the payload formats them back.
 *  - exhibitions.dateLabel is DERIVED from starts_on/ends_on at read
 *    time ("Mar – Nov 2026" same-year, "Sep 2025 – Jan 2026"
 *    cross-year) — §8 has no date-label column; the seed's verbatim
 *    labels all match this derivation.
 *  - exhibitions.status is stored UPCOMING | CURRENT | PAST (§8.2) and
 *    returned lowercased in public payloads, matching the site's
 *    vocabulary ("current" drives the Home selection).
 *  - exhibitions.locationLabel ← `location`; news sourceName ← `outlet`,
 *    publishedDate ← `published_on`; programs categoryLabel ←
 *    `category`, impactMetric ← `impact_label`.
 *  - Images resolve to one { url, alt }: a set cover/avatar media id
 *    wins (URL `/api/media/<id>/file/master`, alt = the record's
 *    image_alt ?? the asset's alt text ?? the record name/title);
 *    otherwise the legacy `image_url`/`image_alt` pair (BD-2 deviation,
 *    see schema/museum.ts header); otherwise null.
 *
 * Every admin mutation is audited (museum.* / news.* / foundation.*).
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  collections,
  exhibitions,
  foundationPrograms,
  galleryItems,
  mediaAssets,
  newsArticleTags,
  newsArticles,
  newsAttachments,
  newsCategories,
  newsPreviewTokens,
  newsTags,
  testimonials,
  users,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { placementSchema, sanitizeRichText } from "../cms/registry.js";
import {
  mediaFileUrl,
  purgeStoredDocument,
  readDocumentFile,
  storeDocument,
} from "../media/media.service.js";
import { generateToken, hashToken } from "../../utils/tokens.js";
import type {
  CoverPlacement,
  CreateCollectionInput,
  CreateExhibitionInput,
  CreateFoundationProgramInput,
  CreateGalleryItemInput,
  CreateNewsArticleInput,
  CreateNewsCategoryInput,
  CreateTestimonialInput,
  UpdateCollectionInput,
  UpdateExhibitionInput,
  UpdateFoundationProgramInput,
  UpdateGalleryItemInput,
  UpdateNewsArticleInput,
  UpdateNewsCategoryInput,
  UpdateTestimonialInput,
} from "./museum.schemas.js";

export interface MuseumDeps {
  db: Database;
  config: AppConfig;
}

export interface MuseumActor {
  userId: number;
  email: string;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

type CollectionRow = typeof collections.$inferSelect;
type ExhibitionRow = typeof exhibitions.$inferSelect;
type GalleryItemRow = typeof galleryItems.$inferSelect;
type NewsArticleRow = typeof newsArticles.$inferSelect;
type NewsCategoryRow = typeof newsCategories.$inferSelect;
type FoundationProgramRow = typeof foundationPrograms.$inferSelect;
type TestimonialRow = typeof testimonials.$inferSelect;
type MediaAssetRow = typeof mediaAssets.$inferSelect;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ResolvedImage {
  url: string;
  alt: string;
  /** Cover placement (migration 0024), present only when one is set —
   * the key is omitted entirely for unset placements so existing
   * responses keep their exact shape. */
  placement?: CoverPlacement;
}

export interface CollectionPublicView {
  id: number;
  slug: string;
  name: string;
  periodLabel: string | null;
  worksCountLabel: string | null;
  category: string | null;
  isFeatured: boolean;
  sortOrder: number;
  image: ResolvedImage | null;
}

export interface ExhibitionPublicView {
  id: number;
  slug: string;
  title: string;
  locationLabel: string | null;
  /** Lowercased stored status: upcoming | current | past. */
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  dateLabel: string | null;
  description: string | null;
  curator: string | null;
  category: string | null;
  coverAspect: string | null;
  isFeatured: boolean;
  sortOrder: number;
  image: ResolvedImage | null;
}

export interface NewsCategoryView {
  id: number;
  slug: string;
  name: string;
  colorToken: string | null;
}

export interface NewsTagView {
  id: number;
  name: string;
  slug: string;
}

export interface NewsArticlePublicView {
  id: number;
  slug: string;
  title: string;
  sourceName: string | null;
  publishedDate: string | null;
  summary: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  colorToken: string | null;
  externalUrl: string | null;
  documentUrl: string | null;
  image: ResolvedImage | null;
  // News Clippings additions (migration 0011). Counters are deliberately
  // NOT exposed publicly — only the derived reading time is.
  author: string | null;
  articleType: string | null;
  isFeatured: boolean;
  hasPdf: boolean;
  readingTimeMinutes: number | null;
  tags: NewsTagView[];
}

export interface NewsPdfView {
  viewUrl: string;
  downloadUrl: string;
  originalName: string | null;
  /** Standardized public filename (bodhisattva-<slug>.pdf) — what the
   * visitor's copy is actually called, independent of the upload's name. */
  downloadName: string;
  fileSize: number;
}

export interface NewsArticleDetailView extends NewsArticlePublicView {
  content: string | null;
  pdf: NewsPdfView | null;
  related: NewsArticlePublicView[];
  /** Present (true) only on the token-preview payload. */
  preview?: true;
}

export interface NewsAttachmentView {
  id: number;
  articleId: number;
  mediaId: number;
  kind: string;
  originalName: string | null;
  fileSize: number;
  mimeType: string;
  checksum: string;
  visibility: string;
  status: string;
  replacedById: number | null;
  uploadedBy: number | null;
  createdAt: Date;
}

/** Admin views are the full stored record (incl. media ids, legacy URL
 * pair, publish flag and timestamps), per the Phase 5 contract. */
export type CollectionAdminView = CollectionRow;
export type ExhibitionAdminView = ExhibitionRow;
export type GalleryItemAdminView = GalleryItemRow;
export type NewsArticleAdminView = NewsArticleRow;
export type NewsCategoryAdminView = NewsCategoryRow;
export type FoundationProgramAdminView = FoundationProgramRow;
export type TestimonialAdminView = TestimonialRow;

export interface FoundationProgramPublicView {
  id: number;
  slug: string;
  name: string;
  categoryLabel: string | null;
  description: string | null;
  impactMetric: string | null;
  iconName: string | null;
  sortOrder: number;
  image: ResolvedImage | null;
}

export interface TestimonialPublicView {
  id: number;
  quote: string;
  authorName: string;
  authorRole: string | null;
  context: string;
  sortOrder: number;
  image: ResolvedImage | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function audit(
  deps: MuseumDeps,
  actor: MuseumActor,
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

/** Escape LIKE wildcards so a search term matches literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Keep only the fields the caller actually sent (undefined = untouched). */
function definedPatch<T extends object>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

interface CoverFields {
  coverMediaId?: number | null;
  imageUrl?: string | null;
  coverPlacement?: CoverPlacement | null;
}

/**
 * Cover-placement update invariant (migration 0024; reviewed plan
 * 2026-11-22): a placement belongs to the cover it was composed for,
 * and the service — not just the admin UI — enforces that. An object
 * in the patch sets/replaces the placement and explicit null clears
 * it (both via definedPatch); this adds the two rules a client cannot
 * be trusted to apply itself:
 *  - the cover source changed (media id or legacy URL) and no new
 *    placement was supplied → the old placement is cleared;
 *  - no cover remains after the patch → the placement is cleared.
 * Alt-text-only and unrelated changes preserve the placement.
 */
function enforceCoverPlacement(
  patch: CoverFields,
  existing: { coverMediaId: number | null; imageUrl: string | null },
  input: CoverFields,
): void {
  const sourceChanged =
    (input.coverMediaId !== undefined && input.coverMediaId !== existing.coverMediaId) ||
    (input.imageUrl !== undefined && input.imageUrl !== existing.imageUrl);
  if (input.coverPlacement === undefined && sourceChanged) {
    patch.coverPlacement = null;
  }
  const nextMediaId = input.coverMediaId !== undefined ? input.coverMediaId : existing.coverMediaId;
  const nextImageUrl = input.imageUrl !== undefined ? input.imageUrl : existing.imageUrl;
  if (nextMediaId == null && !nextImageUrl) {
    patch.coverPlacement = null;
  }
}

/** True when the error (or a wrapped cause) is a MySQL duplicate-key. */
function isDuplicateKeyError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { errno?: unknown; code?: unknown; cause?: unknown };
    if (candidate.errno === 1062 || candidate.code === "ER_DUP_ENTRY") return true;
    current = candidate.cause;
  }
  return false;
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

/** Batch-load the live media assets referenced by a set of records. */
async function loadAssetMap(
  db: Database,
  ids: (number | null | undefined)[],
): Promise<Map<number, MediaAssetRow>> {
  const wanted = [...new Set(ids.filter((id): id is number => id != null))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, wanted), isNull(mediaAssets.deletedAt)));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Validate a stored cover placement (migration 0024) on the way out.
 * Writes are gated by the zod schema at the API boundary, but a value
 * written outside it (seed, direct DB write) must degrade to "no
 * placement", never break the response. MariaDB returns JSON columns
 * as parsed values through the driver; a raw string is parsed
 * defensively for the same reason.
 */
function parseCoverPlacement(raw: unknown): CoverPlacement | undefined {
  if (raw == null) return undefined;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  const parsed = placementSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Resolve a record's image to one { url, alt } (see the module header):
 * media asset first, legacy URL pair second, null when neither exists.
 * A stored cover placement rides along (key omitted when unset).
 */
function resolveImage(
  source: {
    mediaId: number | null;
    imageUrl: string | null;
    imageAlt: string | null;
    placement?: unknown;
  },
  assets: Map<number, MediaAssetRow>,
  fallbackAlt: string,
): ResolvedImage | null {
  const placement = parseCoverPlacement(source.placement);
  if (source.mediaId != null) {
    const asset = assets.get(source.mediaId);
    if (asset) {
      return {
        url: mediaFileUrl(asset.id, "master"),
        alt: source.imageAlt ?? asset.altText ?? fallbackAlt,
        ...(placement ? { placement } : {}),
      };
    }
  }
  if (source.imageUrl) {
    return {
      url: source.imageUrl,
      alt: source.imageAlt ?? fallbackAlt,
      ...(placement ? { placement } : {}),
    };
  }
  return null;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Derive the site's exhibition date label from the stored dates:
 * same year "Mar – Nov 2026", cross-year "Sep 2025 – Jan 2026".
 */
export function exhibitionDateLabel(
  startsOn: string | null,
  endsOn: string | null,
): string | null {
  const parse = (value: string) => {
    const [year, month] = value.split("-").map(Number);
    return { year, month: MONTH_ABBR[(month ?? 1) - 1] ?? "" };
  };
  if (startsOn && endsOn) {
    const start = parse(startsOn);
    const end = parse(endsOn);
    return start.year === end.year
      ? `${start.month} – ${end.month} ${end.year}`
      : `${start.month} ${start.year} – ${end.month} ${end.year}`;
  }
  if (startsOn) {
    const start = parse(startsOn);
    return `${start.month} ${start.year}`;
  }
  if (endsOn) {
    const end = parse(endsOn);
    return `${end.month} ${end.year}`;
  }
  return null;
}

function worksCountLabel(itemCount: number | null): string | null {
  if (itemCount === null) return null;
  return `${itemCount.toLocaleString("en-US")} works`;
}

function assertReorderIds(ids: number[], liveIds: number[], label: string): void {
  const live = new Set(liveIds);
  const unknown = ids.filter((id) => !live.has(id));
  if (unknown.length > 0) {
    throw AppError.validation(
      [{ field: "ids", issue: `Unknown ${label} id(s): ${unknown.join(", ")}.` }],
      "The submitted data is invalid.",
    );
  }
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

export async function listPublicCollections(
  deps: MuseumDeps,
): Promise<CollectionPublicView[]> {
  const { db } = deps;
  const rows = await db
    .select()
    .from(collections)
    .where(and(eq(collections.isPublished, true), isNull(collections.deletedAt)))
    .orderBy(asc(collections.sortOrder), asc(collections.id));
  const assets = await loadAssetMap(db, rows.map((row) => row.coverMediaId));
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    periodLabel: row.periodLabel,
    worksCountLabel: worksCountLabel(row.itemCount),
    category: row.category,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
    image: resolveImage(
      { mediaId: row.coverMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt, placement: row.coverPlacement },
      assets,
      row.name,
    ),
  }));
}

export async function listPublicExhibitions(
  deps: MuseumDeps,
): Promise<ExhibitionPublicView[]> {
  const { db } = deps;
  const rows = await db
    .select()
    .from(exhibitions)
    .where(and(eq(exhibitions.isPublished, true), isNull(exhibitions.deletedAt)))
    .orderBy(asc(exhibitions.sortOrder), asc(exhibitions.id));
  const assets = await loadAssetMap(db, rows.map((row) => row.coverMediaId));
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    locationLabel: row.location,
    status: row.status.toLowerCase(),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    dateLabel: exhibitionDateLabel(row.startsOn, row.endsOn),
    description: row.description,
    curator: row.curator,
    category: row.category,
    coverAspect: row.coverAspect,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
    image: resolveImage(
      { mediaId: row.coverMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt, placement: row.coverPlacement },
      assets,
      row.title,
    ),
  }));
}

// ---------------------------------------------------------------------------
// News Clippings (migration 0011): tags, attachments, public archive
// ---------------------------------------------------------------------------

type NewsAttachmentRow = typeof newsAttachments.$inferSelect;

interface ActiveAttachmentInfo {
  attachment: NewsAttachmentRow;
  fileSize: number;
  mimeType: string;
  assetOriginalName: string | null;
}

/** Slug for a tag name: lowercase alphanumerics + single hyphens. Names
 * with no ASCII slug characters (e.g. Devanagari) fall back to a stable
 * hash suffix so every name still gets a unique, deterministic slug. */
export function newsTagSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (base) return base;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return `tag-${(hash >>> 0).toString(16)}`;
}

/** Batch-load tag views for a set of articles, keyed by article id. */
async function loadTagsForArticles(
  db: Database,
  articleIds: number[],
): Promise<Map<number, NewsTagView[]>> {
  const map = new Map<number, NewsTagView[]>();
  if (articleIds.length === 0) return map;
  const rows = await db
    .select({
      articleId: newsArticleTags.articleId,
      id: newsTags.id,
      name: newsTags.name,
      slug: newsTags.slug,
    })
    .from(newsArticleTags)
    .innerJoin(newsTags, eq(newsArticleTags.tagId, newsTags.id))
    .where(inArray(newsArticleTags.articleId, articleIds))
    .orderBy(asc(newsTags.name));
  for (const row of rows) {
    const list = map.get(row.articleId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    map.set(row.articleId, list);
  }
  return map;
}

/** Batch-load the ACTIVE attachment (latest, if several) per article,
 * joined with its media asset for size/mime. */
async function loadActiveAttachments(
  db: Database,
  articleIds: number[],
  publicOnly: boolean,
): Promise<Map<number, ActiveAttachmentInfo>> {
  const map = new Map<number, ActiveAttachmentInfo>();
  if (articleIds.length === 0) return map;
  const conditions = [
    inArray(newsAttachments.articleId, articleIds),
    eq(newsAttachments.status, "ACTIVE"),
  ];
  if (publicOnly) conditions.push(eq(newsAttachments.visibility, "PUBLIC"));
  const rows = await db
    .select({
      attachment: newsAttachments,
      fileSize: mediaAssets.fileSize,
      mimeType: mediaAssets.mimeType,
      assetOriginalName: mediaAssets.originalName,
    })
    .from(newsAttachments)
    .innerJoin(mediaAssets, eq(newsAttachments.mediaId, mediaAssets.id))
    .where(and(...conditions))
    .orderBy(desc(newsAttachments.id));
  for (const row of rows) {
    if (!map.has(row.attachment.articleId)) {
      map.set(row.attachment.articleId, {
        attachment: row.attachment,
        fileSize: row.fileSize,
        mimeType: row.mimeType,
        assetOriginalName: row.assetOriginalName,
      });
    }
  }
  return map;
}

function toAttachmentView(info: ActiveAttachmentInfo): NewsAttachmentView {
  const a = info.attachment;
  return {
    id: a.id,
    articleId: a.articleId,
    mediaId: a.mediaId,
    kind: a.kind,
    originalName: a.originalName ?? info.assetOriginalName,
    fileSize: info.fileSize,
    mimeType: info.mimeType,
    checksum: a.checksum,
    visibility: a.visibility,
    status: a.status,
    replacedById: a.replacedById,
    uploadedBy: a.uploadedBy,
    createdAt: a.createdAt,
  };
}

/** Derived reading time: ~200 words/minute over the tag-stripped body. */
export function readingTimeMinutes(content: string | null): number | null {
  if (!content) return null;
  const words = content
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  if (words === 0) return null;
  return Math.max(1, Math.ceil(words / 200));
}

function toPublicNewsItem(
  row: NewsArticleRow,
  categoryById: Map<number, NewsCategoryRow>,
  assets: Map<number, MediaAssetRow>,
  tagsByArticle: Map<number, NewsTagView[]>,
  activePublic: Map<number, ActiveAttachmentInfo>,
): NewsArticlePublicView {
  const category = row.categoryId !== null ? categoryById.get(row.categoryId) : undefined;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    sourceName: row.outlet,
    publishedDate: row.publishedOn,
    summary: row.summary,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    colorToken: category?.colorToken ?? null,
    externalUrl: row.externalUrl,
    documentUrl:
      row.documentMediaId !== null
        ? mediaFileUrl(row.documentMediaId, "master")
        : null,
    image: resolveImage(
      { mediaId: row.coverMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt },
      assets,
      row.title,
    ),
    author: row.author,
    articleType: row.articleType,
    isFeatured: row.isFeatured,
    hasPdf: activePublic.has(row.id),
    readingTimeMinutes: readingTimeMinutes(row.content),
    tags: tagsByArticle.get(row.id) ?? [],
  };
}

async function loadCategoryMap(
  db: Database,
): Promise<{ categories: NewsCategoryView[]; byId: Map<number, NewsCategoryRow> }> {
  const categoryRows = await db
    .select()
    .from(newsCategories)
    .orderBy(asc(newsCategories.id));
  return {
    categories: categoryRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      colorToken: row.colorToken,
    })),
    byId: new Map(categoryRows.map((row) => [row.id, row])),
  };
}

export type NewsSort = "newest" | "oldest" | "added" | "alpha";

export interface PublicNewsResult {
  categories: NewsCategoryView[];
  items: NewsArticlePublicView[];
  /** Present only when the caller paginated (page param supplied). */
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface PublicNewsQuery {
  search?: string;
  category?: string;
  publication?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  hasPdf?: boolean;
  featured?: boolean;
  sort?: NewsSort;
  page?: number;
  pageSize?: number;
}

const ACTIVE_PUBLIC_PDF_EXISTS = sql`EXISTS (SELECT 1 FROM news_attachments na WHERE na.article_id = ${newsArticles.id} AND na.status = 'ACTIVE' AND na.visibility = 'PUBLIC')`;
const ACTIVE_PDF_EXISTS = sql`EXISTS (SELECT 1 FROM news_attachments na WHERE na.article_id = ${newsArticles.id} AND na.status = 'ACTIVE')`;

export async function getPublicNews(
  deps: MuseumDeps,
  query: PublicNewsQuery,
): Promise<PublicNewsResult> {
  const { db } = deps;
  const { categories, byId: categoryById } = await loadCategoryMap(db);

  const conditions = [
    eq(newsArticles.isPublished, true),
    isNull(newsArticles.deletedAt),
  ];
  if (query.category) {
    const category = [...categoryById.values()].find((row) => row.slug === query.category);
    if (!category) return { categories, items: [] };
    conditions.push(eq(newsArticles.categoryId, category.id));
  }
  if (query.publication) conditions.push(eq(newsArticles.outlet, query.publication));
  if (query.year !== undefined) {
    conditions.push(gte(newsArticles.publishedOn, `${query.year}-01-01`));
    conditions.push(lte(newsArticles.publishedOn, `${query.year}-12-31`));
  }
  if (query.dateFrom) conditions.push(gte(newsArticles.publishedOn, query.dateFrom));
  if (query.dateTo) conditions.push(lte(newsArticles.publishedOn, query.dateTo));
  if (query.type) conditions.push(eq(newsArticles.articleType, query.type));
  if (query.featured !== undefined) {
    conditions.push(eq(newsArticles.isFeatured, query.featured));
  }
  if (query.hasPdf !== undefined) {
    conditions.push(
      query.hasPdf ? ACTIVE_PUBLIC_PDF_EXISTS : sql`NOT ${ACTIVE_PUBLIC_PDF_EXISTS}`,
    );
  }

  const orderBy =
    query.sort === "oldest"
      ? [asc(newsArticles.publishedOn), asc(newsArticles.id)]
      : query.sort === "added"
        ? [desc(newsArticles.createdAt), desc(newsArticles.id)]
        : query.sort === "alpha"
          ? [asc(newsArticles.title), asc(newsArticles.id)]
          : [desc(newsArticles.publishedOn), desc(newsArticles.id)];

  const paginated = query.page !== undefined;
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;

  const runQuery = async (
    searchCondition: ReturnType<typeof sql> | ReturnType<typeof or> | undefined,
  ): Promise<{ rows: NewsArticleRow[]; total: number }> => {
    const where = searchCondition
      ? and(...conditions, searchCondition)
      : and(...conditions);
    let total = 0;
    if (paginated) {
      const [totalRow] = await db
        .select({ value: count() })
        .from(newsArticles)
        .where(where);
      total = totalRow?.value ?? 0;
    }
    let builder = db
      .select()
      .from(newsArticles)
      .where(where)
      .orderBy(...orderBy)
      .$dynamic();
    if (paginated) {
      builder = builder.limit(pageSize).offset((page - 1) * pageSize);
    }
    const rows = await builder;
    return { rows, total: paginated ? total : rows.length };
  };

  const search = query.search?.trim() ?? "";
  let rows: NewsArticleRow[];
  let total: number;
  if (search) {
    const pattern = likePattern(search);
    const tagBranch = sql`${newsArticles.id} IN (SELECT nat.article_id FROM news_article_tags nat INNER JOIN news_tags nt ON nt.id = nat.tag_id WHERE nt.name LIKE ${pattern})`;
    try {
      // FULLTEXT first (ft_news_search on title/summary/outlet/author/
      // content_plain since migration 0011 — the plain-text projection,
      // never the raw HTML, so markup cannot match), plus a tag-name
      // branch FULLTEXT cannot cover.
      ({ rows, total } = await runQuery(
        sql`(MATCH(${newsArticles.title}, ${newsArticles.summary}, ${newsArticles.outlet}, ${newsArticles.author}, ${newsArticles.contentPlain}) AGAINST (${search} IN NATURAL LANGUAGE MODE) OR ${tagBranch})`,
      ));
    } catch {
      // The design's documented fallback (§8.4 note): LIKE on the same
      // columns when FULLTEXT is unavailable on the host.
      const likeCondition = or(
        like(newsArticles.title, pattern),
        like(newsArticles.summary, pattern),
        like(newsArticles.outlet, pattern),
        like(newsArticles.author, pattern),
        like(newsArticles.contentPlain, pattern),
        tagBranch,
      );
      ({ rows, total } = await runQuery(likeCondition));
    }
  } else {
    ({ rows, total } = await runQuery(undefined));
  }

  const assets = await loadAssetMap(db, rows.map((row) => row.coverMediaId));
  const tagsByArticle = await loadTagsForArticles(db, rows.map((row) => row.id));
  const activePublic = await loadActiveAttachments(db, rows.map((row) => row.id), true);
  const items = rows.map((row) =>
    toPublicNewsItem(row, categoryById, assets, tagsByArticle, activePublic),
  );
  const result: PublicNewsResult = { categories, items };
  if (paginated) {
    result.meta = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }
  return result;
}

export interface NewsFacets {
  categories: { id: number; name: string; slug: string; count: number }[];
  publications: { name: string; count: number }[];
  years: number[];
  types: string[];
}

/** Filter facets for the public archive — published, non-deleted only. */
export async function getPublicNewsFacets(deps: MuseumDeps): Promise<NewsFacets> {
  const { db } = deps;
  const publishedOnly = and(
    eq(newsArticles.isPublished, true),
    isNull(newsArticles.deletedAt),
  );
  const categoryRows = await db
    .select({
      id: newsCategories.id,
      name: newsCategories.name,
      slug: newsCategories.slug,
      value: count(),
    })
    .from(newsCategories)
    .innerJoin(
      newsArticles,
      and(eq(newsArticles.categoryId, newsCategories.id), publishedOnly),
    )
    .groupBy(newsCategories.id, newsCategories.name, newsCategories.slug)
    .orderBy(asc(newsCategories.name));
  const publicationRows = await db
    .select({ name: newsArticles.outlet, value: count() })
    .from(newsArticles)
    .where(and(publishedOnly, sql`${newsArticles.outlet} IS NOT NULL`))
    .groupBy(newsArticles.outlet)
    .orderBy(desc(count()), asc(newsArticles.outlet));
  const yearRows = await db
    .select({ year: sql<number>`YEAR(${newsArticles.publishedOn})` })
    .from(newsArticles)
    .where(and(publishedOnly, sql`${newsArticles.publishedOn} IS NOT NULL`))
    .groupBy(sql`YEAR(${newsArticles.publishedOn})`)
    .orderBy(desc(sql`YEAR(${newsArticles.publishedOn})`));
  const typeRows = await db
    .select({ type: newsArticles.articleType })
    .from(newsArticles)
    .where(and(publishedOnly, sql`${newsArticles.articleType} IS NOT NULL`))
    .groupBy(newsArticles.articleType)
    .orderBy(asc(newsArticles.articleType));
  return {
    categories: categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      count: row.value,
    })),
    publications: publicationRows
      .filter((row) => row.name !== null)
      .map((row) => ({ name: row.name as string, count: row.value })),
    years: yearRows.map((row) => Number(row.year)),
    types: typeRows
      .map((row) => row.type)
      .filter((t): t is string => t !== null),
  };
}

async function buildNewsDetail(
  deps: MuseumDeps,
  row: NewsArticleRow,
): Promise<NewsArticleDetailView> {
  const { db } = deps;
  const { byId: categoryById } = await loadCategoryMap(db);
  const assets = await loadAssetMap(db, [row.coverMediaId]);
  const tagsByArticle = await loadTagsForArticles(db, [row.id]);
  const activePublic = await loadActiveAttachments(db, [row.id], true);
  const item = toPublicNewsItem(row, categoryById, assets, tagsByArticle, activePublic);

  // Related: same category first, topped up with the latest published.
  const relatedConditions = [
    eq(newsArticles.isPublished, true),
    isNull(newsArticles.deletedAt),
    sql`${newsArticles.id} <> ${row.id}`,
  ];
  let relatedRows: NewsArticleRow[] = [];
  if (row.categoryId !== null) {
    relatedRows = await db
      .select()
      .from(newsArticles)
      .where(and(...relatedConditions, eq(newsArticles.categoryId, row.categoryId)))
      .orderBy(desc(newsArticles.publishedOn), desc(newsArticles.id))
      .limit(4);
  }
  if (relatedRows.length < 4) {
    const chosen = new Set(relatedRows.map((r) => r.id));
    const fill = await db
      .select()
      .from(newsArticles)
      .where(and(...relatedConditions))
      .orderBy(desc(newsArticles.publishedOn), desc(newsArticles.id))
      .limit(8);
    for (const candidate of fill) {
      if (relatedRows.length >= 4) break;
      if (!chosen.has(candidate.id)) relatedRows.push(candidate);
    }
  }
  const relatedAssets = await loadAssetMap(db, relatedRows.map((r) => r.coverMediaId));
  const relatedTags = await loadTagsForArticles(db, relatedRows.map((r) => r.id));
  const relatedActive = await loadActiveAttachments(db, relatedRows.map((r) => r.id), true);

  const pdfInfo = activePublic.get(row.id);
  return {
    ...item,
    content: row.content,
    pdf: pdfInfo
      ? {
          viewUrl: `/api/news/${row.slug}/pdf/view`,
          downloadUrl: `/api/news/${row.slug}/pdf/download`,
          originalName: pdfInfo.attachment.originalName ?? pdfInfo.assetOriginalName,
          downloadName: `bodhisattva-${row.slug}.pdf`,
          fileSize: pdfInfo.fileSize,
        }
      : null,
    related: relatedRows.map((r) =>
      toPublicNewsItem(r, categoryById, relatedAssets, relatedTags, relatedActive),
    ),
  };
}

export async function getPublicNewsArticle(
  deps: MuseumDeps,
  slug: string,
): Promise<NewsArticleDetailView> {
  const { db } = deps;
  const [row] = await db
    .select()
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.slug, slug),
        eq(newsArticles.isPublished, true),
        isNull(newsArticles.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw AppError.notFound("News article not found.");
  const detail = await buildNewsDetail(deps, row);
  // Honest counter: one atomic increment per served read, outside any
  // transaction with the read itself.
  await db
    .update(newsArticles)
    .set({ viewCount: sql`${newsArticles.viewCount} + 1` })
    .where(eq(newsArticles.id, row.id));
  return detail;
}

/** Token preview of any non-deleted article (draft included). Oracle-free:
 * unknown, expired and deleted-article tokens all surface as the same 404
 * as a missing public article. */
export async function getNewsPreviewArticle(
  deps: MuseumDeps,
  rawToken: string,
): Promise<NewsArticleDetailView> {
  const { db } = deps;
  if (!rawToken) throw AppError.notFound("News article not found.");
  const [tokenRow] = await db
    .select({ articleId: newsPreviewTokens.articleId })
    .from(newsPreviewTokens)
    .where(
      and(
        eq(newsPreviewTokens.tokenHash, hashToken(rawToken)),
        gt(newsPreviewTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!tokenRow) throw AppError.notFound("News article not found.");
  const [row] = await db
    .select()
    .from(newsArticles)
    .where(and(eq(newsArticles.id, tokenRow.articleId), isNull(newsArticles.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("News article not found.");
  const detail = await buildNewsDetail(deps, row);
  return { ...detail, preview: true };
}

export interface PublicNewsAttachmentItem {
  id: number;
  kind: string;
  originalName: string | null;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
}

export async function listPublicNewsAttachments(
  deps: MuseumDeps,
  slug: string,
): Promise<PublicNewsAttachmentItem[]> {
  const { db } = deps;
  const [article] = await db
    .select({ id: newsArticles.id })
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.slug, slug),
        eq(newsArticles.isPublished, true),
        isNull(newsArticles.deletedAt),
      ),
    )
    .limit(1);
  if (!article) throw AppError.notFound("News article not found.");
  const active = await loadActiveAttachments(db, [article.id], true);
  const info = active.get(article.id);
  if (!info) return [];
  return [
    {
      id: info.attachment.id,
      kind: info.attachment.kind,
      originalName: info.attachment.originalName ?? info.assetOriginalName,
      fileSize: info.fileSize,
      mimeType: info.mimeType,
      createdAt: info.attachment.createdAt,
    },
  ];
}

export interface ResolvedNewsPdf {
  article: NewsArticleRow;
  attachment: NewsAttachmentRow;
  filePath: string;
  size: number;
  originalName: string | null;
  downloadName: string;
}

async function resolvePdfForArticle(
  deps: MuseumDeps,
  article: NewsArticleRow,
  publicOnly: boolean,
): Promise<ResolvedNewsPdf> {
  const active = await loadActiveAttachments(deps.db, [article.id], publicOnly);
  const info = active.get(article.id);
  if (!info) throw AppError.notFound("PDF document not found.");
  const file = await readDocumentFile(deps.db, deps.config, info.attachment.mediaId);
  if (!file) throw AppError.notFound("PDF document not found.");
  return {
    article,
    attachment: info.attachment,
    filePath: file.filePath,
    size: file.size,
    originalName: info.attachment.originalName ?? info.assetOriginalName,
    downloadName: `bodhisattva-${article.slug}.pdf`,
  };
}

export async function resolvePublicNewsPdf(
  deps: MuseumDeps,
  slug: string,
): Promise<ResolvedNewsPdf> {
  const { db } = deps;
  const [article] = await db
    .select()
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.slug, slug),
        eq(newsArticles.isPublished, true),
        isNull(newsArticles.deletedAt),
      ),
    )
    .limit(1);
  if (!article) throw AppError.notFound("News article not found.");
  return resolvePdfForArticle(deps, article, true);
}

export async function resolveAdminNewsPdf(
  deps: MuseumDeps,
  articleId: number,
): Promise<ResolvedNewsPdf> {
  const article = await getNewsArticleOrThrow(deps.db, articleId);
  return resolvePdfForArticle(deps, article, false);
}

export async function incrementNewsPdfDownloadCount(
  deps: MuseumDeps,
  articleId: number,
): Promise<void> {
  await deps.db
    .update(newsArticles)
    .set({ pdfDownloadCount: sql`${newsArticles.pdfDownloadCount} + 1` })
    .where(eq(newsArticles.id, articleId));
}

/** Admin PDF downloads are audited (news.pdf.download) rather than
 * counted — the counter is a public-engagement metric. */
export async function recordNewsPdfDownloadAudit(
  deps: MuseumDeps,
  actor: MuseumActor,
  articleId: number,
  attachmentId: number,
  meta: RequestMeta,
): Promise<void> {
  await audit(deps, actor, AUDIT_ACTIONS.newsPdfDownload, "news_article", articleId, meta, {
    attachmentId,
  });
}

export interface PublicFoundationResult {
  programs: FoundationProgramPublicView[];
  testimonials: TestimonialPublicView[];
}

export async function getPublicFoundation(
  deps: MuseumDeps,
): Promise<PublicFoundationResult> {
  const { db } = deps;
  const programRows = await db
    .select()
    .from(foundationPrograms)
    .where(
      and(
        eq(foundationPrograms.isPublished, true),
        isNull(foundationPrograms.deletedAt),
      ),
    )
    .orderBy(asc(foundationPrograms.sortOrder), asc(foundationPrograms.id));
  const testimonialRows = await db
    .select()
    .from(testimonials)
    .where(
      and(eq(testimonials.isPublished, true), isNull(testimonials.deletedAt)),
    )
    .orderBy(asc(testimonials.sortOrder), asc(testimonials.id));
  const assets = await loadAssetMap(db, [
    ...programRows.map((row) => row.coverMediaId),
    ...testimonialRows.map((row) => row.avatarMediaId),
  ]);
  return {
    programs: programRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      categoryLabel: row.category,
      description: row.description,
      impactMetric: row.impactLabel,
      iconName: row.iconName,
      sortOrder: row.sortOrder,
      image: resolveImage(
        { mediaId: row.coverMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt },
        assets,
        row.name,
      ),
    })),
    testimonials: testimonialRows.map((row) => ({
      id: row.id,
      quote: row.quote,
      authorName: row.authorName,
      authorRole: row.authorRole,
      context: row.context,
      sortOrder: row.sortOrder,
      image: resolveImage(
        { mediaId: row.avatarMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt },
        assets,
        row.authorName,
      ),
    })),
  };
}

// ---------------------------------------------------------------------------
// Collections (admin)
// ---------------------------------------------------------------------------

async function getCollectionOrThrow(db: Database, id: number): Promise<CollectionRow> {
  const [row] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), isNull(collections.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("Collection not found.");
  return row;
}

async function assertCollectionSlugFree(db: Database, slug: string, excludeId?: number): Promise<void> {
  const [existing] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A collection with slug '${slug}' already exists.`);
  }
}

export async function listAdminCollections(
  deps: MuseumDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: CollectionAdminView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(collections.deletedAt)];
  if (search) conditions.push(like(collections.name, likePattern(search)));
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(collections).where(where);
  const rows = await db
    .select()
    .from(collections)
    .where(where)
    .orderBy(asc(collections.sortOrder), asc(collections.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function getAdminCollection(deps: MuseumDeps, id: number): Promise<CollectionAdminView> {
  return getCollectionOrThrow(deps.db, id);
}

export async function createCollection(
  deps: MuseumDeps,
  actor: MuseumActor,
  input: CreateCollectionInput,
  meta: RequestMeta,
): Promise<CollectionAdminView> {
  const { db } = deps;
  await assertCollectionSlugFree(db, input.slug);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  const values = { ...input, createdBy: actor.userId, updatedBy: actor.userId };
  // A placement without a cover is meaningless (migration 0024).
  if (values.coverMediaId == null && !values.imageUrl) values.coverPlacement = null;
  let id = 0;
  try {
    const [inserted] = await db
      .insert(collections)
      .values(values)
      .$returningId();
    id = inserted.id;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A collection with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getCollectionOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumCollectionsCreate, "collection", id, meta, { slug: row.slug });
  return row;
}

export async function updateCollection(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateCollectionInput,
  meta: RequestMeta,
): Promise<CollectionAdminView> {
  const { db } = deps;
  const existing = await getCollectionOrThrow(db, id);
  if (input.slug !== undefined) await assertCollectionSlugFree(db, input.slug, id);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  const patch = definedPatch(input);
  enforceCoverPlacement(patch, existing, input);
  try {
    await db
      .update(collections)
      .set({ ...patch, updatedBy: actor.userId })
      .where(eq(collections.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A collection with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getCollectionOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumCollectionsUpdate, "collection", id, meta, {
    fields: Object.keys(patch),
  });
  return row;
}

export async function deleteCollection(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getCollectionOrThrow(db, id);
  await db
    .update(collections)
    .set({ deletedAt: new Date(), updatedBy: actor.userId })
    .where(eq(collections.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.museumCollectionsDelete, "collection", id, meta);
}

export async function reorderCollections(
  deps: MuseumDeps,
  actor: MuseumActor,
  ids: number[],
  meta: RequestMeta,
): Promise<CollectionAdminView[]> {
  const { db } = deps;
  const live = await db
    .select({ id: collections.id })
    .from(collections)
    .where(isNull(collections.deletedAt));
  assertReorderIds(ids, live.map((row) => row.id), "collection");
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(collections).set({ sortOrder: index }).where(eq(collections.id, id));
    }
  });
  await audit(deps, actor, AUDIT_ACTIONS.museumCollectionsReorder, "collection", null, meta, { ids });
  const rows = await db
    .select()
    .from(collections)
    .where(isNull(collections.deletedAt))
    .orderBy(asc(collections.sortOrder), asc(collections.id));
  return rows;
}

// ---------------------------------------------------------------------------
// Exhibitions (admin)
// ---------------------------------------------------------------------------

async function getExhibitionOrThrow(db: Database, id: number): Promise<ExhibitionRow> {
  const [row] = await db
    .select()
    .from(exhibitions)
    .where(and(eq(exhibitions.id, id), isNull(exhibitions.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("Exhibition not found.");
  return row;
}

async function assertExhibitionSlugFree(db: Database, slug: string, excludeId?: number): Promise<void> {
  const [existing] = await db
    .select({ id: exhibitions.id })
    .from(exhibitions)
    .where(eq(exhibitions.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`An exhibition with slug '${slug}' already exists.`);
  }
}

export async function listAdminExhibitions(
  deps: MuseumDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: ExhibitionAdminView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(exhibitions.deletedAt)];
  if (search) conditions.push(like(exhibitions.title, likePattern(search)));
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(exhibitions).where(where);
  const rows = await db
    .select()
    .from(exhibitions)
    .where(where)
    .orderBy(asc(exhibitions.sortOrder), asc(exhibitions.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function getAdminExhibition(deps: MuseumDeps, id: number): Promise<ExhibitionAdminView> {
  return getExhibitionOrThrow(deps.db, id);
}

export async function createExhibition(
  deps: MuseumDeps,
  actor: MuseumActor,
  input: CreateExhibitionInput,
  meta: RequestMeta,
): Promise<ExhibitionAdminView> {
  const { db } = deps;
  await assertExhibitionSlugFree(db, input.slug);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  const values = { ...input, createdBy: actor.userId, updatedBy: actor.userId };
  // A placement without a cover is meaningless (migration 0024).
  if (values.coverMediaId == null && !values.imageUrl) values.coverPlacement = null;
  let id = 0;
  try {
    const [inserted] = await db
      .insert(exhibitions)
      .values(values)
      .$returningId();
    id = inserted.id;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`An exhibition with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getExhibitionOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumExhibitionsCreate, "exhibition", id, meta, { slug: row.slug });
  return row;
}

export async function updateExhibition(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateExhibitionInput,
  meta: RequestMeta,
): Promise<ExhibitionAdminView> {
  const { db } = deps;
  const existing = await getExhibitionOrThrow(db, id);
  if (input.slug !== undefined) await assertExhibitionSlugFree(db, input.slug, id);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  const patch = definedPatch(input);
  enforceCoverPlacement(patch, existing, input);
  try {
    await db
      .update(exhibitions)
      .set({ ...patch, updatedBy: actor.userId })
      .where(eq(exhibitions.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`An exhibition with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getExhibitionOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumExhibitionsUpdate, "exhibition", id, meta, {
    fields: Object.keys(patch),
  });
  return row;
}

export async function deleteExhibition(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getExhibitionOrThrow(db, id);
  await db
    .update(exhibitions)
    .set({ deletedAt: new Date(), updatedBy: actor.userId })
    .where(eq(exhibitions.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.museumExhibitionsDelete, "exhibition", id, meta);
}

export async function reorderExhibitions(
  deps: MuseumDeps,
  actor: MuseumActor,
  ids: number[],
  meta: RequestMeta,
): Promise<ExhibitionAdminView[]> {
  const { db } = deps;
  const live = await db
    .select({ id: exhibitions.id })
    .from(exhibitions)
    .where(isNull(exhibitions.deletedAt));
  assertReorderIds(ids, live.map((row) => row.id), "exhibition");
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(exhibitions).set({ sortOrder: index }).where(eq(exhibitions.id, id));
    }
  });
  await audit(deps, actor, AUDIT_ACTIONS.museumExhibitionsReorder, "exhibition", null, meta, { ids });
  const rows = await db
    .select()
    .from(exhibitions)
    .where(isNull(exhibitions.deletedAt))
    .orderBy(asc(exhibitions.sortOrder), asc(exhibitions.id));
  return rows;
}

// ---------------------------------------------------------------------------
// Gallery items (admin; the exhibitions' image store, §8.3)
// ---------------------------------------------------------------------------

async function getGalleryItemOrThrow(db: Database, id: number): Promise<GalleryItemRow> {
  const [row] = await db
    .select()
    .from(galleryItems)
    .where(and(eq(galleryItems.id, id), isNull(galleryItems.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("Gallery item not found.");
  return row;
}

export async function listAdminGalleryItems(
  deps: MuseumDeps,
  exhibitionId: number,
  pagination: PaginationParams,
): Promise<{ items: GalleryItemAdminView[]; total: number }> {
  const { db } = deps;
  await getExhibitionOrThrow(db, exhibitionId);
  const where = and(
    eq(galleryItems.exhibitionId, exhibitionId),
    isNull(galleryItems.deletedAt),
  );
  const [totalRow] = await db.select({ value: count() }).from(galleryItems).where(where);
  const rows = await db
    .select()
    .from(galleryItems)
    .where(where)
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function createGalleryItem(
  deps: MuseumDeps,
  actor: MuseumActor,
  exhibitionId: number,
  input: CreateGalleryItemInput,
  meta: RequestMeta,
): Promise<GalleryItemAdminView> {
  const { db } = deps;
  await getExhibitionOrThrow(db, exhibitionId);
  await assertMediaExists(db, input.mediaId, "mediaId");
  const [inserted] = await db
    .insert(galleryItems)
    .values({ ...input, exhibitionId, createdBy: actor.userId })
    .$returningId();
  const row = await getGalleryItemOrThrow(db, inserted.id);
  await audit(deps, actor, AUDIT_ACTIONS.museumGalleryCreate, "gallery_item", row.id, meta, {
    exhibitionId,
    mediaId: input.mediaId,
  });
  return row;
}

export async function updateGalleryItem(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateGalleryItemInput,
  meta: RequestMeta,
): Promise<GalleryItemAdminView> {
  const { db } = deps;
  await getGalleryItemOrThrow(db, id);
  if (input.mediaId !== undefined) await assertMediaExists(db, input.mediaId, "mediaId");
  if (input.exhibitionId != null) await getExhibitionOrThrow(db, input.exhibitionId);
  await db
    .update(galleryItems)
    .set(definedPatch(input))
    .where(eq(galleryItems.id, id));
  const row = await getGalleryItemOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumGalleryUpdate, "gallery_item", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteGalleryItem(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getGalleryItemOrThrow(db, id);
  await db
    .update(galleryItems)
    .set({ deletedAt: new Date() })
    .where(eq(galleryItems.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.museumGalleryDelete, "gallery_item", id, meta);
}

export async function reorderGalleryItems(
  deps: MuseumDeps,
  actor: MuseumActor,
  ids: number[],
  meta: RequestMeta,
): Promise<GalleryItemAdminView[]> {
  const { db } = deps;
  const live = await db
    .select({ id: galleryItems.id })
    .from(galleryItems)
    .where(isNull(galleryItems.deletedAt));
  assertReorderIds(ids, live.map((row) => row.id), "gallery item");
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(galleryItems).set({ sortOrder: index }).where(eq(galleryItems.id, id));
    }
  });
  await audit(deps, actor, AUDIT_ACTIONS.museumGalleryReorder, "gallery_item", null, meta, { ids });
  const rows = await db
    .select()
    .from(galleryItems)
    .where(isNull(galleryItems.deletedAt))
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.id));
  return rows;
}

// ---------------------------------------------------------------------------
// News categories (admin)
// ---------------------------------------------------------------------------

async function getNewsCategoryOrThrow(db: Database, id: number): Promise<NewsCategoryRow> {
  const [row] = await db
    .select()
    .from(newsCategories)
    .where(eq(newsCategories.id, id))
    .limit(1);
  if (!row) throw AppError.notFound("News category not found.");
  return row;
}

async function assertNewsCategorySlugFree(db: Database, slug: string, excludeId?: number): Promise<void> {
  const [existing] = await db
    .select({ id: newsCategories.id })
    .from(newsCategories)
    .where(eq(newsCategories.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A news category with slug '${slug}' already exists.`);
  }
}

export async function listAdminNewsCategories(
  deps: MuseumDeps,
): Promise<NewsCategoryAdminView[]> {
  return deps.db
    .select()
    .from(newsCategories)
    .orderBy(asc(newsCategories.id));
}

export async function createNewsCategory(
  deps: MuseumDeps,
  actor: MuseumActor,
  input: CreateNewsCategoryInput,
  meta: RequestMeta,
): Promise<NewsCategoryAdminView> {
  const { db } = deps;
  await assertNewsCategorySlugFree(db, input.slug);
  let id = 0;
  try {
    const [inserted] = await db
      .insert(newsCategories)
      .values({ ...input })
      .$returningId();
    id = inserted.id;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A news category with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getNewsCategoryOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.newsCategoriesCreate, "news_category", id, meta, { slug: row.slug });
  return row;
}

export async function updateNewsCategory(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateNewsCategoryInput,
  meta: RequestMeta,
): Promise<NewsCategoryAdminView> {
  const { db } = deps;
  await getNewsCategoryOrThrow(db, id);
  if (input.slug !== undefined) await assertNewsCategorySlugFree(db, input.slug, id);
  try {
    await db
      .update(newsCategories)
      .set(definedPatch(input))
      .where(eq(newsCategories.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A news category with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getNewsCategoryOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.newsCategoriesUpdate, "news_category", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteNewsCategory(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getNewsCategoryOrThrow(db, id);
  // Hard delete (the table has no deleted_at): the FK is RESTRICT, and
  // soft-deleted articles still hold it, so ANY referencing article
  // blocks the delete with a 409.
  const [refRow] = await db
    .select({ value: count() })
    .from(newsArticles)
    .where(eq(newsArticles.categoryId, id));
  if ((refRow?.value ?? 0) > 0) {
    throw AppError.conflict(
      "This news category is referenced by articles and cannot be deleted.",
    );
  }
  await db.delete(newsCategories).where(eq(newsCategories.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.newsCategoriesDelete, "news_category", id, meta);
}

// ---------------------------------------------------------------------------
// News articles (admin)
// ---------------------------------------------------------------------------

async function getNewsArticleOrThrow(db: Database, id: number): Promise<NewsArticleRow> {
  const [row] = await db
    .select()
    .from(newsArticles)
    .where(and(eq(newsArticles.id, id), isNull(newsArticles.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("News article not found.");
  return row;
}

async function assertNewsArticleSlugFree(db: Database, slug: string, excludeId?: number): Promise<void> {
  const [existing] = await db
    .select({ id: newsArticles.id })
    .from(newsArticles)
    .where(eq(newsArticles.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A news article with slug '${slug}' already exists.`);
  }
}

async function assertNewsRefsValid(
  db: Database,
  input: { categoryId?: number | null; documentMediaId?: number | null; coverMediaId?: number | null },
): Promise<void> {
  if (input.categoryId != null) {
    const [category] = await db
      .select({ id: newsCategories.id })
      .from(newsCategories)
      .where(eq(newsCategories.id, input.categoryId))
      .limit(1);
    if (!category) {
      throw AppError.validation(
        [{ field: "categoryId", issue: "News category not found." }],
        "The submitted data is invalid.",
      );
    }
  }
  if (input.documentMediaId != null) await assertMediaExists(db, input.documentMediaId, "documentMediaId");
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
}

export interface AdminNewsListFilters {
  search?: string;
  categoryId?: number;
  status?: "published" | "draft" | "all";
  featured?: boolean;
  hasPdf?: boolean;
  sort?: "updated" | "published" | "title";
}

/**
 * List items deliberately omit the article body (`content`, LONGTEXT)
 * and its plain-text projection (`contentPlain`, MEDIUMTEXT): no list
 * consumer reads them (the editor loads the detail endpoint), and they
 * made a 20-row page ~40 KB. The detail type below keeps both.
 */
export type NewsArticleAdminListItem = Omit<
  NewsArticleRow,
  "content" | "contentPlain"
> & {
  hasPdf: boolean;
  pdfOriginalName: string | null;
  createdByName: string | null;
  tags: NewsTagView[];
};

const {
  content: _newsContent,
  contentPlain: _newsContentPlain,
  ...newsListColumns
} = getTableColumns(newsArticles);

export type NewsArticleAdminDetail = NewsArticleRow & {
  tags: NewsTagView[];
  attachment: NewsAttachmentView | null;
};

export async function listAdminNewsArticles(
  deps: MuseumDeps,
  pagination: PaginationParams,
  filters: AdminNewsListFilters = {},
): Promise<{ items: NewsArticleAdminListItem[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(newsArticles.deletedAt)];
  if (filters.search) {
    const pattern = likePattern(filters.search);
    const searchCondition = or(
      like(newsArticles.title, pattern),
      like(newsArticles.outlet, pattern),
      like(newsArticles.author, pattern),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (filters.categoryId !== undefined) {
    conditions.push(eq(newsArticles.categoryId, filters.categoryId));
  }
  if (filters.status === "published") conditions.push(eq(newsArticles.isPublished, true));
  if (filters.status === "draft") conditions.push(eq(newsArticles.isPublished, false));
  if (filters.featured !== undefined) {
    conditions.push(eq(newsArticles.isFeatured, filters.featured));
  }
  if (filters.hasPdf !== undefined) {
    conditions.push(filters.hasPdf ? ACTIVE_PDF_EXISTS : sql`NOT ${ACTIVE_PDF_EXISTS}`);
  }
  const where = and(...conditions);
  const orderBy =
    filters.sort === "published"
      ? [desc(newsArticles.publishedOn), desc(newsArticles.id)]
      : filters.sort === "title"
        ? [asc(newsArticles.title), asc(newsArticles.id)]
        : [desc(newsArticles.updatedAt), desc(newsArticles.id)];
  const [totalRow] = await db.select({ value: count() }).from(newsArticles).where(where);
  const rows = await db
    .select(newsListColumns)
    .from(newsArticles)
    .where(where)
    .orderBy(...orderBy)
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);

  const ids = rows.map((row) => row.id);
  const tagsByArticle = await loadTagsForArticles(db, ids);
  const activeAny = await loadActiveAttachments(db, ids, false);
  const creatorIds = [...new Set(rows.map((row) => row.createdBy).filter((v): v is number => v !== null))];
  const creatorNames = new Map<number, string>();
  if (creatorIds.length > 0) {
    const creatorRows = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, creatorIds));
    for (const creator of creatorRows) creatorNames.set(creator.id, creator.fullName);
  }
  const items = rows.map((row) => {
    const pdf = activeAny.get(row.id);
    return {
      ...row,
      hasPdf: pdf !== undefined,
      pdfOriginalName: pdf ? (pdf.attachment.originalName ?? pdf.assetOriginalName) : null,
      createdByName: row.createdBy !== null ? (creatorNames.get(row.createdBy) ?? null) : null,
      tags: tagsByArticle.get(row.id) ?? [],
    };
  });
  return { items, total: totalRow?.value ?? 0 };
}

export async function getAdminNewsArticle(
  deps: MuseumDeps,
  id: number,
): Promise<NewsArticleAdminDetail> {
  const { db } = deps;
  const row = await getNewsArticleOrThrow(db, id);
  const tagsByArticle = await loadTagsForArticles(db, [id]);
  const activeAny = await loadActiveAttachments(db, [id], false);
  const info = activeAny.get(id);
  return {
    ...row,
    tags: tagsByArticle.get(id) ?? [],
    attachment: info ? toAttachmentView(info) : null,
  };
}

/** Replace an article's tag set (get-or-create by slug), inside the
 * caller's transaction. Names are trimmed and deduplicated by slug. */
async function setArticleTags(
  tx: Database,
  articleId: number,
  names: string[],
): Promise<void> {
  const bySlug = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = newsTagSlug(name);
    if (!bySlug.has(slug)) bySlug.set(slug, name.slice(0, 80));
  }
  await tx.delete(newsArticleTags).where(eq(newsArticleTags.articleId, articleId));
  for (const [slug, name] of bySlug) {
    let [tag] = await tx
      .select({ id: newsTags.id })
      .from(newsTags)
      .where(eq(newsTags.slug, slug))
      .limit(1);
    if (!tag) {
      try {
        const [inserted] = await tx
          .insert(newsTags)
          .values({ name, slug })
          .$returningId();
        tag = { id: inserted.id };
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        const [again] = await tx
          .select({ id: newsTags.id })
          .from(newsTags)
          .where(eq(newsTags.slug, slug))
          .limit(1);
        if (!again) throw err;
        tag = again;
      }
    }
    await tx.insert(newsArticleTags).values({ articleId, tagId: tag.id });
  }
}

const HTML_ENTITY_MAP: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/**
 * Plain-text projection of a sanitized HTML body: tags stripped, basic
 * entities decoded, whitespace collapsed. Stored in `content_plain` on
 * every save and searched by `ft_news_search` INSTEAD of the raw HTML,
 * so markup (tag/attribute names) can never match a reader's search.
 * Returns null when there is no visible text.
 */
export function toPlainText(html: string | null): string | null {
  if (!html) return null;
  const decoded = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name: string) =>
      name === "amp" ? match : (HTML_ENTITY_MAP[name] ?? match),
    )
    // `&amp;` decodes LAST so an authored "&amp;lt;" stays the literal
    // text "&lt;" instead of collapsing into "<".
    .replace(/&amp;/g, "&");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Sanitise the rich-text body at save (never store raw admin HTML) and
 * derive its `content_plain` projection in the same patch, so the two
 * columns can never drift apart.
 */
function sanitizedContentPatch<T extends { content?: string | null }>(
  input: T,
): T & { contentPlain?: string | null } {
  if (typeof input.content === "string") {
    const content = sanitizeRichText(input.content);
    return { ...input, content, contentPlain: toPlainText(content) };
  }
  if (input.content === null) {
    return { ...input, contentPlain: null };
  }
  return input;
}

export async function createNewsArticle(
  deps: MuseumDeps,
  actor: MuseumActor,
  input: CreateNewsArticleInput,
  meta: RequestMeta,
): Promise<NewsArticleAdminView> {
  const { db } = deps;
  await assertNewsArticleSlugFree(db, input.slug);
  await assertNewsRefsValid(db, input);
  const { tags, ...fields } = sanitizedContentPatch(input);
  let id = 0;
  try {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(newsArticles)
        .values({ ...fields, createdBy: actor.userId, updatedBy: actor.userId })
        .$returningId();
      id = inserted.id;
      if (tags !== undefined) await setArticleTags(tx as Database, id, tags);
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A news article with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getNewsArticleOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.newsArticlesCreate, "news_article", id, meta, { slug: row.slug });
  return row;
}

export async function updateNewsArticle(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateNewsArticleInput,
  meta: RequestMeta,
): Promise<NewsArticleAdminView> {
  const { db } = deps;
  await getNewsArticleOrThrow(db, id);
  if (input.slug !== undefined) await assertNewsArticleSlugFree(db, input.slug, id);
  await assertNewsRefsValid(db, input);
  const { tags, ...fields } = sanitizedContentPatch(input);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(newsArticles)
        .set({ ...definedPatch(fields), updatedBy: actor.userId })
        .where(eq(newsArticles.id, id));
      if (tags !== undefined) await setArticleTags(tx as Database, id, tags);
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A news article with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getNewsArticleOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.newsArticlesUpdate, "news_article", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function setNewsArticlePublished(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  published: boolean,
  meta: RequestMeta,
): Promise<NewsArticleAdminView> {
  const { db } = deps;
  await getNewsArticleOrThrow(db, id);
  await db
    .update(newsArticles)
    .set({ isPublished: published, updatedBy: actor.userId })
    .where(eq(newsArticles.id, id));
  const row = await getNewsArticleOrThrow(db, id);
  await audit(
    deps,
    actor,
    published ? AUDIT_ACTIONS.newsArticlesPublish : AUDIT_ACTIONS.newsArticlesUnpublish,
    "news_article",
    id,
    meta,
    { slug: row.slug },
  );
  return row;
}

export async function duplicateNewsArticle(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<NewsArticleAdminDetail> {
  const { db } = deps;
  const source = await getNewsArticleOrThrow(db, id);
  let newId = 0;
  await db.transaction(async (tx) => {
    // First free slug: <slug>-copy, then <slug>-copy-2, -3, …
    let candidate = `${source.slug}-copy`;
    let suffix = 2;
    for (;;) {
      const [clash] = await tx
        .select({ id: newsArticles.id })
        .from(newsArticles)
        .where(eq(newsArticles.slug, candidate))
        .limit(1);
      if (!clash) break;
      candidate = `${source.slug}-copy-${suffix}`;
      suffix += 1;
    }
    const [inserted] = await tx
      .insert(newsArticles)
      .values({
        slug: candidate,
        categoryId: source.categoryId,
        title: `${source.title} (Copy)`.slice(0, 255),
        outlet: source.outlet,
        articleType: source.articleType,
        summary: source.summary,
        content: source.content,
        contentPlain: source.contentPlain,
        author: source.author,
        publishedOn: source.publishedOn,
        externalUrl: source.externalUrl,
        documentMediaId: source.documentMediaId,
        coverMediaId: source.coverMediaId,
        imageUrl: source.imageUrl,
        imageAlt: source.imageAlt,
        isPublished: false,
        isFeatured: source.isFeatured,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .$returningId();
    newId = inserted.id;

    const tagLinks = await tx
      .select({ tagId: newsArticleTags.tagId })
      .from(newsArticleTags)
      .where(eq(newsArticleTags.articleId, id));
    for (const link of tagLinks) {
      await tx.insert(newsArticleTags).values({ articleId: newId, tagId: link.tagId });
    }

    // Share the same media file through a fresh ACTIVE attachment row —
    // the document itself is never duplicated on disk.
    const [active] = await tx
      .select()
      .from(newsAttachments)
      .where(and(eq(newsAttachments.articleId, id), eq(newsAttachments.status, "ACTIVE")))
      .orderBy(desc(newsAttachments.id))
      .limit(1);
    if (active) {
      await tx.insert(newsAttachments).values({
        articleId: newId,
        mediaId: active.mediaId,
        kind: active.kind,
        originalName: active.originalName,
        checksum: active.checksum,
        visibility: active.visibility,
        status: "ACTIVE",
        uploadedBy: actor.userId,
      });
    }
  });
  await audit(deps, actor, AUDIT_ACTIONS.newsArticlesDuplicate, "news_article", newId, meta, {
    sourceId: id,
    sourceSlug: source.slug,
  });
  return getAdminNewsArticle(deps, newId);
}

export interface NewsBulkResult {
  results: { id: number; ok: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

export async function bulkNewsArticles(
  deps: MuseumDeps,
  actor: MuseumActor,
  ids: number[],
  action: "publish" | "unpublish" | "archive",
  meta: RequestMeta,
): Promise<NewsBulkResult> {
  const { db } = deps;
  const results: NewsBulkResult["results"] = [];
  for (const id of ids) {
    const [row] = await db
      .select({ id: newsArticles.id })
      .from(newsArticles)
      .where(and(eq(newsArticles.id, id), isNull(newsArticles.deletedAt)))
      .limit(1);
    if (!row) {
      results.push({ id, ok: false, error: "News article not found." });
      continue;
    }
    if (action === "archive") {
      await db
        .update(newsArticles)
        .set({ deletedAt: new Date(), updatedBy: actor.userId })
        .where(eq(newsArticles.id, id));
    } else {
      await db
        .update(newsArticles)
        .set({ isPublished: action === "publish", updatedBy: actor.userId })
        .where(eq(newsArticles.id, id));
    }
    results.push({ id, ok: true });
  }
  const succeeded = results.filter((r) => r.ok).length;
  await audit(deps, actor, AUDIT_ACTIONS.newsArticlesBulk, "news_article", null, meta, {
    action,
    total: ids.length,
    succeeded,
    failed: ids.length - succeeded,
  });
  return { results, succeeded, failed: ids.length - succeeded };
}

/**
 * Attach (or replace) an article's PDF. The document is validated and
 * stored FIRST — when that fails nothing about the article changes, so a
 * published article never temporarily loses its live document. Only then
 * does one transaction flip the old ACTIVE attachment to REPLACED (with
 * its history link), insert the new ACTIVE row and mirror the media id
 * onto the article.
 *
 * Concurrency: the transaction FIRST locks the article row
 * (SELECT … FOR UPDATE) and only then reads the current ACTIVE
 * attachment, so two simultaneous replacements serialise on the article
 * — exactly one ACTIVE attachment survives and the replaced_by chain
 * stays consistent. If the transaction fails after the file was stored,
 * the just-created media asset is purged best-effort (the Phase 8 media
 * sweep remains the backstop for anything that still slips through,
 * e.g. a process crash between store and transaction).
 */
export async function uploadNewsPdf(
  deps: MuseumDeps,
  actor: MuseumActor,
  articleId: number,
  file: { buffer: Buffer; originalName: string | null },
  meta: RequestMeta,
): Promise<NewsAttachmentView> {
  const { db, config } = deps;
  await getNewsArticleOrThrow(db, articleId);
  const { asset, checksum } = await storeDocument(db, config, {
    buffer: file.buffer,
    originalName: file.originalName,
    uploadedBy: actor.userId,
  });

  let attachmentId = 0;
  let replaced = false;
  try {
    await db.transaction(async (tx) => {
      // Lock the article row before touching its attachments: a second
      // concurrent replacement blocks here until this transaction
      // commits, then reads the NEW active attachment as its previous.
      const [locked] = await tx
        .select({ id: newsArticles.id })
        .from(newsArticles)
        .where(eq(newsArticles.id, articleId))
        .for("update");
      if (!locked) throw AppError.notFound("News article not found.");
      const previous = await tx
        .select({ id: newsAttachments.id })
        .from(newsAttachments)
        .where(
          and(
            eq(newsAttachments.articleId, articleId),
            eq(newsAttachments.status, "ACTIVE"),
          ),
        );
      replaced = previous.length > 0;
      const [inserted] = await tx
        .insert(newsAttachments)
        .values({
          articleId,
          mediaId: asset.id,
          kind: "PDF",
          originalName: asset.originalName,
          checksum,
          visibility: "PUBLIC",
          status: "ACTIVE",
          uploadedBy: actor.userId,
        })
        .$returningId();
      attachmentId = inserted.id;
      if (replaced) {
        await tx
          .update(newsAttachments)
          .set({ status: "REPLACED", replacedById: attachmentId })
          .where(
            and(
              eq(newsAttachments.articleId, articleId),
              eq(newsAttachments.status, "ACTIVE"),
              sql`${newsAttachments.id} <> ${attachmentId}`,
            ),
          );
      }
      await tx
        .update(newsArticles)
        .set({ documentMediaId: asset.id, updatedBy: actor.userId })
        .where(eq(newsArticles.id, articleId));
    });
  } catch (err) {
    // The file + media row exist but no attachment references them:
    // remove both best-effort and rethrow the ORIGINAL error. The
    // Phase 8 media sweep is the backstop if even this cleanup fails.
    try {
      await purgeStoredDocument(db, config, asset.id);
    } catch {
      // Never mask the original failure with a cleanup failure.
    }
    throw err;
  }

  await audit(
    deps,
    actor,
    replaced ? AUDIT_ACTIONS.newsPdfReplace : AUDIT_ACTIONS.newsPdfUpload,
    "news_article",
    articleId,
    meta,
    { attachmentId, mediaId: asset.id, checksum, fileSize: asset.fileSize },
  );
  const active = await loadActiveAttachments(db, [articleId], false);
  const info = active.get(articleId);
  if (!info) throw AppError.internal();
  return toAttachmentView(info);
}

export async function removeNewsPdf(
  deps: MuseumDeps,
  actor: MuseumActor,
  articleId: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getNewsArticleOrThrow(db, articleId);
  const active = await loadActiveAttachments(db, [articleId], false);
  if (!active.has(articleId)) {
    throw AppError.notFound("This article has no PDF attachment.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(newsAttachments)
      .set({ status: "REMOVED" })
      .where(
        and(
          eq(newsAttachments.articleId, articleId),
          eq(newsAttachments.status, "ACTIVE"),
        ),
      );
    await tx
      .update(newsArticles)
      .set({ documentMediaId: null, updatedBy: actor.userId })
      .where(eq(newsArticles.id, articleId));
  });
  await audit(deps, actor, AUDIT_ACTIONS.newsPdfRemove, "news_article", articleId, meta);
}

export interface CreatedNewsPreview {
  token: string;
  url: string;
  expiresAt: Date;
}

const NEWS_PREVIEW_TTL_MS = 30 * 60 * 1000;

export async function createNewsPreview(
  deps: MuseumDeps,
  actor: MuseumActor,
  articleId: number,
  meta: RequestMeta,
): Promise<CreatedNewsPreview> {
  const { db } = deps;
  await getNewsArticleOrThrow(db, articleId);
  const { raw, hash } = generateToken(32);
  const expiresAt = new Date(Date.now() + NEWS_PREVIEW_TTL_MS);
  await db.insert(newsPreviewTokens).values({
    articleId,
    tokenHash: hash,
    expiresAt,
    createdBy: actor.userId,
  });
  await audit(deps, actor, AUDIT_ACTIONS.newsPreviewCreate, "news_article", articleId, meta, {
    expiresAt: expiresAt.toISOString(),
  });
  return { token: raw, url: `/news/preview/${raw}`, expiresAt };
}

export async function deleteNewsArticle(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getNewsArticleOrThrow(db, id);
  await db
    .update(newsArticles)
    .set({ deletedAt: new Date(), updatedBy: actor.userId })
    .where(eq(newsArticles.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.newsArticlesDelete, "news_article", id, meta);
}

// ---------------------------------------------------------------------------
// Foundation programs (admin)
// ---------------------------------------------------------------------------

async function getFoundationProgramOrThrow(db: Database, id: number): Promise<FoundationProgramRow> {
  const [row] = await db
    .select()
    .from(foundationPrograms)
    .where(and(eq(foundationPrograms.id, id), isNull(foundationPrograms.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("Foundation program not found.");
  return row;
}

async function assertFoundationProgramSlugFree(db: Database, slug: string, excludeId?: number): Promise<void> {
  const [existing] = await db
    .select({ id: foundationPrograms.id })
    .from(foundationPrograms)
    .where(eq(foundationPrograms.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict(`A foundation program with slug '${slug}' already exists.`);
  }
}

export async function listAdminFoundationPrograms(
  deps: MuseumDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: FoundationProgramAdminView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(foundationPrograms.deletedAt)];
  if (search) conditions.push(like(foundationPrograms.name, likePattern(search)));
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(foundationPrograms).where(where);
  const rows = await db
    .select()
    .from(foundationPrograms)
    .where(where)
    .orderBy(asc(foundationPrograms.sortOrder), asc(foundationPrograms.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function getAdminFoundationProgram(deps: MuseumDeps, id: number): Promise<FoundationProgramAdminView> {
  return getFoundationProgramOrThrow(deps.db, id);
}

export async function createFoundationProgram(
  deps: MuseumDeps,
  actor: MuseumActor,
  input: CreateFoundationProgramInput,
  meta: RequestMeta,
): Promise<FoundationProgramAdminView> {
  const { db } = deps;
  await assertFoundationProgramSlugFree(db, input.slug);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  let id = 0;
  try {
    const [inserted] = await db
      .insert(foundationPrograms)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .$returningId();
    id = inserted.id;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A foundation program with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getFoundationProgramOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.foundationProgramsCreate, "foundation_program", id, meta, { slug: row.slug });
  return row;
}

export async function updateFoundationProgram(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateFoundationProgramInput,
  meta: RequestMeta,
): Promise<FoundationProgramAdminView> {
  const { db } = deps;
  await getFoundationProgramOrThrow(db, id);
  if (input.slug !== undefined) await assertFoundationProgramSlugFree(db, input.slug, id);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  try {
    await db
      .update(foundationPrograms)
      .set({ ...definedPatch(input), updatedBy: actor.userId })
      .where(eq(foundationPrograms.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A foundation program with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getFoundationProgramOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.foundationProgramsUpdate, "foundation_program", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteFoundationProgram(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getFoundationProgramOrThrow(db, id);
  await db
    .update(foundationPrograms)
    .set({ deletedAt: new Date(), updatedBy: actor.userId })
    .where(eq(foundationPrograms.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.foundationProgramsDelete, "foundation_program", id, meta);
}

export async function reorderFoundationPrograms(
  deps: MuseumDeps,
  actor: MuseumActor,
  ids: number[],
  meta: RequestMeta,
): Promise<FoundationProgramAdminView[]> {
  const { db } = deps;
  const live = await db
    .select({ id: foundationPrograms.id })
    .from(foundationPrograms)
    .where(isNull(foundationPrograms.deletedAt));
  assertReorderIds(ids, live.map((row) => row.id), "foundation program");
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(foundationPrograms).set({ sortOrder: index }).where(eq(foundationPrograms.id, id));
    }
  });
  await audit(deps, actor, AUDIT_ACTIONS.foundationProgramsReorder, "foundation_program", null, meta, { ids });
  const rows = await db
    .select()
    .from(foundationPrograms)
    .where(isNull(foundationPrograms.deletedAt))
    .orderBy(asc(foundationPrograms.sortOrder), asc(foundationPrograms.id));
  return rows;
}

// ---------------------------------------------------------------------------
// Testimonials (admin; no slug — identity is the row id)
// ---------------------------------------------------------------------------

async function getTestimonialOrThrow(db: Database, id: number): Promise<TestimonialRow> {
  const [row] = await db
    .select()
    .from(testimonials)
    .where(and(eq(testimonials.id, id), isNull(testimonials.deletedAt)))
    .limit(1);
  if (!row) throw AppError.notFound("Testimonial not found.");
  return row;
}

export async function listAdminTestimonials(
  deps: MuseumDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: TestimonialAdminView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(testimonials.deletedAt)];
  if (search) conditions.push(like(testimonials.authorName, likePattern(search)));
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(testimonials).where(where);
  const rows = await db
    .select()
    .from(testimonials)
    .where(where)
    .orderBy(asc(testimonials.sortOrder), asc(testimonials.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function getAdminTestimonial(deps: MuseumDeps, id: number): Promise<TestimonialAdminView> {
  return getTestimonialOrThrow(deps.db, id);
}

export async function createTestimonial(
  deps: MuseumDeps,
  actor: MuseumActor,
  input: CreateTestimonialInput,
  meta: RequestMeta,
): Promise<TestimonialAdminView> {
  const { db } = deps;
  if (input.avatarMediaId != null) await assertMediaExists(db, input.avatarMediaId, "avatarMediaId");
  const [inserted] = await db
    .insert(testimonials)
    .values({
      ...input,
      // The pool vocabulary is the seed's lowercase tokens ('foundation',
      // 'curator'); the column default is never relied on.
      context: input.context ?? "foundation",
      createdBy: actor.userId,
    })
    .$returningId();
  const row = await getTestimonialOrThrow(db, inserted.id);
  await audit(deps, actor, AUDIT_ACTIONS.foundationTestimonialsCreate, "testimonial", row.id, meta, {
    context: row.context,
  });
  return row;
}

export async function updateTestimonial(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  input: UpdateTestimonialInput,
  meta: RequestMeta,
): Promise<TestimonialAdminView> {
  const { db } = deps;
  await getTestimonialOrThrow(db, id);
  if (input.avatarMediaId != null) await assertMediaExists(db, input.avatarMediaId, "avatarMediaId");
  await db
    .update(testimonials)
    .set(definedPatch(input))
    .where(eq(testimonials.id, id));
  const row = await getTestimonialOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.foundationTestimonialsUpdate, "testimonial", id, meta, {
    fields: Object.keys(definedPatch(input)),
  });
  return row;
}

export async function deleteTestimonial(
  deps: MuseumDeps,
  actor: MuseumActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await getTestimonialOrThrow(db, id);
  await db
    .update(testimonials)
    .set({ deletedAt: new Date() })
    .where(eq(testimonials.id, id));
  await audit(deps, actor, AUDIT_ACTIONS.foundationTestimonialsDelete, "testimonial", id, meta);
}

export async function reorderTestimonials(
  deps: MuseumDeps,
  actor: MuseumActor,
  ids: number[],
  meta: RequestMeta,
): Promise<TestimonialAdminView[]> {
  const { db } = deps;
  const live = await db
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(isNull(testimonials.deletedAt));
  assertReorderIds(ids, live.map((row) => row.id), "testimonial");
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(testimonials).set({ sortOrder: index }).where(eq(testimonials.id, id));
    }
  });
  await audit(deps, actor, AUDIT_ACTIONS.foundationTestimonialsReorder, "testimonial", null, meta, { ids });
  const rows = await db
    .select()
    .from(testimonials)
    .where(isNull(testimonials.deletedAt))
    .orderBy(asc(testimonials.sortOrder), asc(testimonials.id));
  return rows;
}
