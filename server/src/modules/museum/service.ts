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
  inArray,
  isNull,
  like,
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
  newsArticles,
  newsCategories,
  testimonials,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { mediaFileUrl } from "../media/media.service.js";
import type {
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
 * Resolve a record's image to one { url, alt } (see the module header):
 * media asset first, legacy URL pair second, null when neither exists.
 */
function resolveImage(
  source: {
    mediaId: number | null;
    imageUrl: string | null;
    imageAlt: string | null;
  },
  assets: Map<number, MediaAssetRow>,
  fallbackAlt: string,
): ResolvedImage | null {
  if (source.mediaId != null) {
    const asset = assets.get(source.mediaId);
    if (asset) {
      return {
        url: mediaFileUrl(asset.id, "master"),
        alt: source.imageAlt ?? asset.altText ?? fallbackAlt,
      };
    }
  }
  if (source.imageUrl) {
    return { url: source.imageUrl, alt: source.imageAlt ?? fallbackAlt };
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
      { mediaId: row.coverMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt },
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
      { mediaId: row.coverMediaId, imageUrl: row.imageUrl, imageAlt: row.imageAlt },
      assets,
      row.title,
    ),
  }));
}

export interface PublicNewsResult {
  categories: NewsCategoryView[];
  items: NewsArticlePublicView[];
}

export interface PublicNewsQuery {
  search?: string;
  category?: string;
}

export async function getPublicNews(
  deps: MuseumDeps,
  query: PublicNewsQuery,
): Promise<PublicNewsResult> {
  const { db } = deps;
  const categoryRows = await db
    .select()
    .from(newsCategories)
    .orderBy(asc(newsCategories.id));
  const categories: NewsCategoryView[] = categoryRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    colorToken: row.colorToken,
  }));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));

  const conditions = [
    eq(newsArticles.isPublished, true),
    isNull(newsArticles.deletedAt),
  ];
  if (query.category) {
    const category = categoryRows.find((row) => row.slug === query.category);
    if (!category) return { categories, items: [] };
    conditions.push(eq(newsArticles.categoryId, category.id));
  }

  const search = query.search?.trim() ?? "";
  let rows: NewsArticleRow[];
  if (search) {
    try {
      // FULLTEXT first (ft_news_search on title/summary/outlet, §8.4).
      rows = await db
        .select()
        .from(newsArticles)
        .where(
          and(
            ...conditions,
            sql`MATCH(${newsArticles.title}, ${newsArticles.summary}, ${newsArticles.outlet}) AGAINST (${search} IN NATURAL LANGUAGE MODE)`,
          ),
        )
        .orderBy(desc(newsArticles.publishedOn), desc(newsArticles.id));
    } catch {
      // The design's documented fallback (§8.4 note): LIKE on the same
      // columns when FULLTEXT is unavailable on the host.
      const pattern = likePattern(search);
      const likeCondition = or(
        like(newsArticles.title, pattern),
        like(newsArticles.summary, pattern),
        like(newsArticles.outlet, pattern),
      );
      rows = await db
        .select()
        .from(newsArticles)
        .where(likeCondition ? and(...conditions, likeCondition) : and(...conditions))
        .orderBy(desc(newsArticles.publishedOn), desc(newsArticles.id));
    }
  } else {
    rows = await db
      .select()
      .from(newsArticles)
      .where(and(...conditions))
      .orderBy(desc(newsArticles.publishedOn), desc(newsArticles.id));
  }

  const assets = await loadAssetMap(db, rows.map((row) => row.coverMediaId));
  const items = rows.map((row) => {
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
    };
  });
  return { categories, items };
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
  let id = 0;
  try {
    const [inserted] = await db
      .insert(collections)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
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
  await getCollectionOrThrow(db, id);
  if (input.slug !== undefined) await assertCollectionSlugFree(db, input.slug, id);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  try {
    await db
      .update(collections)
      .set({ ...definedPatch(input), updatedBy: actor.userId })
      .where(eq(collections.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`A collection with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getCollectionOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumCollectionsUpdate, "collection", id, meta, {
    fields: Object.keys(definedPatch(input)),
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
  let id = 0;
  try {
    const [inserted] = await db
      .insert(exhibitions)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
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
  await getExhibitionOrThrow(db, id);
  if (input.slug !== undefined) await assertExhibitionSlugFree(db, input.slug, id);
  if (input.coverMediaId != null) await assertMediaExists(db, input.coverMediaId, "coverMediaId");
  try {
    await db
      .update(exhibitions)
      .set({ ...definedPatch(input), updatedBy: actor.userId })
      .where(eq(exhibitions.id, id));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict(`An exhibition with slug '${input.slug}' already exists.`);
    }
    throw err;
  }
  const row = await getExhibitionOrThrow(db, id);
  await audit(deps, actor, AUDIT_ACTIONS.museumExhibitionsUpdate, "exhibition", id, meta, {
    fields: Object.keys(definedPatch(input)),
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

export async function listAdminNewsArticles(
  deps: MuseumDeps,
  pagination: PaginationParams,
  search?: string,
): Promise<{ items: NewsArticleAdminView[]; total: number }> {
  const { db } = deps;
  const conditions = [isNull(newsArticles.deletedAt)];
  if (search) {
    const pattern = likePattern(search);
    const searchCondition = or(
      like(newsArticles.title, pattern),
      like(newsArticles.outlet, pattern),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(newsArticles).where(where);
  const rows = await db
    .select()
    .from(newsArticles)
    .where(where)
    .orderBy(desc(newsArticles.publishedOn), desc(newsArticles.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  return { items: rows, total: totalRow?.value ?? 0 };
}

export async function getAdminNewsArticle(deps: MuseumDeps, id: number): Promise<NewsArticleAdminView> {
  return getNewsArticleOrThrow(deps.db, id);
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
  let id = 0;
  try {
    const [inserted] = await db
      .insert(newsArticles)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .$returningId();
    id = inserted.id;
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
  try {
    await db
      .update(newsArticles)
      .set({ ...definedPatch(input), updatedBy: actor.userId })
      .where(eq(newsArticles.id, id));
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
