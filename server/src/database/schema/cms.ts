import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  type MySqlColumn,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';
import { mediaAssets } from './media.js';

/**
 * CMS tables — DATABASE_DESIGN.md §7.1 (`pages`), §7.2 (`page_revisions`),
 * §7.4 (`page_sections`), §7.5 (`menus`, `menu_items`), §7.6
 * (`site_settings`). The revision/publication model is §7.3.
 * `preview_tokens` implements Phase 0 amendment A4 (hashed, expiring,
 * page+revision-bound preview tokens) — migration 0004.
 *
 * Global conventions (§2): BIGINT UNSIGNED surrogate PKs, DATETIME(3) UTC
 * timestamps, snake_case names, `idx_`/`uq_`/`fk_` constraint naming,
 * ON DELETE RESTRICT / ON UPDATE RESTRICT unless a table states otherwise
 * (the one exception here: `menu_items.menu_id` is ON DELETE CASCADE, §7.5).
 *
 * Circular reference (§7.1 migration-order note): `pages` points at its
 * draft/published revisions while `page_revisions` points back at `pages`.
 * Both FK directions are declared here as lazy column-level references
 * whose arrows carry an explicit `MySqlColumn` return type — the
 * pages ↔ page_revisions cycle otherwise defeats TS type inference
 * (TS7022/TS7024), through extra-config callbacks and unannotated
 * reference arrows alike. The SQL migration creates `pages` WITHOUT the
 * two revision FKs and adds them by ALTER TABLE, under their design
 * names, once `page_revisions` exists.
 */

export const pages = mysqlTable(
  'pages',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // The home page's '' path is stored as the slug 'home'; the URL path is
    // derived from the slug (§7.1).
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    // DRAFT | PUBLISHED | ARCHIVED (app-level enum, §7.1)
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    // The 7 existing pages: slug locked, undeletable (§7.1).
    isSystem: boolean('is_system').notNull().default(false),
    seoTitle: varchar('seo_title', { length: 200 }),
    metaDescription: varchar('meta_description', { length: 320 }),
    ogImageMediaId: bigint('og_image_media_id', { mode: 'number', unsigned: true }),
    // The revision the builder edits; cloned from the published revision on
    // first edit when draft == published (§7.3). Lazy column-level
    // reference with an annotated return type (see module header); the SQL
    // migration adds the FK by post-CREATE ALTER under its design name
    // (fk_pages_draft_revision).
    draftRevisionId: bigint('draft_revision_id', { mode: 'number', unsigned: true })
      .references((): MySqlColumn => pageRevisions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    // The only revision public reads ever resolve (§7.3). Same treatment;
    // SQL constraint name fk_pages_published_revision.
    publishedRevisionId: bigint('published_revision_id', { mode: 'number', unsigned: true })
      .references((): MySqlColumn => pageRevisions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    publishedAt: datetime('published_at', { fsp: 3, mode: 'date' }),
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
    uniqueIndex('uq_pages_slug').on(table.slug),
    index('idx_pages_status').on(table.status, table.deletedAt),
    foreignKey({
      columns: [table.ogImageMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'fk_pages_og_image',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_pages_created_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_pages_updated_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const pageRevisions = mysqlTable(
  'page_revisions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // Lazy column-level reference (see pages.draftRevisionId): the design
    // constraint name is fk_rev_page, applied by the SQL migration.
    pageId: bigint('page_id', { mode: 'number', unsigned: true })
      .notNull()
      .references((): MySqlColumn => pages.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    // Per-page, monotonically increasing (§7.2).
    revisionNo: int('revision_no', { unsigned: true }).notNull(),
    // Optimistic-concurrency counter for draft edits (§7.3): a stale editor
    // saving with an old version gets 409 CONFLICT.
    version: int('version', { unsigned: true }).notNull().default(1),
    // Optional admin note ("Fixed hero text").
    label: varchar('label', { length: 120 }),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uq_revisions_page_no').on(table.pageId, table.revisionNo),
    index('idx_revisions_page').on(table.pageId, table.createdAt),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_rev_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const pageSections = mysqlTable(
  'page_sections',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    revisionId: bigint('revision_id', { mode: 'number', unsigned: true }).notNull(),
    // Section-registry key: hero | rich_text | image_text | collection_grid | …
    type: varchar('type', { length: 60 }).notNull(),
    sortOrder: int('sort_order').notNull(),
    isVisible: boolean('is_visible').notNull().default(true),
    // Content + data-source config; Zod-validated per type on every save and
    // again at publish. Media references inside are media ids (§7.4).
    config: json('config').notNull(),
    // Presentation options (background, alignment, spacing, …).
    design: json('design'),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_sections_revision_order').on(table.revisionId, table.sortOrder),
    index('idx_sections_type').on(table.type),
    foreignKey({
      columns: [table.revisionId],
      foreignColumns: [pageRevisions.id],
      name: 'fk_sections_revision',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const menus = mysqlTable(
  'menus',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // primary | footer_visit | footer_engage | footer_connect | mobile (§7.5)
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_menus_code').on(table.code)],
);

export const menuItems = mysqlTable(
  'menu_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    menuId: bigint('menu_id', { mode: 'number', unsigned: true }).notNull(),
    // Reserved for future nesting; v1 renders one level (§7.5).
    parentId: bigint('parent_id', { mode: 'number', unsigned: true }),
    label: varchar('label', { length: 120 }).notNull(),
    // PAGE | EXTERNAL | ANCHOR (app-level enum, §7.5)
    linkType: varchar('link_type', { length: 10 }).notNull().default('PAGE'),
    // Set when link_type = PAGE.
    pageId: bigint('page_id', { mode: 'number', unsigned: true }),
    // Set when link_type = EXTERNAL / ANCHOR.
    url: varchar('url', { length: 500 }),
    sortOrder: int('sort_order').notNull().default(0),
    isVisible: boolean('is_visible').notNull().default(true),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_items_menu_order').on(table.menuId, table.sortOrder),
    // Items are meaningless without their menu: CASCADE — the stated
    // exception to the RESTRICT default (§7.5).
    foreignKey({
      columns: [table.menuId],
      foreignColumns: [menus.id],
      name: 'fk_items_menu',
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'fk_items_parent',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'fk_items_page',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const previewTokens = mysqlTable(
  'preview_tokens',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    pageId: bigint('page_id', { mode: 'number', unsigned: true }).notNull(),
    // The draft revision the token previews; binding the token to one
    // revision keeps the preview stable while editing continues (A4).
    revisionId: bigint('revision_id', { mode: 'number', unsigned: true }).notNull(),
    // SHA-256 hex of the raw token (§2.11 pattern) — the raw token is
    // returned once at creation and never stored.
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { fsp: 3, mode: 'date' }).notNull(),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_preview_tokens_hash').on(table.tokenHash),
    index('idx_preview_tokens_page').on(table.pageId),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [pages.id],
      name: 'fk_preview_tokens_page',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.revisionId],
      foreignColumns: [pageRevisions.id],
      name: 'fk_preview_tokens_revision',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_preview_tokens_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const siteSettings = mysqlTable(
  'site_settings',
  {
    // site_name | contact_phone | contact_email | opening_hours |
    // social_facebook | … | store_shipping_fee | store_tax_enabled |
    // invoice_prefix (§7.6). Key–value by design; secrets are NEVER settings.
    settingKey: varchar('setting_key', { length: 80 }).primaryKey(),
    // JSON-encoded for structured values.
    settingValue: text('setting_value'),
    // Exposed via GET /api/site when 1 (§7.6).
    isPublic: boolean('is_public').notNull().default(false),
    updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_settings_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
