# PHASE 1 — REVIEW SYNTHESIS & VERIFICATION RECORD

**Project:** Dynamic Museum Website + Visual CMS + Ecommerce + Secure Administration
**Repository:** `sanjeevRae/bodhisattva-main`
**Date:** 17 November 2026
**Reviewers:** ChatGPT (structure, config, secret hygiene) and Gemini (phase-readiness), per Master Specification Part 21. Reviews were run against a structured description of the built foundation; no credentials or secrets were shared.

---

## 1. Exit-gate verification (lead, evidence-based)

All items executed locally on 17 Nov 2026:

- Dependencies install clean (root, `shared/`, `server/`).
- `npm --prefix server run build` (tsc, strict, NodeNext ESM) — **green**.
- `npm --prefix server test` — **26/26 pass** with no database running (config fail-fast, health behaviour, error envelope, money arithmetic, permission catalogue integrity).
- Frontend `npm run build` — **green** (frontend untouched by this phase).
- Migration cycle against local MariaDB 10.11.14: `db:migrate` → 8 tables created → down SQL → all 8 dropped, bookkeeping cleared → `db:migrate` again → `db:status` reports **1 applied**.
- Seed framework: default run no-ops; `--dev` placeholder runs inside a transaction; production refusal is enforced by the runner.
- Compiled server booted against the live DB: `GET /health` → 200; `GET /health/ready` → 200 `{"status":"ready","database":"ok"}` (~0.24 s); unknown route → 404 in the shared error envelope.
- Native modules on this machine (provisional, host test still pending): **argon2 PASS** (Argon2id hash/verify), **sharp PASS** (resize, libvips 8.17.3).

**Bug found and fixed during verification:** mysql2's `pool.on('connection')` event hands back the callback-style connection even on a promise pool; awaiting its `.query()` threw and hung connection setup, so readiness stalled. Fixed by using the callback form inside the handler (documented in `server/src/database/client.ts`); readiness now answers in ~0.24 s.

**Local environment note:** the sandbox's apt mirror proved unreliable, so the local MariaDB 10.11.14 runs from the official binary tarball under `~/workspace/tools/`. This is a dev-machine detail only; the production database type/version on cPanel remains unverified (deployment path, Phase 8 gate).

## 2. Reviewer verdicts

- **ChatGPT:** 8.5/10 — approves the architecture with conditions; would not approve *production deployment* until hosting compatibility, secret/connection hardening, and migration/backup procedures are proven on the real host. Praised the shared contracts, money handling, DI health probe, and the decision to defer business logic.
- **Gemini:** "exceptionally mature, disciplined" foundation, explicitly **not over-engineered**; highest concern is Passenger multi-process state (already the design's premise: DB-backed sessions/rate limits, `session_version` checked against the DB).

## 3. Dispositions

**Fixed in Phase 1 (from ChatGPT):**
- **F2 pool budget** — pool limit is now env-driven (`DB_POOL_LIMIT`, default 5 per worker) with `connectTimeout` 5 s and a bounded queue, on both the URL and discrete config paths.
- **F3 secret strength** — config now rejects reuse of the same secret across purposes, and `TOTP_ENCRYPTION_KEY` must decode to exactly 32 bytes (64-char hex or 32-byte base64), not merely be 32 characters.
- **§7A permission drift guard** — automated test asserts the catalogue holds exactly 49 permissions, no duplicates, valid format, and that `audit.update`/`audit.delete` do not exist. (The "51" figure in early summaries was wrong; PERMISSIONS.md defines 49 grantable — the document is the contract.)

**Already satisfied by the design/build (noted for the record):**
- Graceful shutdown on SIGTERM/SIGINT exists in `server.ts` (F1); migrations are an explicit CLI step, never run at server boot (F5); migrations are forward-only in production with restore-from-backup as the rollback policy (ChatGPT §6D concurs).
- Transactional email outbox (Gemini) is already designed in DATABASE_DESIGN.md (`email_outbox`) and lands with the email/orders phases — deliberately not one of Phase 1's 8 tables.
- `rate_limits` already carries the expiry index Gemini asked about (`idx_rate_limits_expiry`).
- Migrations must run as a separate deployment step (Gemini) — already the documented procedure in SETUP.md.

**Deferred with a phase owner:**
- Log-redaction adversarial tests (fake-secret fixtures) — Phase 2, when auth payloads exist (ChatGPT §5).
- TOTP key versioning — design the encryption abstraction with a key-version field in Phase 2's MFA work (ChatGPT F3).
- `DATABASE_URL` vs discrete-vars conflict: precedence is defined (URL wins when both are set) and documented in SETUP.md; ChatGPT's stricter reject-on-conflict was **not** adopted because the documented local workflow uses the URL for drizzle tooling and discrete vars for the app, always pointing at the same database.
- Hand-edited migration SQL divergence caution (ChatGPT §6C): accepted as a standing rule — never edit a deployed migration; every manual adjustment is documented in the migration file header (as done in 0000).
- Soft-delete (`deleted_at`) convention for content/shop tables (Gemini) — to be decided per table family in Phases 3/5/6 against DATABASE_DESIGN.md's status-flag approach; historical orders/invoices already snapshot their data.
- Passenger startup-file convention, pool budget on the real host, backup/restore test — Phase 8 / hosting-connection gate, unchanged.

## 4. Phase 1 outcome

Foundation complete against the DEVELOPMENT_ROADMAP.md §3 exit gate. Phase 2 (Authentication & RBAC) is next; its entry conditions are met locally, with the SMTP route still to be decided by Meena (local mail catcher is acceptable for Phase 2 per the roadmap, and must be recorded when used).
