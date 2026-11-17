-- DOWN migration for 0003_cms_media.sql — Phase 3 CMS & media library
-- rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0003_cms_media_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value
--      (1794902093292):
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794902093292;
--   3. Re-apply with: npm run db:migrate
--
-- Tables are dropped in reverse creation order with FOREIGN_KEY_CHECKS
-- left enabled. The one wrinkle is the circular pages ↔ page_revisions
-- reference (§7.1): neither table can be dropped while the other still
-- references it, so the two revision FKs on `pages` are dropped first —
-- after which page_revisions, then pages, drop cleanly. Any CMS content
-- or media metadata in these tables is disposable in dev by definition —
-- in production they hold the live site content and must never be dropped
-- outside a restore.

DROP TABLE IF EXISTS `site_settings`;
DROP TABLE IF EXISTS `menu_items`;
DROP TABLE IF EXISTS `menus`;
DROP TABLE IF EXISTS `page_sections`;
ALTER TABLE `pages` DROP FOREIGN KEY `fk_pages_draft_revision`;
ALTER TABLE `pages` DROP FOREIGN KEY `fk_pages_published_revision`;
DROP TABLE IF EXISTS `page_revisions`;
DROP TABLE IF EXISTS `pages`;
DROP TABLE IF EXISTS `media_assets`;
DROP TABLE IF EXISTS `media_folders`;
