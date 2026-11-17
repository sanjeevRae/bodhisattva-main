-- DOWN migration for 0000_foundation_identity.sql — Phase 1 foundation rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback of
-- a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0000_foundation_identity_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again:
--        DELETE FROM `__drizzle_migrations` ORDER BY `id` DESC LIMIT 1;
--      (0000 is currently the only migration; when later migrations exist,
--      delete the row whose created_at matches this migration's journal
--      `when` value instead.)
--   3. Re-apply with: npm run db:migrate
--
-- Tables are dropped in FK-safe order (children before parents) with
-- FOREIGN_KEY_CHECKS left enabled, so a successful run also proves the
-- dependency order. audit_logs is dropped too — in dev only; its data is
-- disposable there by definition.

DROP TABLE IF EXISTS `user_roles`;
DROP TABLE IF EXISTS `role_permissions`;
DROP TABLE IF EXISTS `user_sessions`;
DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `rate_limits`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `roles`;
DROP TABLE IF EXISTS `permissions`;
