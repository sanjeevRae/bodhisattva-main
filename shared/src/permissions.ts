/**
 * Permission catalogue — the single source of truth for permission strings,
 * shared by the backend authorization middleware and the frontend menu
 * filtering (ARCHITECTURE.md §6.4, PERMISSIONS.md §4).
 *
 * Format: `module.resource.action` (lowercase, dot-separated).
 * Permissions ending in `.manage` are coarse bundles that include read
 * access to that domain. `account.*` permissions are self-service and are
 * always additionally scoped by ownership (PERMISSIONS.md §6).
 *
 * Frontend visibility is NOT authorization: the API checks these strings
 * server-side on every protected endpoint (PERMISSIONS.md §1).
 */
export const PERMISSIONS = [
  // Self-service (account) — PERMISSIONS.md §4.1
  "account.profile.read",
  "account.profile.update",
  "account.addresses.manage",
  "account.orders.read",
  "account.invoices.read",
  "account.security.manage",

  // CMS — pages and sections — PERMISSIONS.md §4.2
  "cms.pages.read",
  "cms.pages.create",
  "cms.pages.update",
  "cms.pages.publish",
  "cms.pages.delete",
  "cms.pages.restore",
  "cms.sections.create",
  "cms.sections.update",
  "cms.sections.delete",
  "cms.sections.reorder",
  "cms.menus.manage",

  // Media library — PERMISSIONS.md §4.3
  "media.read",
  "media.create",
  "media.update",
  "media.delete",

  // Museum and editorial content — PERMISSIONS.md §4.4
  "museum.collections.manage",
  "museum.exhibitions.manage",
  "museum.gallery.manage",
  "news.manage",
  "foundation.manage",
  "policy.manage",
  "contact.read",
  "contact.manage",

  // Store — PERMISSIONS.md §4.5
  "store.products.manage",
  "store.categories.manage",
  "store.inventory.manage",
  "store.orders.read",
  "store.orders.approve",
  "store.orders.cancel",
  "store.orders.update",
  "store.invoices.manage",
  "store.invoices.resend",
  "store.invoice_templates.manage",
  "store.reports.read",
  "store.settings.manage",

  // Administration and system — PERMISSIONS.md §4.6
  "users.read",
  "users.manage",
  "roles.read",
  "roles.manage",
  "invitations.create",
  "invitations.read",
  "invitations.revoke",
  "audit.read",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Role names (PERMISSIONS.md §2). Roles are named bundles of permissions
 * stored in `role_permissions`; business code must gate on permissions,
 * never on role names. The role → permission matrix lives in PERMISSIONS.md
 * §5 and is seeded as data in Phase 2.
 */
export const ROLES = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN", "CUSTOMER"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
