-- Down for 0019_site_popups: remove the ADMIN grant and the
-- permission, then drop the table (the generated column and unique
-- index go with it).
DELETE rp FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN `permissions` p ON p.`id` = rp.`permission_id`
WHERE r.`code` = 'ADMIN' AND p.`code` = 'popup.manage';
--> statement-breakpoint
DELETE FROM `permissions` WHERE `code` = 'popup.manage';
--> statement-breakpoint
DROP TABLE `site_popups`;
