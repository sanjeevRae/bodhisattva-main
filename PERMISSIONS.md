# PERMISSIONS.md — Role-Based Access Control & Permission Matrix

**Project:** Bodhisattva Museum — Dynamic Website + Visual CMS + Ecommerce + Secure Administration
**Phase:** 0 — Audit and Planning (design deliverable)
**Status:** ⚠️ **DESIGNED, NOT YET IMPLEMENTED.** As of this writing the repository contains only the
public frontend (React + Vite). No backend, database, authentication or authorization code exists yet.
Everything in this document is the agreed design contract for Phase 2 (Authentication and RBAC) and all
later phases. Nothing here should be read as a claim that a control is already in place.
**Governing spec:** Master Project Specification, Parts 7, 8, 9, 14, 15 and 17.
**Companion document:** `SECURITY_THREAT_MODEL.md`.

---

## 1. Authorization principles

1. **Server-side enforcement only.** Every protected API endpoint independently verifies the
   requesting user's permissions on the server. The frontend never authorizes anything.
2. **Frontend menu visibility is NOT authorization.** Admin navigation is role-aware purely as a
   usability aid (spec §9.5, Part 18). A hidden button, route or menu item provides zero security:
   an attacker can call any API endpoint directly. Any endpoint that is "protected" only by not being
   linked in the UI is considered **unprotected** and is a defect.
3. **Deny by default.** A request is allowed only when an explicit permission grant matches it.
   Routes must declare their required permission at registration time; a route with no declared
   permission must not be reachable in a production build. New endpoints added without a permission
   mapping fail review.
4. **Centralized permission middleware.** Authorization decisions are made by one middleware
   (`requirePermission('module.resource.action')`) plus one ownership guard for customer resources —
   never by ad-hoc role checks scattered through controllers, and never by checks in React components.
5. **Permissions, not roles, gate endpoints.** Endpoints require *permissions*. Roles are simply
   named bundles of permissions stored in `role_permissions`. Business code must not contain
   `if (role === 'ADMIN')` logic.
6. **Ownership is a second, independent check.** For customer resources, holding the right
   *kind* of access is not enough: the specific record must belong to the requesting user
   (see §6). This is the primary defence against IDOR / broken object-level authorization
   (OWASP API1:2023).
7. **Least privilege.** Each role receives only the permissions its job requires (spec §9.1–9.4).
   Cross-domain access (e.g. a Store Admin editing CMS pages) is never granted implicitly.
8. **Every denial is auditable.** Permission failures (HTTP 403) and authentication failures
   (HTTP 401) on protected endpoints are written to the audit log (spec Part 14 explicitly lists
   "Permission failures" as an audited event).
9. **Multiple roles per user.** A user may hold several roles (`user_roles`). Effective permissions
   are the **union** of all held roles' permissions. The CUSTOMER role is granted automatically on
   completed (email-verified) registration; administrative roles are granted **only** through the
   invitation system (Part 8) — never through public registration and never by direct database
   convenience scripts outside the audited admin API / bootstrap CLI.

## 2. Roles

| Role | How the account is created | MFA | Purpose |
|---|---|---|---|
| `SUPER_ADMIN` | One-time protected CLI bootstrap for the first account; thereafter only by invitation from an existing Super Admin | **Required (TOTP)** | Full system control: administrators, roles, invitations, all content, all store operations, settings, audit logs |
| `ADMIN` | Invitation only (created by Super Admin) | **Required (TOTP)** | Website content administration: CMS pages/sections, museum content, news, foundation, media, navigation |
| `STORE_ADMIN` | Invitation only (created by Super Admin) | **Required (TOTP)** | Store operations only: products, categories, inventory, orders, invoices, invoice templates, store settings |
| `CUSTOMER` | Public registration **with mandatory email verification** (spec §7.1) | Not required (see §7) | Own profile, addresses, cart, checkout, own orders and invoices |

**SUPER_ADMIN's full-catalogue access is enforced at resolution time**
(`server/src/services/permissions.ts`): a Super Admin's effective set is
the whole catalogue, whatever the `role_permissions` rows say. The seed
also grants the rows, and migration 0021 repaired them on older
databases — but the rows are not the mechanism. (Before 2026-11-20 the
rows WERE the only mechanism, and permissions added by migrations
0018–0020, granted to ADMIN alone, silently locked Super Admins on
previously-seeded databases out of those features.)

There is deliberately **no** public administrator registration endpoint, and no permission that
allows creating a Super Admin through the ordinary user-management API — role assignment is itself
permission-gated (`roles.manage`, Super Admin only) and audited.

## 3. Permission naming convention

Format: `module.resource.action` (lowercase, dot-separated), following spec §9.5.

- Permissions ending in **`.manage`** are coarse-grained bundles for a self-contained content domain
  (e.g. `museum.collections.manage`) and **include read access** to that domain's admin screens.
- Page/section editing uses **granular** permissions because the visual builder separates creating,
  editing, reordering and publishing into distinct, separately auditable actions.
- **`account.*`** permissions are *self-service* capabilities. They are always additionally scoped
  by ownership (§6): `account.orders.read` means "read **my own** orders", never anyone else's.
- There is intentionally **no** `audit.update` or `audit.delete` permission for any role, including
  Super Admin. Audit records are append-only through ordinary APIs (spec Part 14).

## 4. Permission catalogue

### 4.1 Self-service (account)

| Permission | Meaning |
|---|---|
| `account.profile.read` | View own profile |
| `account.profile.update` | Edit own name/phone; initiate secure email-change process |
| `account.addresses.manage` | Create/edit/delete own delivery addresses; set default |
| `account.orders.read` | List and view **own** orders and order details |
| `account.invoices.read` | List and download **own** invoices |
| `account.security.manage` | Change own password; view and revoke own sessions; manage own MFA (admins) |

### 4.2 CMS — pages and sections

| Permission | Meaning |
|---|---|
| `cms.pages.read` | List/view pages and drafts in the admin |
| `cms.pages.create` | Create pages |
| `cms.pages.update` | Edit page metadata, SEO fields, draft content; save drafts |
| `cms.pages.publish` | Publish/unpublish pages; make a revision live |
| `cms.pages.delete` | Delete/archive eligible pages |
| `cms.pages.restore` | View revisions and roll back to a previous revision |
| `cms.sections.create` | Add sections to a page |
| `cms.sections.update` | Edit section content/design configuration |
| `cms.sections.delete` | Delete sections |
| `cms.sections.reorder` | Drag-and-drop reordering of sections (persisted order) |
| `cms.menus.manage` | Manage navigation menus, menu items and footer columns |

### 4.3 Media library

| Permission | Meaning |
|---|---|
| `media.read` | Browse/search the media library (incl. the editor's image picker) |
| `media.create` | Upload media (subject to upload security controls, see threat model) |
| `media.update` | Rename, alt text, captions, folder/category changes, replacement |
| `media.delete` | Delete media assets |

*Scoping note:* STORE_ADMIN's media permissions exist to manage **product imagery**. Enforcement is
by media folder/category: the API must reject Store Admin access to CMS-only media folders even
though the permission string matches. This scoping rule must be covered by an authorization test.

### 4.4 Museum and editorial content

| Permission | Meaning |
|---|---|
| `museum.collections.manage` | Create/edit/publish/reorder collections |
| `museum.exhibitions.manage` | Create/edit/publish exhibitions |
| `museum.gallery.manage` | Manage gallery items, captions, categories, years, ordering |
| `news.manage` | Manage news clippings and news categories |
| `foundation.manage` | Manage foundation programs, impact statistics and testimonials |
| `policy.manage` | Manage the legal policy pages (privacy, terms, accessibility) |
| `contact.read` | View contact-form submissions |
| `contact.manage` | Mark submissions resolved; delete submissions |

### 4.5 Store

| Permission | Meaning |
|---|---|
| `store.products.manage` | Create/edit/archive products, images, variants, prices, featured flags |
| `store.categories.manage` | Manage product categories |
| `store.inventory.manage` | Adjust stock; view inventory movements/stock history |
| `store.orders.read` | List/view all orders and the customer details needed for fulfilment |
| `store.orders.approve` | Approve a `PENDING_APPROVAL` order (triggers invoice creation — idempotent) |
| `store.orders.cancel` | Cancel an order under the cancellation policy (stock/invoice adjustments) |
| `store.orders.update` | Advance fulfilment status (`APPROVED → PROCESSING → SHIPPED → DELIVERED`) |
| `store.invoices.manage` | View/generate/download invoices; view delivery status |
| `store.invoices.resend` | Resend / retry an invoice email (never creates a second invoice) |
| `store.invoice_templates.manage` | Edit invoice template configuration and manage template versions |
| `store.reports.read` | View store-specific operational reports |
| `store.settings.manage` | Store-scoped settings only: shipping fee, COD options, tax toggles |

### 4.6 Administration and system

| Permission | Meaning |
|---|---|
| `users.read` | List/view user accounts (admin user management screens) |
| `users.manage` | Activate/deactivate accounts; revoke sessions; reset MFA via authorized procedure |
| `roles.read` | View roles and their permission bundles |
| `roles.manage` | Assign/revoke roles; edit role permission bundles |
| `invitations.create` | Create administrative invitations (email + role) |
| `invitations.read` | List invitations and their status |
| `invitations.revoke` | Revoke a pending invitation |
| `audit.read` | View and filter audit logs and login activity (Super Admin module) |
| `settings.manage` | Global site/system settings (site identity, SMTP-related non-secret settings, feature configuration) |

## 5. Role × permission matrix

Legend: **✓** granted · **—** denied · **own** granted, restricted to the user's own records (§6).
A "—" is enforced by the API regardless of what any UI shows.

| Permission | SUPER_ADMIN | ADMIN | STORE_ADMIN | CUSTOMER |
|---|:---:|:---:|:---:|:---:|
| `account.profile.read` | own | own | own | own |
| `account.profile.update` | own | own | own | own |
| `account.addresses.manage` | own | own | own | own |
| `account.orders.read` | own | own | own | own |
| `account.invoices.read` | own | own | own | own |
| `account.security.manage` | own | own | own | own |
| `cms.pages.read` | ✓ | ✓ | — | — |
| `cms.pages.create` | ✓ | ✓ | — | — |
| `cms.pages.update` | ✓ | ✓ | — | — |
| `cms.pages.publish` | ✓ | ✓ | — | — |
| `cms.pages.delete` | ✓ | ✓ | — | — |
| `cms.pages.restore` | ✓ | ✓ | — | — |
| `cms.sections.create` | ✓ | ✓ | — | — |
| `cms.sections.update` | ✓ | ✓ | — | — |
| `cms.sections.delete` | ✓ | ✓ | — | — |
| `cms.sections.reorder` | ✓ | ✓ | — | — |
| `cms.menus.manage` | ✓ | ✓ | — | — |
| `media.read` | ✓ | ✓ | ✓ (product media) | — |
| `media.create` | ✓ | ✓ | ✓ (product media) | — |
| `media.update` | ✓ | ✓ | ✓ (product media) | — |
| `media.delete` | ✓ | ✓ | — | — |
| `museum.collections.manage` | ✓ | ✓ | — | — |
| `museum.exhibitions.manage` | ✓ | ✓ | — | — |
| `museum.gallery.manage` | ✓ | ✓ | — | — |
| `news.manage` | ✓ | ✓ | — | — |
| `foundation.manage` | ✓ | ✓ | — | — |
| `policy.manage` | ✓ | ✓ | — | — |
| `contact.read` | ✓ | ✓ | — | — |
| `contact.manage` | ✓ | ✓ | — | — |
| `store.products.manage` | ✓ | — | ✓ | — |
| `store.categories.manage` | ✓ | — | ✓ | — |
| `store.inventory.manage` | ✓ | — | ✓ | — |
| `store.orders.read` | ✓ | — | ✓ | — |
| `store.orders.approve` | ✓ | — | ✓ | — |
| `store.orders.cancel` | ✓ | — | ✓ | — |
| `store.orders.update` | ✓ | — | ✓ | — |
| `store.invoices.manage` | ✓ | — | ✓ | — |
| `store.invoices.resend` | ✓ | — | ✓ | — |
| `store.invoice_templates.manage` | ✓ | — | ✓ | — |
| `store.reports.read` | ✓ | — | ✓ | — |
| `store.settings.manage` | ✓ | — | ✓ | — |
| `users.read` | ✓ | — | — | — |
| `users.manage` | ✓ | — | — | — |
| `roles.read` | ✓ | — | — | — |
| `roles.manage` | ✓ | — | — | — |
| `invitations.create` | ✓ | — | — | — |
| `invitations.read` | ✓ | — | — | — |
| `invitations.revoke` | ✓ | — | — | — |
| `audit.read` | ✓ | — | — | — |
| `settings.manage` | ✓ | — | — | — |

**Notes on deliberate exclusions (from spec §9.2–9.3):**

- **ADMIN has no store permissions by default.** Spec §9.2: an Admin "cannot manage store operations
  unless separately granted." If Meena later wants a specific Admin to run the shop, the correct
  mechanism is to *also* assign that user the STORE_ADMIN role (union of permissions), not to widen
  the ADMIN role for everyone.
- **STORE_ADMIN has no CMS/museum/news/foundation permissions and no `audit.read`.** Spec §9.3:
  a Store Admin "cannot edit website CMS pages, publish museum content, manage administrator roles,
  access Super Admin configuration, or view full system audit logs." Their view of customer data is
  limited to what `store.orders.read` returns for fulfilment — they do **not** get `users.read`.
- **ADMIN has no user/role/invitation/audit/settings permissions.** Spec §9.2: an Admin "cannot
  manage administrator accounts, assign roles, or access full Super Admin audit logs." The spec's
  phrase "manage website settings explicitly granted to this role" is implemented as follows:
  individual, named site-content settings (e.g. opening hours shown on the About page) live in the
  CMS as content and are editable via CMS permissions; the global `settings.manage` permission
  itself remains Super Admin only. Any exception must be a new, narrowly named permission granted
  explicitly — never a silent widening of ADMIN.
- **CUSTOMER has no administrative permissions at all**, and public (unauthenticated) read access to
  *published* pages and *enabled* products is not a permission — it is the public API surface, which
  must only ever expose published/enabled data (see threat model, draft-content leakage).

## 6. Ownership rules for customer resources

Holding a session is never sufficient for customer-scoped endpoints. For every request the server
must verify that the target record belongs to the authenticated user, in the data layer (query
scoped by `user_id`), not by fetching-then-comparing in controller code where it can be forgotten.

| Resource | Rule |
|---|---|
| Profile | A user can read/update only their own row in `users`. Email change requires the secure re-verification flow, not a plain field update. |
| Addresses (`customer_addresses`) | All CRUD scoped by `user_id = session.userId`. Another user's address ID returns **404** (not 403 — do not confirm the record exists). |
| Cart / cart items (`carts`, `cart_items`) | Cart is resolved from the session, never from a client-supplied cart ID. Item updates/deletes must join through the owner's cart. |
| Orders (`orders`, `order_items`) | Customer reads filter by `user_id`. Order detail for another customer's order returns 404. Admin access uses the separate `store.orders.*` endpoints — the customer endpoint must never "fall through" to admin behaviour. |
| Invoices | Customer download requires: invoice exists **and** its order belongs to the requester. PDFs are served only through this authorized endpoint — never via a direct/static file URL. |
| Sessions | A user can list/revoke only their own sessions (`account.security.manage`). Revoking *another* user's sessions requires `users.manage` (Super Admin). |
| Password / MFA | Password change and MFA enrolment/reset act only on the caller's own account, except the documented Super Admin MFA-reset procedure (`users.manage`), which is audited and never reveals the existing secret. |

Additional rules:

- **IDs are not authorization.** Sequential IDs are acceptable internally only because ownership
  and permission checks are mandatory on every access. Where feasible, public-facing order/invoice
  references use non-sequential public identifiers in addition to internal IDs.
- **Mass-assignment protection.** Request bodies are parsed through allow-listed schemas (Zod).
  Fields such as `user_id`, `role`, `status`, `price` or `total` in a client payload are ignored or
  rejected — never trusted (OWASP API3:2023). Prices and totals are always recomputed server-side
  from database records (spec §10.3–10.4).
- **Consistent failure shape.** Cross-owner access returns the same response as a non-existent
  record, to avoid account/record enumeration.

## 7. MFA requirements by role

| Role | TOTP MFA | Notes |
|---|---|---|
| `SUPER_ADMIN` | **Required** | Enrolment is part of invitation acceptance / bootstrap. Login is not complete until MFA passes; the resulting session is flagged `mfa_verified`. |
| `ADMIN` | **Required** | As above (spec §8.2). |
| `STORE_ADMIN` | **Required** | As above (spec §8.2). |
| `CUSTOMER` | Not required | Optional customer TOTP is **out of scope** for the initial build unless Meena approves it (see open decisions in `SECURITY_THREAT_MODEL.md`). |

Enforcement rules:

- A session belonging to an MFA-required role that has not completed MFA is a **limited session**:
  it may only reach the MFA enrolment/verification endpoints. All `/api/admin/*` endpoints require
  `mfa_verified = true` for these roles, checked in middleware — not per-controller.
- MFA secrets and recovery codes are never returned by any API after enrolment, never logged, and
  are stored per the threat model (encrypted TOTP secrets; hashed recovery codes).
- **Step-up rule (designed):** especially sensitive actions — creating invitations, assigning roles
  (`roles.manage`), changing global settings, and resetting another admin's MFA — require an MFA
  verification within the current session (re-authentication if the last MFA check is stale).
  The staleness window is a configuration value (proposed: 15 minutes; see open decisions).

## 8. Permission gating by API route family (spec Part 17)

Authentication state key: **Public** = no session · **Session** = any authenticated session ·
**Perm** = session + named permission (+ MFA-verified session for all `/api/admin/*`).

| Route family | Gate | Notes |
|---|---|---|
| `POST /api/auth/register` | Public + rate limit | Creates an *unverified* account only; confers no access until email verification (spec §7.1). |
| `POST /api/auth/verify-email` | Public + rate limit + code checks | Single-use, attempt-limited, HMAC-stored code. |
| `POST /api/auth/resend-code` | Public + rate limit + cooldown | Generic responses (no account enumeration). |
| `POST /api/auth/login` | Public + rate limit | Generic failure messages; admin accounts additionally require MFA step before full session. |
| `POST /api/auth/logout` | Session | Revokes the current server-side session. |
| `GET /api/auth/session` | Session | Returns own identity/roles/permissions for UI rendering only. |
| `POST /api/auth/forgot-password` / `reset-password` | Public + rate limit | Hashed, expiring, single-use tokens; reset revokes existing sessions. |
| `GET/PATCH /api/account/profile` | Session + `account.profile.*` + ownership | Own record only. |
| `/api/account/addresses*` | Session + `account.addresses.manage` + ownership | 404 on cross-owner access. |
| `GET /api/account/orders`, `/api/account/orders/:id` | Session + `account.orders.read` + ownership | Never exposes other customers' orders. |
| `GET /api/account/invoices` (+ download) | Session + `account.invoices.read` + ownership | Authorized streaming download; no static PDF URLs. |
| `GET /api/pages/:slug` | Public | **Published revision only.** Drafts are never reachable here. |
| `GET /api/admin/pages` · `POST /api/admin/pages` | Perm `cms.pages.read` / `cms.pages.create` | |
| `PATCH /api/admin/pages/:id` | Perm `cms.pages.update` | Optimistic-concurrency version check required (spec §5.4). |
| `DELETE /api/admin/pages/:id` | Perm `cms.pages.delete` | Reserved system routes cannot be deleted/overwritten (spec §5.1). |
| `POST /api/admin/pages/:id/publish` | Perm `cms.pages.publish` | Publication is a separate permission from editing — an editor who can save drafts cannot necessarily go live. |
| `POST /api/admin/pages/:id/preview` | Perm `cms.pages.read` | Preview tokens are signed, short-lived, and bound to the requesting admin. |
| `GET /api/admin/pages/:id/revisions` · `POST .../restore` | Perm `cms.pages.restore` | Restore creates a new revision; history is never rewritten. |
| `POST /api/admin/pages/:id/sections` | Perm `cms.sections.create` | Section config validated against the section registry schema before save. |
| `PATCH /api/admin/sections/:id` | Perm `cms.sections.update` | |
| `DELETE /api/admin/sections/:id` | Perm `cms.sections.delete` | |
| `PATCH /api/admin/pages/:id/sections/reorder` | Perm `cms.sections.reorder` | Order persisted transactionally. |
| `/api/admin/media*` | Perm `media.*` per method | Store Admin scoped to product media (§4.3). |
| Admin museum endpoints (`/api/admin/collections`, `/exhibitions`, `/gallery`, `/news`, `/foundation`) | Perm `museum.*.manage` / `news.manage` / `foundation.manage` | Route families implied by spec Part 6; same pattern as CMS. |
| `GET /api/products`, `GET /api/products/:slug` | Public | Enabled products only; no cost/internal fields. |
| `/api/admin/products*` | Perm `store.products.manage` | Products with order history are archived, never hard-deleted. |
| `/api/cart*` | Session + CUSTOMER capability (`account.*` scope) | Cart resolved from session; login-gated add-to-cart flow per spec §10.3. Prices revalidated server-side on every mutation. |
| `POST /api/checkout` | Session + ownership | Server recomputes all amounts; transactional order + stock handling (see threat model). |
| `GET /api/admin/orders`, `/api/admin/orders/:id` | Perm `store.orders.read` | |
| `POST /api/admin/orders/:id/approve` | Perm `store.orders.approve` | Idempotent; creates exactly one invoice (unique constraint). |
| `POST /api/admin/orders/:id/cancel` | Perm `store.orders.cancel` | Policy-checked; stock restoration recorded. |
| `POST /api/admin/orders/:id/status` | Perm `store.orders.update` | Only legal lifecycle transitions; every transition written to `order_status_history`. |
| `GET /api/admin/invoices`, `/api/admin/invoices/:id` | Perm `store.invoices.manage` | |
| `GET /api/admin/invoices/:id/download` | Perm `store.invoices.manage` | Authorized streaming; path never client-controlled. |
| `POST /api/admin/invoices/:id/resend` | Perm `store.invoices.resend` | Re-queues the email for the *same* invoice snapshot. |
| `/api/admin/invoice-templates*` | Perm `store.invoice_templates.manage` | Template changes affect future invoices only; versions retained. |
| `GET /api/admin/users` | Perm `users.read` | |
| User mutations (activate/deactivate, session revoke, MFA reset) | Perm `users.manage` | Audited; step-up MFA required (§7). |
| `POST /api/admin/invitations` | Perm `invitations.create` | Super Admin only in practice (sole holder of the permission). Token hashed at rest; shown/sent once. |
| `GET /api/admin/invitations` | Perm `invitations.read` | Token values are never returned by the API. |
| `POST /api/admin/invitations/:id/revoke` | Perm `invitations.revoke` | |
| `GET /api/admin/audit-logs` | Perm `audit.read` | Read-only; no update/delete endpoints exist. |
| `GET/PATCH /api/admin/settings` | Perm `settings.manage` | Secrets (SMTP password etc.) are write-only via env/config, never returned by the API. |
| `POST /api/contact` (About-page form) | Public + rate limit + spam controls | Submissions readable via `contact.read`. Must not be usable as an email relay (see threat model). |

## 9. Seeding, bootstrap and change control

- Roles and the permission catalogue are **seeded by migration/seed scripts** (`npm run db:seed`,
  spec Part 4) so every environment has identical role definitions. Production is never seeded
  with demonstration accounts (spec Part 4).
- The **first Super Admin** is created only by the one-time CLI bootstrap command (spec §8.1),
  which must refuse to run once a Super Admin exists.
- Changes to `role_permissions` at runtime require `roles.manage`, are written to the audit log
  with before/after values, and take effect for new requests (permission sets are read per-request
  or from a short-lived server-side cache keyed by user — never trusted from the client).
- The frontend may call `GET /api/auth/session` to learn its own permissions **for display
  purposes only**. The API remains the sole enforcement point (§1.2).

## 10. Acceptance tests derived from this matrix (for Phase 2 / Phase 8)

From spec Part 23, each of these must be demonstrated against the API directly (not through the UI):

- Store Admin receives 403 on every CMS page/section endpoint.
- Admin receives 403 on invitation, role-assignment and audit-log endpoints.
- Customer receives 401/403 on every `/api/admin/*` endpoint.
- Customer A receives 404 when requesting Customer B's order, address or invoice by ID.
- An editor with `cms.pages.update` but not `cms.pages.publish` cannot publish.
- An admin session that has not completed MFA cannot reach any `/api/admin/*` endpoint.
- Permission failures above appear in the audit log.

---

*End of PERMISSIONS.md — Phase 0 design document. Implementation begins in Phase 2; this matrix is
the contract those phases are tested against.*
