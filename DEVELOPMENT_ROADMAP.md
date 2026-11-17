# DEVELOPMENT_ROADMAP.md

## Phase-by-Phase Plan — Bodhisattva Dynamic Museum Platform

| Field | Value |
|---|---|
| Project | Bodhisattva Museum Website + Visual CMS + Ecommerce + Secure Administration |
| Repository | `sanjeevRae/bodhisattva-main` |
| Phase | Phase 0 — Audit and Planning |
| Document owner | Subagent 4 — Deployment Feasibility + Roadmap (under the Lead Architect) |
| Date | 2026-11-17 |
| Specification references | Part 20 (Subagent Workflow), Part 21 (ChatGPT + Gemini Review), Part 22 (Development Phases), Part 23 (Testing and Acceptance Criteria), Part 25 (Rules for Reporting Completion) |

---

## 1. Governing rules for all phases

These rules come from the Master Specification and bind every phase below.

1. **Phases run in order. No phase skipping** (Part 22: "Do not skip phases merely to produce a faster demonstration"). A later phase's work may be *prepared* (designs, contracts) while an earlier phase runs, but it may not be *integrated* until its entry gate is met.
2. **Shared contracts first** (Part 20): before any subagent writes module code, the Lead Architect defines and freezes — architecture, database schema, permission matrix, API conventions, shared TypeScript types, error response format, CMS section schema, order lifecycle, coding standards, test requirements. Subagents implement against the contracts; nobody modifies a shared contract independently.
3. **Subagent coordination** (Part 20): separate branches or worktrees; explicit file ownership per subagent; no conflicting migrations (migrations are sequential and reviewed by the Lead before merge); relevant tests run before integration; the Lead merges; cross-module tests re-run after every integration. The Lead never claims a subagent completed work without inspecting its actual output.
4. **Independent review after every major phase** (Part 21): ChatGPT (architecture, security design, transactions, race conditions, authorization) and Gemini (repository-scale analysis, UI consistency, CMS design, regression analysis) each review the phase's architecture documents, changed sources, migrations and test results. Findings are compared, disagreements resolved through evidence and documented decisions, and each finding validated against the repository and reproducible tests before remediation. **No real credentials, customer records, OTP/invitation secrets or production data are ever supplied to external AI services.**
5. **Reporting discipline** (Part 25): every phase closes with a report containing — implemented functionality, changed-file summary, database migration summary, tests executed, test results, security findings, remaining issues, verification evidence. The words *implemented*, *tested*, *verified*, *deployed*, *not implemented* and *known limitation* are used precisely and never interchangeably. A requirement is not complete because a code file exists (Part 23).
6. **Preservation** (Part 1.2): the seven existing public pages are the visual source of truth. No phase may replace the site with a generic template, remove working sections, break existing URLs, or make the public site depend on hardcoded demo data.
7. **Hosting gate:** the deployment design is provisional until the `DEPLOYMENT_REQUIREMENTS.md` checklist is verified (its Section 11 Go/No-Go gate). Local development never waits on hosting verification; deployment claims do.

### Subagent roster (Part 20)

| Agent | Responsibility |
|---|---|
| **Lead Architect & Orchestrator** | Contracts, integration, merges, phase gates, reporting |
| **Subagent 1 — Backend & Database** | Schema, migrations, Node API, authentication, sessions, RBAC, validation, transactions, audit service |
| **Subagent 2 — CMS & Frontend** | Existing-page migration to dynamic rendering, CMS interface, visual editor, section registry, inline editing, drag-and-drop, media library, preview/publication UX |
| **Subagent 3 — Ecommerce** | Products, categories, inventory, cart, checkout, orders, customer dashboard, invoices, email workflows |
| **Subagent 4 — Security** | Threat model, authentication review, MFA, invitations, authorization, rate limits, CSRF, upload protection, API security, vulnerability review |
| **Subagent 5 — QA & Testing** | Unit, integration, browser, regression, concurrency and security tests; deployment verification |

---

## 2. Phase 0 — Audit and Planning

**Status: IN PROGRESS** (see Section 11 for the detailed status record).

### Objectives
Study the complete existing repository and produce the architecture, feasibility, database, security and UI-preservation plans — before any implementation (Final Execution Instruction). No major implementation in this phase.

### Work items
- Inspect the entire repository: `package.json` and all configuration, dependencies, route handling, all seven page components, `Nav.tsx`, `Footer.tsx`, `shared.tsx`, reusable components, all images/logos/fonts/assets, hardcoded content inventory, existing forms and interactions, conflicts with the proposed backend, and whether any API/database layer already exists (Part 1.3).
- Capture desktop and mobile screenshots of all seven current pages (the visual-preservation baseline).
- Prepare the existing-content inventory and the section-by-section CMS mapping.
- Inspect hosting feasibility (delegated to `DEPLOYMENT_REQUIREMENTS.md`; all items currently UNVERIFIED).
- Create the architecture, database design, permission matrix, threat model and roadmap documents.

### Deliverables (Part 22, Phase 0)
- `PROJECT_AUDIT.md`
- `ARCHITECTURE.md`
- `DATABASE_DESIGN.md`
- `PERMISSIONS.md`
- `CMS_CONTENT_MAPPING.md`
- `SECURITY_THREAT_MODEL.md`
- `DEPLOYMENT_REQUIREMENTS.md`
- `DEVELOPMENT_ROADMAP.md` (this document)
- Desktop + mobile screenshots of all seven existing pages

### Entry gate
- Meena's instruction to begin (given 2026-11-17 with the Master Specification). **Met.**

### Exit gate
- All eight documents exist and are internally consistent (schema ↔ permissions ↔ API contracts ↔ section registry).
- Screenshots captured for all seven pages, desktop and mobile.
- **Meena reviews the blocking decisions (Section 10) and answers or explicitly defers each one.** Deferred items are recorded as open risks, not silently assumed.
- ChatGPT + Gemini Phase 0 review completed on the document set (Part 21), findings dispositioned.

### Dependencies
- None upstream. Everything else depends on this phase.

### Ownership
- Lead Architect: integration and consistency of the document set.
- Subagent 1: `DATABASE_DESIGN.md`, backend portions of `ARCHITECTURE.md`.
- Subagent 2: `PROJECT_AUDIT.md`, `CMS_CONTENT_MAPPING.md`, screenshots.
- Subagent 4 (Security role): `SECURITY_THREAT_MODEL.md`, `PERMISSIONS.md` review.
- Subagent 4 (this assignment): `DEPLOYMENT_REQUIREMENTS.md`, `DEVELOPMENT_ROADMAP.md`.
- Subagent 5: reviews all documents for testability against Part 23.

---

## 3. Phase 1 — Foundation

### Objectives
Stand up the backend skeleton and the local development environment: Express + TypeScript server in `server/` per the Part 2.2 module structure, MySQL/MariaDB connectivity via Drizzle + mysql2, the migration toolchain, Zod validation, structured error handling, health endpoints, logging, shared API types, and the standard scripts (`db:migrate`, `db:status`, `db:seed`, `test`).

### Deliverables
- Working backend foundation with a **verified database connection** (local MySQL; Part 22 wording — the claim requires an actual successful connection, per Part 25).
- Migration framework with the initial (empty or identity-only) migration and a tested rollback path.
- `GET /health` (liveness) and a database-backed readiness check.
- Shared TypeScript types package/location used by both frontend and backend (error format, pagination, ID conventions).
- Local development setup documented (frontend dev server, API, local MySQL, mail-catcher/test mailbox) per Part 19.1; `.env.example` files with no real secrets.
- Safe seed framework (roles/permissions seeding arrives with Phase 2; Phase 1 proves the mechanism without seeding any accounts — Part 4: never seed production with demonstration accounts).

### Entry gate
- Phase 0 exit gate met, including frozen contracts (schema v1, API conventions, error format).
- Local MySQL available in the development environment.

### Exit gate (evidence required)
- From a clean checkout, following only the written setup doc: dependencies install, migrations run, API starts, health + readiness return success, `npm run test` passes (initial suite: config loading, error format, migration up/down).
- `db:status` output captured in the phase report.
- ChatGPT + Gemini review of the foundation (structure, config handling, secret hygiene).

### Dependencies
- Phase 0. Hosting verification (roadmap Section 1, rule 7) is **not** required to build locally, but the *deployment-shaped* choices in this phase (Node version target, Passenger assumptions) stay provisional until the `DEPLOYMENT_REQUIREMENTS.md` gate clears.

### Ownership
- Subagent 1 (lead), Subagent 4 (config/secret-handling review), Subagent 5 (setup-from-scratch test on a clean environment).

---

## 4. Phase 2 — Authentication and RBAC

### Objectives
Implement the complete identity system of Parts 7–9 and 14–15: customer registration with HMAC-protected 8-digit email verification codes (expiry, single-use, attempt limits, resend cooldown, per-email send caps), Argon2id password hashing (parameters benchmarked, Part 15.1), login with generic failure messages and rate limiting, server-side sessions (`__Host-session`, hashed session IDs, rotation, revocation, logout-all-devices), password reset with hashed single-use tokens, admin invitation system (Super Admin only, hashed expiring one-time tokens), TOTP MFA for Super Admin/Admin/Store Admin (encrypted secrets, hashed recovery codes), the permission-based RBAC middleware (deny-by-default, per-endpoint authorization, ownership checks), the one-time CLI Super Admin bootstrap, and audit logging for all auth events.

### Deliverables
- Functional authentication and **tested** authorization (Part 22 wording) covering the Part 17 auth/account endpoint families.
- Permission matrix from `PERMISSIONS.md` implemented as data (roles, permissions, role_permissions) with seed scripts for roles/permissions only.
- MySQL-backed rate-limit store (Redis is not assumed available on cPanel — Part 15.3) with the initial policies of Part 15.3 configurable via protected server configuration.
- Audit log write path + the event taxonomy of Part 14.

### Entry gate
- Phase 1 exit gate met. Argon2id benchmark environment identified (target host if verified; otherwise local benchmark recorded as provisional).

### Exit gate (evidence required — from Part 23, Authentication & RBAC)
- Automated tests demonstrate: unverified account cannot log in; expired OTP rejected; reused OTP rejected; OTP attempts beyond the limit blocked; duplicate registration handled safely; password reset token single-use and expiring; invitation expiry enforced and reuse rejected; MFA enforced for admin roles (login cannot complete without TOTP once enrolled); logout revokes the session server-side.
- RBAC negative tests: Store Admin cannot call CMS page endpoints; Admin cannot manage roles/invitations; Customer cannot reach any admin endpoint; Customer A cannot read Customer B's profile/orders (IDOR suite).
- Rate-limit tests: login, registration, OTP send/verify and recovery limits trip and recover per policy.
- ChatGPT + Gemini security review of the auth design and code; findings dispositioned in the phase report.

### Dependencies
- Phase 1. SMTP route decision (blocking decisions, Section 10) — without a working mail path, verification/invitation/reset flows can only be tested against a local mail catcher, which is acceptable for this phase but must be recorded.

### Ownership
- Subagent 1 (implementation), Subagent 4 (design review + adversarial test cases), Subagent 5 (test execution), Subagent 2 (login/register/verify UI only — no security logic in the frontend beyond presentation).

---

## 5. Phase 3 — Dynamic CMS Backend

### Objectives
Build the data and service layer of Part 5 (without the visual builder UI, which is Phase 4): page and section models with revisions, draft/preview/publish workflow, slug uniqueness and reserved-route protection, menu/navigation APIs, site settings, media management APIs (validated uploads, re-encoding, random names, private storage), and the **content migration**: every existing hardcoded section of the seven pages converted into seeded database content matching `CMS_CONTENT_MAPPING.md`, served through `GET /api/pages/:slug` and the other Part 17 CMS endpoints. Public pages switch to database-backed rendering in this phase while remaining visually identical.

### Deliverables
- All seven public pages load from database-backed content (Part 22 wording), pixel-compared against the Phase 0 screenshots.
- Publishing service: draft → preview → publish; published pages serve the latest successful revision; failed publish leaves the previous published revision intact; rollback to a prior revision works (Part 5.5).
- Media API with the Part 5.6/15.6 validations (content-based type checking, size limits, re-encoding, random names, no executables, private storage outside `public_html`).
- Navigation and footer rendered from menu data (Part 5.7), editable via API.

### Entry gate
- Phase 2 exit gate met (CMS admin endpoints require working auth + RBAC + audit).

### Exit gate (evidence required — from Part 23, CMS, backend half)
- Screenshot diff: all seven routes, desktop + mobile, before vs after — no unintended visual change.
- Tests: draft edits are not publicly visible; publish makes them visible; publish failure preserves the previous version; revision restore works; duplicate slug rejected; reserved slugs (`login`, `account`, `admin`, …) cannot be taken by a CMS page; section config failing schema validation cannot be published; rich text is sanitized (XSS payload suite).
- Migration evidence: the content-seed migration is reproducible from a clean database and its rollback empties content without breaking the schema.
- ChatGPT + Gemini review (publication workflow, sanitization, migration integrity).

### Dependencies
- Phases 1–2; `CMS_CONTENT_MAPPING.md` (Phase 0); media storage layout from `DEPLOYMENT_REQUIREMENTS.md` Section 6 (local equivalent for development).

### Ownership
- Subagent 1 (models, services, APIs), Subagent 2 (public-page dynamic rendering switch + visual diff), Subagent 4 (sanitization/upload security review), Subagent 5 (diff + workflow tests).

---

## 6. Phase 4 — Visual Page Builder

### Objectives
Build the Google Sites-inspired three-panel editor of Part 5.2–5.4 on top of the Phase 3 backend: left panel section navigator (drag handle, select, edit, duplicate, hide/show, delete, add, reorder — order persisted via the reorder endpoint), centre panel **live canvas rendering the real page components** with click-to-edit overlays (never a fake preview), right panel property inspector exposing only properties valid for the selected section type. Implement the 19-type section library of Part 5.3 as a controlled, schema-validated component registry; inline text editing; image replacement from the media library; undo/redo; autosave + manual save with success/failure feedback; unsaved-changes navigation guard; optimistic concurrency (version checking) so one admin cannot silently overwrite another's newer changes; desktop/tablet/mobile preview widths; draft/preview/publish from inside the editor.

### Deliverables
- Administrators can create and edit pages without writing code (Part 22 wording) — demonstrated end-to-end on a staging build.
- Section registry with Zod-validated configs for all 19 required section types; no arbitrary HTML/JS execution path (Part 5.3).
- Media library UI (Part 5.6): upload, search, filter, folders/categories, rename, alt text, captions, dimensions/size display, unused-media detection.
- Navigation/footer management UI (Part 5.7).

### Entry gate
- Phase 3 exit gate met (the builder is a client of the Phase 3 APIs and revision system; building it earlier would couple it to an unstable backend).

### Exit gate (evidence required — from Part 23, CMS, UI half)
- Scripted + manual test pass: create page, add/edit/duplicate/hide/delete/reorder sections, edit text inline, replace image, change button label/link — all persist after reload; reorder survives publish; undo/redo behave; autosave indicator truthful; concurrent-edit conflict produces a warning, not silent overwrite; leaving with unsaved changes prompts.
- Usability/visual check by Gemini (UI consistency with the site's branding, Part 21) and a Lead-led walkthrough recorded in the phase report.
- Accessibility spot-check of editor controls (keyboard focus, labels) per Part 18.

### Dependencies
- Phase 3. dnd-kit adoption decided in Phase 0 contracts (Part 2.1 permits it "if appropriate").

### Ownership
- Subagent 2 (lead), Subagent 1 (any API deltas — via contract change process only), Subagent 4 (registry/XSS review), Subagent 5 (persistence + conflict tests).

---

## 7. Phase 5 — Museum Content Management

### Objectives
Deliver the domain modules of Part 6 as managed data with admin UIs and dynamic public rendering in the existing designs: collections (CRUD, images, categories, featured ordering), exhibitions (dates, location, status, featured, gallery images), gallery items (categories, years, exhibition association, filtering, sort order), news clippings (source, date, external URL or uploaded document, categories, search/filter), foundation programs + impact statistics + testimonials. Public Museum/Gallery/News/Foundation pages render these records through their current components.

### Deliverables
- Museum website content is fully manageable (Part 22 wording): every collection, exhibition, gallery item, article, program, statistic and testimonial visible on the public site exists as a database record editable in admin.
- Admin list/edit screens for each module, permission-gated per `PERMISSIONS.md` (`museum.collections.manage`, `museum.exhibitions.manage`, `museum.gallery.manage`, `news.manage`, `foundation.manage`).

### Entry gate
- Phase 3 exit gate met (these modules reuse the media, revision and rendering infrastructure). Phase 4 is **not** a hard dependency for the backend modules, but public-page changes must not fight the builder's section system — sequencing within the phase is Lead-coordinated. The default plan runs Phase 4 first, as listed in Part 22.

### Exit gate (evidence required)
- For each module: create → publish → appears on the correct public page in the existing design; unpublish → disappears; reorder → reflected publicly. Verified against screenshots.
- Existing launch content fully migrated (the current hardcoded collections/exhibitions/articles/programs are the seed data — no content lost; count check record-by-record against `CMS_CONTENT_MAPPING.md`).
- ChatGPT + Gemini review (data integrity + UI consistency).

### Dependencies
- Phases 1–3 (4 by default order).

### Ownership
- Subagent 1 (APIs), Subagent 2 (admin UIs + public rendering), Subagent 5 (module test matrix).

---

## 8. Phase 6 — Ecommerce

### Objectives
Turn the Gift Shop into the real store of Part 10: product management (categories, multiple images, SKU, price/sale price, stock, variants where needed, archive-not-delete for products with order history), inventory with movement history, the public shop in its existing design (grid, detail, search, filters, sorting, pagination, stock availability), customer addresses, the **login-gated persistent cart** (Part 10.3: browsing is public; adding to cart requires login, preserves the intended action across the login round-trip, then completes it; cart authoritative in MySQL; server-side price and stock validation on every operation), and Cash-on-Delivery checkout (Part 10.4: full delivery details, backend-recalculated subtotal/shipping/discounts/tax/total, customer confirmation, transactional order creation, oversell-proof stock handling per Part 10.5).

**Behaviour change to note:** the current shop's cart is anonymous and in-memory (verified fact, `DEPLOYMENT_REQUIREMENTS.md` §2.5). The specified cart is login-gated and persistent. This is a user-visible change and is on the blocking-decisions list (Section 10) for Meena's explicit acceptance.

### Deliverables
- Working ecommerce shopping and checkout flow (Part 22 wording): a customer can register, verify, log in, add products, check out with COD, and receive an order in `PENDING_APPROVAL` state with correct totals and stock effects.

### Entry gate
- Phase 2 exit gate met (customer accounts, sessions, addresses prerequisites).
- Phase 5 not strictly required, but product imagery uses the Phase 3 media system — Phase 3 exit gate is therefore also required.

### Exit gate (evidence required — from Part 23, Ecommerce)
- Tests: browsing without login works; add-to-cart while logged out redirects through login and completes the original action; cart persists across logout/login and across devices (same account); quantity edits and removals validate stock; checkout totals equal an independent backend recalculation (client-submitted prices are ignored — tampering test); insufficient stock rejected; **concurrent-checkout test: two simultaneous orders for the last unit cannot both succeed and stock never goes negative**; cancelled/failed checkout leaves no orphan order; order items snapshot product name and price.
- Currency/tax/shipping configuration (blocking decision, Section 10) applied and visible in totals tests.
- ChatGPT + Gemini review with explicit focus on race conditions and price integrity (Part 21 list).

### Dependencies
- Phases 1, 2, 3. Invoice work is Phase 7 — Phase 6 ends at order creation.

### Ownership
- Subagent 3 (lead), Subagent 1 (transaction patterns review), Subagent 4 (price-tampering/IDOR review), Subagent 5 (concurrency tests).

---

## 9. Phase 7 — Orders and Invoices

### Objectives
Build the Store Admin order workspace and the invoice system of Parts 11–12 and the email workflows of Part 16: order list (search, pagination, date/status filters), order detail (customer, items, address, history, invoice info), the lifecycle state machine (`PENDING_APPROVAL → APPROVED → PROCESSING → SHIPPED → DELIVERED`, controlled cancellation with reasons), the **idempotent approval transaction** (validate state → lock/finalize inventory → create invoice with unique number + immutable data snapshot + template version → commit → queue invoice email → audit; email failure never rolls back approval; retries never duplicate invoices — Part 11.2), cancellation with correct stock restoration and customer notification, PDF invoice generation (PDFKit) with the full Part 12 field set, the editable invoice template system (validated configuration only — logo, company details, prefix, colours, footer, terms, field toggles, versions; previously issued invoices never change), the email outbox queue with retries and manual resend, ownership-protected invoice downloads for customers, and the customer dashboard of Part 13 (overview, profile, addresses, orders, order detail, invoices, security/sessions).

### Deliverables
- Store Admin can manage orders and send professional invoices (Part 22 wording).
- Super Admin audit interface (Part 14) with filters (date, actor, role, action, module, success/failure) over the now-complete event stream.
- Invoice template editor with preview and version management.

### Entry gate
- Phase 6 exit gate met (orders must exist and be trustworthy before approval/invoice logic is built on them).

### Exit gate (evidence required — from Part 23, Orders & Invoices)
- Tests: approval happy path produces exactly one invoice with a unique number; **double-approval (double-click + concurrent requests) produces exactly one invoice**; approval with SMTP down still commits and the queued email retries to success without duplicating the invoice; cancellation at each permitted state restores stock exactly once and writes status history with actor/reason; forbidden transitions rejected; issued invoice PDF is byte-stable after a later template edit (snapshot test); template changes apply to the *next* invoice only; customer can download their own invoice and is denied another customer's (IDOR test); PDF content matches the Part 12 field checklist (visual + text-extraction check).
- Email queue behaviour verified against a real SMTP test target (local catcher minimum; the production SMTP route if by then decided).
- ChatGPT + Gemini review focused on duplicate-invoice, stock-restoration and email-retry failure modes (Part 21 list).

### Dependencies
- Phase 6; SMTP decision (Section 10) for realistic email testing; invoice company details/prefix decision (Section 10) for template defaults.

### Ownership
- Subagent 3 (lead), Subagent 1 (transaction/idempotency), Subagent 4 (download authorization, template-injection review), Subagent 5 (failure-injection tests: SMTP down, double submit, mid-transaction failure).

---

## 10. Phase 8 — Final Security and Deployment

### Objectives
Harden, prove and ship: the full Part 15 security pass against OWASP ASVS 5.0 and the OWASP API Security Top 10, regression and browser testing (Playwright), concurrency testing, backup + **restore drill**, production configuration, cPanel deployment test on the verified hosting, monitoring/logging setup, and the complete Part 24 documentation set.

### Deliverables
- Verified deployment and final release report (Part 22 wording).
- Documentation set (Part 24): `README.md` (updated), `API_DOCUMENTATION.md`, `CMS_GUIDE.md`, `ECOMMERCE_GUIDE.md`, `SECURITY_GUIDE.md`, `DEPLOYMENT_GUIDE.md`, `BACKUP_RESTORE.md`, `TESTING_REPORT.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md` (plus the Phase 0 documents maintained).
- Production runbook: build commands, cPanel Node setup, startup config, environment config, database creation, migrations, static deployment, API routing, SSL verification, SMTP config, cron config, backup config, restore instructions, rollback instructions (Part 19.4). **No DNS or production configuration is modified without explicit deployment approval** (Part 19.4).

### Entry gate
- Phase 7 exit gate met.
- **`DEPLOYMENT_REQUIREMENTS.md` Go/No-Go gate cleared** — every checklist item verified with evidence, or a Section 5 fallback architecture formally chosen by Meena. Deployment to an unverified host is prohibited.

### Exit gate (evidence required — from Part 23, Security & Deployment)
- Security test suite executed and reported: SQL injection, XSS, CSRF, IDOR, session fixation, brute force/rate-limit bypass attempts, privilege escalation, path traversal, malicious uploads, insecure object access, information disclosure, unauthorized invoice downloads.
- Full regression: all seven public routes, CMS acceptance list, auth acceptance list, RBAC acceptance list, ecommerce and invoice acceptance lists (Part 23) — pass/fail per item in `TESTING_REPORT.md`, no silent skips.
- Backup taken and **restored into a scratch environment**, restore timed and verified (login, CMS page, invoice download smoke tests).
- Production smoke test on the real host: frontend build served, API health, DB connection, one migration cycle, SSL valid, one real email delivered (verification or test invoice), cron jobs observed running.
- ChatGPT + Gemini final reviews; all critical/high findings remediated or formally accepted as known limitations by Meena.
- Final release report per Part 25 distinguishing implemented / tested / verified / deployed / not implemented / known limitations.

### Dependencies
- All prior phases; hosting verification; Meena's deployment approval for any DNS/production change.

### Ownership
- Subagent 4 + Subagent 5 (co-leads for security/QA), Subagent 1–3 (remediation), Lead (release report and go-live recommendation).

---

## 11. Blocking decisions for Meena

These decisions block or shape the phases noted. Each needs an answer or an explicit "defer" from Meena; implementers must not guess them.

| # | Decision | Why it blocks | Needed by |
|---|---|---|---|
| B1 | **Hosting verification session**: provide access to (or answers from) the target cPanel account so `DEPLOYMENT_REQUIREMENTS.md` §4 can be verified — Node.js + versions, Passenger, SSH, MySQL/MariaDB version, cron interval, SMTP limits, disk/inodes, LVE limits, SSL. If the account cannot run Node, choose fallback A (VPS) or B (split hosting). | Deployment design cannot be finalized; Phase 8 cannot start without it (Go/No-Go gate). | End of Phase 0 / during Phase 1 |
| B2 | **SMTP provider**: host SMTP vs an external transactional provider (e.g. Google Workspace SMTP, Amazon SES, SendGrid, Mailgun), and the sending domain/`SMTP_FROM` identity with SPF/DKIM. | Verification codes, resets, invitations and invoice email all depend on it; deliverability differs greatly. | Phase 2 (testable with a local catcher until then) |
| B3 | **Domain / `APP_URL`**: which domain (and any `api.` subdomain under split hosting) the dynamic site will use. | Cookies, email links, SSL, CORS allowlist, Cloudflare setup all derive from it. | Phase 1 (configuration), hard by Phase 8 |
| B4 | **Cart behaviour change acceptance**: the current Gift Shop cart is anonymous and in-memory; the specification replaces it with a **login-gated, database-persistent** cart (Part 10.3). Confirm this user-visible change is acceptable. | Defines Phase 6's core flow; changing it later re-opens checkout design. | Before Phase 6 entry |
| B5 | **Invoice company details and prefix**: legal/trading name, address, phone/email, tax registration (e.g. PAN/VAT) to print on invoices, and the invoice number prefix/format. | Invoice template defaults and the numbering scheme are Phase 7 inputs; issued invoices are immutable, so this must be right before the first real invoice. | Before Phase 7 entry |
| B6 | **Currency and tax configuration**: currency is NPR per project context — confirm; whether prices are tax-inclusive or tax is added; VAT rate if any; shipping fee rules (flat, per-district, free threshold). | Checkout totals (Phase 6) and invoice math (Phase 7) are built on these rules; totals tests encode them. | Before Phase 6 entry |
| B7 | **Cloudflare**: does a Cloudflare account exist for the domain under Meena's/client's control, and is a paid plan (if needed for WAF/bot features) approved? | Phase 8 hardening and DNS work; account ownership must sit with the client (see `DEPLOYMENT_REQUIREMENTS.md` §10). | Phase 8 (earlier is better) |
| B8 | **Initial Super Admin identity**: the email address for the one-time CLI bootstrap Super Admin (Part 8.1). | Required the first time the system is deployed anywhere real; never created via a public endpoint. | Phase 2 testing / Phase 8 go-live |

Non-blocking but recorded: backup retention periods (`DEPLOYMENT_REQUIREMENTS.md` §9), Argon2id cost parameters (benchmark-derived, Subagent 4 owns), and the `.history/` folder cleanup in the repository (housekeeping, Lead).

---

## 12. Phase 0 status record

Recorded 2026-11-17, per Part 25 reporting rules:

| Item | Status |
|---|---|
| Repository inspection (Part 1.3 checklist) | In progress across subagents; verified facts so far: static React+Vite SPA, seven routed pages, **no backend/API/database layer exists**, cart is in-memory only, content fully hardcoded |
| `PROJECT_AUDIT.md` | In preparation (Subagent 2) |
| `ARCHITECTURE.md` | In preparation (Lead / Subagent 1) |
| `DATABASE_DESIGN.md` | In preparation (Subagent 1) |
| `PERMISSIONS.md` | In preparation (Lead / Subagent 4 Security role) |
| `CMS_CONTENT_MAPPING.md` | In preparation (Subagent 2) |
| `SECURITY_THREAT_MODEL.md` | In preparation (Subagent 4 Security role) |
| `DEPLOYMENT_REQUIREMENTS.md` | **Written** — all hosting items marked UNVERIFIED; verification awaits decision B1 |
| `DEVELOPMENT_ROADMAP.md` | **Written** (this document) |
| Screenshots (7 pages × desktop/mobile) | In preparation (Subagent 2) |
| Hosting verification | **Not performed** — no access to the target cPanel account has been provided yet; nothing in `DEPLOYMENT_REQUIREMENTS.md` §4 is verified |
| ChatGPT + Gemini Phase 0 review | Not yet run — scheduled once the document set is complete |
| Phase 0 exit gate | **Not met** — pending: document set completion, screenshots, external review, and Meena's review of blocking decisions B1–B8 |

Nothing in Phase 0 has been *implemented*, *deployed*, or *verified* beyond the repository facts stated above, and no claim in this roadmap should be read as saying otherwise.

---

## 13. Sequencing note (realistic ordering)

- The critical path is **0 → 1 → 2 → 3 → 6 → 7 → 8**, with Phase 4 (builder) and Phase 5 (museum modules) between 3 and 6 in the specification's order. Phases 4 and 5 both depend on Phase 3's platform (media, revisions, rendering); they may overlap each other under Lead coordination, but neither may *integrate* before Phase 3's exit gate.
- Authentication (Phase 2) precedes everything administrative — there is no interim "temporary login". Building CMS or store admin screens against a placeholder auth and retrofitting real RBAC later is explicitly out of plan.
- Ecommerce splits deliberately: shopping/checkout (Phase 6) before order operations/invoices (Phase 7), because approval, invoicing and email correctness can only be tested against trustworthy orders.
- Hosting verification (B1) is on the *deployment* critical path, not the development one: Phases 1–7 proceed locally regardless, but if verification ultimately forces fallback A or B, Phase 8 absorbs the deployment redesign — another reason to verify early (during Phase 1) rather than at the end.
- Estimates are intentionally absent from this roadmap: until Phase 0's audit is complete and B1 is answered, any date would be invented. Phase durations are estimated at each phase's entry gate, from its actual scope and the previous phase's measured velocity, and recorded in the phase report.

---

## Appendix — Document control

- Companion documents: `PROJECT_AUDIT.md`, `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `PERMISSIONS.md`, `CMS_CONTENT_MAPPING.md`, `SECURITY_THREAT_MODEL.md`, `DEPLOYMENT_REQUIREMENTS.md`.
- This roadmap is updated at every phase gate: status, exit-gate evidence links, and decision outcomes (B1–B8) are recorded in Sections 11–12 as they change.
- No code was changed by the preparation of this document.
