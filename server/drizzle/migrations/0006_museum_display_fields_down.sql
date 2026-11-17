-- Rollback for 0006_museum_display_fields.sql (local use only —
-- migrations are forward-only in production, DATABASE_DESIGN.md §13.1).
-- Drops exactly what 0006 added: the unique key first, then the columns.
ALTER TABLE `news_articles` DROP INDEX `uq_news_slug`;--> statement-breakpoint
ALTER TABLE `news_articles` DROP COLUMN `slug`;--> statement-breakpoint
ALTER TABLE `news_categories` DROP COLUMN `color_token`;--> statement-breakpoint
ALTER TABLE `foundation_programs` DROP COLUMN `icon_name`;--> statement-breakpoint
ALTER TABLE `exhibitions` DROP COLUMN `cover_aspect`;--> statement-breakpoint
ALTER TABLE `exhibitions` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `exhibitions` DROP COLUMN `curator`;
