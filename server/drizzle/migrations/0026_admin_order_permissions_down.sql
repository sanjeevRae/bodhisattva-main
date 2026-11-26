-- Rollback for 0026_admin_order_permissions: remove the four order
-- grants 0026 gave the ADMIN role. (A database rolled back this way
-- also needs the seed matrix reverted, or the next seed restores the
-- grants — the seed inserts any missing matrix rows idempotently.)
DELETE rp FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN `permissions` p ON p.`id` = rp.`permission_id`
WHERE r.`code` = 'ADMIN'
  AND p.`code` IN ('store.orders.read', 'store.orders.approve', 'store.orders.cancel', 'store.orders.update');
