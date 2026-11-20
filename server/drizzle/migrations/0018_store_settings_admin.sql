-- 0018_store_settings_admin (2026-11-20)
-- Owner requirement: Admins (not only Super Admin / Store Admin) must
-- be able to set the shop's shipping fee and VAT rate, and the
-- settings must provably exist in every database.
--  1. Grant store.settings.manage to the ADMIN role (idempotent —
--     role_permissions has a composite PK, so INSERT IGNORE is a
--     no-op where the grant already exists, e.g. fresh seeds).
--  2. Guarantee the three store.* settings rows exist with their
--     placeholder defaults, WITHOUT overwriting values a shop has
--     already configured (INSERT IGNORE).
--  3. Refresh the permission's description to the VAT wording.
-- Seed parity: seed-data/permissions.ts (ADMIN_PERMISSIONS) and
-- seed.ts (store settings block).

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p
WHERE r.`code` = 'ADMIN' AND p.`code` = 'store.settings.manage';
--> statement-breakpoint
INSERT IGNORE INTO `site_settings` (`setting_key`, `setting_value`, `is_public`) VALUES ('store.shipping_flat_fee', '"0.00"', 0);
--> statement-breakpoint
INSERT IGNORE INTO `site_settings` (`setting_key`, `setting_value`, `is_public`) VALUES ('store.tax_rate_percent', '"0"', 0);
--> statement-breakpoint
INSERT IGNORE INTO `site_settings` (`setting_key`, `setting_value`, `is_public`) VALUES ('store.cod_enabled', '"true"', 0);
--> statement-breakpoint
UPDATE `permissions` SET `description` = 'Store-scoped settings only: shipping fee, COD options, VAT rate' WHERE `code` = 'store.settings.manage';
