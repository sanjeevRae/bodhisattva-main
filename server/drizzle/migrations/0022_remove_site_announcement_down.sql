-- Rollback for 0022_remove_site_announcement: recreate the
-- site_popups table (empty — dropped popup content is not restored)
-- and the popup.manage permission with its ADMIN grant, exactly as
-- migration 0019 created them.
CREATE TABLE `site_popups` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`heading` varchar(160) NOT NULL,
	`message` varchar(2000) NOT NULL,
	`image_media_id` bigint unsigned,
	`button_label` varchar(80),
	`link_url` varchar(500),
	`is_active` boolean NOT NULL DEFAULT false,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` bigint unsigned,
	`updated_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_popups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `site_popups` ADD CONSTRAINT `fk_popups_image` FOREIGN KEY (`image_media_id`) REFERENCES `media_assets`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `site_popups` ADD CONSTRAINT `fk_popups_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `site_popups` ADD CONSTRAINT `fk_popups_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `idx_popups_active` ON `site_popups` (`is_active`);
--> statement-breakpoint
ALTER TABLE `site_popups` ADD COLUMN `active_slot` tinyint GENERATED ALWAYS AS (CASE WHEN `is_active` = 1 THEN 1 ELSE NULL END) PERSISTENT;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_popups_active_slot` ON `site_popups` (`active_slot`);
--> statement-breakpoint
INSERT IGNORE INTO `permissions` (`code`, `description`) VALUES ('popup.manage', 'Manage the website announcement popup');
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p
WHERE r.`code` = 'ADMIN' AND p.`code` = 'popup.manage';
