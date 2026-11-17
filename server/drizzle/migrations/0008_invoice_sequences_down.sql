-- DOWN migration for 0008_invoice_sequences.sql — Phase 6 sequence table rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0008_invoice_sequences_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value:
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794911306744;
--   3. Re-apply with: npm run db:migrate

DROP TABLE IF EXISTS `invoice_sequences`;
