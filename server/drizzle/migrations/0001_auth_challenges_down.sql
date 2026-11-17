-- DOWN migration for 0001_auth_challenges.sql — Phase 2 identity challenges
-- & administrative-security rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0001_auth_challenges_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value
--      (1794898778084):
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794898778084;
--   3. Re-apply with: npm run db:migrate
--
-- All five tables are children of `users`/`roles` (0000) and of nothing in
-- each other, so drop order among them is unconstrained; they are dropped in
-- reverse creation order with FOREIGN_KEY_CHECKS left enabled. Any OTP,
-- reset-token, invitation or MFA data in them is disposable in dev by
-- definition — in production these tables hold live security state and must
-- never be dropped outside a restore.

DROP TABLE IF EXISTS `password_reset_tokens`;
DROP TABLE IF EXISTS `mfa_recovery_codes`;
DROP TABLE IF EXISTS `mfa_credentials`;
DROP TABLE IF EXISTS `invitations`;
DROP TABLE IF EXISTS `email_verification_codes`;
