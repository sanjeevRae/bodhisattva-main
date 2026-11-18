-- Migration 0011 — News Clippings & Digital Press Archive module:
-- readable article content, author byline, featuring + honest counters on
-- `news_articles`; tag taxonomy (`news_tags`, `news_article_tags`); PDF
-- attachments with replacement history (`news_attachments`); per-article
-- preview tokens (`news_preview_tokens`); and the `ft_news_search`
-- FULLTEXT index extended to author + content_plain.
--
-- `content_plain` is the plain-text projection of the sanitized HTML
-- body (tags stripped, entities decoded, whitespace collapsed). It is
-- maintained by the museum service on every article save and is what
-- FULLTEXT searches — never the raw HTML, so markup (tag and attribute
-- names such as "strong" or "href") can never match a reader's search.
-- This migration deliberately leaves `content_plain` NULL on existing
-- rows: every row seeded before this module has NULL `content`, and any
-- row that gains a body gets its projection on its next save.
-- Hand-written per DATABASE_DESIGN.md §13.1 (drizzle-kit cannot express
-- FULLTEXT indexes and emits the known phantom diffs — the circular
-- pages ↔ page_revisions FK churn — which are absent here by
-- construction):
--   1. CREATE TABLEs carry the design §2.1 table options
--      ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci.
--   2. FKs are added by ALTER TABLE after the CREATE, as in 0009/0010.
--   3. No existing row is touched: new columns are NULLable or carry
--      defaults, and the seeded news content is preserved verbatim.
-- Rollback: 0011_news_clippings_down.sql (same folder).
ALTER TABLE `news_articles` ADD `content` longtext;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `content_plain` mediumtext;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `author` varchar(160);--> statement-breakpoint
ALTER TABLE `news_articles` ADD `is_featured` tinyint(1) NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `view_count` int unsigned NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `pdf_download_count` int unsigned NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `news_articles` ADD INDEX `idx_news_featured` (`is_featured`,`is_published`,`published_on`);--> statement-breakpoint
ALTER TABLE `news_articles` DROP INDEX `ft_news_search`;--> statement-breakpoint
CREATE FULLTEXT INDEX `ft_news_search` ON `news_articles` (`title`,`summary`,`outlet`,`author`,`content_plain`);--> statement-breakpoint
CREATE TABLE `news_tags` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `news_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_news_tags_slug` UNIQUE(`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `news_article_tags` (
	`article_id` bigint unsigned NOT NULL,
	`tag_id` bigint unsigned NOT NULL,
	CONSTRAINT `news_article_tags_id` PRIMARY KEY(`article_id`,`tag_id`),
	INDEX `idx_news_article_tags_tag` (`tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `news_article_tags` ADD CONSTRAINT `fk_nat_article` FOREIGN KEY (`article_id`) REFERENCES `news_articles`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `news_article_tags` ADD CONSTRAINT `fk_nat_tag` FOREIGN KEY (`tag_id`) REFERENCES `news_tags`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE TABLE `news_attachments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`article_id` bigint unsigned NOT NULL,
	`media_id` bigint unsigned NOT NULL,
	`kind` varchar(20) NOT NULL DEFAULT 'PDF',
	`original_name` varchar(255),
	`checksum` char(64) NOT NULL,
	`visibility` varchar(20) NOT NULL DEFAULT 'PUBLIC',
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`replaced_by_id` bigint unsigned,
	`uploaded_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `news_attachments_id` PRIMARY KEY(`id`),
	INDEX `idx_news_attachments_article` (`article_id`,`status`),
	INDEX `idx_news_attachments_media` (`media_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `news_attachments` ADD CONSTRAINT `fk_natt_article` FOREIGN KEY (`article_id`) REFERENCES `news_articles`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `news_attachments` ADD CONSTRAINT `fk_natt_media` FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `news_attachments` ADD CONSTRAINT `fk_natt_replaced_by` FOREIGN KEY (`replaced_by_id`) REFERENCES `news_attachments`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `news_attachments` ADD CONSTRAINT `fk_natt_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE TABLE `news_preview_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`article_id` bigint unsigned NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `news_preview_tokens_id` PRIMARY KEY(`id`),
	INDEX `idx_news_preview_tokens_hash` (`token_hash`),
	INDEX `idx_news_preview_tokens_article` (`article_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `news_preview_tokens` ADD CONSTRAINT `fk_npt_article` FOREIGN KEY (`article_id`) REFERENCES `news_articles`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `news_preview_tokens` ADD CONSTRAINT `fk_npt_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
