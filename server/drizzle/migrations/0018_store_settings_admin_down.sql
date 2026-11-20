-- Down for 0018_store_settings_admin: revoke the ADMIN grant and
-- restore the old description wording. The settings rows are NOT
-- removed: they are store infrastructure, and deleting them could
-- erase values the shop configured after this migration ran.

DELETE rp FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN `permissions` p ON p.`id` = rp.`permission_id`
WHERE r.`code` = 'ADMIN' AND p.`code` = 'store.settings.manage';
--> statement-breakpoint
UPDATE `permissions` SET `description` = 'Store-scoped settings only: shipping fee, COD options, tax toggles' WHERE `code` = 'store.settings.manage';
