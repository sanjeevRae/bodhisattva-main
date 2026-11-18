-- DOWN migration for 0011_news_clippings.sql — News Clippings & Digital
-- Press Archive module rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
-- WARNING: dropping `news_attachments` destroys the PDF replacement
-- history, and dropping the new `news_articles` columns destroys authored
-- article content; never run this against a database that has taken real
-- editorial content.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0011_news_clippings_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with
--      the schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value:
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794990000000;
--   3. Re-apply with: npm run db:migrate

ALTER TABLE `news_preview_tokens` DROP FOREIGN KEY `fk_npt_created_by`;
ALTER TABLE `news_preview_tokens` DROP FOREIGN KEY `fk_npt_article`;
DROP TABLE IF EXISTS `news_preview_tokens`;
ALTER TABLE `news_attachments` DROP FOREIGN KEY `fk_natt_uploaded_by`;
ALTER TABLE `news_attachments` DROP FOREIGN KEY `fk_natt_replaced_by`;
ALTER TABLE `news_attachments` DROP FOREIGN KEY `fk_natt_media`;
ALTER TABLE `news_attachments` DROP FOREIGN KEY `fk_natt_article`;
DROP TABLE IF EXISTS `news_attachments`;
ALTER TABLE `news_article_tags` DROP FOREIGN KEY `fk_nat_tag`;
ALTER TABLE `news_article_tags` DROP FOREIGN KEY `fk_nat_article`;
DROP TABLE IF EXISTS `news_article_tags`;
DROP TABLE IF EXISTS `news_tags`;
ALTER TABLE `news_articles` DROP INDEX `ft_news_search`;
CREATE FULLTEXT INDEX `ft_news_search` ON `news_articles` (`title`,`summary`,`outlet`);
ALTER TABLE `news_articles` DROP INDEX `idx_news_featured`;
ALTER TABLE `news_articles` DROP COLUMN `pdf_download_count`;
ALTER TABLE `news_articles` DROP COLUMN `view_count`;
ALTER TABLE `news_articles` DROP COLUMN `is_featured`;
ALTER TABLE `news_articles` DROP COLUMN `author`;
ALTER TABLE `news_articles` DROP COLUMN `content_plain`;
ALTER TABLE `news_articles` DROP COLUMN `content`;
