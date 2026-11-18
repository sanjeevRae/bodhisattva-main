import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  foreignKey,
  index,
  int,
  longtext,
  mediumtext,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';
import { mediaAssets } from './media.js';

/**
 * Museum tables — DATABASE_DESIGN.md §8.1 (`collections`), §8.2
 * (`exhibitions`), §8.3 (`gallery_items`), §8.4 (`news_categories`,
 * `news_articles`), §8.5 (`foundation_programs`), §8.6 (`testimonials`).
 *
 * Global conventions (§2): BIGINT UNSIGNED surrogate PKs, DATETIME(3) UTC
 * timestamps, snake_case names, `idx_`/`uq_`/`fk_` constraint naming,
 * ON DELETE RESTRICT / ON UPDATE RESTRICT throughout §8 (no exceptions).
 * Categories are plain VARCHAR columns on `collections` and
 * `gallery_items` — §8 defines no category table for them; only news has
 * a taxonomy table (`news_categories`).
 *
 * RECORDED DEVIATION (Phase 5 lead decision): the existing site imagery
 * is remote Unsplash URLs, pending the client's media decision (BD-2).
 * So `collections`, `exhibitions`, `news_articles` and
 * `foundation_programs` carry — alongside their nullable `cover_media_id`
 * FK — a legacy `image_url` / `image_alt` column pair, and
 * `testimonials` carries the same pair alongside `avatar_media_id`.
 * Public payloads resolve a single {url, alt}, preferring the media
 * asset when the FK is set. `gallery_items` keeps `media_id` NOT NULL
 * per §8.3 (it is the uploaded-image store; no legacy URL content exists
 * for it). When BD-2 is decided, the URL columns are migrated into
 * media assets and retired.
 *
 * Phase 5 API completion (migration 0006): §8 omits four display fields
 * that the current site renders and CMS_CONTENT_MAPPING.md assigns to
 * these records, so they are stored here: `exhibitions.curator`,
 * `exhibitions.category` (the Gallery filter key) and
 * `exhibitions.cover_aspect` (the Gallery masonry flag, mapping §G3);
 * `news_categories.color_token` (the News page's per-type display
 * colours, mapping §N2); `news_articles.slug` (public/API addressing,
 * ARCHITECTURE.md §6.1 — §8.4 has no slug, the seed data and the API
 * contract require one); `foundation_programs.icon_name` (the Lucide
 * icon name, mapping §F4 — the component reference cannot be stored).
 *
 * Two modelling notes:
 *  - DATE columns (`starts_on`, `ends_on`, `published_on`) use drizzle
 *    `mode: 'string'` ('YYYY-MM-DD'): they are calendar dates, and string
 *    mode avoids JS Date timezone shifting. §8 does not specify a mode.
 *  - `news_articles`' FULLTEXT index `ft_news_search` (§8.4) cannot be
 *    expressed in drizzle's MySQL schema API. It is hand-written into
 *    migration 0005 and recorded in its snapshot; see that migration's
 *    header for the phantom-diff warning.
 */

export const collections = mysqlTable(
  'collections',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    // Sculpture | Painting | Manuscripts | Coins | Textiles | Contemporary
    category: varchar('category', { length: 80 }),
    // '1st – 5th Century CE'
    periodLabel: varchar('period_label', { length: 120 }),
    description: text('description'),
    history: text('history'),
    coverMediaId: bigint('cover_media_id', { mode: 'number', unsigned: true }),
    // Legacy remote imagery (see module header deviation).
    imageUrl: varchar('image_url', { length: 1000 }),
    imageAlt: varchar('image_alt', { length: 500 }),
    // Curatorial figure shown publicly (e.g. 487 works); display data, not stock.
    itemCount: int('item_count', { unsigned: true }),
    isFeatured: boolean('is_featured').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: int('sort_order').notNull().default(0),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_collections_slug').on(table.slug),
    index('idx_collections_pub').on(table.isPublished, table.isFeatured, table.sortOrder),
    foreignKey({
      columns: [table.coverMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_collections_cover',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_collections_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_collections_ub',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const exhibitions = mysqlTable(
  'exhibitions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 220 }).notNull(),
    description: text('description'),
    coverMediaId: bigint('cover_media_id', { mode: 'number', unsigned: true }),
    // Legacy remote imagery (see module header deviation).
    imageUrl: varchar('image_url', { length: 1000 }),
    imageAlt: varchar('image_alt', { length: 500 }),
    // 'Main Hall', 'East Wing'…
    location: varchar('location', { length: 160 }),
    // Display fields §8.2 omits (see module header, migration 0006):
    // the curator credited on the Gallery cards, the Gallery filter key
    // (buddhist | historical | thematic | contemporary) and the masonry
    // aspect flag from the current grid.
    curator: varchar('curator', { length: 160 }),
    category: varchar('category', { length: 80 }),
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    // UPCOMING | CURRENT | PAST (admin-set; date-derived display is a
    // service concern, §8.2).
    status: varchar('status', { length: 20 }).notNull().default('UPCOMING'),
    // tall | standard — the cover's aspect in grid contexts (mapping §G3).
    coverAspect: varchar('cover_aspect', { length: 20 }),
    isFeatured: boolean('is_featured').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: int('sort_order').notNull().default(0),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_exhibitions_slug').on(table.slug),
    index('idx_exhibitions_pub').on(table.isPublished, table.status, table.startsOn),
    foreignKey({
      columns: [table.coverMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_exhibitions_cover',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_exhibitions_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_exhibitions_ub',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const galleryItems = mysqlTable(
  'gallery_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    mediaId: bigint('media_id', { mode: 'number', unsigned: true }).notNull(),
    // NULL = standalone gallery piece; otherwise the exhibition this image
    // belongs to (§8.3 — gallery images beyond an exhibition's cover live
    // here, there is no separate exhibition-images table).
    exhibitionId: bigint('exhibition_id', { mode: 'number', unsigned: true }),
    title: varchar('title', { length: 220 }),
    caption: varchar('caption', { length: 500 }),
    // buddhist | historical | thematic | contemporary (matches the
    // current Gallery filters, §8.3).
    category: varchar('category', { length: 80 }),
    year: smallint('year'),
    sortOrder: int('sort_order').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(false),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    index('idx_gallery_filter').on(table.isPublished, table.year, table.category, table.sortOrder),
    index('idx_gallery_exhibition').on(table.exhibitionId),
    foreignKey({
      columns: [table.mediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_gallery_media',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.exhibitionId],
      foreignColumns: [exhibitions.id],
      name: 'fk_gallery_exhibition',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_gallery_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const newsCategories = mysqlTable(
  'news_categories',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    // Tailwind class pair from the News page's type-colour map (mapping
    // §N2; §8.4 omits it — see module header, migration 0006).
    colorToken: varchar('color_token', { length: 160 }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [uniqueIndex('uq_news_categories_slug').on(table.slug)],
);

export const newsArticles = mysqlTable(
  'news_articles',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // Public/API addressing (ARCHITECTURE.md §6.1; §8.4 omits it — see
    // module header, migration 0006).
    slug: varchar('slug', { length: 200 }).notNull(),
    categoryId: bigint('category_id', { mode: 'number', unsigned: true }),
    title: varchar('title', { length: 255 }).notNull(),
    // Publication/source: 'The Hindu', 'Art Nepal Magazine'…
    outlet: varchar('outlet', { length: 160 }),
    // News | Interview | Feature | Press Release | Review (the current
    // design's labels, §8.4).
    articleType: varchar('article_type', { length: 40 }),
    summary: text('summary'),
    // News Clippings module (migration 0011): the readable article body —
    // sanitize-html output written by the admin editor, never raw input.
    content: longtext('content'),
    // Plain-text projection of `content` (tags stripped, entities
    // decoded, whitespace collapsed), maintained by the museum service
    // on every save. `ft_news_search` indexes THIS column so a search
    // matches the words a reader sees — never HTML markup.
    contentPlain: mediumtext('content_plain'),
    // Journalist / author byline, when the clipping carries one.
    author: varchar('author', { length: 160 }),
    publishedOn: date('published_on', { mode: 'string' }),
    externalUrl: varchar('external_url', { length: 500 }),
    // Uploaded clipping/document alternative to external_url.
    documentMediaId: bigint('document_media_id', { mode: 'number', unsigned: true }),
    coverMediaId: bigint('cover_media_id', { mode: 'number', unsigned: true }),
    // Legacy remote imagery (see module header deviation).
    imageUrl: varchar('image_url', { length: 1000 }),
    imageAlt: varchar('image_alt', { length: 500 }),
    isPublished: boolean('is_published').notNull().default(false),
    // News Clippings module (migration 0011): editorial featuring plus
    // honest counters — incremented only by real public reads/downloads.
    isFeatured: boolean('is_featured').notNull().default(false),
    viewCount: int('view_count', { unsigned: true }).notNull().default(0),
    pdfDownloadCount: int('pdf_download_count', { unsigned: true })
      .notNull()
      .default(0),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_news_slug').on(table.slug),
    index('idx_news_pub').on(table.isPublished, table.publishedOn),
    index('idx_news_featured').on(
      table.isFeatured,
      table.isPublished,
      table.publishedOn,
    ),
    index('idx_news_category').on(table.categoryId),
    // FULLTEXT KEY ft_news_search (title, summary, outlet — §8.4;
    // extended by migration 0011 to author + content_plain) is intentionally
    // absent here — drizzle's MySQL schema API cannot express FULLTEXT
    // indexes. Migrations 0005/0011 maintain it by hand and record it in
    // their snapshots; see the module header.
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [newsCategories.id],
      name: 'fk_news_category',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.documentMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_news_doc',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.coverMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_news_cover',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_news_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_news_ub',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

// ---------------------------------------------------------------------------
// News Clippings module (migration 0011): tags, PDF attachments with a
// replacement history, and per-article preview tokens.
// ---------------------------------------------------------------------------

export const newsTags = mysqlTable(
  'news_tags',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [uniqueIndex('uq_news_tags_slug').on(table.slug)],
);

export const newsArticleTags = mysqlTable(
  'news_article_tags',
  {
    articleId: bigint('article_id', { mode: 'number', unsigned: true }).notNull(),
    tagId: bigint('tag_id', { mode: 'number', unsigned: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.tagId] }),
    index('idx_news_article_tags_tag').on(table.tagId),
    foreignKey({
      columns: [table.articleId],
      foreignColumns: [newsArticles.id],
      name: 'fk_nat_article',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.tagId],
      foreignColumns: [newsTags.id],
      name: 'fk_nat_tag',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

/**
 * One row per PDF ever attached to an article. The ACTIVE row is the live
 * document (and the one `news_articles.document_media_id` mirrors);
 * replacing a PDF flips the old row to REPLACED with `replaced_by_id`
 * pointing at its successor, so the document history is never lost. The
 * file bytes live in the media library (`media_id` → `media_assets`); the
 * checksum of the ORIGINAL uploaded bytes is recorded here at upload.
 */
export const newsAttachments = mysqlTable(
  'news_attachments',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    articleId: bigint('article_id', { mode: 'number', unsigned: true }).notNull(),
    mediaId: bigint('media_id', { mode: 'number', unsigned: true }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull().default('PDF'),
    originalName: varchar('original_name', { length: 255 }),
    // SHA-256 hex of the original uploaded bytes.
    checksum: char('checksum', { length: 64 }).notNull(),
    // PUBLIC = servable to visitors while the article is published.
    visibility: varchar('visibility', { length: 20 }).notNull().default('PUBLIC'),
    // ACTIVE | REPLACED | REMOVED
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    replacedById: bigint('replaced_by_id', { mode: 'number', unsigned: true }),
    uploadedBy: bigint('uploaded_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_news_attachments_article').on(table.articleId, table.status),
    index('idx_news_attachments_media').on(table.mediaId),
    foreignKey({
      columns: [table.articleId],
      foreignColumns: [newsArticles.id],
      name: 'fk_natt_article',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.mediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_natt_media',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.replacedById],
      foreignColumns: [table.id],
      name: 'fk_natt_replaced_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [users.id],
      name: 'fk_natt_uploaded_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

/**
 * Per-article preview tokens — the CMS `preview_tokens` shape (migration
 * 0004) bound to a news article instead of a page revision: only the
 * SHA-256 digest is stored, the raw token is shown once, expiry 30 min.
 */
export const newsPreviewTokens = mysqlTable(
  'news_preview_tokens',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    articleId: bigint('article_id', { mode: 'number', unsigned: true }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { fsp: 3, mode: 'date' }).notNull(),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_news_preview_tokens_hash').on(table.tokenHash),
    index('idx_news_preview_tokens_article').on(table.articleId),
    foreignKey({
      columns: [table.articleId],
      foreignColumns: [newsArticles.id],
      name: 'fk_npt_article',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_npt_created_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const foundationPrograms = mysqlTable(
  'foundation_programs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    // Education | Artist Support | Access | Heritage
    category: varchar('category', { length: 80 }),
    description: text('description'),
    // '6,200 students per year'
    impactLabel: varchar('impact_label', { length: 160 }),
    // Lucide icon name ('BookOpen', 'Award', …) — the current component
    // stores a component reference in its data; the DB stores the name
    // and the renderer maps it from a controlled list (mapping §F4;
    // §8.5 omits it — see module header, migration 0006).
    iconName: varchar('icon_name', { length: 80 }),
    coverMediaId: bigint('cover_media_id', { mode: 'number', unsigned: true }),
    // Legacy remote imagery (see module header deviation).
    imageUrl: varchar('image_url', { length: 1000 }),
    imageAlt: varchar('image_alt', { length: 500 }),
    isFeatured: boolean('is_featured').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: int('sort_order').notNull().default(0),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_programs_slug').on(table.slug),
    index('idx_programs_pub').on(table.isPublished, table.isFeatured, table.sortOrder),
    foreignKey({
      columns: [table.coverMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_programs_cover',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_programs_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_programs_ub',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const testimonials = mysqlTable(
  'testimonials',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    quote: text('quote').notNull(),
    authorName: varchar('author_name', { length: 120 }).notNull(),
    // 'Living Craft Fellow, 2024'
    authorRole: varchar('author_role', { length: 160 }),
    avatarMediaId: bigint('avatar_media_id', { mode: 'number', unsigned: true }),
    // Legacy remote imagery (see module header deviation).
    imageUrl: varchar('image_url', { length: 1000 }),
    imageAlt: varchar('image_alt', { length: 500 }),
    // FOUNDATION | GENERAL
    context: varchar('context', { length: 40 }).notNull().default('FOUNDATION'),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: int('sort_order').notNull().default(0),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    index('idx_testimonials_pub').on(table.context, table.isPublished, table.sortOrder),
    foreignKey({
      columns: [table.avatarMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_testimonials_avatar',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_testimonials_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
