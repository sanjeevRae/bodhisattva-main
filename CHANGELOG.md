# Changelog

The Bodhisattva dynamic museum platform, phase by phase. All entries
are 2026-11-17 (the build ran as one continuous programme). Commit
hashes are on `sanjeevRae/bodhisattva-main` `main`. Status discipline:
everything below is implemented, tested and verified **locally**;
**nothing is deployed**.

## Unreleased — 2026-11-18

- **Site favicon added** (owner-supplied Bodhisattva seal logo,
  2026-11-19): `public/favicon.ico` (16/32/48), `favicon-16.png`,
  `favicon-32.png`, `icon-192.png`, `icon-512.png` and
  `apple-touch-icon.png` (white-backed for iOS), linked from
  `index.html`. The small sizes use a contrast-firmed rendering of
  the seal so the linework stays legible at tab size.
- **About-page contact form now delivers email** (owner task
  2026-11-18). The form previously submitted nowhere; it now posts
  to the new `POST /api/contact`, which stores each message
  (migration 0012, `contact_submissions`) and emails it from the
  configured alerts@ identity to info@ with the visitor as
  Reply-To. Strict validation (subject allowlist read live from the
  published CMS About config), honeypot, MySQL rate limits, and
  config-gated Cloudflare Turnstile; the mailer's optional
  from/replyTo support is used by no other caller. The Subject
  dropdown's white-on-white bug (near-white select text, unstyled
  native option popup, missing chevron) is fixed. QA found and we
  fixed a same-task double-click duplicate submission (synchronous
  ref lock) and a misleading 401 on `GET /api/contact` (now 405).
  Reviews: CONTACT_FORM_REVIEW.md.
- **Swagger UI / OpenAPI 3.0 for the whole API** (owner task
  2026-11-18). `GET /api/docs` + `GET /api/docs.json` document all
  167 operations (122 paths), generated with swagger-jsdoc from
  `@openapi` annotations in the route files plus shared component
  schemas in `server/src/config/swagger.ts`; the served spec was
  diffed against every route registration in code (zero phantom,
  zero missing — this also settles the endpoint count at 167).
  Authorize uses the platform's session cookie; production exposure
  is off unless `API_DOCS_ENABLED=true`. No endpoint behaviour
  changed (route-file diffs are comment-only).
- **Phone number required at signup, with real international
  validation** (owner decision 2026-11-18). Registration now requires
  a phone that is a real number under its country's numbering plan —
  customers may be from any country, so all numbering-plan knowledge
  comes from `libphonenumber-js` metadata; nothing country-specific
  (lists, dial codes, lengths, patterns) is hardcoded. Input is either
  international form ("+…") or a national number plus its ISO country
  code (`phoneCountry`); the stored value is always E.164
  (`users.phone`, normalised on both the new-account and the
  unverified re-registration paths). Delivery-address and inline
  checkout phones get the same validation + normalisation. Existing
  accounts are unaffected — the column stays nullable and login never
  demands a phone. The register, checkout and address forms gained a
  metadata-driven country selector (default Nepal) with a client-side
  pre-check; the server remains authoritative. Following the
  independent reviews (`PHONE_REVIEW.md`), the server validates with
  the strict `libphonenumber-js/max` metadata (an empirical
  differential test found the `/min` build accepts numbers in
  unallocated ranges) and a strict input-shape guard rejects
  extensions and surrounding text instead of silently stripping or
  extracting them. Covered by new unit tests (`phone.test.ts`, 22
  cases across NP/IN/US/GB/CA/JM plans) and new auth-flows integration
  cases (missing/invalid phone → 400 with the `phone` field error;
  stored value asserted in E.164 in the DB).
- **Super Admin cap raised to 3** (owner decision 2026-11-18). The
  platform now allows at most 3 active Super Admin accounts
  (`MAX_SUPER_ADMINS` in `server/src/config/limits.ts`), enforced on
  every creation path: the bootstrap CLI (previously refused when any
  Super Admin existed), role assignment (promotions beyond the cap
  are refused inside the transaction), and invitations (pending Super
  Admin invitations reserve slots at creation; acceptance re-checks
  the ceiling before consuming the invitation, so an invitation stays
  usable when the cap is temporarily full). The minimum-1 floor — the
  last active Super Admin cannot be demoted — is unchanged. Covered by
  a new integration suite (`super-admin-cap`, own test database).

## Pre-platform — 2026-11-17

- **News Clippings & Digital Press Archive module** (owner
  specification 2026-11-18). `/news` becomes a database-driven
  press archive: articles gain a rich-text body, author, featured
  flag, tags and view/download counters (migration 0011, existing
  rows untouched); original newspaper PDFs are stored unmodified
  with SHA-256 checksums and a full replacement history
  (`news_attachments`), and are served only through
  publication-gated, range-capable endpoints. Public archive with
  facet filters, full-text search over a plain-text projection of
  the body, an article reader page at `/news/:slug`, and a PDF.js
  viewer (zoom, fit, fullscreen, download); admin "News Clippings"
  screen with bulk actions, tag editor, and a PDF panel (upload
  with progress, preview, replace, remove) — all under the existing
  `news.manage` permission and audit log. Independent reviews
  (ChatGPT 8.7/10, Gemini 8.6/10) drove a hardening round before
  release: serialized PDF replacement, the generic media route
  closed to documents, sandboxed PDF responses, and markup-free
  search indexing. New integration suite: 28 tests; platform
  totals 97 integration + 121 unit, all passing. Details:
  NEWS_CLIPPINGS_REVIEW.md, docs/news-clippings/walkthrough.md.
- `e4981f37` — The original single-page Figma bundle split into seven
  routed React Router pages (Home, Museum, Gallery, Gift Shop, News,
  Foundation, About) with shared Nav/Footer. Content and design
  unchanged.

## Phase 0 — Audit & design — `92f4f023`

- Eight design documents: PROJECT_AUDIT, ARCHITECTURE,
  DATABASE_DESIGN (41 tables), PERMISSIONS, CMS_CONTENT_MAPPING,
  SECURITY_THREAT_MODEL, DEPLOYMENT_REQUIREMENTS, DEVELOPMENT_ROADMAP.
- 14 audit screenshots; ChatGPT + Gemini reviews synthesised in
  PHASE0_REVIEW.md with 12 adopted amendments (A1–A12: stock
  reservations, order idempotency keys, TOTP replay protection,
  preview tokens, publication concurrency, resource-level
  authorisation, async PDF via outbox, outbox leasing, session
  revocation generations, renderer modes, module query contracts,
  hosting proof-of-concept gate).

## Phase 1 — Foundation — `198a9861` (+ `f616cd5a`)

- Shared contracts package (`@bodhisattva/shared`): 13-code error
  catalogue, 49 permissions, pagination, exact paisa money maths.
- Express + TypeScript server: fail-fast env validation, structured
  errors, request ids, pino logging, health endpoints.
- Drizzle + mysql2 with migration toolchain; identity-only first
  migration (8 tables) with tested rollback; safe seed framework (no
  accounts). SETUP.md.

## Phase 2 — Authentication & RBAC — `f4d1bb7b`

- Email-OTP registration (8-digit, HMAC-stored), server-side sessions
  (hashed ids, per-role lifetimes, session_version revocation), CSRF
  double-submit + Origin check, MySQL-backed rate limiting (fails
  closed), Argon2id passwords.
- Admin invitations (hashed one-time tokens), TOTP MFA with replay
  protection + recovery codes, role management with rank caps and the
  last-Super-Admin guard, append-only audit log, Super Admin
  bootstrap CLI. Reviews: ChatGPT 8.2, Gemini 7.5 (PHASE2_REVIEW.md).

## Phase 3 — CMS backend + frontend switch — `2f8d20b7`

- Pages/revisions/sections with clone-on-edit drafts, optimistic
  concurrency, publish/rollback, hashed preview tokens; 22-type
  section registry with sanitize-on-save; menus; site settings.
- Media pipeline: Sharp-sniffed uploads, re-encode + EXIF strip,
  derivatives, reference-checked deletes.
- All seven pages re-rendered from the API (pixel diffs ≤0.6% vs the
  hardcoded originals). Reviews: ChatGPT 8.8, Gemini 8.5.

## Phase 4 — Visual page builder — `2094ee87`

- Admin SPA at `/admin`: three-panel editor (dnd-kit navigator, live
  canvas at three widths, inspector), autosave, conflict banner,
  preview, publish, revisions drawer; media library, menus, settings,
  users screens.
- Review fixes: draft saves bound to the loaded revision, autosave
  snapshot semantics, in-place MFA step-up, TOTP QR enrolment,
  schema-drift contract test. Reviews: ChatGPT 8.5, Gemini 8.0.

## Phase 5 — Museum content modules — `4a72c8a6`

- Collections, exhibitions (+ gallery items), news (+ categories),
  foundation programs, testimonials as database records with admin
  CRUD/reorder and public APIs; seeded canonically (6/9/5/8/4/4) with
  the hardcoded copies deduplicated — Home's news headlines and two
  collection cards corrected to the canonical records; the Museum
  category filter fixed (defect D1). Reviews: ChatGPT 8.2, Gemini 7.8.

## Phase 6 — Gift Shop ecommerce — `30edaf19`

- 11 store tables; public shop APIs; login-gated persistent cart
  (with the login round-trip intent preserved); customer addresses;
  COD checkout with server-recomputed totals, idempotency keys and
  A1 stock reservations. The concurrency test caught a real oversell
  under REPEATABLE READ — fixed with READ COMMITTED + row locks
  (exactly one winner, proven repeatedly). Admin catalogue +
  inventory ledger. Reviews: ChatGPT 8.8, Gemini 7.5.

## Phase 7 — Orders & invoices — `5c4d2bce`

- Centralised order state machine (the only writer of order status);
  approval as one transaction — stock finalised, exactly one invoice
  from a frozen snapshot, invoice email enqueued; cancellation
  restores stock exactly once on both paths (RELEASE /
  ORDER_RESTORE).
- Deterministic PDFKit invoice PDFs (byte-identical re-downloads
  after template edits), versioned invoice templates, email outbox
  with leased claiming/backoff/dead-letter/resend, admin order queue
  with age badges, audit-log screen, customer invoice downloads
  (IDOR-tested). Reviews: ChatGPT 8.7, Gemini 8.5 (PHASE7_REVIEW.md).

## Phase 8 — Hardening, security, deployment readiness — *(this commit)*

- **Credit notes**: created inside the post-approval cancellation
  transaction (own `CN-` sequence, totals mirrored, PDF + customer
  email), closing the Phase 7 reviewers' top accounting item.
- **Outbox fencing**: lease-version conditional updates, SMTP timeouts
  far below the lease, deterministic per-row Message-ID, single-flight
  in-process drain.
- **Deadlock retry** (MariaDB 1213/1205, bounded, state re-validated)
  on checkout and order transitions; heavier concurrency tests
  (3-way approval, approve-vs-cancel, competing drains).
- **Security suite** (14 tests: injection, XSS, CSRF, IDOR, fixation,
  brute force, privilege escalation, traversal, malicious uploads,
  disclosure) — it **found and fixed a real vulnerability**: the OTP
  wrong-attempt counter was rolled back by its own transaction,
  leaving codes brute-forceable; now regression-locked.
- **Backup + restore drill** executed and evidenced (total restore
  ≈22 s on the dev dataset; restored MFA + invoice PDF verified
  byte-identical). Production-config pass: five broken-environment
  boots all fail fast.
- **WYSIWYG editor** (TipTap) for the builder's rich-text fields,
  confined to the server's sanitize allowlist, with HTML source view
  and textarea fallback.
- **Ops utilities** (Phase 8d): `media:sweep` (dry-run orphan media
  sweep), `inventory:reconcile` (ledger reconciliation — dev database
  verified all-consistent), last-good cache for the two public CMS
  reads.
- **Documentation set**: README (rewritten), API_DOCUMENTATION,
  CMS_GUIDE, ECOMMERCE_GUIDE, SECURITY_GUIDE, DEPLOYMENT_GUIDE
  (runbook — **not yet executed**), BACKUP_RESTORE,
  KNOWN_LIMITATIONS, this changelog.
- Deployment itself remains pending the owner's cPanel connection,
  the hosting proof-of-concept gate, and explicit deployment
  approval.
