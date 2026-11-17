# PHASE 0 — INDEPENDENT REVIEW SYNTHESIS

**Project:** Dynamic Museum Website + Visual CMS + Ecommerce + Secure Administration
**Repository:** `sanjeevRae/bodhisattva-main`
**Date:** 17 November 2026
**Reviewers:** ChatGPT (architecture + security) and Gemini (CMS design + audit), per Master Specification Part 21. Reviews were run against a structured summary of the Phase 0 documents; no credentials, secrets or customer data were shared.
**Status of this document:** Lead architect's synthesis. "Adopted" items amend the Phase 0 design documents and are binding on Phase 1+ implementation unless Meena decides otherwise. The original documents are unchanged; this file records the deltas.

---

## 1. Verdicts

- **ChatGPT:** architecture fundamentally sound (its words: strong foundations in sessions, DB-backed authorization, immutable invoice snapshots, transactional approval, inventory ledger, outbox, shared rendering registry) — **not production-ready without fixes**. Five highest-priority changes listed in §3 below.
- **Gemini:** concurs on the major risks (shared-component canvas isolation, content-protection hook, hot-linked assets, cPanel constraints) and adds a publishing-model paradox (Finding 1.2) the internal documents had not made explicit.
- **Both reviewers independently agree:** remove the `useWebsiteProtection` content-protection hook; the cPanel/Passenger environment must be *proven* before the design is treated as deployable; PDF generation must be lightweight (PDFKit — already the design choice; Puppeteer explicitly rejected).

## 2. Adopted amendments (binding design changes)

| # | Amendment | Source | Amends |
|---|-----------|--------|--------|
| A1 | **Stock reservations replace deduct-at-creation.** Products track `on_hand`, `reserved`, `available = on_hand − reserved`. Order creation reserves atomically in the order transaction; approval converts reservation → deduction; cancellation/rejection/expiry releases the reservation exactly once. Adds `stock_reservations` + `stock_reservation_items` to the schema plan. | ChatGPT 8.1 | DATABASE_DESIGN §inventory, ARCHITECTURE order lifecycle |
| A2 | **Order idempotency keys.** `POST /api/checkout` (and order creation) requires a client-generated `Idempotency-Key`; unique `(customer_id, idempotency_key)`; same key + same payload returns the original order, same key + different payload returns conflict. Recorded inside the order transaction. | ChatGPT 8.3 (flagged as a critical omission) | ARCHITECTURE API conventions, DATABASE_DESIGN |
| A3 | **TOTP replay protection.** Store last accepted time-step per admin; reject reuse; atomic conditional update so concurrent verifications cannot both succeed. Recovery codes: ≥10, individually Argon2id-hashed, single-use, atomic consumption. MFA reset revokes all sessions for the account. | ChatGPT 3.4 | SECURITY_THREAT_MODEL, DATABASE_DESIGN (mfa tables) |
| A4 | **Separate content-retrieval services.** `getPublishedPage` (public, published pointer only), `getEditorPage`, `getPreviewPage` are distinct server services. Preview uses short-lived, hashed, revision-bound preview tokens — never a bare revision ID. Preview responses carry `X-Robots-Tag: noindex`. | ChatGPT 7.1, 7.5 | ARCHITECTURE CMS pipeline |
| A5 | **Publication concurrency.** Publishing uses optimistic concurrency on the page row (expected previous published pointer) plus a `publication_history` table (who, when, from/to revision). | ChatGPT 7.2 | DATABASE_DESIGN (CMS tables) |
| A6 | **Resource-level authorization is a required third layer.** Permission check → resource/scope check → ownership inside the database query (never fetch-then-check). Role assignment is never generic CRUD: server-side maximum assignable privilege, recent-MFA required, last-Super-Admin protection. Permissions resolved from the DB (no cross-process in-memory cache under Passenger). | ChatGPT 5.1–5.5 | PERMISSIONS.md principles (already stated; now an explicit implementation requirement) |
| A7 | **PDF generation is asynchronous.** The approval transaction creates the invoice record, number and snapshot and enqueues a PDF-generation outbox event; a worker renders the PDF afterwards. A failed render never un-issues an invoice; regeneration always uses the original snapshot + recorded template version. | ChatGPT 9.3 | ARCHITECTURE §invoices (invoice *record* in-transaction already; the *file render* is now explicitly async) |
| A8 | **Outbox worker hardening.** DB-backed worker lease, bounded batches, lock expiry, dead-letter state after max retries, stuck-event alerting. Cron-invoked short-lived worker only — never `setInterval` inside Express. | ChatGPT 10.1–10.3 | ARCHITECTURE email design |
| A9 | **Session revocation generation.** `users.session_version` incremented on password change/reset, MFA reset, suspension and security-relevant role change; sessions validate against it. Rotation is atomic (revoke old + create new in one commit). | ChatGPT 2.1 | DATABASE_DESIGN (users, user_sessions) |
| A10 | **Renderer mode boundary.** The shared section registry renders through `<PageRenderer mode="public" \| "preview" \| "edit">`; in preview/edit modes, links, form submissions and interactive side-effects are neutralised. This preserves the spec's "one real rendering system" rule while isolating the builder canvas. | Gemini 1.1 | ARCHITECTURE CMS pipeline, Phase 4 design |
| A11 | **Module-reference contract.** Sections that display module records store a *query configuration* (module, filters, limit) evaluated at render time against published module data — not frozen snapshots — with defined behaviour for archived/deleted items (item is skipped; a section with zero items hides itself). Page revisions therefore version layout + configuration; module records keep their own publish state, as Part 6 requires. | Gemini 1.2 (paradox resolved by contract, documented here) | CMS_CONTENT_MAPPING.md assumptions |
| A12 | **Hosting proof-of-concept is Phase 1's entry gate.** The 10-point validation (Node version, DB version/transactions, Drizzle migrations + concurrent-transaction test, argon2 + sharp native load test, PDFKit render + private storage, cron worker execution, worker-lock overlap test, Passenger restart/multi-process behaviour, backup restore) must pass on the real host before Phase 1 design is finalised. | ChatGPT §19 | DEVELOPMENT_ROADMAP Phase 1 entry gate, DEPLOYMENT_REQUIREMENTS go/no-go |

## 3. Reviewer disagreements — resolved

- **Money representation.** Gemini proposed integer minor units (paisa); the master specification (Part 4) explicitly requires fixed-precision DECIMAL, and DATABASE_DESIGN.md uses `DECIMAL(12,2)`. **Decision: keep DECIMAL per the specification** — MySQL DECIMAL is exact base-10 arithmetic, so the reviewers' underlying concern (no floating point) is already met. Application code must never route money through JS `number` arithmetic without a decimal library or integer-paisa conversion at the boundary; this is a Phase 1 coding standard.
- **Rate limiting.** Gemini suggested an in-memory LRU limiter. **Rejected:** Passenger runs multiple/recycled processes (ChatGPT 11.2), so in-memory counters are per-process and reset on restart — the MySQL-backed store in SECURITY_THREAT_MODEL.md stands as the single mechanism.
- **Section schema storage.** Gemini suggested a MySQL JSON column for block configs. The design already stores section configuration as validated JSON (Zod at the API boundary) — agreement in substance; no change.

## 4. Noted for later phases (no Phase 0 change)

- COD as three state domains (order / delivery / cash-collection reconciliation) — Phase 6/7 design refinement (ChatGPT 15.2).
- Nepal VAT/invoice legal fields and record retention to be confirmed with the client's accountant before the invoice schema is frozen (ChatGPT 9.2) — joins blocking decision B5.
- Multilingual publication model — only if Meena confirms multilingual content is in scope (ChatGPT 15.1); not in the master specification.
- Credit notes for erroneous issued invoices — Phase 7, subject to the accountant's confirmation.
- Audit hash-chaining alone is not tamper-proof; periodic signed exports to an independent location are the Phase 8 hardening option (ChatGPT 12.1).

## 5. What the reviews did not change

Both reviewers endorsed: Express + TypeScript modular monolith, MySQL/MariaDB + Drizzle, server-side sessions with hashed IDs, synchroniser-token CSRF, HMAC-stored OTPs, DB-backed rate limiting, the shared section registry with Zod-validated configs, published-revision pointers, transactional order approval, the inventory movement ledger, the locked-sequence invoice numbering (`INV-2026-00042`), immutable invoice snapshots, the transactional outbox, invitation-only admin creation, TOTP MFA, and the insert-only audit log.
