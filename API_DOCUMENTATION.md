# API Documentation

The Express + TypeScript API in `server/`. In development it listens on
`:4000` and the Vite frontend proxies `/api` to it. All routes below are
under `/api` unless noted. This document describes the API **as built**
(Phases 1–8); nothing here is deployed yet.

## Conventions

- **Auth** is a server-side session cookie (`__Host-session` in
  production, `session` otherwise; HttpOnly, SameSite=Lax). Auth levels:
  `full`, `mfa_pending`, `enrolment_required` — most routes require
  `full`; the MFA routes exist to move a session between levels.
- **CSRF**: state-changing requests with a session must send the
  double-submit token (`csrf` cookie value) as the `X-CSRF-Token`
  header. The token is returned by login and by `GET /api/auth/csrf-token`.
  The pre-session public auth posts (register, verify-email,
  resend-verification, login, password-reset request/confirm,
  invitations/accept) are exempt — they run before a session exists.
  An `Origin` header, when present on a state-changing request, must
  match the CORS allowlist.
- **Permissions**: admin routes name the permission they require
  (49 grantable permissions across 4 roles — SUPER_ADMIN, ADMIN,
  STORE_ADMIN, CUSTOMER; see `PERMISSIONS.md`). "Step-up" routes
  additionally require an MFA verification within the last 15 minutes
  (`POST /api/auth/mfa/step-up`).
- **Success responses** are the resource JSON directly. List endpoints
  return `{ items: [...] }`; paginated lists add
  `meta: { page, pageSize, total, totalPages }` (`?page=` default 1,
  `?pageSize=` default 20, max 100).
- **Errors** use one envelope everywhere:
  `{ "error": { "code", "message", "details"?, "requestId" } }`.
  Unknown errors are hidden behind a generic `INTERNAL` — responses
  never contain stack traces, SQL or file paths.
- **Money** crosses the API as integer paisa in `*Paisa` fields (and as
  DECIMAL strings inside invoice/order snapshots). NPR only.

### Error catalogue (`shared/src/errors.ts`)

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Input failed validation (`details` lists field issues) |
| `UNAUTHENTICATED` | 401 | No/invalid session, or generic login failure |
| `FORBIDDEN` | 403 | Authenticated but not allowed (permission, auth level, CSRF, origin) |
| `NOT_FOUND` | 404 | Missing — also returned for other users' objects (no existence oracle) |
| `CONFLICT` | 409 | State conflict (duplicate slug, optimistic-concurrency version, in-flight email resend…) |
| `PAYLOAD_TOO_LARGE` | 413 | Body or upload over the limit |
| `OTP_EXPIRED` | 400 | Verification code expired |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | Too many wrong verification codes; the code is burned |
| `RATE_LIMITED` | 429 | A rate-limit scope tripped |
| `INSUFFICIENT_STOCK` | 422 | Requested quantity exceeds available stock |
| `INVALID_STATE_TRANSITION` | 422 | Order transition not allowed from the current status |
| `SERVICE_UNAVAILABLE` | 503 | A backing store (e.g. the rate-limit store) is unavailable — the API fails closed |
| `INTERNAL` | 500 | Unexpected error (details never leaked) |

## Health (no auth, not under `/api`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness; never touches the DB |
| GET | `/health/ready` | 200 when the DB answers `SELECT 1`, else 503 envelope |

## Auth — `/api/auth`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | public, CSRF-exempt | Always a generic response. New account starts `PENDING_VERIFICATION` with the CUSTOMER role; an 8-digit email OTP is sent (3/IP/hour) |
| POST | `/verify-email` | public, CSRF-exempt | Consumes the code (single-use); 5 wrong attempts burn it (`OTP_ATTEMPTS_EXCEEDED`) |
| POST | `/resend-verification` | public, CSRF-exempt | Generic response; 60 s cooldown, 3/email/hour |
| POST | `/login` | public, CSRF-exempt | Generic `UNAUTHENTICATED` on any failure. Response carries `csrfToken`. Admins land at `mfa_pending` (MFA enrolled) or `enrolment_required` (not enrolled); customers at `full`. Failure limits: account 5/15 min (admins 3/15 min) AND IP 5/15 min, checked before the password |
| POST | `/password-reset/request` | public, CSRF-exempt | Generic response; token link emailed for ACTIVE accounts (1 h TTL) |
| POST | `/password-reset/confirm` | public, CSRF-exempt | Atomic consume; revokes all sessions. Min password 12 chars for admin-role holders, 10 otherwise |
| GET | `/csrf-token` | session | Fresh CSRF token for the session |
| POST | `/logout` | session | Revokes the current session |
| POST | `/logout-all` | session | Bumps `session_version` and revokes every session |
| GET | `/me` | any level | Current user + auth level |

## MFA — `/api/auth/mfa`, `/api/admin/mfa`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/mfa/enrol` | admin role | Returns the TOTP secret + otpauth URL (shown once) |
| POST | `/api/auth/mfa/confirm` | admin role | Confirms enrolment with a first code |
| POST | `/api/auth/mfa/verify` | `mfa_pending` | Completes login; replay of a used time-step is rejected |
| POST | `/api/auth/mfa/recover` | `mfa_pending` | Login via a one-time recovery code (10 issued at enrolment) |
| POST | `/api/auth/mfa/step-up` | `full`, admin role | Re-verifies MFA for step-up-gated actions; failures limited (5/15 min) |
| POST | `/api/admin/mfa/reset/:userId` | `full` + `users.manage` + step-up | Resets a user's MFA (they re-enrol at next login) |

## Invitations — `/api/admin/invitations`, `/api/auth/invitations`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/admin/invitations` | `full` + `invitations.create` + step-up | Issues a 72 h one-time token (SHA-256 stored); re-issuing revokes predecessors; inviter rank caps the granted role |
| GET | `/api/admin/invitations` | `full` + `invitations.read` | List |
| POST | `/api/admin/invitations/:id/revoke` | `full` + `invitations.revoke` | Revoke |
| POST | `/api/auth/invitations/accept` | public, CSRF-exempt | Creates the account bound to the invitation's email + role; no auto-session (MFA enrolment at first login) |

## Users & roles — `/api/admin`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/roles` | `full` + `roles.read` | Roles with their permission sets (also the admin SPA's permission source) |
| GET | `/users` | `full` + `roles.read` | Paginated user list |
| PUT | `/users/:userId/roles` | `full` + `roles.manage` + step-up | Rank-capped; demoting the last active SUPER_ADMIN is a 409; target's sessions are revoked |

## CMS — public `/api`, admin `/api/admin`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/pages/:slug` | public | Published revision only. Served from the last-good cache (with `X-Content-Source: last-good-cache`) if the DB read fails |
| GET | `/pages/:slug/preview?token=` | public + token | Draft preview; every failure mode is the same 404; `no-store`/`noindex` headers |
| GET | `/menus/:code` | public | Visible items; PAGE links resolved to paths |
| GET | `/site` | public | Public site settings as an object (same last-good fallback) |
| GET | `/pages` | `cms.pages.read` | Admin page list |
| POST | `/pages` | `cms.pages.create` | Slug validated against the shared slug schema + reserved list |
| GET | `/pages/:id` | `cms.pages.read` | Admin view |
| PATCH | `/pages/:id` | `cms.pages.update` | Metadata; system pages' slugs are locked |
| DELETE | `/pages/:id` | `cms.pages.delete` | Soft delete; system pages cannot be deleted |
| GET | `/pages/:id/draft` | `cms.pages.read` | Clone-on-edit draft |
| PUT | `/pages/:id/draft` | `cms.pages.update` | Whole-batch section validation before any write; `revisionId` + `expectedVersion` required (409 on mismatch) |
| POST | `/pages/:id/publish` | `cms.pages.publish` | Re-validates every section inside the pointer-swap transaction |
| POST | `/pages/:id/rollback/:revisionId` | `cms.pages.restore` | Points published at an earlier revision + fresh draft clone |
| GET | `/pages/:id/revisions` | `cms.pages.read` | Revision list |
| POST | `/pages/:id/preview-token` | `cms.pages.read` | 201; 30-minute token bound to page + revision |
| GET | `/menus` | `cms.menus.manage` | All menus with items |
| PUT | `/menus/:code` | `cms.menus.manage` | Replace a menu's items |
| GET | `/settings` | `settings.manage` | All settings |
| PUT | `/settings` | `settings.manage`, or `store.settings.manage` for `store.*` keys only | All-or-nothing per request; changes audited with old/new values |

Section configs are validated against the 22-type registry
(`server/src/modules/cms/registry.ts`) on every save and again at
publish; rich text is sanitized at save (formatting-only allowlist).

## Media — public `/api`, admin `/api/admin`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/media/:id/file/:variant` | public | `variant` ∈ master/thumb/medium; path built only from the stored random name; `Cache-Control: public, max-age=31536000, immutable` |
| POST | `/media` | `media.create` | Multipart field `file`, 10 MiB max. Type is sniffed by Sharp (jpeg/png/webp/gif/avif only); re-encoded with EXIF stripped; 40 MPixel decompression cap |
| GET | `/media` | `media.read` | Paginated; `?search=`, `?folderId=` |
| GET | `/media/folders` · POST `/media/folders` | `media.read` / `media.create` | Folder list / create |
| PATCH · DELETE | `/media/folders/:folderId` | `media.update` / `media.delete` | Move has self-parent + descendant cycle guards |
| PATCH | `/media/:id` | `media.update` | Alt text, caption, folder |
| DELETE | `/media/:id` | `media.delete` | Soft delete; **409 while any content references the asset** (page og-image, section configs, museum covers, product images) |

## Museum modules — public `/api`, admin `/api/admin`

Public (published + non-deleted only): `GET /collections`,
`GET /exhibitions`, `GET /news` (`?search=` full-text with LIKE
fallback, `?category=<slug>`; News Clippings adds `publication`,
`year`, `dateFrom`, `dateTo`, `type`, `hasPdf`, `featured`,
`sort=newest|oldest|added|alpha`, and `page`/`pageSize` — the
pagination `meta` is emitted only when `page` is supplied, the
legacy `{categories, items}` shape otherwise), `GET /news/facets`,
`GET /news/:slug` (detail + related; increments `view_count`),
`GET /news/:slug/attachments`, `GET /news/:slug/pdf/view` and
`/pdf/download` (published + ACTIVE PUBLIC attachment only, HTTP
Range supported, download increments `pdf_download_count`),
`GET /news/preview/:token` (hashed draft-preview token, 30 min),
`GET /foundation`.

Admin (one manage permission per resource; every write audited):

| Resource | Permission | Routes |
|---|---|---|
| Collections | `museum.collections.manage` | GET list · POST · GET/PATCH/DELETE `/:id` · POST `/collections/reorder` |
| Exhibitions | `museum.exhibitions.manage` | GET list · POST · GET/PATCH/DELETE `/:id` · POST `/exhibitions/reorder` |
| Gallery items | `museum.gallery.manage` | GET/POST `/exhibitions/:id/gallery-items` · PATCH/DELETE `/gallery-items/:id` · POST `/gallery-items/reorder` |
| News categories + articles | `news.manage` | GET/POST `/news/categories` · PATCH/DELETE `/news/categories/:id` (DELETE is 409 while articles reference it) · GET list (filters: search/category/status/featured/hasPdf) · POST `/news` · GET/PATCH/DELETE `/news/:id` · POST `/news/:id/publish` · `/unpublish` · `/duplicate` · POST `/news/bulk` (publish/unpublish/archive) · POST/DELETE `/news/:id/pdf` · GET `/news/:id/pdf/view` · `/pdf/download` (audited) · POST `/news/:id/preview` |
| Foundation programs + testimonials | `foundation.manage` | GET list · POST · GET/PATCH/DELETE `/:id` · POST `/foundation-programs/reorder` · same shape under `/testimonials` |

Duplicate slugs are 409; reorder validates every id (400) in one
transaction. Records carry both `cover_media_id` and a legacy
`image_url`/`image_alt` pair; payloads resolve one `{url, alt}`
preferring the media asset (see KNOWN_LIMITATIONS).

## Storefront — public `/api`

| Method | Path | Notes |
|---|---|---|
| GET | `/shop/categories` | With product counts |
| GET | `/shop/products` | `?category=&search=&sort=featured\|price-asc\|price-desc\|name&page=&pageSize=`; items carry `pricePaisa`, `salePricePaisa`, `effectivePricePaisa`, `availableQty`, `inStock`, `isFeatured` |
| GET | `/shop/products/:slug` | Detail incl. variants |
| GET | `/shop/config` | `{ currency: "NPR", shippingFeePaisa, taxRatePercent, codEnabled }` |

## Cart, addresses, checkout, customer orders — `/api` (full session; cross-user access is 404)

| Method | Path | Notes |
|---|---|---|
| GET | `/cart` | Prices always read live from products |
| POST | `/cart/items` | Validates published + in-cart quantity ≤ available (422 `INSUFFICIENT_STOCK`); merges same product+variant lines |
| PATCH · DELETE | `/cart/items/:id` | Quantity / remove |
| DELETE | `/cart` | Clear |
| GET · POST | `/addresses` | Customer address book |
| PATCH · DELETE | `/addresses/:id` | Own only |
| POST | `/checkout` | `{ addressId }` or an inline address + required `idempotencyKey` (≤64 chars). One READ COMMITTED transaction; totals recomputed server-side (the schema accepts no price/total fields); creates the order `PENDING_APPROVAL` with delivery + line snapshots and RESERVE movements; replaying a key returns the same order at 200 |
| GET | `/orders` · GET `/orders/:id` | Own orders only |
| GET | `/orders/:id/invoice` | Invoice metadata for an own order (incl. `creditNote` summary when one exists) |
| GET | `/orders/:id/invoice.pdf` | Owner-only PDF download |
| GET | `/orders/:id/credit-note.pdf` | Owner-only credit-note PDF (Phase 8) |

## Store admin — `/api/admin`

| Resource | Routes | Permission |
|---|---|---|
| Product categories | GET list · POST · GET/PATCH/DELETE `/product-categories/:id` (DELETE 409 while products reference it) | `store.categories.manage` |
| Products | GET list · POST · GET/PATCH `/products/:id` · DELETE `/products/:id` (= archive) | `store.products.manage` |
| Product images | GET/POST `/products/:id/images` · PATCH/DELETE `/products/images/:id` | `store.products.manage` |
| Variants | GET/POST `/products/:id/variants` · PATCH/DELETE `/products/:id/variants/:variantId` | `store.products.manage` |
| Inventory | GET `/products/:id/inventory` (summary + movement ledger) · POST `/products/:id/inventory/adjust` (`{ quantity }` delta or `{ setQuantity }`, reason required; adjusting below the reserved quantity is 422) | `store.inventory.manage` |

## Orders, invoices, credit notes — admin `/api/admin`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/orders` | `store.orders.read` | Search + status/date filters; with `status=PENDING_APPROVAL` the queue is oldest-first and each row carries `ageMs`; otherwise newest-first |
| GET | `/orders/:id` | `store.orders.read` | Items (snapshots), status history, invoice summary |
| POST | `/orders/:id/approve` | `store.orders.approve` | One transaction: stock finalised, exactly one invoice created, invoice email enqueued |
| POST | `/orders/:id/reject` | `store.orders.cancel` | From PENDING_APPROVAL; reason required |
| POST | `/orders/:id/cancel` | `store.orders.cancel` | From PENDING_APPROVAL / APPROVED / PROCESSING; reason required; post-approval cancellation also creates a credit note |
| POST | `/orders/:id/process` · `/ship` · `/deliver` | `store.orders.update` | Lifecycle steps; any other transition is 422 `INVALID_STATE_TRANSITION` |
| POST | `/orders/:id/invoice/resend` | `store.invoices.resend` | 409 while an invoice email is in flight; re-queues the same invoice, never a second one |
| GET | `/invoices` · GET `/invoices/:id` | `store.invoices.manage` | Detail includes the snapshot and, when present, the `creditNote` summary |
| GET | `/invoices/:id/download` | `store.invoices.manage` | PDF rendered from the stored snapshot only |
| GET | `/invoices/:id/credit-note.pdf` | `store.invoices.manage` | Credit-note PDF (Phase 8) |
| GET · PUT | `/invoice-template` | `store.invoice_templates.manage` | PUT creates a new immutable version; issued invoices never change |
| GET | `/invoice-template/preview.pdf` | `store.invoice_templates.manage` | Preview of the active version |

## Audit — `/api/admin`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/audit-logs` | `full` + `audit.read` (Super Admin only in the role matrix; there is no audit update/delete for anyone) | Filters: `from`/`to`, actor (id or email substring), role, action prefix, result, targetType; newest-first, paginated |
