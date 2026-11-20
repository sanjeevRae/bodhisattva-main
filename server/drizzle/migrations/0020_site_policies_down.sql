-- Rollback for 0020_site_policies: remove the ADMIN grant and the
-- policy.manage permission, then drop the revisions table and the
-- policies table (revisions first: it references policies).
DELETE FROM `role_permissions`
WHERE `permission_id` IN (SELECT `id` FROM `permissions` WHERE `code` = 'policy.manage');
--> statement-breakpoint
DELETE FROM `permissions` WHERE `code` = 'policy.manage';
--> statement-breakpoint
DROP TABLE `site_policy_revisions`;
--> statement-breakpoint
DROP TABLE `site_policies`;
