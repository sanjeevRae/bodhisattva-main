import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';

/**
 * Media library tables — DATABASE_DESIGN.md §7.7 (`media_folders`,
 * `media_assets`).
 *
 * Global conventions (§2): BIGINT UNSIGNED surrogate PKs, DATETIME(3) UTC
 * timestamps, snake_case names, `idx_`/`uq_`/`fk_` constraint naming,
 * ON DELETE RESTRICT / ON UPDATE RESTRICT unless a table states otherwise.
 *
 * Files live outside `public_html` under random 128-bit storage names
 * (ARCHITECTURE.md §9); `original_name` is display-only. `mime_type` is the
 * server-sniffed type, never the client-supplied one (§7.7). Derivative
 * sizes are files derived from `storage_name`, not separate rows.
 */

export const mediaFolders = mysqlTable(
  'media_folders',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    // NULL for a top-level folder; nesting is reserved by the design (§7.7).
    parentId: bigint('parent_id', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_folders_parent').on(table.parentId),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'fk_folders_parent',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const mediaAssets = mysqlTable(
  'media_assets',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    folderId: bigint('folder_id', { mode: 'number', unsigned: true }),
    // Random 128-bit name + extension; never the original filename (§7.7).
    storageName: varchar('storage_name', { length: 120 }).notNull(),
    // Display only — never used to build a filesystem path.
    originalName: varchar('original_name', { length: 255 }),
    // Sniffed server-side at upload, not client-supplied (§7.7).
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    // Bytes of the re-encoded master file.
    fileSize: bigint('file_size', { mode: 'number', unsigned: true }).notNull(),
    width: int('width', { unsigned: true }),
    height: int('height', { unsigned: true }),
    altText: varchar('alt_text', { length: 255 }),
    caption: varchar('caption', { length: 500 }),
    uploadedBy: bigint('uploaded_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    // Soft delete; hard delete (row + files) is an admin-confirmed purge (§7.7).
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_media_storage_name').on(table.storageName),
    index('idx_media_folder').on(table.folderId, table.deletedAt),
    index('idx_media_created').on(table.createdAt),
    foreignKey({
      columns: [table.folderId],
      foreignColumns: [mediaFolders.id],
      name: 'fk_media_folder',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [users.id],
      name: 'fk_media_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
