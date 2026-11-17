# DEPLOYMENT_REQUIREMENTS.md

## Hosting Feasibility Report — Bodhisattva Dynamic Museum Platform

| Field | Value |
|---|---|
| Project | Bodhisattva Museum Website + Visual CMS + Ecommerce + Secure Administration |
| Repository | `sanjeevRae/bodhisattva-main` |
| Phase | Phase 0 — Audit and Planning (Master Specification Part 22) |
| Document owner | Subagent 4 — Deployment Feasibility + Roadmap |
| Date | 2026-11-17 |
| Specification references | Part 3 (Hosting Feasibility), Part 15.4 (DDoS / Cloudflare), Part 15.7 (Backup Protection), Part 19 (Local Development and cPanel Deployment) |
| Overall status | **NOT VERIFIED — no production hosting fact in this document has been confirmed against the target hosting account. See the Go/No-Go Gate (Section 11).** |

---

## 1. Purpose and rules of this document

The production target named in the Master Specification is **cPanel shared hosting**. The specification is explicit (Part 3):

> "Do not assume Node.js hosting is available simply because cPanel exists."

This report therefore separates three kinds of statement, and labels each one:

- **REQUIREMENT** — what the application genuinely needs, derived from the specification and the chosen stack (Node.js + Express + TypeScript API, MySQL/MariaDB via Drizzle ORM + mysql2, server-side sessions, SMTP email queue, PDF invoice generation, scheduled jobs).
- **VERIFIED FACT** — something confirmed by direct inspection of the repository or another primary source during Phase 0.
- **UNVERIFIED** — a hosting capability that has not been checked against the actual target account. Every hosting capability in Section 4 is UNVERIFIED at the time of writing.

No deployment design may be treated as final until the Section 4 checklist is verified. If a required capability turns out to be unsupported, the fallbacks in Section 5 must be presented and decided **before** implementation commits to a deployment shape that cannot run (Specification Part 3, final paragraphs).

---

## 2. Verified facts about the current application (Phase 0 inspection)

These facts were verified by direct repository inspection on 2026-11-17:

| # | Fact | Evidence |
|---|---|---|
| 2.1 | The current application is a **static single-page application only**: React 18.3.1 + Vite + Tailwind CSS + React Router, seven routed public pages (`/`, `/museum`, `/gallery`, `/shop`, `/news`, `/foundation`, `/about`). | `package.json`, `src/app/App.tsx`, `src/app/pages/` |
| 2.2 | There is **no backend, no API layer, no database layer, and no server directory** in the repository today. No file connects to MySQL or any other database. | Full repository listing; absence of `server/`, absence of any DB driver in `package.json` dependencies |
| 2.3 | `package.json` declares `"engines": { "node": "24.x" }`. This constrains the **local build toolchain**. It does **not** mean the production host offers Node 24 — see item 4.2. The production API should target a widely available LTS line, to be fixed once item 4.2 is verified. | `package.json` |
| 2.4 | The frontend production build is `npm run build` → static output in `dist/`. A static build of this kind can be hosted on any ordinary cPanel account's `public_html` **without** Node.js on the server. Only the **API** needs a server-side runtime. This distinction drives the fallback options in Section 5. | `package.json` scripts, `vite.config.ts`, `dist/` |
| 2.5 | The current Gift Shop cart is **in-memory browser state only** (React `useState`); it does not persist across reloads and there is no checkout, account, or order functionality. The dynamic system in the specification replaces this with a database-backed cart (Part 10.3). | `src/app/pages/GiftShopPage.tsx` |
| 2.6 | All current page content is hardcoded in TSX components. There are no environment files (`.env`) committed and no configuration layer. | Repository listing |
| 2.7 | The client's other website (bodhisattvainternational.com, the separate exhibition site in a different repository) runs on **Nest Nepal cPanel shared hosting**. This is background context only. It does **not** verify anything about the hosting account intended for this project: the account, plan, and enabled features for this project are unconfirmed, and shared-hosting features differ per account and per plan even with the same provider. | Project background (parent-agent context); **not** verified against this project's hosting account |

---

## 3. What the finished application needs from hosting — summary

The dynamic system (Specification Parts 2, 7, 10–12, 15, 16) requires, at minimum:

1. A **long-running Node.js process** for the Express API (authentication, sessions, CMS, ecommerce, order workflow, invoice generation, email queue processing). This is the single hardest requirement on shared hosting.
2. A **MySQL/MariaDB database** with InnoDB and utf8mb4, reachable from the API process.
3. **Outbound SMTP** with enough hourly quota for verification codes, password resets, invitations, order emails and invoice delivery — plus a queue, because shared-hosting SMTP is rate-limited and failure-prone (Part 16).
4. **Cron** (or an equivalent scheduler) for the email queue worker, session cleanup, and backups.
5. **Writable private storage outside `public_html`** for uploaded media, product images, invoice PDFs and backups (Parts 15.6, 19.3).
6. **SSL** for the site and API (sessions use `__Host-` cookies, which require HTTPS — Part 7.4).
7. Sufficient **disk, inode, CPU and RAM** headroom for the Node process, image re-encoding (Sharp), PDF generation (PDFKit), and media storage growth.

Each item is examined in Section 4.

---

## 4. Hosting feasibility checklist (Specification Part 3)

**Every item below has verification status: UNVERIFIED.** "How to verify" gives the exact cPanel location, host question, or command. Commands assume SSH; if SSH is unavailable, the cPanel UI path or a host support ticket is the verification route.

### 4.1 Node.js availability

- **Requirement & why:** A persistent Node.js runtime must execute the Express API (`server/src/server.ts` compiled output) continuously. Authentication, sessions, CMS publishing, cart/checkout transactions, order approval, invoice PDF generation and the email queue all live in this process. Without Node.js on the host, the specified architecture cannot run there at all.
- **Status:** UNVERIFIED.
- **How to verify:**
  - cPanel → **Software → Setup Node.js App** (CloudLinux Node.js Selector). If this icon exists, Node.js apps are supported on the account. Open it and note whether "Create Application" is enabled.
  - If SSH exists: `node --version` and `which node`.
  - Ask the host in writing: "Does this plan support running a persistent Node.js application via the cPanel Node.js Selector / Passenger? Is there a limit on how long the process may run?"
- **Fallback if unsupported:** Section 5, options B (split hosting) or A (VPS). Do not substitute a PHP rewrite silently — see Section 5, option C, for the honest assessment.

### 4.2 Supported Node.js versions

- **Requirement & why:** The API will be built on a current LTS line. The codebase's `engines` field currently says Node 24.x for the frontend toolchain; the backend should pin the newest LTS the host actually offers (realistically 18/20/22 on shared cPanel). Express, Drizzle, mysql2, Argon2 (native module) and Sharp (native module) all need a compatible version, and native modules need prebuilt binaries for the host's platform — a version/platform mismatch is a common shared-hosting failure.
- **Status:** UNVERIFIED.
- **How to verify:** In **Setup Node.js App → Create Application**, open the Node.js version dropdown and record **every** version offered. Cross-check with `node --version` over SSH if available.
- **Fallback if only an old/EOL version exists:** Prefer split hosting or VPS (Section 5). Running a security-sensitive authentication system on an EOL Node line is not acceptable; this is a decision for Meena with the trade-offs documented, not a silent downgrade.

### 4.3 Passenger support

- **Requirement & why:** On cPanel, Node.js applications are almost always served through **Phusion Passenger** (via the CloudLinux Node.js Selector). Passenger starts/stops the app, restarts it on file change (`tmp/restart.txt`), and imposes its own limits (e.g. process pool size, idle shutdown). The deployment design (startup file, restart procedure, log locations) depends on Passenger being the app server.
- **Status:** UNVERIFIED.
- **How to verify:** The presence of **Setup Node.js App** implies Passenger-backed Node support. Confirm by creating a throwaway test application with a trivial `app.js` that returns its Node version and environment, visiting its URL, and confirming it serves. Ask the host: "Are Node.js apps served via Passenger? What are the Passenger pool/idle limits on this plan?"
- **Fallback if unsupported:** If the host offers Node only via a manually managed process (rare on shared hosting), a process supervisor is usually unavailable — treat as unsupported and use Section 5.

### 4.4 Node.js Application Manager

- **Requirement & why:** The specification names the cPanel **Node.js Application Manager / Setup Node.js App** interface as the expected management route: it sets the application root, startup file, environment variables, and restart control. The deployment guide (Part 19.4) will be written against whatever manager actually exists.
- **Status:** UNVERIFIED.
- **How to verify:** cPanel home → search "Node". Record the exact name of the feature present ("Setup Node.js App" vs a host-custom panel vs absent) and screenshot it for the Phase 0 evidence pack.
- **Fallback if absent but Node exists via SSH only:** Deployment becomes manual (SSH + `.htaccess` proxy rules where permitted). This is fragile on shared hosting and must be flagged to Meena as a risk before Phase 1 design is finalized.

### 4.5 SSH access

- **Requirement & why:** SSH is needed for: running database migrations (`npm run db:migrate`), installing production dependencies (`npm install --omit=dev`), inspecting logs, running the one-time Super Admin bootstrap CLI (Part 8.1), and performing backup/restore drills (Part 15.7). Without SSH, every one of these needs a slower, riskier workaround (web-based migration endpoints are **not** acceptable for an admin bootstrap).
- **Status:** UNVERIFIED.
- **How to verify:** cPanel → **Security → SSH Access** — check whether shell access is enabled (full shell vs jailed shell) and whether a key can be added. Test an actual login: `ssh cpaneluser@server-hostname`. Ask the host: "Is SSH enabled on this plan? Jailed or full? Can it be enabled on request?"
- **Fallback if unavailable:** Ask the host to enable it (many shared hosts enable on request with ID verification). If refused: migrations and bootstrap must be run by the host's support on request, or deployment moves to Section 5 options. **This is a near-blocking item** — record Meena's decision if SSH is refused.

### 4.6 MySQL / MariaDB version

- **Requirement & why:** The database is authoritative for accounts, CMS content, products, carts, orders, invoices, permissions and audit records (Part 2.3). Requirements: MySQL 8.0+ **or** MariaDB 10.4+, InnoDB, utf8mb4, foreign keys, transactions. Drizzle ORM + mysql2 must be compatible with the server version. Money is stored as fixed-precision DECIMAL, never floats (Part 4).
- **Status:** UNVERIFIED (neither the engine nor the version is confirmed; whether a database has even been provisioned for this project is unconfirmed).
- **How to verify:** cPanel → **Databases → MySQL Databases** (note whether it says MySQL or MariaDB) and phpMyAdmin → home page shows the server version string. Over SSH: `mysql --version` or query `SELECT VERSION();`. Also record: maximum databases allowed on the plan, and whether remote MySQL access is offered (not required — the API should connect locally — but useful for tunnelled development per Part 19.1).
- **Fallback if version too old / MySQL unavailable:** A host that cannot provide MySQL 8 / MariaDB 10.4+ cannot host the specified database. Options: host upgrade request, split hosting with the database beside the API (Section 5B), or VPS (Section 5A). PostgreSQL substitution would deviate from the specification and requires Meena's explicit decision.

### 4.7 Cron availability

- **Requirement & why:** Three scheduled jobs are required (detailed in Section 8): email queue processing (every few minutes — verification codes and invoice emails cannot wait for a human), expired session/token cleanup, and backups. On shared hosting, the minimum cron interval is often 15 minutes; the email-queue design must tolerate that (codes remain valid long enough; the queue drains in batches).
- **Status:** UNVERIFIED.
- **How to verify:** cPanel → **Advanced → Cron Jobs** — confirm the feature exists and note the minimum interval the UI permits. Ask the host: "What is the minimum cron interval on this plan, and is running a Node script via cron permitted?"
- **Fallback if cron is absent or too coarse:** An external scheduler (e.g. a free cron-ping service hitting a token-protected job endpoint) can trigger the queue worker; session cleanup can piggyback on queue runs. If no scheduling is possible at all, invoice/verification email becomes synchronous-only — a degraded design that must be flagged, not hidden.

### 4.8 SMTP access and sending limits

- **Requirement & why:** The system sends: email verification codes, password resets, admin invitations, order confirmations, approvals, cancellations, and invoice PDFs (Part 16). Shared-hosting SMTP is typically capped (per-hour limits are common), may mark bulk-ish mail as spam, and invoice emails carry PDF attachments. The design uses an **email outbox queue with retries** (Parts 4.8, 12.3) precisely because delivery is unreliable; the sending limits determine queue drain rates and whether an external SMTP provider is needed.
- **Status:** UNVERIFIED (no SMTP host, port, credentials, hourly cap, or attachment policy has been confirmed for this project).
- **How to verify:** cPanel → **Email → Email Accounts / Connect Devices** shows the outgoing SMTP server and ports for an account on the domain. Ask the host in writing: "What is the per-hour outbound email limit for this account? Are PDF attachments permitted? Is there a dedicated SMTP relay or a recommended transactional provider? What is the policy on application-generated mail (verification codes, invoices)?" Send a real test email with a PDF attachment to an external address and confirm arrival (not just acceptance by the server — Part 16: an accepted API call is not delivery).
- **Fallback if limits are too low or delivery is poor:** Use a transactional SMTP provider (e.g. the domain's Google Workspace / Microsoft 365 SMTP, or a transactional service such as Amazon SES / SendGrid / Mailgun) via the same Nodemailer configuration — the architecture already isolates SMTP behind environment variables (Section 7), so this is a configuration change, not a redesign. **Provider choice is a blocking decision for Meena** (cost + account ownership).

### 4.9 Disk storage and inode limits

- **Requirement & why:** Storage consumers: the Node application + `node_modules` (hundreds of MB and tens of thousands of files — **inodes are the usual shared-hosting killer**, not raw disk), CMS media uploads, product images, generated invoice PDFs (retained permanently per Part 12.2), database growth, and backups. Backups must not live in a publicly downloadable directory (Part 15.7).
- **Status:** UNVERIFIED.
- **How to verify:** cPanel home sidebar shows **Disk Usage** and, on CloudLinux accounts, inode/file-usage in the statistics panel; cPanel → **Files → Disk Usage** for detail. Ask the host: "What are this plan's disk quota and inode (file count) limit? What happens when the inode limit is reached?"
- **Fallback if too small:** Keep `node_modules` lean (production-only install), store media with disciplined retention, off-site backups (Section 9), and consider split hosting/VPS if the inode ceiling is very low. Record the actual numbers in this document once verified — the media-library growth policy depends on them.

### 4.10 CPU and RAM limits

- **Requirement & why:** The Node API process holds RAM continuously (Passenger pool), Argon2id password hashing is deliberately CPU/RAM-expensive (Part 15.1 — its parameters must be benchmarked against the *actual* host, per the specification), Sharp re-encodes uploaded images, and PDFKit renders invoices. CloudLinux LVE limits on shared hosting throttle CPU/RAM and can kill processes that exceed them.
- **Status:** UNVERIFIED.
- **How to verify:** cPanel → **Metrics → Resource Usage** shows the account's LVE limits and fault history. Ask the host: "What are the CPU, physical memory, virtual memory, entry-process and I/O limits (LVE) on this plan?" During Phase 1, benchmark Argon2id on the target (or an equivalent) server before fixing its parameters.
- **Fallback if limits are very low:** Reduce Passenger pool to a single process, lower Argon2id cost within OWASP-acceptable bounds (documented decision), process image uploads at constrained sizes — or move the API to split hosting/VPS. Performance claims must come from measurement, not assumption (Part 25).

### 4.11 Application process restrictions

- **Requirement & why:** Beyond raw CPU/RAM: shared hosts restrict the number of concurrent processes ("entry processes"), may kill long-running processes, may prohibit background daemons entirely, and Passenger may recycle idle apps (cold starts affect the first request after idle — acceptable for this workload, but must be known). The email queue worker is designed as a **cron-triggered batch job**, not a daemon, specifically to survive these restrictions.
- **Status:** UNVERIFIED.
- **How to verify:** Ask the host: "What is the entry-process / nproc limit? Are long-running Node processes permitted, or are processes killed after a time limit? Is the Node app recycled when idle?" The throwaway test app from item 4.3 doubles as the probe: deploy it, leave it idle, and observe restart behaviour in the logs.
- **Fallback if long-running processes are prohibited:** The specified architecture cannot run as designed on that account → Section 5. This is a go/no-go item (Section 11).

### 4.12 SSL certificate availability

- **Requirement & why:** HTTPS is mandatory: session cookies use the `__Host-` prefix, which browsers only accept over HTTPS with `Secure` (Part 7.4); login, checkout and admin traffic must never run over HTTP; Cloudflare's protections (Section 10) also assume an HTTPS origin.
- **Status:** UNVERIFIED for this project's domain (which domain the dynamic site will use is itself a blocking decision — Section 11 and the roadmap).
- **How to verify:** cPanel → **Security → SSL/TLS Status** — confirm AutoSSL (or Let's Encrypt) is available and covers the domain and any subdomain used for the API. Confirm the certificate actually provisions by visiting `https://<domain>` after setup.
- **Fallback if AutoSSL is unavailable:** Purchase/install a certificate, or terminate TLS at Cloudflare with a Cloudflare Origin Certificate installed on the host (still requires host cooperation to install). No fallback permits launching without HTTPS.

---

## 5. Fallback architectures if Node.js hosting is unsupported

Per Specification Part 3, alternatives must be explained **before** designing a deployment that cannot run. Three options, honestly assessed:

### Option A — VPS (full stack on one virtual server)

- **Shape:** A small VPS (e.g. 1–2 GB RAM) running Node.js (API), MySQL/MariaDB, Nginx/Caddy as reverse proxy, the static frontend, cron via systemd timers/crontab, Let's Encrypt TLS.
- **Pros:** Every Part 3 requirement is satisfiable and verifiable; no Passenger/LVE/process restrictions; full SSH; predictable Argon2id benchmarking; the Part 19.3 layout maps directly.
- **Cons:** New recurring cost; the VPS must be patched, firewalled and backed up by us (more operational responsibility than shared hosting); cPanel familiarity doesn't transfer.
- **When to choose:** If shared hosting fails any go/no-go item (4.1, 4.3, 4.11) or LVE limits (4.10) are too low for Argon2id + image processing.

### Option B — Split hosting: static frontend on cPanel, API on a separate Node host

- **Shape:** The Vite build (static, no server runtime needed — Fact 2.4) is deployed to the existing-style cPanel `public_html`. The Express API + MySQL run on a Node-capable host (small VPS or a Node PaaS), exposed as `api.<domain>` with strict CORS allowlisting the site origin (Part 15.5). Sessions: because the API is on a subdomain of the same registrable domain, cookie design needs care — the `__Host-` cookie pattern in Part 7.4 assumes API and site share an origin path (`/api`). Under split hosting the frontend calls `https://api.<domain>/…` cross-origin; the session cookie must then be set by the API host with `SameSite=Lax`/appropriate attributes and CORS credentials enabled. **This is a real design deviation from Part 7.4's `__Host-session` recommendation and must be documented and re-reviewed by Subagent 4 (Security) if chosen.**
- **Pros:** Keeps the familiar cPanel account for the public site and its email/DNS; API gets an unrestricted Node environment; each half scales independently.
- **Cons:** Two hosts to deploy, secure and back up; cross-origin session/CSRF design is more delicate; invoice/media file storage lives with the API host; latency between user and API depends on API host location.
- **When to choose:** If the client strongly prefers keeping the current cPanel account for the site but it cannot run Node.

### Option C — PHP backend on cPanel (deviation from the specified stack)

- **Honest assessment:** cPanel shared hosting almost universally runs PHP, and a PHP (e.g. Laravel or plain PHP) backend could implement the same REST contracts, MySQL schema, sessions, RBAC, PDF invoices and email queue. **However:** the Master Specification mandates Node.js + Express + TypeScript + Drizzle (Part 2.2–2.3). Choosing PHP means: discarding shared TypeScript types between frontend and backend, a different ORM/migration toolchain, different test stack, and re-doing the Phase 0 architecture documents. It is **not** a drop-in fallback and must not be adopted by implementers unilaterally.
- **When to choose:** Only by explicit decision of Meena after seeing options A and B, with the specification formally amended. Recorded here so the option is visible, not recommended by default.

**Recommendation of this report:** Verify Section 4 first. If the existing-style cPanel account passes the go/no-go items, deploy as designed (Section 6). If it fails on Node/process grounds, **Option B** preserves the most existing investment; **Option A** is the cleanest long-term platform. Option C is a last resort requiring a specification change.

---

## 6. Recommended production layout (Specification §19.3, adapted)

Assuming cPanel + Node.js Selector/Passenger is verified (Section 4). Paths use the placeholder `CPANEL_USER`, to be replaced with the real account name once known (UNVERIFIED).

```
/home/CPANEL_USER/
  apps/
    museum-api/                 # Node.js application root (outside public_html)
      app.js                    # Passenger startup file (loads compiled server)
      dist/                     # compiled TypeScript API output
      node_modules/             # production dependencies only
      package.json
      logs/                     # application logs (never web-accessible)

  private-storage/              # never web-accessible
    cms-media/                  # CMS uploads (random server-generated names, Part 5.6)
    product-images/             # Gift Shop product images
    invoices/                   # generated invoice PDFs (Part 12.2)
    backups/                    # local backup staging (copied off-site, Section 9)

  public_html/                  # static frontend only
    index.html                  # Vite build output
    assets/                     # Vite build output
    images/                     # static site images from the build
    .htaccess                   # SPA fallback + /api routing (see notes)
```

Layout rules (from Parts 15.6, 19.3):

1. **Only the static frontend lives in `public_html`.** No `.env`, no server code, no uploads, no invoice PDFs, no backups in any web-accessible directory.
2. The Node.js App's **application root** is `apps/museum-api`; its **startup file** is `app.js`; environment variables are set in the Node.js Selector UI (or the app's `.env` outside `public_html`, per host capability — to be confirmed at verification).
3. **API routing:** requests to `/api/*` must reach the Node app and must **not** be swallowed by the SPA fallback. Two verified-compatible patterns exist (choose after Section 4 verification):
   - The Node.js Selector maps the application to the `/api` URI path directly (Passenger serves the app under that path; `.htaccess` in `public_html` then only handles SPA fallback for non-API routes).
   - Or the app is bound to the domain and serves both API and static files — not preferred on cPanel.
   The `.htaccess` SPA fallback must explicitly exclude `/api`.
4. **Uploads are served through authorized endpoints** (Part 15.6), never by direct URL into `private-storage/`.
5. `tmp/restart.txt` (Passenger convention) is the restart mechanism after each deployment; the deployment guide (Phase 8, `DEPLOYMENT_GUIDE.md`) will document the exact sequence: upload build → install deps → migrate → restart → smoke test.
6. If Option B (split hosting) is chosen instead, this layout applies to the frontend half unchanged; the API half follows the same `apps/` + `private-storage/` separation on its own host.

---

## 7. Environment variable inventory (Specification §19.2)

No values exist yet; **no production secrets have been generated or committed** (verified: no `.env` in the repository, Fact 2.6). Rules: every secret is generated uniquely per environment; production secrets are never reused in development and never committed (Part 19.2); secrets are never shared with external AI reviewers (Part 21).

### 7.1 Frontend (build-time, public — not secrets)

| Variable | Purpose | Required |
|---|---|---|
| `VITE_API_BASE_URL` | API base path the SPA calls. `/api` under the Section 6 layout; a full `https://api.<domain>` URL only under split hosting (Option B). | Yes |
| `VITE_SITE_NAME` | Display name used by the built frontend. | Yes |

### 7.2 Backend (runtime, private)

| Variable | Purpose | Secret |
|---|---|---|
| `NODE_ENV` | `production` in production; controls error detail, cookie behaviour, logging. | No |
| `PORT` | Port the API listens on. Under Passenger this is typically assigned/ignored by the app server — confirm during verification (item 4.3). | No |
| `APP_URL` | Canonical public URL of the site; used in email links (verification, reset, invitations) and invoice generation. **Value depends on the domain decision (blocking).** | No |
| `DB_HOST` | MySQL/MariaDB host (expected `localhost` on cPanel). | No |
| `DB_PORT` | MySQL port (expected 3306). | No |
| `DB_NAME` | Database name (cPanel prefixes with the account name). | No |
| `DB_USER` | Database user (least-privilege: only the app database). | No |
| `DB_PASSWORD` | Database password. | **Yes** |
| `SESSION_SECRET` | Signing/encryption material for session identifiers (session IDs are stored hashed, Part 7.4). High entropy, unique per environment. | **Yes** |
| `OTP_HMAC_SECRET` | HMAC key protecting stored email verification codes (Part 7.1: only the HMAC representation is stored). Separate from `SESSION_SECRET`. | **Yes** |
| `TOTP_ENCRYPTION_KEY` | Key encrypting stored TOTP MFA secrets at rest (Part 8.2). Separate from all other secrets; loss = all admin MFA must be re-enrolled, so it must be backed up with the configuration backup (Section 9). | **Yes** |
| `SMTP_HOST` | Outgoing mail server (host SMTP or external provider — blocking decision, item 4.8). | No |
| `SMTP_PORT` | SMTP port (typically 465 TLS or 587 STARTTLS). | No |
| `SMTP_USER` | SMTP account username. | No |
| `SMTP_PASSWORD` | SMTP account password. | **Yes** |
| `SMTP_FROM` | From address for all system email (must be on a domain with SPF/DKIM configured — deliverability, Part 16). | No |
| `UPLOAD_DIRECTORY` | Absolute path to `private-storage/` root (Section 6). Media, product images and invoices live under it. | No |
| `RATE_LIMIT_*` (policy set) | Tunable authentication rate-limit thresholds (Part 15.3: registration, OTP, login, recovery, admin login). Server-configuration only, not admin-UI editable by lower roles. | No |
| `OTP_POLICY_*` (policy set) | OTP expiry, max attempts (initial 5), resend cooldown (initial 60s), sends per email per hour (initial 3) — adjustable via protected server configuration (Part 7.1). | No |

Additional variables may be added by Phase 1 (e.g. log level, Cloudflare Turnstile keys if adopted); each addition must be recorded in `DEPLOYMENT_GUIDE.md` when it appears.

---

## 8. Cron jobs required

All jobs run the compiled API's job entry points with the production environment. Exact commands are finalized in Phase 1/7 once the app layout is verified; the schedule requirements are fixed now:

| # | Job | Suggested schedule | Purpose | Notes |
|---|---|---|---|---|
| 8.1 | **Email queue worker** | Every 5 minutes (or the finest interval the host permits — see item 4.7) | Drains `email_outbox`: verification codes, password resets, invitations, order confirmations/approvals/cancellations, invoice delivery with PDF attachment; applies retry/backoff and records per-message status (pending/processing/sent/failed, retry count, last error — Parts 12.3, 16). | Must be idempotent and safe against overlapping runs (single-instance lock via DB). If the host's minimum interval is 15 minutes, the OTP validity window and user messaging must be set accordingly — a configuration fact to record at verification. |
| 8.2 | **Session & token cleanup** | Hourly (or piggybacked on 8.1) | Deletes expired `user_sessions`, expired `email_verification_codes`, expired `password_reset_tokens`, expired/consumed `invitations`; prunes rate-limit counters past their window (Part 15.3 store hygiene). | Keeps auth tables small and prevents unbounded growth on inode/disk-limited hosting. |
| 8.3 | **Backup job** | Daily (off-peak, Asia/Kathmandu night) | Database dump + media/product-image/invoice file archive per Section 9, with rotation and an off-site copy step. | A backup that has never been restore-tested does not count (Part 15.7) — restore drills are scheduled in Phase 8 and then periodically. |
| 8.4 | **Audit/log maintenance** (optional, Phase 7+) | Weekly | Rotates application logs under `apps/museum-api/logs/`; audit logs themselves are **never** auto-deleted by ordinary jobs (Part 14: not editable/deletable via admin APIs; retention policy is a Super Admin decision). | Log rotation matters on inode-limited hosting (item 4.9). |

If cron is unavailable (item 4.7 fallback), jobs 8.1–8.3 need an external trigger hitting token-protected endpoints; that substitution must be recorded here when decided.

---

## 9. Backup and restore requirements (Specification Part 15.7)

**What must be backed up:**

| Asset | Method | Retention (initial policy — Meena to confirm) |
|---|---|---|
| MySQL database (all CMS, account, order, invoice, audit data) | Scheduled `mysqldump` (consistent, InnoDB single-transaction) via job 8.3 | Daily × 14, weekly × 8 |
| CMS media (`private-storage/cms-media/`) | File archive, incremental where tooling allows | Same cycle as database |
| Product images (`private-storage/product-images/`) | File archive | Same cycle |
| Invoice PDFs (`private-storage/invoices/`) | File archive — these are legal/financial records and the system of record alongside the `invoices` table snapshots (Part 12.2) | Same cycle; consider longer retention |
| Configuration | The environment-variable set (Section 7) exported securely — **including `TOTP_ENCRYPTION_KEY`** (without it, backups cannot restore admin MFA) — stored in a password manager / sealed record, never in the repo | On every change |

**Rules:**

1. Backups are **never** stored in a publicly downloadable directory (Part 15.7). Local staging under `private-storage/backups/` is outside `public_html`; at least one copy must leave the hosting account (off-site: e.g. cloud storage or a download to a controlled machine), because a shared-hosting account compromise or termination otherwise destroys site and backups together.
2. **Restoration must be tested**, not assumed (Part 15.7): Phase 8 includes a full restore drill into a scratch database + scratch storage, timed and documented in `BACKUP_RESTORE.md`. An untested backup is recorded as a known limitation, not as a completed control.
3. Restore procedure must cover: database import → storage restore → configuration restore → migration state check (`npm run db:status`) → smoke test of login, a CMS page, and an invoice download.
4. Deployment rollback (Part 19.4) is distinct from backup restore: code rollback = redeploy previous build + `tmp/restart.txt`; data rollback = migrations' down-procedures where written, otherwise backup restore. Both are documented in Phase 8 deliverables.

---

## 10. Cloudflare notes (Specification Part 15.4) — honest scope

Cloudflare is recommended in front of the site, but its powers and limits on shared hosting must be stated plainly:

**What Cloudflare genuinely provides here:**

- **Volumetric DDoS absorption at the edge** — attack traffic is dropped before it reaches the shared host. This is the *only* layer that can do this; the specification itself forbids claiming that application middleware can stop volumetric attacks (Part 15.4).
- TLS termination and HTTPS enforcement aids (with the origin still requiring its own valid certificate for Full (Strict) mode — item 4.12).
- Basic WAF rules, bot management (plan-dependent), and rate-limiting rules at the edge as a *first* filter.
- DNS management and caching of static frontend assets.

**What Cloudflare cannot do / honest limits:**

- It does **not** replace application-layer controls: authentication rate limits, OTP throttling, CSRF, authorization and ownership checks must still exist in the API (Parts 15.3, 15.5), because credential-stuffing and API abuse arrive as perfectly ordinary HTTPS requests through Cloudflare.
- On shared hosting the origin IP is typically shared and discoverable (other sites, historical DNS, mail headers), so attackers may bypass Cloudflare and hit the origin directly. Mitigations are partial (host firewall cooperation is rarely available on shared plans). This residual risk is recorded, not hidden.
- Cloudflare cannot fix host resource limits (Section 4.9–4.11): a page-view spike still consumes the same LVE CPU/RAM at the origin for dynamic API calls.
- Free-plan features are limited (WAF rule count, no advanced bot management); whether a paid plan is justified is Meena's decision (blocking decisions, roadmap).
- **Account ownership matters:** the Cloudflare account must be the client's/Meena's, not a third party's, so DNS control is never hostage. Whether a Cloudflare account exists for the domain is UNVERIFIED.

---

## 11. Go / No-Go gate

**Gate statement:** Phase 1 may build the backend foundation locally (it is environment-independent), but **Phase 1 cannot finalize the deployment design, and no later phase may claim deployability, until every item in the table below is verified and recorded in this document with evidence** (screenshot, command output, or the host's written answer).

| Gate item | Source | Blocking for |
|---|---|---|
| Node.js available + version list recorded | 4.1, 4.2 | Deployment design; Argon2id/native-module choices |
| Passenger / Node.js App Manager confirmed working with a test app | 4.3, 4.4 | Deployment design |
| Long-running processes permitted | 4.11 | **Go/No-Go for the whole cPanel target** — if No, choose Section 5 option A or B first |
| SSH access confirmed (or host refusal recorded + Meena decision) | 4.5 | Migrations, bootstrap, restore drills |
| MySQL/MariaDB engine + version recorded | 4.6 | Drizzle configuration, migration design |
| Cron available + minimum interval recorded | 4.7 | Email queue design parameters |
| SMTP route chosen (host SMTP vs external provider) + hourly limit recorded + test email with PDF delivered | 4.8 | Email system design (Phase 2/7) |
| Disk + inode quotas recorded | 4.9 | Media library policy |
| CPU/RAM (LVE) limits recorded | 4.10 | Argon2id parameters (Phase 2) |
| SSL (AutoSSL/Let's Encrypt) confirmed for the chosen domain | 4.12 | Any production launch |
| Domain / `APP_URL` decided | §7.2 | Email links, cookies, SSL, Cloudflare |

**Verification method:** one working session in the actual cPanel account (or a host support ticket answered in writing) covering Sections 4.1–4.12, with evidence saved to the Phase 0 evidence pack. Estimated effort: under one hour with account access. Until then, this report's status remains **UNVERIFIED** and any statement that "the app will deploy on cPanel" is prohibited by the reporting rules (Part 25).

---

## Appendix A — Ready-to-send questions for the hosting provider

1. Does this plan support Node.js applications via cPanel's "Setup Node.js App" (CloudLinux Node.js Selector / Passenger)? Which Node.js versions are offered?
2. Are long-running Node.js processes allowed, or are processes time-limited/killed? What are the Passenger pool and idle-recycle settings?
3. Is SSH access available on this plan (jailed or full)? Can it be enabled on request?
4. Which database server runs on this account — MySQL or MariaDB — and what version? How many databases does the plan allow?
5. What is the minimum cron interval, and may cron run Node.js scripts?
6. What is the outbound email limit per hour for this account? May application email (verification codes, invoices with PDF attachments) be sent through the server SMTP? Is a transactional relay recommended?
7. What are the plan's disk quota and inode (file count) limit?
8. What are the CloudLinux LVE limits: CPU, physical/virtual memory, entry processes, I/O?
9. Is AutoSSL or Let's Encrypt available for the domain and subdomains?
10. Where are Node.js application logs written, and can the account holder read them?

## Appendix B — Document control

- This is a Phase 0 deliverable. It will be updated in place as verification evidence arrives; each Section 4 item's status line changes from UNVERIFIED to VERIFIED with the date and evidence reference.
- Companion Phase 0 documents: `PROJECT_AUDIT.md`, `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `PERMISSIONS.md`, `CMS_CONTENT_MAPPING.md`, `SECURITY_THREAT_MODEL.md`, `DEVELOPMENT_ROADMAP.md`.
- No code was changed by the preparation of this document.
