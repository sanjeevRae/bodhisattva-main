-- 0027_store_reports_permissions (2026-11-27)
-- Owner decision 2026-11-27: the new Store insights dashboard is
-- available to Admin, Super Admin and Store Admin, including its
-- CSV/Excel downloads. Adds the store.reports.export catalogue row
-- (new permission — the permissions table must carry it or the boot
-- parity check refuses to start), grants ADMIN store.reports.read +
-- store.reports.export, and grants STORE_ADMIN store.reports.export
-- (it already held reports.read). Products, inventory and invoices
-- stay STORE_ADMIN-only; audit.read is untouched (Super Admin only).
-- Idempotent INSERT IGNORE in the 0019/0026 pattern. SUPER_ADMIN
-- needs no grant rows (runtime-resolved to the full catalogue).
-- Fresh databases receive the same state from the seed matrix
-- (seed-data/permissions.ts); PERMISSIONS.md records the decision
-- as the third ADMIN store carve-out.
INSERT IGNORE INTO `permissions` (`code`, `description`) VALUES ('store.reports.export', 'Download store insight reports as CSV/Excel files');
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p
WHERE r.`code` = 'ADMIN'
  AND p.`code` IN ('store.reports.read', 'store.reports.export');
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p
WHERE r.`code` = 'STORE_ADMIN'
  AND p.`code` = 'store.reports.export';
