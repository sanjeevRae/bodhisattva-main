import {
  PERMISSIONS,
  type Permission,
  type Role,
} from '@bodhisattva/shared/permissions';

/**
 * Role & permission seed data — the PERMISSIONS.md §2 roles, §4 catalogue and
 * §5 role × permission matrix as data (DATABASE_DESIGN.md §13.2–13.3).
 *
 * This file is the deployment source for the `roles`, `permissions` and
 * `role_permissions` tables; the database is the runtime source the
 * authorization middleware checks. Adding a permission = change the shared
 * catalogue + this file + PERMISSIONS.md, never an ad-hoc admin edit (§5.2).
 *
 * Encoding notes:
 *  - The catalogue itself comes from @bodhisattva/shared (single source of
 *    truth). Descriptions are transcribed from PERMISSIONS.md §4; a missing
 *    description is a compile error (Record<Permission, string>).
 *  - `module` is the permission code's first dot-segment (account, cms,
 *    media, museum, news, foundation, contact, store, users, roles,
 *    invitations, audit, settings). §5.2's comment lists only a subset of
 *    these; the first-segment rule covers the whole catalogue consistently.
 *  - Matrix "own" grants (§5) are plain grants here: ownership is enforced
 *    separately in the data layer (PERMISSIONS.md §6), not by the grant.
 *  - Deliberate exclusions (§5 notes): ADMIN gets no store and no
 *    users/roles/invitations/audit/settings permissions; STORE_ADMIN gets no
 *    CMS/museum/news/foundation, no `media.delete`, and no admin permissions;
 *    CUSTOMER gets the six `account.*` self-service permissions only.
 *    `audit.update` / `audit.delete` do not exist for anyone.
 */

export interface RoleSeed {
  code: Role;
  name: string;
  description: string;
}

/** The four system roles (PERMISSIONS.md §2). `is_system` is set by the seed step. */
export const ROLE_SEEDS: readonly RoleSeed[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description:
      'Full system control: administrators, roles, invitations, all content, all store operations, settings, audit logs',
  },
  {
    code: 'ADMIN',
    name: 'Admin',
    description:
      'Website content administration: CMS pages/sections, museum content, news, foundation, media, navigation',
  },
  {
    code: 'STORE_ADMIN',
    name: 'Store Admin',
    description:
      'Store operations only: products, categories, inventory, orders, invoices, invoice templates, store settings',
  },
  {
    code: 'CUSTOMER',
    name: 'Customer',
    description: 'Own profile, addresses, cart, checkout, own orders and invoices',
  },
];

export interface PermissionSeed {
  code: Permission;
  module: string;
  description: string;
}

/** Meanings transcribed from PERMISSIONS.md §4.1–4.6. */
const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  // §4.1 Self-service (account)
  'account.profile.read': 'View own profile',
  'account.profile.update': 'Edit own name/phone; initiate secure email-change process',
  'account.addresses.manage': 'Create/edit/delete own delivery addresses; set default',
  'account.orders.read': 'List and view own orders and order details',
  'account.invoices.read': 'List and download own invoices',
  'account.security.manage': 'Change own password; view and revoke own sessions; manage own MFA (admins)',
  // §4.2 CMS — pages and sections
  'cms.pages.read': 'List/view pages and drafts in the admin',
  'cms.pages.create': 'Create pages',
  'cms.pages.update': 'Edit page metadata, SEO fields, draft content; save drafts',
  'cms.pages.publish': 'Publish/unpublish pages; make a revision live',
  'cms.pages.delete': 'Delete/archive eligible pages',
  'cms.pages.restore': 'View revisions and roll back to a previous revision',
  'cms.sections.create': 'Add sections to a page',
  'cms.sections.update': 'Edit section content/design configuration',
  'cms.sections.delete': 'Delete sections',
  'cms.sections.reorder': 'Drag-and-drop reordering of sections (persisted order)',
  'cms.menus.manage': 'Manage navigation menus, menu items and footer columns',
  // §4.3 Media library
  'media.read': "Browse/search the media library (incl. the editor's image picker)",
  'media.create': 'Upload media (subject to upload security controls)',
  'media.update': 'Rename, alt text, captions, folder/category changes, replacement',
  'media.delete': 'Delete media assets',
  // §4.4 Museum and editorial content
  'museum.collections.manage': 'Create/edit/publish/reorder collections',
  'museum.exhibitions.manage': 'Create/edit/publish exhibitions',
  'museum.gallery.manage': 'Manage gallery items, captions, categories, years, ordering',
  'news.manage': 'Manage news clippings and news categories',
  'foundation.manage': 'Manage foundation programs, impact statistics and testimonials',
  'contact.read': 'View contact-form submissions',
  'contact.manage': 'Mark submissions resolved; delete submissions',
  // §4.5 Store
  'store.products.manage': 'Create/edit/archive products, images, variants, prices, featured flags',
  'store.categories.manage': 'Manage product categories',
  'store.inventory.manage': 'Adjust stock; view inventory movements/stock history',
  'store.orders.read': 'List/view all orders and the customer details needed for fulfilment',
  'store.orders.approve': 'Approve a PENDING_APPROVAL order (triggers invoice creation — idempotent)',
  'store.orders.cancel': 'Cancel an order under the cancellation policy (stock/invoice adjustments)',
  'store.orders.update': 'Advance fulfilment status (APPROVED → PROCESSING → SHIPPED → DELIVERED)',
  'store.invoices.manage': 'View/generate/download invoices; view delivery status',
  'store.invoices.resend': 'Resend / retry an invoice email (never creates a second invoice)',
  'store.invoice_templates.manage': 'Edit invoice template configuration and manage template versions',
  'store.reports.read': 'View store-specific operational reports',
  'store.settings.manage': 'Store-scoped settings only: shipping fee, COD options, VAT rate',
  // §4.6 Administration and system
  'users.read': 'List/view user accounts (admin user management screens)',
  'users.manage': 'Activate/deactivate accounts; revoke sessions; reset MFA via authorized procedure',
  'roles.read': 'View roles and their permission bundles',
  'roles.manage': 'Assign/revoke roles; edit role permission bundles',
  'invitations.create': 'Create administrative invitations (email + role)',
  'invitations.read': 'List invitations and their status',
  'invitations.revoke': 'Revoke a pending invitation',
  'audit.read': 'View and filter audit logs and login activity (Super Admin module)',
  'settings.manage': 'Global site/system settings (site identity, SMTP-related non-secret settings, feature configuration)',
};

/** The full catalogue as seed rows, in shared-catalogue order. */
export const PERMISSION_SEEDS: readonly PermissionSeed[] = PERMISSIONS.map((code) => ({
  code,
  module: code.split('.')[0],
  description: PERMISSION_DESCRIPTIONS[code],
}));

/** Self-service permissions granted to every role ("own" in the §5 matrix). */
const ACCOUNT_PERMISSIONS: readonly Permission[] = [
  'account.profile.read',
  'account.profile.update',
  'account.addresses.manage',
  'account.orders.read',
  'account.invoices.read',
  'account.security.manage',
];

/** ADMIN — 28 grants (§5): account + CMS + media + museum/editorial. No store, no system administration. */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...ACCOUNT_PERMISSIONS,
  // Store *settings* only (shipping fee, VAT rate, COD toggle) — the
  // owner asked Admins to manage these (2026-11-20); the rest of the
  // store domain stays STORE_ADMIN-only.
  'store.settings.manage',
  'cms.pages.read',
  'cms.pages.create',
  'cms.pages.update',
  'cms.pages.publish',
  'cms.pages.delete',
  'cms.pages.restore',
  'cms.sections.create',
  'cms.sections.update',
  'cms.sections.delete',
  'cms.sections.reorder',
  'cms.menus.manage',
  'media.read',
  'media.create',
  'media.update',
  'media.delete',
  'museum.collections.manage',
  'museum.exhibitions.manage',
  'museum.gallery.manage',
  'news.manage',
  'foundation.manage',
  'contact.read',
  'contact.manage',
];

/**
 * STORE_ADMIN — 21 grants (§5): account + product-scoped media (read/create/
 * update; delete is NOT granted) + the full store domain. No CMS/museum.
 */
const STORE_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...ACCOUNT_PERMISSIONS,
  'media.read',
  'media.create',
  'media.update',
  'store.products.manage',
  'store.categories.manage',
  'store.inventory.manage',
  'store.orders.read',
  'store.orders.approve',
  'store.orders.cancel',
  'store.orders.update',
  'store.invoices.manage',
  'store.invoices.resend',
  'store.invoice_templates.manage',
  'store.reports.read',
  'store.settings.manage',
];

/** The §5 matrix: role → granted permissions. SUPER_ADMIN holds the full catalogue. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  STORE_ADMIN: STORE_ADMIN_PERMISSIONS,
  CUSTOMER: ACCOUNT_PERMISSIONS,
};
