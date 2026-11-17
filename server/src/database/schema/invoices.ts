import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  datetime,
  decimal,
  foreignKey,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
  type MySqlColumn,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';
import { orders } from './store.js';

/**
 * Invoice tables — DATABASE_DESIGN.md §10.
 *
 * Phase 6 authored ONLY `invoice_sequences` (§10.2): the order-number
 * generator (§9.8) uses the same sequence mechanism with its own scope
 * ('ORDER:<year>'), so the counter table must exist before checkout can
 * issue order numbers. Phase 7 adds `invoices` (§10.1) and
 * `invoice_templates` / `invoice_template_versions` (§10.3).
 *
 * Mechanism (§10.2): inside the order/invoice transaction the scope row
 * is locked `SELECT … FOR UPDATE`, incremented, and the formatted number
 * (`ORD-2026-000123` / `INV-2026-00042`) is inserted under its UNIQUE
 * constraint — the constraint is the final guarantee, the row lock keeps
 * the critical section short. Rolled-back transactions may consume a
 * number; gaps are acceptable and auditable, duplicates are not.
 *
 * §10.1 invariants the schema enforces structurally:
 *  - `uq_invoices_order` — one invoice per order, ever. Together with
 *    the idempotent approval transaction this makes duplicate invoice
 *    creation impossible at the database level (§11.2 of the spec).
 *  - `snapshot` is the immutable render source: the PDF is rendered
 *    from the snapshot (which embeds the template configuration it was
 *    issued under), never from live order/product/template rows, so a
 *    later template edit cannot alter an issued invoice (§12.2).
 *  - A cancelled-after-approval order keeps its invoice row — invoices
 *    are accounting records and are never deleted in v1 (a future
 *    credit-note flow would supersede, per §10.1 notes).
 */
export const invoiceSequences = mysqlTable('invoice_sequences', {
  // 'INVOICE:2026' | 'ORDER:2026'
  scope: varchar('scope', { length: 40 }).primaryKey(),
  lastValue: bigint('last_value', { mode: 'number', unsigned: true })
    .notNull()
    .default(0),
  updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
});

export const invoiceTemplates = mysqlTable(
  'invoice_templates',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    // Exactly one active template — service-enforced (§10.3).
    isActive: boolean('is_active').notNull().default(false),
    // Lazy column-level reference (the pages ↔ page_revisions pattern of
    // §7.1/§10.3): the versions table references this one, so the FK is
    // declared lazily and applied by the migration under the design
    // name fk_templates_current_version.
    currentVersionId: bigint('current_version_id', {
      mode: 'number',
      unsigned: true,
    }).references((): MySqlColumn => invoiceTemplateVersions.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_templates_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: 'fk_templates_ub',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const invoiceTemplateVersions = mysqlTable(
  'invoice_template_versions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    templateId: bigint('template_id', { mode: 'number', unsigned: true }).notNull(),
    versionNo: int('version_no', { unsigned: true }).notNull(),
    // Validated configuration ONLY (Zod schema in the orders module):
    // company identity, prefix, colours, footer, terms, field toggles —
    // never executable template code (spec §12.1). Rows are immutable:
    // editing a template inserts a new version and moves the template's
    // current_version_id (§10.3).
    config: json('config').notNull(),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uq_itv_template_version').on(table.templateId, table.versionNo),
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [invoiceTemplates.id],
      name: 'fk_itv_template',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: 'fk_itv_cb',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const invoices = mysqlTable(
  'invoices',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // '<prefix>-<year>-<sequence>' from the §10.2 counter, e.g.
    // 'INV-2026-00042'.
    invoiceNumber: varchar('invoice_number', { length: 24 }).notNull(),
    orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
    // The template version this invoice was issued under (§10.3).
    templateVersionId: bigint('template_version_id', {
      mode: 'number',
      unsigned: true,
    }),
    currency: char('currency', { length: 3 }).notNull().default('NPR'),
    // Totals copied from the order at issue time (money strings,
    // DECIMAL(12,2) — see the store schema conventions).
    subtotal: decimal('subtotal', { precision: 12, scale: 2, mode: 'string' }).notNull(),
    shippingFee: decimal('shipping_fee', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0.00'),
    discountTotal: decimal('discount_total', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0.00'),
    taxTotal: decimal('tax_total', { precision: 12, scale: 2, mode: 'string' })
      .notNull()
      .default('0.00'),
    grandTotal: decimal('grand_total', { precision: 12, scale: 2, mode: 'string' }).notNull(),
    // Immutable render data — company info, customer, delivery address,
    // lines, totals, terms and the template configuration, exactly as
    // issued. The ONLY source the PDF renderer reads.
    snapshot: json('snapshot').notNull(),
    // File under <uploadDirectory>/invoices/ — served only through the
    // authorised download endpoints, never a static URL (§10.1).
    pdfStorageName: varchar('pdf_storage_name', { length: 120 }),
    // PENDING | SENT | FAILED — mirrors the invoice's outbox row; the
    // outbox is the delivery mechanism (§10.1/§11.1).
    emailStatus: varchar('email_status', { length: 20 }).notNull().default('PENDING'),
    issuedAt: datetime('issued_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    // The approving admin.
    issuedBy: bigint('issued_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uq_invoices_number').on(table.invoiceNumber),
    uniqueIndex('uq_invoices_order').on(table.orderId),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'fk_invoices_order',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [invoiceTemplateVersions.id],
      name: 'fk_invoices_tmpl_version',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.issuedBy],
      foreignColumns: [users.id],
      name: 'fk_invoices_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
