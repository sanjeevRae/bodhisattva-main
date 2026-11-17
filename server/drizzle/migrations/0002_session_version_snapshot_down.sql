-- DOWN migration for 0002_session_version_snapshot.sql — Phase 2 A9 rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- is a restore-from-backup operation, never an improvised change. Run this
-- only against a disposable development database.
--
-- Procedure (from server/):
--   1. Execute the statements below through any MySQL client.
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again:
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794899568286;

ALTER TABLE `user_sessions` DROP COLUMN `session_version`;
