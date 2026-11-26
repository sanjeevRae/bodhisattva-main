-- 0026_admin_order_permissions (2026-11-26)
-- Owner decision 2026-11-26: Admins run Gift Shop order statuses from
-- the Orders list (inline status dropdown) alongside Super Admin and
-- Store Admin. Grants the ADMIN role the four order permissions —
-- store.orders.read / .approve / .cancel / .update — and nothing else:
-- products, inventory, invoices and reports stay STORE_ADMIN-only.
-- Idempotent INSERT IGNORE in the 0020/0021 pattern, so re-running is
-- safe. SUPER_ADMIN needs no rows (its access is resolved to the full
-- catalogue at runtime). Fresh databases receive the same grants from
-- the seed matrix (seed-data/permissions.ts); PERMISSIONS.md records
-- the decision as the second ADMIN store carve-out (after store
-- settings, 2026-11-20).
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p
WHERE r.`code` = 'ADMIN'
  AND p.`code` IN ('store.orders.read', 'store.orders.approve', 'store.orders.cancel', 'store.orders.update');
