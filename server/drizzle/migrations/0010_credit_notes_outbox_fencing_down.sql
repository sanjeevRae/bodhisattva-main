-- DOWN migration for 0010_credit_notes_outbox_fencing.sql — Phase 8
-- credit-note + outbox-fencing rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
-- WARNING: dropping `credit_notes` destroys issued reversal documents; never
-- run this against a database that has taken real orders.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0010_credit_notes_outbox_fencing_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value:
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794919735052;
--   3. Re-apply with: npm run db:migrate

ALTER TABLE `credit_notes` DROP FOREIGN KEY `fk_credit_notes_by`;
ALTER TABLE `credit_notes` DROP FOREIGN KEY `fk_credit_notes_order`;
ALTER TABLE `credit_notes` DROP FOREIGN KEY `fk_credit_notes_invoice`;
DROP TABLE IF EXISTS `credit_notes`;
ALTER TABLE `email_outbox` DROP COLUMN `lease_version`;
