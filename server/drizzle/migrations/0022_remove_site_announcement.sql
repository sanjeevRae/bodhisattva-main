-- 0022_remove_site_announcement (2026-11-20)
-- Owner instruction: remove the Site Announcement feature (added in
-- 0019) and its related elements entirely — the admin screen, the
-- public home-page popup, the API, the permission and the table.
-- Audit-log rows that mention popup.* actions are history and stay.
DELETE FROM `role_permissions`
WHERE `permission_id` = (SELECT `id` FROM `permissions` WHERE `code` = 'popup.manage');
--> statement-breakpoint
DELETE FROM `permissions` WHERE `code` = 'popup.manage';
--> statement-breakpoint
DROP TABLE IF EXISTS `site_popups`;
