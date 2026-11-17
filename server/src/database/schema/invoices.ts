import { sql } from 'drizzle-orm';
import { bigint, datetime, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/**
 * Invoice tables — DATABASE_DESIGN.md §10.
 *
 * Phase 6 authors ONLY `invoice_sequences` (§10.2): the order-number
 * generator (§9.8) uses the same sequence mechanism with its own scope
 * ('ORDER:<year>'), so the counter table must exist before checkout can
 * issue order numbers. `invoices` (§10.1) and `invoice_templates` /
 * `invoice_template_versions` (§10.3) land in Phase 7 with the invoice
 * module itself.
 *
 * Mechanism (§10.2): inside the order/invoice transaction the scope row
 * is locked `SELECT … FOR UPDATE`, incremented, and the formatted number
 * (`ORD-2026-000123` / `INV-2026-00042`) is inserted under its UNIQUE
 * constraint — the constraint is the final guarantee, the row lock keeps
 * the critical section short. Rolled-back transactions may consume a
 * number; gaps are acceptable and auditable, duplicates are not.
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
