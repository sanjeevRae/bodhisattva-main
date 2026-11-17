-- DOWN migration for 0005_museum.sql — Phase 5 museum tables rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0005_museum_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value
--      (1794907445488):
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794907445488;
--   3. Re-apply with: npm run db:migrate
--
-- Tables are dropped in reverse creation order with FOREIGN_KEY_CHECKS
-- left enabled: gallery_items before the exhibitions it references,
-- news_articles before its news_categories; the remaining tables only
-- reference media_assets / users, which stay. Museum content in these
-- tables is disposable in dev by definition — in production it is live
-- site content and must never be dropped outside a restore.

DROP TABLE IF EXISTS `testimonials`;
DROP TABLE IF EXISTS `foundation_programs`;
DROP TABLE IF EXISTS `news_articles`;
DROP TABLE IF EXISTS `news_categories`;
DROP TABLE IF EXISTS `gallery_items`;
DROP TABLE IF EXISTS `exhibitions`;
DROP TABLE IF EXISTS `collections`;
