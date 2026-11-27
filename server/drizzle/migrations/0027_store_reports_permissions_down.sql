-- Rollback for 0027_store_reports_permissions: remove the grants
-- 0027 made and the store.reports.export catalogue row it added.
-- (A database rolled back this way also needs the seed matrix
-- reverted, or the next seed restores the grants — the seed inserts
-- any missing matrix rows idempotently. The compiled catalogue in
-- shared/src/permissions.ts must drop the code too, or the boot
-- parity check refuses to start.)
DELETE rp FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN `permissions` p ON p.`id` = rp.`permission_id`
WHERE (r.`code` = 'ADMIN' AND p.`code` IN ('store.reports.read', 'store.reports.export'))
   OR (r.`code` = 'STORE_ADMIN' AND p.`code` = 'store.reports.export');
--> statement-breakpoint
DELETE FROM `permissions` WHERE `code` = 'store.reports.export';
