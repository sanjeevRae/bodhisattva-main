# SETUP.md — Local Development Setup

Bodhisattva Museum dynamic platform: existing Vite/React frontend (repo root)
plus the new Express + TypeScript API (`server/`) and shared contracts
(`shared/`). Architecture: `ARCHITECTURE.md` §5.1. Phase 1 foundation —
see `DEVELOPMENT_ROADMAP.md` §3 for what exists so far.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.x (repo `engines`) | The API also runs on any current LTS; the *host's* Node version is verified separately (hosting gate, `DEPLOYMENT_REQUIREMENTS.md`). |
| npm | 10+ | Three installs: root (frontend), `shared/`, `server/`. |
| MariaDB or MySQL | MariaDB 10.6+ / MySQL 8.0+ | Local instance for development. Database `bodhisattva_dev`, user `bodhisattva`. |

## 1. Create the local database

```sql
CREATE DATABASE bodhisattva_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bodhisattva'@'localhost' IDENTIFIED BY '<choose-a-local-password>';
GRANT ALL PRIVILEGES ON bodhisattva_dev.* TO 'bodhisattva'@'localhost';
FLUSH PRIVILEGES;
```

## 2. Install dependencies

```bash
# Frontend (repo root) — usually already installed
npm install

# Shared contracts package (must be built before the API can type-check/run)
npm --prefix shared install
npm --prefix shared run build

# API
npm --prefix server install
```

## 3. Configure the API environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`: set `DB_PASSWORD` to the password from step 1 (or set
`DATABASE_URL=mysql://bodhisattva:<password>@localhost:3306/bodhisattva_dev`
instead) and replace the three `change-me-…` secrets with unique local values
of at least 32 characters, e.g.:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`server/.env` is never committed and holds no production values. The API
validates the whole environment at boot and exits with a readable list of
problems if anything required is missing (fail-fast).

## 4. Migrations, status, seed

From the repo root (these delegate to `server/`):

```bash
npm run db:status    # which migrations exist / are applied
npm run db:migrate   # apply pending migrations
npm run db:seed      # roles/permissions seed framework (Phase 2 content)
```

The `db:*` scripts read `DATABASE_URL` from the environment. Export it for
the session (the API server itself loads `server/.env` automatically):

```bash
export DATABASE_URL="mysql://bodhisattva:<password>@localhost:3306/bodhisattva_dev"
```

## 5. Run frontend + API together

Two terminals:

```bash
# Terminal 1 — API on http://localhost:4000
npm run server:dev

# Terminal 2 — frontend on http://localhost:5173
npm run dev
```

Smoke checks (no database required for liveness):

```bash
curl http://localhost:4000/health         # {"status":"ok"}
curl http://localhost:4000/health/ready   # 200 when the DB answers SELECT 1,
                                          # 503 + error envelope when it doesn't
```

> Note: the Vite dev proxy for `/api` → `http://localhost:4000`
> (ARCHITECTURE.md §5.1) is added with the Phase 3 frontend data layer.
> Until then the frontend and API run side by side on their own ports and
> the API is exercised directly (curl, tests).

## 6. Tests and build

```bash
npm run server:test     # vitest suite — passes WITHOUT a database running
npm run server:build    # builds shared/, then compiles the API to server/dist/
```

### Integration tests (Phase 2 exit gate)

`server/tests/auth-flows.integration.test.ts` exercises the real app
against a real database and a real SMTP sink — OTP codes, reset tokens and
invitation tokens are read from the delivered mail, never from the DB.
It is skipped unless `INTEGRATION_DB=1`, so the default suite stays
database-free. To run it:

1. Create a test database (e.g. `bodhisattva_test`) and grant the dev user
   access to it.
2. Apply migrations + seed to it (point `DATABASE_URL` at it for
   `db:migrate` / `db:seed`).
3. Run an SMTP sink on `localhost:1025` that stores messages as `.eml`
   files in `/tmp/mailbox` (any mail catcher that writes files works; the
   suite decodes quoted-printable before extracting codes/links).
4. `npm --prefix server run test:integration` (sources `server/.env` for
   the DB credentials; the suite itself targets `bodhisattva_test`).

The bootstrap CLI test inside the suite passes `DATABASE_URL` for the
**test** database explicitly — the CLI loads `server/.env` itself, and a
present `DATABASE_URL` wins over the discrete `DB_*` settings. Keep that
in mind for any scripted CLI use: check which database the URL names
before running it.

### Phase 3 additions — CMS content + media

Migration `0003` adds the CMS tables (pages, page_revisions,
page_sections, menus, menu_items, site_settings, media_folders,
media_assets) and `0004` adds `preview_tokens`. The seed step
`cms-content` migrates the seven existing pages into the database (7
pages, 31 sections, 4 menus, 19 menu items, 10 site settings) — it is
idempotent and fill-missing-only for settings, so re-running `db:seed`
never overwrites edited content.

Media uploads are stored under `UPLOAD_DIRECTORY` (see `server/.env`,
default `./storage/uploads`, relative to `server/`) in two-character
prefix subdirectories; derivatives are generated next to the master file.
The directory must be writable by the API process and is **not** served
statically — files are streamed by `GET /api/media/:id/file/:variant`.

The CMS integration suite (`server/tests/cms-flows.integration.test.ts`)
uses its own database (`bodhisattva_test_cms`) so it can run in parallel
with the auth suite; `npm --prefix server run test:integration` runs both
suites (13 tests). The public frontend renders pages from
`GET /api/pages/:slug`; the Vite dev server and preview both proxy
`/api` to `http://localhost:4000` (see `vite.config.ts`).

### Phase 4 additions — admin SPA + visual builder

The admin lives at `/admin` in the same SPA (lazy-loaded, outside the
public shell). Sign in with a bootstrapped or invited admin account;
admin roles must enrol in TOTP MFA at first login (the enrolment screen
shows the secret as text — enter it into any authenticator app). The
page editor is three panels: section navigator (drag to reorder),
live canvas (the real public renderer at desktop/tablet/mobile widths),
and a property inspector whose fields mirror the server-side section
schemas — the server stays authoritative and rejects invalid saves with
field-level errors. `GET /api/admin/users` (roles.read) backs the Users
screen. A scripted walkthrough of the admin (login → MFA → editor →
media → menus) is recorded in `docs/phase-4/walkthrough.md`.

## 7. Native module smoke test (Phase 1, provisional)

`argon2` and `sharp` are native modules; ARCHITECTURE.md §14.1 requires
proving they load before the design relies on them. Results on this
development machine (Linux x86_64, Node 24.22.1), 2026-11-17:

| Module | Test | Result |
|---|---|---|
| `argon2` 0.44.0 | Argon2id hash of a test password, then verify correct + incorrect password | **PASS** — hash `$argon2id$v=19$…` produced; correct password verified `true`, wrong password `false` |
| `sharp` 0.34.5 | Generate a 1×1 PNG in memory, resize to 4×4, read back metadata | **PASS** — output 4×4 PNG, libvips 8.17.3 |

**Provisional:** these results cover this machine only. The same smoke test
must pass on the cPanel host before Phase 2 relies on Argon2id parameters
or Phase 3 relies on Sharp re-encoding (hosting verification gate —
`DEPLOYMENT_REQUIREMENTS.md`; fallbacks in `SECURITY_THREAT_MODEL.md` /
ARCHITECTURE.md §14.1).

## Museum content modules (Phase 5)

Migrations `0005_museum` (the seven module tables) and `0006_museum_display_fields`
(curator/category/cover-aspect on exhibitions, colour tokens on news categories,
article slugs, program icon names) extend the schema; `npm run db:migrate` applies
them like the rest. The `museum-content` seed step (part of `npm run db:seed`)
loads the canonical record sets — 6 collections, 9 exhibitions, 5 news categories,
8 news articles, 4 foundation programs, 4 testimonials — skipping records that
already exist, so it is safe to re-run.

Public reads: `GET /api/collections`, `GET /api/exhibitions`, `GET /api/news`
(supports `?search=` full-text and `?category=<slug>`), `GET /api/foundation`.
Admin CRUD lives under `/api/admin/collections`, `/api/admin/exhibitions`
(+ `/api/admin/exhibitions/:id/gallery-items`), `/api/admin/news`
(+ `/api/admin/news/categories`), `/api/admin/foundation` (programs +
testimonials), each gated by its module permission (`museum.*.manage`,
`news.manage`, `foundation.manage`). The admin SPA has matching screens
(Collections, Exhibitions, News, Foundation) and the page editor's canvas now
renders real module records.

Record images are dual-sourced until the client decides on media migration:
an uploaded `cover_media_id` wins; otherwise the record's legacy `image_url` /
`image_alt` pair is used. Deleting a media asset is blocked while any module
record references it. The museum integration suite uses its own database
(`bodhisattva_test_museum`); `npm run test:integration` runs all three suites.

## Gift Shop ecommerce (Phase 6)

Migrations `0007_store` (the eleven store tables) and `0008_invoice_sequences`
(the §10.2 sequence counters) extend the schema. The `store-content` seed step
loads 5 product categories, 12 products with primary images and opening stock
(placeholder 10 per product — replace with the client's real counts via admin
inventory adjustments before launch), plus placeholder store settings
(`store.shipping_flat_fee` "0.00", `store.tax_rate_percent` "0",
`store.cod_enabled` "true"; fill-missing only). Note the seed now requires
migrations through 0008 on every database it runs against.

Public reads: `GET /api/shop/categories`, `GET /api/shop/products`
(`?category=&search=&sort=`), `GET /api/shop/products/:slug`,
`GET /api/shop/config`. Signed-in customers get `/api/cart`,
`/api/addresses`, `POST /api/checkout` (COD, stock reservations,
idempotency keys) and `/api/orders`. Admin catalogue/inventory lives under
`/api/admin/products`, `/api/admin/product-categories` and
`/api/admin/products/:id/inventory`, gated by the `store.*` permissions;
a holder of `store.settings.manage` may update only `store.*` keys through
`PUT /api/admin/settings`. The store integration suite uses its own database
(`bodhisattva_test_store`); `npm run test:integration` runs all four suites.

Frontend: the shop page renders from the public APIs; customers get
`/login`, `/register`, `/verify-email`, `/forgot-password`,
`/reset-password`, `/checkout`, `/account`, `/account/orders` and
`/account/addresses`. Adding to the cart requires login — the intended add
is preserved across the login round-trip and completes on return. Admin
screens: Products, Product Categories, and inventory inside the product
editor.

Inventory rules every writer must follow (Phase 6 review): checkout and
inventory transactions run at READ COMMITTED and lock the product row
FOR UPDATE (variant rows likewise, in id order) before reading
availability; availability = `stock_qty + SUM(RESERVE/RELEASE movement
quantities)`; when a product has variants, variant stock is authoritative
and `products.stock_qty` mirrors the variant sum. Local quirk: set
`SMTP_HOST=127.0.0.1` (not `localhost`) — the sandbox egress proxy
intercepts nodemailer's `localhost` connections.

## Orders & invoices (Phase 7)

Migration `0009_invoices_outbox` adds `invoices`, `invoice_templates`,
`invoice_template_versions` and `email_outbox`. The `invoice-template` seed
step creates one active template ("Default Museum Invoice", version 1) from
the site's public identity — prefix `INV`, tax registration number NULL
(never invent one; the client adds it in the template editor).

Order lifecycle is owned by ONE service (`transitionOrder` in
`server/src/modules/orders/orders.service.ts`) — the only writer of
`orders.status`. Matrix: approve PENDING_APPROVAL→APPROVED; reject
PENDING_APPROVAL→CANCELLED (reason required); process APPROVED→PROCESSING;
ship PROCESSING→SHIPPED; deliver SHIPPED→DELIVERED; cancel from
PENDING_APPROVAL/APPROVED/PROCESSING→CANCELLED (reason required); anything
else is 422 INVALID_STATE_TRANSITION. Every transition is one READ
COMMITTED transaction under the global lock order: invoice-sequence row
(approve only) → order row → product rows (id order) → variant rows.
Approval finalises inventory (ORDER_DEDUCT + RELEASE pair per line),
creates exactly one invoice (unique `invoices.order_id`; number from the
`INVOICE:<year>` sequence; snapshot frozen from the order's stored
snapshots + the pinned template version) and enqueues the invoice email —
atomically. Cancellation before approval releases the reservation
(RELEASE); after approval it restores stock (ORDER_RESTORE); an issued
invoice is never deleted. Invoice PDFs render ONLY from the stored
snapshot (PDFKit, deterministic) and are cached under
`<upload directory>/invoices/`.

Email goes through the outbox, never inline: rows are claimed under a
lease (stale leases recover after 5 minutes), failures back off
(1m/5m/30m/2h) and dead-letter after 5 attempts. The API drains
opportunistically after each enqueue; the reliable path is the CLI —
`npm run outbox:drain` in `server/` (run it from cron every minute in
production). Admin endpoints: `/api/admin/orders` (+ `/:id` and the
transition POSTs), `/api/admin/orders/:id/invoice/resend`,
`/api/admin/invoices` (+ `/:id`, `/:id/download`),
`/api/admin/invoice-template` (GET/PUT — every save is a new immutable
version) and `/api/admin/invoice-template/preview.pdf`. Customers get
`GET /api/orders/:id/invoice` and `GET /api/orders/:id/invoice.pdf`
(owner-only; anyone else's is a 404). The orders integration suite uses
its own database (`bodhisattva_test_orders`); `npm run test:integration`
runs all five suites.

## Hardening, security & ops (Phase 8)

- **Migration 0010** adds `credit_notes` and `email_outbox.lease_version`
  (outbox fencing). Cancelling an APPROVED/PROCESSING order now creates a
  credit note (CN-<year>-<5-digit>) in the same transaction and emails it.
- **Security suite**: `server/tests/security.integration.test.ts` (own DB
  `bodhisattva_test_security`) runs as part of `npm run test:integration`.
  It found and fixed a real bug: the OTP wrong-attempt counter was rolled
  back by its own transaction — see SECURITY_GUIDE.md.
- **Ops CLIs** (server package.json): `npm run outbox:drain` (reliable
  email path; schedule via cron in production), `npm run media:sweep`
  (orphan files; dry-run unless `-- --delete`), `npm run
  inventory:reconcile` (report-only ledger check, exit 1 on divergence).
- **Last-good cache**: public page/site reads fall back to
  `<UPLOAD_DIRECTORY>/../cache/last-good/` payloads when the DB read
  fails (header `X-Content-Source: last-good-cache`); real 404s still
  propagate.
- **Production**: the API fails fast on missing/placeholder/reused
  secrets; never ship a `.env` inside the deployed app directory.
  Deployment itself is pending the owner's cPanel connection —
  DEPLOYMENT_GUIDE.md is the runbook; RELEASE_REPORT.md is the status.

## News Clippings & Digital Press Archive (2026-11-18)

- **Migration 0011** extends `news_articles` (body `content`,
  `author`, `is_featured`, `view_count`, `pdf_download_count`, and a
  `content_plain` plain-text projection of the body) and adds
  `news_tags`, `news_article_tags`, `news_attachments` (PDF
  lifecycle: ACTIVE/REPLACED/REMOVED with checksums and replacement
  history) and `news_preview_tokens`. FULLTEXT `ft_news_search`
  covers (title, summary, outlet, author, content_plain) — search
  matches visible words, never HTML markup. Existing rows are
  untouched; articles get `content_plain` on their next save.
- **PDFs** are documents, not images: uploaded originals are stored
  unmodified (25 MiB cap, `%PDF-`/`%%EOF` validation, SHA-256
  recorded) via the media module's document path, and are served
  ONLY through the gated news endpoints (published + ACTIVE +
  PUBLIC; HTTP Range supported; `Content-Security-Policy:
  default-src 'none'; sandbox` on PDF responses). The generic media
  file route refuses PDF assets. One ACTIVE PDF per article;
  replacement is serialized on the article row lock.
- Public: `GET /api/news` (filters/publication/year/date range/
  type/hasPdf/featured, sorts, pagination meta when `page` is
  given), `GET /api/news/facets`, `GET /api/news/:slug`,
  `/pdf/view`, `/pdf/download`, `GET /api/news/preview/:token`.
  Admin (`news.manage`): enriched list, publish/unpublish/
  duplicate/bulk, `POST /api/admin/news/:id/pdf` (+ DELETE, view,
  download), `POST /:id/preview`. Frontend: the `/news` archive,
  `/news/:slug` reader with the PDF.js viewer (`pdfjs-dist`), and
  the admin "News Clippings" screen.
- Tests: `server/tests/news-clippings.integration.test.ts` runs on
  its own database `bodhisattva_test_news` (create + grant it like
  the other suite databases). Reviews: NEWS_CLIPPINGS_REVIEW.md;
  walkthrough: docs/news-clippings/walkthrough.md.

## About-page contact form & email (2026-11-18)

- **Migration 0012** adds `contact_submissions` (the form's messages,
  with delivery status RECEIVED → SENT/FAILED and the SMTP message
  id). Run `npm run db:migrate` after pulling.
- **Endpoint** `POST /api/contact` (public). The About page form now
  really submits: the message is stored, then emailed from the
  configured website identity to the configured inbox with the
  visitor as Reply-To. Sender/recipient are server config only —
  `CONTACT_FROM_EMAIL` (default alerts@bodhisattvainternational.com),
  `CONTACT_FROM_NAME`, `CONTACT_TO_EMAIL` (default
  info@bodhisattvainternational.com) in `server/.env`; delivery uses
  the platform's existing SMTP settings (`SMTP_HOST`/`SMTP_PORT`/
  `SMTP_USER`/`SMTP_PASSWORD`, port 465 = implicit TLS).
- **Protections**: global Origin check, strict validation (subject
  must match the published About page's CMS subject list), honeypot,
  MySQL rate limits (3/10 min + 5/hour per IP, 5/hour per email;
  tunable via `CONTACT_RATE_LIMIT_WINDOW_MS`/`CONTACT_RATE_LIMIT_MAX`),
  and Cloudflare Turnstile when configured — set
  `TURNSTILE_SECRET_KEY` (server) and `VITE_TURNSTILE_SITE_KEY`
  (frontend build) to enable it. Without the secret the form still
  works, but the server logs a warning at production startup: the
  rate limits are then the only anti-spam brake.
- The Subject dropdown's white-on-white bug is fixed in
  `src/styles/theme.css` (explicit `option` colours) with a custom
  chevron in the form component.
- Tests: `server/tests/contact.integration.test.ts` on its own
  database `bodhisattva_test_contact`. Reviews:
  CONTACT_FORM_REVIEW.md.

## Interactive API documentation — Swagger UI (2026-11-18)

- With the API running, open **http://localhost:4000/api/docs** for
  the Swagger UI and **http://localhost:4000/api/docs.json** for the
  raw OpenAPI 3.0 spec (167 operations, generated from `@openapi`
  annotations in the route files + `server/src/config/swagger.ts`).
- Auth is the platform's session cookie (no JWT): log in via the
  website in the same browser and Try-it-out sends the cookie
  automatically, or use the **Authorize** button with a copied
  `session` cookie value. Mutating calls also need the
  `X-CSRF-Token` header filled with the `csrf` cookie value.
- Availability: on by default outside production; in production the
  docs are OFF unless `API_DOCS_ENABLED=true` is set in
  `server/.env`. Only the docs path gets a relaxed CSP — the global
  helmet policy is unchanged.
