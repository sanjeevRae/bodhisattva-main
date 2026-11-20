-- Rollback for 0021_super_admin_full_grants: remove the SUPER_ADMIN
-- grants for the three migration-era permissions 0021 repaired
-- (0018 store.settings.manage, 0019 popup.manage, 0020
-- policy.manage). Grants for older permissions predate 0021 (the
-- seed created them) and are left alone.
DELETE rp FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN `permissions` p ON p.`id` = rp.`permission_id`
WHERE r.`code` = 'SUPER_ADMIN'
  AND p.`code` IN ('store.settings.manage', 'popup.manage', 'policy.manage');
