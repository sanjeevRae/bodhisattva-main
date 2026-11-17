-- DOWN migration for 0009_invoices_outbox.sql — Phase 7 invoice + outbox rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
-- WARNING: dropping `invoices` destroys issued accounting records; never run
-- this against a database that has taken real orders.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0009_invoices_outbox_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value:
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794914878343;
--   3. Re-apply with: npm run db:migrate

ALTER TABLE `invoices` DROP FOREIGN KEY `fk_invoices_tmpl_version`;
ALTER TABLE `invoice_templates` DROP FOREIGN KEY `fk_templates_current_version`;
DROP TABLE IF EXISTS `invoices`;
DROP TABLE IF EXISTS `invoice_template_versions`;
DROP TABLE IF EXISTS `invoice_templates`;
DROP TABLE IF EXISTS `email_outbox`;
