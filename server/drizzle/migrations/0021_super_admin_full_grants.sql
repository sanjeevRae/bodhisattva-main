-- 0021_super_admin_full_grants (2026-11-20)
-- Repair: SUPER_ADMIN is documented to hold the full permission
-- catalogue (PERMISSIONS.md §2/§5), and the seed grants it every
-- permission that exists at seed time. But permissions introduced
-- by later migrations reached existing databases only through those
-- migrations' own grants — and 0018 (store.settings.manage), 0019
-- (popup.manage) and 0020 (policy.manage) granted ADMIN alone. On
-- any database seeded before those features, the Super Admin had
-- no access to them (owner report: Website Popup visible to Admin,
-- not to Super Admin).
--
-- This blanket INSERT IGNORE restores the seed invariant in the
-- ROWS, for every permission now in the catalogue. Runtime
-- resolution no longer depends on these rows for SUPER_ADMIN
-- (services/permissions.ts resolves the full catalogue for that
-- role), but row-based readers (GET /roles) should show the truth.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`code` = 'SUPER_ADMIN';
