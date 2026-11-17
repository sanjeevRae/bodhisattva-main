# ARCHITECTURE.md — Bodhisattva Museum Dynamic Platform

**Project:** Bodhisattva International — dynamic museum website + visual CMS + ecommerce + secure administration
**Phase:** 0 — Audit & Planning (design only; no implementation in this document)
**Companion documents:** `DATABASE_DESIGN.md`, `PERMISSIONS.md`, `PROJECT_AUDIT.md`, `CMS_CONTENT_MAPPING.md`, `SECURITY_THREAT_MODEL.md`, `DEPLOYMENT_REQUIREMENTS.md`
**Status key used throughout:**

- ✅ **DECIDED** — follows directly from the master specification; implementation may proceed on this basis.
- ⏳ **HOSTING-DEPENDENT** — design is settled, but a parameter (version, limit, mechanism) can only be fixed after the cPanel hosting verification in Part 3 of the specification is complete. Assumptions are stated explicitly and must not be treated as verified host facts.
- 🔶 **NEEDS APPROVAL** — a genuine decision for Meena; options and a recommendation are given.

---

## 1. System overview

One integrated application, one repository, one database, one deployment unit set:

```
                        ┌──────────────────────────────────────────────┐
                        │                 Cloudflare                    │
                        │   (HTTPS, DDoS, WAF, bot rules, caching)      │
                        └───────────────┬──────────────────────────────┘
                                        │
              ┌─────────────────────────┴─────────────────────────┐
              │                                                   │
   Static frontend (built Vite SPA)                 Node.js API (Express + TS)
   served from public_html                          running under Passenger /
              │                                     cPanel Node.js App Manager
              │  /api/*  ────────────────────────────────►│
              │                                                   │
              │                                     ┌─────┴───────────────┐
              │                                     │  MySQL / MariaDB     │
              │                                     │  (single database,   │
              │                                     │   InnoDB, utf8mb4)   │
              │                                     └─────┬───────────────┘
              │                                           │
              │                          Private storage (outside public_html):
              └──── public media served via API ──►  cms-media/ product-images/
                                                     invoices/ backups/
```

**Principles**

1. ✅ The React frontend **never** talks to MySQL directly. All data flows through the REST API.
2. ✅ The database is authoritative for accounts, CMS content, products, carts, orders, invoices, permissions and audit records.
3. ✅ A single Express application serves every API module. There is no microservice split — inappropriate for shared cPanel hosting and unnecessary at this scale.
4. ✅ Public website, CMS admin, store admin and customer account are **one SPA** (the existing Vite app) with route-level code splitting, sharing the design system, but with admin/customer component trees kept in separate directories and lazy-loaded so public visitors never download admin code.
5. ✅ Money is `DECIMAL` in the database and integer-minor-unit or decimal-string in the API — never binary floating point (see `DATABASE_DESIGN.md` §2).
6. ✅ All timestamps are stored in UTC; the API emits ISO 8601 UTC; the frontend localises to Asia/Kathmandu for display.

---

## 2. Repository layout (target)

The existing frontend stays exactly where it is. New top-level areas are added beside it:

```
bodhisattva-main/
  index.html                  # existing Vite entry (unchanged role)
  src/                        # existing frontend — see §3
    app/
      pages/                  # existing 7 public pages (become CMS-rendered, §8)
      components/             # existing Nav, Footer, shared, ui/*
      sections/        (new)  # CMS section component registry (§8.2)
      admin/           (new)  # CMS + store + super-admin SPA (§3.3)
      account/         (new)  # customer dashboard (§3.4)
      lib/             (new)  # api client, auth context, formatting
  server/              (new)  # backend — see §4
    src/
      config/  database/  modules/  middleware/  security/
      validators/  services/  jobs/  utils/
      app.ts  server.ts
    migrations/               # Drizzle migration SQL + journal
    seeds/                    # roles/permissions seed only (see DATABASE_DESIGN.md §13)
    tests/
    package.json  tsconfig.json  drizzle.config.ts
  shared/              (new)  # contracts shared by src/ and server/ — see §6
    src/
      api-types.ts  errors.ts  permissions.ts  sections.ts  money.ts
    package.json  tsconfig.json
  docs/ …                     # phase deliverables
  ARCHITECTURE.md  DATABASE_DESIGN.md  …
```

✅ **DECIDED:** `shared/` is a plain TypeScript source folder consumed by both sides via path aliases (`@shared/*` in Vite and tsconfig paths in the server), **not** a published package and not a workspace tool — cPanel deployment stays a simple file copy, and there is no build-order dependency beyond `tsc` type-checking. The server bundles its copy at build time; the frontend bundles its copy via Vite. Runtime code in `shared/` must be platform-neutral (types, Zod schemas, constants) — no Node or DOM APIs.

---

## 3. Frontend architecture

### 3.1 What exists today (preserved)

- React 18.3.1 + Vite 6.3.5 + Tailwind CSS 4 + react-router 7.13 (`react-router` package) — already installed; routing was added in the previous change and all seven public routes work.
- Pages: `HomePage`, `MuseumPage`, `GalleryPage`, `GiftShopPage`, `NewsPage`, `FoundationPage`, `AboutPage` under `src/app/pages/`.
- Shared chrome: `src/app/components/Nav.tsx`, `Footer.tsx`, `shared.tsx` (page-path map, `SectionLabel`, image helper, content-protection hook).
- Full shadcn/ui component set under `src/app/components/ui/` (Radix primitives, `sonner` toasts, `react-hook-form` available) — the admin UI is built from these, guaranteeing visual consistency with the public site.
- Fonts/theme: `src/styles/*` (fonts.css, theme.css, tailwind.css, globals.css) — untouched.

✅ **Nothing in the public visual design changes.** Pages become *data-driven renderings of the same components* (§8), they are not redesigned.

### 3.2 Public route map

| Route | Component today | After CMS migration |
|---|---|---|
| `/` | `HomePage` | CMS page slug `home`, rendered by section registry |
| `/museum` | `MuseumPage` | CMS page slug `museum` |
| `/gallery` | `GalleryPage` | CMS page slug `gallery` + gallery/exhibition data sections |
| `/shop` | `GiftShopPage` | CMS page slug `shop` shell + live product data (§10) |
| `/news` | `NewsPage` | CMS page slug `news` + news listing section |
| `/foundation` | `FoundationPage` | CMS page slug `foundation` + program/testimonial sections |
| `/about` | `AboutPage` | CMS page slug `about` |
| `/:slug` (new) | — | CMS-created pages, resolved against published pages; reserved slugs rejected (§8.4) |
| `/products/:slug` (new) | — | Product detail, same Gift Shop design language |
| `/cart`, `/checkout` (new) | — | Cart and COD checkout flow |

The seven existing URLs are permanent. CMS slugs for system pages are locked to these paths (an admin can edit their content and SEO fields, not their slug).

### 3.3 Administration SPA (new, `src/app/admin/`)

- Mounted under `/admin/*`, lazy-loaded chunk, `noindex`.
- One shell (sidebar + topbar from existing ui components) with **role-aware navigation**: the menu is filtered by the permission list returned with the session, but every screen also handles API 403s — menu hiding is UX, never the security boundary (spec §9.5).
- Areas: Overview, Website CMS (page list + visual builder, §8.3), Pages, Collections, Exhibitions, Gallery, News, Foundation, Media Library, Gift Shop (Products, Categories, Inventory, Orders, Invoices, Invoice Templates, Store Settings), Users, Invitations, Audit Logs, Settings. Visibility per role exactly as spec Part 18.
- The visual page builder is a route inside this SPA: `/admin/pages/:id/edit`.

### 3.4 Customer account area (new, `src/app/account/`)

- Mounted under `/account/*`: Overview, Profile, Addresses, Orders, Order Details, Invoices, Security (sessions, password) — per spec Part 13.
- Public auth pages: `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invitation` (admin invitations), `/mfa-setup` (forced enrolment flow for invited admins).

### 3.5 Frontend data layer

- ✅ A single typed API client (`src/app/lib/api.ts`) wrapping `fetch` with: `credentials: "include"` (session cookie), CSRF token header injection (§7.4), the standard error envelope (§6.2), and 401 → redirect-to-login handling that preserves the intended post-login action (required by the login-gated cart, spec §10.3).
- ✅ Server state is fetched per screen; no global state library is added. React context is used only for: current session/user, cart badge count, theme. (Zustand/Redux are unnecessary — rejected deliberately.)
- ✅ Forms use `react-hook-form` (already installed) + Zod resolvers sharing the exact schemas from `shared/` that the API validates with — one schema, two runtimes.

---

## 4. Backend architecture

### 4.1 Runtime and framework

✅ **DECIDED:** Node.js + Express + TypeScript, compiled with `tsc` to `dist/`, started from a single entry file compatible with Passenger (`server/dist/server.js` referenced by the cPanel app startup file; see §5.2).

⏳ **HOSTING-DEPENDENT:** exact Node version. The frontend `package.json` declares `engines: node 24.x`, but cPanel shared hosting commonly offers Node 16–22 via CloudLinux NodeJS Selector. **The server code will target the lowest verified LTS on the host**; until verification, code must avoid Node >20-only APIs. This is a Phase 0 audit action, not an assumption.

### 4.2 Module map (spec §2.2, adjusted)

Each module owns: `routes.ts` (thin), `controller.ts`, `service.ts` (business logic + transactions), `repository.ts` (Drizzle queries), `schemas.ts` (Zod), `types.ts`. No module imports another module's repository — cross-module work goes through the other module's **service** or through domain events (§4.4).

| Module | Responsibility | Key permissions |
|---|---|---|
| `auth` | Registration, email OTP verification, login/logout, password reset, session lifecycle | public + session |
| `users` | Customer profile & admin user management, account status | `users.manage`, self-service |
| `roles` | Role/permission matrix reads & assignment | `roles.manage` |
| `invitations` | Admin invitation create/list/revoke/accept | `users.manage` (Super Admin only in practice) |
| `mfa` | TOTP enrolment, verification, recovery codes, admin reset | session + step-up |
| `cms` | Pages, sections, revisions, publish/rollback, menus, site settings | `cms.pages.*`, `settings.manage` |
| `media` | Upload, re-encode, library, folders, alt text, orphan detection | `cms.media.manage` (see PERMISSIONS.md) |
| `museum` | Collections | `museum.collections.manage` |
| `exhibitions` | Exhibitions (museum domain) | `museum.exhibitions.manage` |
| `gallery` | Gallery items | `museum.gallery.manage` |
| `news` | News articles & categories | `news.manage` |
| `foundation` | Programs, testimonials, impact stats | `foundation.manage` |
| `products` | Products, categories, variants, images | `store.products.manage` |
| `inventory` | Stock levels, movement ledger, adjustments | `store.inventory.manage` |
| `cart` | Server-side persistent cart | customer session |
| `checkout` | COD checkout, server-side totals, order creation transaction | customer session |
| `orders` | Order lifecycle, approval/cancellation, history | `store.orders.*` |
| `invoices` | Invoice generation, PDF rendering, template versions, resend | `store.invoices.manage`, `store.invoice_templates.manage` |
| `email` | Outbox queue, templates, SMTP transport, retries | internal |
| `audit` | Append-only audit write service + Super Admin query API | `audit.read` |
| `settings` | Site settings, store settings (fees, tax toggles), email/policy config | `settings.manage` |
| `contact` | Public contact-form submissions → `contact_submissions` + optional email | public, rate-limited |
| `security` (cross-cutting) | Rate-limit store, login-attempt tracking, anomaly flags | internal |

Platform folders: `config/` (env parsing with Zod, fail-fast on boot), `database/` (mysql2 pool, Drizzle instance, migration runner), `middleware/` (session auth, authorization, CSRF, rate limit, error handler, request-id/logger), `validators/` (shared Zod helpers), `services/` (audit writer, file storage, PDF renderer, mailer — used by modules), `jobs/` (outbox worker, cleanup jobs — §11), `utils/` (money, tokens, hashing, pagination).

### 4.3 Request lifecycle

```
request → request-id + structured log → security headers (helmet)
        → CORS allowlist check → body size limit → JSON parse
        → session resolution (hashed cookie id → user_sessions row)
        → CSRF verification (state-changing methods)
        → rate limit (route-class policy, MySQL store §9 of DATABASE_DESIGN)
        → route → Zod validation → authorization (permission middleware)
        → ownership check (customer resources) → service → repository
        → response envelope (§6.2)   errors → central error handler → envelope
```

### 4.4 Cross-module coordination

✅ Synchronous service calls for request-path work (checkout → inventory → orders → invoices → email-outbox insert, all inside one DB transaction where the spec requires atomicity). The **email outbox row is written in the same transaction** as the business event and sent later by the worker (§10) — this is the transactional-outbox pattern and is what makes "email failure must not roll back an approved order" (spec §11.2) and "retries must not duplicate invoices" achievable.

An in-process event emitter is used only for non-critical side effects (e.g. cache invalidation). Anything that must not be lost goes through the database, never through memory — Passenger may run multiple workers and can restart the process at any time. ⏳ Worker count on the host is unverified; the design is correct for 1..n workers (all shared state is in MySQL).

---

## 5. How frontend and API coexist

### 5.1 Local development ✅

| Piece | Command / address |
|---|---|
| Frontend | `npm run dev` → Vite on `http://localhost:5173` |
| API | `npm --prefix server run dev` → Express on `http://localhost:4000` |
| Database | Local MySQL/MariaDB (developer machine or Docker), database `bodhisattva_dev` |
| Mail | Local SMTP catcher (e.g. Mailpit) or a controlled test mailbox — never production SMTP |

- Vite dev server proxies `/api` → `http://localhost:4000` (one `server.proxy` entry added to `vite.config.ts` in Phase 1) so the browser sees a single origin and the `__Host-` session cookie + CSRF behave exactly as in production.
- Frontend env: `VITE_API_BASE_URL=/api` (relative — same origin in dev via proxy and in production via §5.2).
- Server env from `server/.env` (see spec §19.2 for the variable list). Secrets are generated per-environment; nothing real is committed; `.env.example` documents every key.

### 5.2 Production on cPanel ⏳ (layout per spec §19.3, parameters unverified)

```
/home/<cpanel-user>/
  apps/
    museum-api/            # server/ build output + node_modules (outside public_html)
      dist/  package.json  app.js (Passenger startup shim → dist/server.js)
  private-storage/
    cms-media/  product-images/  invoices/  backups/
  public_html/
    index.html  assets/    # Vite build output ONLY — no server code, no .env
    .htaccess              # SPA fallback + /api routing (§5.3)
```

- The Node app is registered in **cPanel → Setup Node.js App** (Passenger) with its application root at `apps/museum-api`, or the app is reached through an `.htaccess` proxy rule — ⏳ which mechanism the host exposes is a hosting-verification item. Both are designed for; the API code is identical either way because it only assumes "requests arrive at my port with the original path".
- Static frontend and API share the public origin (e.g. `https://bodhisattvainternational.com`): `/api/*` → Node app; everything else → SPA. Same-origin is **required** by the `__Host-session` cookie design (§7) — a separate API subdomain would force a different cookie/CORS posture and is rejected.
- SSL: site must be HTTPS-only before any login ships (Cloudflare + origin certificate; `__Host-` cookies refuse to be set over HTTP). ⏳ Certificate mechanism (AutoSSL vs Cloudflare Origin CA) is hosting-dependent.

### 5.3 Routing rules (production `.htaccess` contract)

1. `/api/*` requests are passed to the Node application **before** any SPA rewrite (API 404s must stay JSON, never return `index.html`).
2. Existing real files (hashed Vite assets, images) are served directly.
3. All other GET requests fall back to `index.html` (SPA routing for `/museum`, `/:slug`, `/admin/*`, `/account/*`).
4. `private-storage/` is **never** under `public_html`; media and invoices are delivered only through authorised API endpoints (§9).

Exact rewrite syntax is written and tested in Phase 8 against the verified host (Apache/LiteSpeed differences matter). ⏳

---

## 6. Shared contracts

### 6.1 API conventions ✅

- Base path `/api`. Resource-oriented REST exactly as spec Part 17 (route families adopted unchanged; naming reviewed — no changes found necessary).
- JSON only. Request bodies validated with Zod before any business logic.
- **Pagination:** `?page=1&pageSize=20` (pageSize max 100) → response carries `meta: { page, pageSize, total, totalPages }`. Lists are always paginated (spec §15.5).
- **Filtering/sorting:** explicit allow-listed query params per endpoint, documented in `API_DOCUMENTATION.md`; unknown params are ignored, never interpolated into SQL. All SQL is parameterised via Drizzle.
- **IDs in URLs** are the numeric primary keys for admin APIs; public product/page access is by **slug**. Customer-owned resources are always scoped by the session user id in the query itself (ownership is structural, not a post-check).
- **Versioning:** no `/v1` prefix initially; breaking changes would introduce it. Additive changes only.
- **Idempotency:** order approval, checkout submission and invoice resend accept an `Idempotency-Key` header (client-generated UUID); the server stores the key with the resulting record and replays the original result on retry (see DATABASE_DESIGN.md §10.3).

### 6.2 Error response format ✅

Every error, from every endpoint, has exactly this shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The submitted data is invalid.",
    "details": [ { "field": "email", "issue": "Invalid email address" } ],
    "requestId": "req_01J…"
  }
}
```

- `code` is a stable machine string from the shared catalogue in `shared/src/errors.ts` (e.g. `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `INSUFFICIENT_STOCK`, `INVALID_STATE_TRANSITION`, `CONFLICT`, `INTERNAL`).
- `message` is safe, human-readable, and never contains SQL errors, stack traces, file paths or whether an email exists (auth endpoints return deliberately generic messages, spec §7.2).
- HTTP status mapping: 400 validation, 401 unauthenticated, 403 authenticated-but-not-permitted, 404 not found (also used to mask other customers' resources), 409 state/uniqueness conflict, 422 business-rule failure (e.g. insufficient stock), 429 rate limited (with `Retry-After`), 500 internal (logged with `requestId`, generic to client).
- Success responses: the resource object directly, or `{ "data": [...], "meta": {...} }` for lists. No mixed envelopes.

### 6.3 Validation ✅

- Zod schemas live in `shared/src/` when both sides need them (auth forms, checkout, section configs, invoice template config) and in the owning server module otherwise.
- The server re-validates everything; frontend validation is UX only.
- Section configurations (§8.2) and invoice template configurations (§12 of spec) are Zod-schema-validated JSON — never arbitrary HTML/JS. Rich text is stored as sanitised HTML produced from a restricted editor and re-sanitised server-side on save **and** treated as untrusted on render.

### 6.4 Shared TypeScript types ✅

`shared/src/` exports: API request/response DTOs per resource, the error catalogue, the permission string union (single source for frontend menu filtering and backend middleware), CMS section type definitions + their config schemas, money helpers (parse/format `DECIMAL` strings, NPR default), and the order-status / invoice-status / email-status enums used by both sides. Enums are string unions mirrored by database `ENUM`/check values in `DATABASE_DESIGN.md`.

---

## 7. Session authentication design (summary)

Full detail: `SECURITY_THREAT_MODEL.md` and `DATABASE_DESIGN.md` §4. Summary of the decided design (spec Part 7.4):

- ✅ **Server-side sessions**, opaque cookie `__Host-session` (`Secure; HttpOnly; SameSite=Lax; Path=/`, no `Domain`). The cookie carries a 256-bit random id; the database stores only its SHA-256 hash (`user_sessions.session_id_hash`). A database leak therefore yields no usable sessions.
- ✅ Session row records user, created/last-seen, idle + absolute expiry, IP, user agent, and auth level (password-only vs MFA-verified).
- ✅ **Rotation** on login, on MFA completion, and on privilege change (role assignment, password change) — old session ids are invalidated in the same transaction.
- ✅ Idle timeout and absolute lifetime are server-configurable; "logout" and "logout from all devices" revoke rows. Revocation is a status flag + row retention for audit, not silent deletion.
- ✅ **CSRF:** SameSite=Lax plus a synchroniser token: the server issues a per-session CSRF token (readable via `GET /api/auth/session`), the client sends it as `X-CSRF-Token` on every state-changing request, middleware compares in constant time. `Origin`/`Referer` are also checked against the allowlist as defence in depth.
- ✅ **Step-up:** sensitive admin actions (role changes, MFA reset, template approval) require a fresh MFA verification within a short window, recorded on the session.
- ✅ Passwords: Argon2id (parameters benchmarked on the actual host in Phase 2 — ⏳ shared-host CPU limits apply; target ≈250–500 ms verify time). Email OTP codes and reset/invitation tokens are stored only as HMAC-SHA-256 / SHA-256 hashes (see DATABASE_DESIGN.md).
- ✅ Customers and admins are the **same `users` table** with role assignments; admins are created **only** by invitation (spec Part 8), never via public registration. The first Super Admin is created by a one-time CLI bootstrap command (`npm --prefix server run bootstrap:super-admin`) that refuses to run if a Super Admin already exists.

---

## 8. CMS rendering pipeline

This is the heart of the "preserve the design, make it dynamic" requirement.

### 8.1 Content model (see DATABASE_DESIGN.md §7)

A **page** has metadata (title, slug, SEO) and an ordered list of **sections** belonging to a **revision**. At any moment a page points to one *draft revision* (being edited) and one *published revision* (live). Publishing is a pointer move, not a copy — so publish/rollback are instant and atomic, and a failed publish leaves the live page untouched (spec §5.5).

### 8.2 Section registry ✅

- Every visual block of the current site is extracted into a React component registered in `src/app/sections/registry.tsx` under a stable `type` key, with: the component, its Zod config schema, default config, editor property definition, and an icon/label for the library.
- The 19 section types required by spec §5.3 map onto the existing design as follows (extraction source in parentheses — full mapping in `CMS_CONTENT_MAPPING.md`): hero banner (Home/Museum/Foundation heroes), rich text, image, image-and-text (Home intro, Foundation mission), image gallery, collection grid (Home featured + Museum categories), exhibition grid (Home current exhibitions + Gallery archive), featured products (shop strip), news listing (Home latest news + News page), foundation programs, statistics (Foundation stats band, Museum facts), history timeline (Museum history), team members (About team), testimonials (Foundation voices), CTA (Museum virtual-tour band, newsletter band), contact information (About visit & contact), contact form (About form), divider, spacer.
- Sections that display *records* (collections, exhibitions, products, news, programs, testimonials) receive a config of `{ source, filters, limit, sort }` and fetch their records from the museum/store APIs at render time — the CMS stores the *presentation*, the domain modules own the *data*. This keeps one source of truth per record (editing a collection updates Home, Museum and Gallery simultaneously).
- Unknown/obsolete section types render a null placeholder on the public site (never crash the page) and a warning in the editor.

### 8.3 Rendering flow

```
PUBLIC:  GET /:slug → SPA fetches GET /api/pages/:slug
         → API returns the PUBLISHED revision: page meta + ordered sections
           [{ id, type, config, design }] (config already schema-validated at save)
         → <SectionRenderer> maps each entry through the registry using the
           REAL components → identical markup/classes to today's static pages
         → data-driven sections fetch their records from their domain APIs

EDITOR:  /admin/pages/:id/edit loads the DRAFT revision into the three-panel
         builder (navigator | live canvas | inspector). The canvas renders the
         SAME <SectionRenderer> with an `editing` flag that adds selection
         outlines, click-to-select and inline-edit affordances — overlays exist
         only in the editor bundle path, never in published output.
         Drag-and-drop reorder uses @dnd-kit/sortable; order persists via
         PATCH /api/admin/pages/:id/sections/reorder (transactional renumber).
         Autosave debounces PATCHes to the draft revision with the revision's
         optimistic-concurrency version; a version conflict returns 409 and the
         editor offers reload/merge — never silent overwrite (spec §5.4).

PREVIEW: GET /api/admin/pages/:id/preview renders the draft revision through
         the same public route with a preview token — a genuine preview of the
         real components, not a mock (spec §5.2).
```

### 8.4 Reserved routes ✅

Slugs `login`, `register`, `verify-email`, `forgot-password`, `reset-password`, `accept-invitation`, `mfa-setup`, `admin`, `account`, `cart`, `checkout`, `products`, `api` are reserved in a shared constant; the CMS API rejects creating/renaming a page to any of them, and the seven system pages cannot be deleted or have their slug changed (they can be unpublished only with an explicit warning, since that takes a public URL down).

### 8.5 Navigation & footer

Menus are data (`menus` + `menu_items`, DATABASE_DESIGN.md §7.5). `Nav.tsx`/`Footer.tsx` keep their exact markup but read the `primary` menu, footer columns and site settings (name, phone, hours, socials) from `GET /api/site` instead of hardcoded values. Fallback: if the API is unreachable, the components render the currently-shipped hardcoded values as a static fallback so the public site never appears broken.

---

## 9. Media storage layout

✅ Decided layout (spec §5.6, §15.6, §19.3):

```
/home/<cpanel-user>/private-storage/          # outside public_html, not web-accessible
  cms-media/<yyyy>/<mm>/<random-name>.webp     # re-encoded derivatives + originals/
  product-images/<product-id>/<random-name>.webp
  invoices/<yyyy>/<invoice-number>.pdf         # private; download only via authorised API
  backups/                                     # DB dumps + media archives (Phase 8)
```

- Upload pipeline (API): size limit → magic-byte/MIME sniffing (not extension trust) → Sharp decode + **re-encode** (strips payloads/EXIF) → random 128-bit server filename → store original + generated sizes (thumb/card/full) → `media_assets` row with dimensions, size, alt text, folder, uploader.
- Public CMS/product images are served by the API at `GET /api/media/:id/:size` with long-lived immutable cache headers (the random name changes on replace) — or, ⏳ if the host proves to serve a symlinked public folder safely, via a `public_html/media` symlink; the API-endpoint route is the default because it works on every cPanel configuration and keeps one code path.
- Invoice PDFs and any private file are **only** reachable through authenticated, ownership/permission-checked download endpoints that stream the file — never by URL guessing.
- Executables and SVG uploads are rejected (SVG only as a sanitised, admin-only exception if ever needed — default: reject).

---

## 10. Email queue design

✅ Transactional outbox (spec Parts 12.3 & 16):

- `email_outbox` rows are inserted **in the same DB transaction** as the triggering event (registration, order approval, …) with: type, recipient, template data (JSON snapshot), status `PENDING`, attempt count, next-attempt time, last error.
- A worker drains the queue: claims rows (`SELECT … FOR UPDATE SKIP LOCKED` — ⏳ `SKIP LOCKED` requires MySQL 8.0+ / MariaDB 10.6+; on older versions the fallback is an atomic `UPDATE … SET status='PROCESSING', claimed_by=… WHERE status='PENDING' … LIMIT n` claim — both patterns are specified in DATABASE_DESIGN.md §11), renders the template, sends via Nodemailer SMTP, marks `SENT`/`FAILED` with exponential backoff (e.g. 1m, 5m, 30m, 2h, then dead-letter at 5 attempts) and manual retry from admin.
- **How the worker runs on cPanel:** ⏳ two supported shapes, chosen at deployment verification: (a) a lightweight in-process interval inside the API app (simplest; risk: Passenger may idle-kill the process — mitigated by (b)); (b) a **cron job** (cPanel cron, every minute) invoking `node dist/jobs/run-outbox.js` — the recommended default because cron is near-universal on cPanel and survives app restarts. The same entry point also runs session/OTP cleanup. Design uses (b) as primary, (a) disabled by default.
- Invoice email carries the PDF as an attachment generated at approval time (stored once in `private-storage/invoices/`), so retries re-send the identical file and can never create a duplicate invoice.
- "Sent" means the SMTP server accepted the message; the system records acceptance, and the docs must never claim confirmed inbox delivery (spec Part 25).

---

## 11. Jobs & scheduled work

| Job | Cadence | Work |
|---|---|---|
| Outbox worker | every 1 min (cron) | §10 |
| Session cleanup | hourly | delete expired/revoked session rows past retention |
| OTP/token cleanup | hourly | delete expired verification codes, reset & invitation tokens |
| Rate-limit cleanup | hourly | delete expired rate-limit windows |
| Media orphan scan | weekly | flag `media_assets` unreferenced by any section/product (report only, never auto-delete) |
| Backup | daily (Phase 8) | DB dump + media/invoice archive to `private-storage/backups/`, retention policy |

All jobs are idempotent CLI entry points under `server/src/jobs/`, runnable by hand, safe under overlapping execution (DB-level claims/locks).

---

## 12. Caching & publication model

- ✅ **Publication is a pointer swap** (DATABASE_DESIGN.md §7.3): publishing sets `pages.published_revision_id`. There is no build step and no file generation for CMS content — the next API read serves the new revision.
- ✅ **API read caching:** published page payloads and site/menu payload are cached in-process (per worker) keyed by `(slug, published_revision_id)` and invalidated on publish/rollback via a `settings`-table version counter polled cheaply, or simply by keying on the revision id (a new publish = new key = automatic freshness; old entries expire by TTL 60 s). No Redis is assumed or required.
- ✅ **HTTP caching:** published page/menu/product-list GETs emit `ETag`/`Cache-Control: public, max-age=60` so Cloudflare can absorb read load; authenticated and admin responses are `private, no-store`.
- ✅ **Static assets:** Vite hashed filenames with 1-year immutable caching at Cloudflare/Apache level.
- ⏳ Cloudflare APO/full-page HTML caching is **not** used — the SPA shell is a single `index.html` and is already trivially cacheable; content freshness comes from the API layer above.

---

## 13. Order lifecycle state machine ✅ (spec §11.1)

```
                 ┌──────────────────┐
   checkout ───► │ PENDING_APPROVAL │
                 └───┬──────────┬───┘
          approve    │          │  cancel (admin, reason required)
                     ▼          ▼
                 ┌────────┐  ┌───────────┐
                 │APPROVED│  │ CANCELLED │ (stock restored, history row)
                 └───┬────┘  └───────────┘
                     ▼
                 ┌──────────┐      cancel after approval: controlled policy —
                 │PROCESSING│      only SUPER_ADMIN/STORE_ADMIN with reason,
                 └───┬──────┘      stock + invoice adjustments recorded
                     ▼
                 ┌─────────┐
                 │ SHIPPED │
                 └───┬─────┘
                     ▼
                 ┌───────────┐
                 │ DELIVERED │ (terminal)
                 └───────────┘
```

Rules enforced in the `orders` service (single transition function; no other code writes `orders.status`):

- Transitions are validated against an explicit allow-list; anything else → `422 INVALID_STATE_TRANSITION`.
- Every transition writes an `order_status_history` row (previous, new, actor, reason, UTC timestamp) **in the same transaction**.
- **Approval is idempotent and transactional** (spec §11.2): conditional status update (`WHERE status='PENDING_APPROVAL'`) → finalise inventory deduction → create invoice with unique number → write outbox row → audit row → commit. A second approval call returns the original result (invoice already exists → no duplicate).
- **Stock policy:** checkout *reserves* nothing; stock is validated at checkout and **deducted atomically at order creation** via conditional update (`stock_qty >= qty`), with an `inventory_movements` ledger entry per line. Cancellation before fulfilment restores stock via an offsetting ledger entry. (Reservation-at-checkout was considered and rejected: abandoned checkouts would strand stock; the conditional-update design still guarantees no overselling, including under concurrency — verified by the Phase 6 concurrency test in spec Part 23.) 🔶 Recorded here as a design decision Meena should be aware of; it trades "stock held while deciding" for "no stranded stock", and approval-time stock surprises are impossible because deduction already happened at order creation.
- Invoice numbering: per-year sequence from a dedicated counter table locked inside the approval transaction + a `UNIQUE` constraint on `invoices.invoice_number` as the hard guarantee (DATABASE_DESIGN.md §10.2).

---

## 14. Dependency table

### 14.1 Backend (new — `server/package.json`)

| Package | Why it is needed |
|---|---|
| `express` | Spec-mandated REST framework; universal Passenger compatibility |
| `typescript`, `ts-node`(dev), `@types/express`, `@types/node` | Type-safe server; compiled output for production |
| `drizzle-orm` | Spec-preferred ORM: SQL-first, parameterised queries, typed schema, tiny runtime (good for shared-host memory) |
| `drizzle-kit` (dev) | Migration generation from the schema; migrations reviewed as SQL before applying |
| `mysql2` | MySQL/MariaDB driver with promise pool + prepared statements (Drizzle backend) |
| `zod` | Request validation + shared schemas with the frontend (§6.3) |
| `argon2` | Argon2id password hashing (spec §15.1). ⏳ Native module — needs a prebuilt binary for the host's Node/arch; fallback if unavailable: `bcrypt` is **not** equivalent — escalation path is documented in SECURITY_THREAT_MODEL.md; verification in Phase 1 |
| `otplib` | TOTP MFA (RFC 6238) enrolment/verification + QR data; secrets encrypted at rest (AES-256-GCM via Node `crypto`, key from env) |
| `nodemailer` | SMTP sending for all email types (spec Part 16) |
| `pdfkit` | Invoice PDF generation from validated template config (spec Part 12) — pure JS, no headless browser (important on shared hosting) |
| `sharp` | Image validation, re-encoding and derivative sizes for uploads (spec §15.6). ⏳ Native module — prebuilt binaries cover common cPanel platforms; fallback: `jimp` (pure JS, slower) if sharp cannot load |
| `helmet` | Security headers incl. CSP (spec §15.5) |
| `cors` | Strict origin allowlist (spec §15.5) |
| `cookie-parser` | Session cookie handling |
| `express-rate-limit` | **Not used** for the authoritative limits — limits must persist across restarts/workers, so the MySQL-backed store in `security/` implements the same policies (spec §15.3). Listed here to record the deliberate rejection |
| `pino` + `pino-http` | Structured JSON logs with request ids; separates diagnostic logs from the audit log (spec Part 14) |
| `dotenv` | Local env loading (production env comes from the cPanel app config) |
| `vitest` + `supertest` (dev) | Unit/integration tests (spec Part 20, Subagent 5) |

### 14.2 Frontend (additions only — everything else already installed)

| Package | Why it is needed |
|---|---|
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Section drag-and-drop in the visual builder (spec §5.2). The installed `react-dnd` is **not** used for this — dnd-kit has first-class sortable semantics, keyboard accessibility and touch support; keeping both would be dead weight, so `react-dnd` is flagged for removal in Phase 4 if nothing else uses it |
| `@hookform/resolvers` | Connects existing `react-hook-form` to the shared Zod schemas (the resolver package is not yet installed) |
| `zod` | Frontend side of the shared schemas (also a server dep; versions pinned together) |

### 14.3 Explicitly rejected

Redis (unavailable/unverifiable on cPanel — MySQL-backed stores instead), any headless-Chromium PDF tool (resource limits), Next.js or SSR framework (would replace the working SPA), GraphQL (spec mandates REST), a separate admin app/repo (one integrated application, spec Part 1).

---

## 15. Security architecture (summary)

Full treatment in `SECURITY_THREAT_MODEL.md`. Load-bearing decisions:

- ✅ Deny-by-default permission middleware on every `/api/admin/*` and `/api/account/*` route; permissions are the shared string union (§6.4), checked server-side per endpoint — never inferred from role names in the frontend.
- ✅ Ownership is structural: customer queries always include `AND user_id = :sessionUser`.
- ✅ Rate limits (registration 3/IP/hour, OTP send 3/email/hour + 60 s cooldown + 5 attempts/code, login 5 failures/15 min per account+IP, recovery 3/email/hour — spec §15.3) enforced from the MySQL `rate_limits` table so they survive restarts and multiple Passenger workers.
- ✅ Audit log is append-only at the application layer and written by a single service; secrets (passwords, OTPs, tokens, TOTP secrets, recovery codes) are never logged (spec Part 14).
- ✅ Uploads: §9 pipeline. Downloads: authorised streaming endpoints only.
- ✅ Cloudflare in front for volumetric DDoS/WAF (spec §15.4); the application never claims to mitigate volumetric attacks itself.

---

## 16. Decision & assumption register

| # | Item | State |
|---|---|---|
| A1 | Node version available on cPanel host | ⏳ Unverified — code targets lowest verified LTS; frontend's `node 24.x` engines field does **not** describe the host |
| A2 | Passenger / Node.js App Manager presence and worker model | ⏳ Unverified — design is worker-count-agnostic |
| A3 | MySQL vs MariaDB + exact version (`SKIP LOCKED`, JSON functions, CHECK constraints) | ⏳ Unverified — schema avoids version-fragile features except where a fallback is specified |
| A4 | Cron availability (outbox worker depends on it) | ⏳ Unverified — in-process interval is the fallback |
| A5 | `argon2` / `sharp` native binaries load on host | ⏳ Unverified — fallbacks documented; tested first thing in Phase 1 |
| A6 | SMTP credentials + sending limits of the hosting mailbox | ⏳ Unverified — queue design tolerates low limits via backoff |
| A7 | Stock deducted at order creation (no checkout reservation) | 🔶 Design decision, §13 — recommendation: accept |
| A8 | Public media served via API endpoint (vs symlinked public folder) | ✅ Decided (API route); revisit only if host performance demands it |
| A9 | Invoice number format `INV-<year>-<seq 5-digit>` e.g. `INV-2026-00042` | 🔶 Needs Meena's approval (prefix/format is a business choice; uniqueness mechanism is not) |
| A10 | Currency: NPR only at launch; `currency` column kept for future-proofing | 🔶 Confirm — current Gift Shop prices are already Rs.-denominated |
| A11 | Session idle/absolute lifetimes: customer 24 h idle / 7 d absolute; admin 30 min idle / 12 h absolute with MFA | 🔶 Recommendation — Meena to confirm strictness for admins |
| A12 | Whether the Gift Shop checkout requires a verified account for COD (spec §10.3 implies login-gated cart; guest checkout is **not** built) | ✅ Per spec — login required to add to cart |

---

## 17. Phase mapping

Phase 1 builds §4–§7 foundations (server skeleton, DB connection, migrations, shared contracts, health endpoint). Phase 2 implements §7 + invitations/MFA/RBAC. Phase 3 implements §8.1–8.3 backend + public rendering. Phase 4 the builder UI. Phase 5 museum modules. Phase 6 shop/cart/checkout (§13 order creation). Phase 7 orders/invoices/email (§10, §13 approval). Phase 8 hardens and deploys per §5.2–5.3. No phase changes the public visual design.
