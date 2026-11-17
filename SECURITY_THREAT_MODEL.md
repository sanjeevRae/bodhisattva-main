# SECURITY_THREAT_MODEL.md — Threat Model & Security Design

**Project:** Bodhisattva Museum — Dynamic Website + Visual CMS + Ecommerce + Secure Administration
**Phase:** 0 — Audit and Planning (design deliverable)
**Status:** ⚠️ **DESIGNED, NOT YET IMPLEMENTED.** The repository today contains only the public
frontend (React + Vite SPA). There is **no backend, no database, no authentication, no session
handling and no API** in the codebase. Every control in this document is a design decision to be
implemented and tested in Phases 1–8. No control described here may be reported as "in place"
until the corresponding phase's tests pass (spec Part 25).
**Governing spec:** Master Project Specification, Parts 7, 8, 9, 14, 15, 16, 19 and 23.
**Verification references:** OWASP ASVS 5.0 (verification standard for Phase 8 testing) and the
OWASP API Security Top 10 (2023) (design checklist, mapped in §9).
**Companion document:** `PERMISSIONS.md` (the authorization contract referenced throughout).

---

## 1. System overview (as designed)

A single integrated application on cPanel shared hosting:

- **Public SPA** (existing React/Vite frontend, preserved) served as static files from `public_html`.
- **Node.js + Express + TypeScript API** running under cPanel's Node.js Application Manager /
  Passenger, with files **outside** `public_html` (spec §19.3).
- **MySQL/MariaDB** (InnoDB, utf8mb4) accessed only by the API via Drizzle ORM + mysql2.
  React never connects to the database (spec §2.3).
- **Server-side sessions** with a `__Host-session` cookie; **Argon2id** password hashing;
  **TOTP MFA** for administrative roles; **SMTP** email through an outbox queue with retries.
- **Cloudflare** in front of the site for volumetric DDoS protection, TLS and bot filtering
  (spec §15.4) — adoption is an open decision (§11).
- **Private file storage** outside `public_html` for invoice PDFs, private media and backups.

Hosting capabilities (Node version, Passenger behaviour, MySQL version, cron, resource limits)
are **assumptions until the Part 3 hosting feasibility check is completed**. Where a design point
depends on the host (e.g. Argon2id benchmarking, per-table DB grants), that dependency is flagged.

## 2. Assets to protect

| # | Asset | Why it matters |
|---|---|---|
| A1 | Password hashes (Argon2id) | Credential compromise enables account takeover at scale |
| A2 | Session identifiers (hashed at rest) | Theft = impersonation of customers or administrators |
| A3 | Email verification codes (HMAC at rest) | Bypass = unverified/fraudulent account activation |
| A4 | Password-reset tokens (hashed at rest) | Theft = account takeover |
| A5 | Invitation tokens (hashed at rest) | Theft/reuse = unauthorized **administrator** account creation |
| A6 | TOTP secrets & recovery codes | Theft = MFA bypass for the most privileged accounts |
| A7 | Customer PII (names, emails, phones, addresses) | Privacy harm, regulatory/reputational exposure |
| A8 | Orders & order history (incl. price snapshots) | Financial record integrity; fulfilment depends on it |
| A9 | Invoice records, numbering & PDF files | Financial documents; forgery/alteration and unauthorized disclosure risks |
| A10 | CMS content & page revisions | Public defacement risk; publication integrity |
| A11 | Media files (CMS + product images) | Defacement, malicious-content hosting, storage abuse |
| A12 | Inventory counts & movement ledger | Overselling / stock fraud |
| A13 | Audit logs | The record of who did what; worthless if editable |
| A14 | Secrets & configuration (DB credentials, `SESSION_SECRET`, `OTP_HMAC_SECRET`, `TOTP_ENCRYPTION_KEY`, SMTP password) | Total compromise if leaked (repo, logs, error pages) |
| A15 | Email-sending capability (SMTP account) | Abuse = spam relay, domain/IP blacklisting (this domain has already suffered a compromised-mailbox spam incident) |
| A16 | Backups (DB, media, invoices) | Contain A1–A13 in bulk; a common leak point on shared hosting |
| A17 | Availability of the site & API | Revenue/reputation; shared-hosting resources are finite |
| A18 | The application server & DB accounts themselves | cPanel shared hosting = neighbouring tenants and a shared kernel; least-privilege configuration matters |

## 3. Actors

| Actor | Description | Trust level |
|---|---|---|
| Anonymous visitor | Unauthenticated internet user; includes bots and scanners | None |
| Registered customer | Authenticated, email-verified CUSTOMER | Low — trusted only with their own data |
| Malicious customer | A verified account deliberately probing other customers' data / endpoints | None beyond own data |
| ADMIN | Content administrator (invited, MFA) | Medium — content only |
| STORE_ADMIN | Store operator (invited, MFA) | Medium — store only |
| SUPER_ADMIN | System owner (invited/bootstrapped, MFA) | High, but still audited |
| Compromised admin account | Attacker holding a real admin's password (MFA is the containment) | Treated as hostile |
| Malicious insider | A legitimate admin abusing access (e.g. editing audit trails, exporting PII) | Partially trusted; deterred/detected via audit |
| External attacker / botnet | Credential stuffing, OTP spam, vulnerability scanning, DDoS | Hostile |
| Hosting neighbour / host-level attacker | Another tenant or a compromised co-hosted site on the shared server | Outside our control; mitigated by file placement/permissions |

## 4. Trust boundaries

```
[Visitor / Customer / Admin browsers]
        │  TB1: public internet, TLS via Cloudflare (if adopted)
        ▼
[Cloudflare edge] ── TB2: origin pull ──► [cPanel / Apache + Passenger]
                                              │
                          TB3: static vs app  ├─► public_html (SPA build only — no code, no secrets)
                                              │
                                              ▼
                                    [Node/Express API  (outside public_html)]
                                       │        │          │            │
                    TB4: DB creds ─────┘        │          │            └─ TB7: filesystem
                                       ▼        ▼          ▼               (private storage:
                                    [MySQL]  [SMTP]   [Audit log         invoices, media,
                                    (app     (outbox   (inside MySQL,    backups — never
                                     user)    queue)    append-only)     web-reachable)
                                              TB5: outbound mail —
                                              SPF/DKIM identity boundary
                                       TB6: admin browser ◄──► /api/admin/*
                                       (same API, stricter auth: session + MFA + permissions)
```

Key boundary rules:

- **TB3:** Nothing executable, no `.env`, no uploads, no PDFs and no backups may live under
  `public_html`. Anything in `public_html` is assumed world-readable.
- **TB4:** The API's MySQL user is the only DB identity. The browser never receives DB credentials
  or connects directly.
- **TB6:** Admin and customer traffic share one API but **not** one authorization path: admin
  routes require session + completed MFA + named permission (`PERMISSIONS.md` §8).
- **Shared-hosting boundary:** other tenants are outside our control. Mitigations are limited to
  keeping code/data outside `public_html`, restrictive file permissions, and not storing secrets
  in web-reachable locations. This residual risk is accepted and recorded (§10).

## 5. Threat register

Phase references are to spec Part 22. "Mitigation" describes the **designed** control; all are
unimplemented until their phase lands.

| ID | Threat | Module | Impact | Designed mitigation | Phase |
|---|---|---|---|---|:---:|
| T-01 | **Credential stuffing / brute force** against login (breached password lists, botnets) | Auth | Customer/admin account takeover | Argon2id hashing; login rate limit 5 failed/(account+IP)/15 min with progressive backoff (§7); generic failure messages; MFA mandatory for all admin roles so a password alone never suffices; login success/failure audited; optional breached-password screening (open decision §11) | 2 |
| T-02 | **OTP abuse**: flooding verification emails, guessing the 8-digit code, code reuse, enumeration of registered emails | Registration / email verification | Fraudulent activation; SMTP quota burn & domain blacklisting; account enumeration | Code stored only as HMAC (`OTP_HMAC_SECRET`); 10-minute expiry (proposed); **single-use**; max **5 attempts** per code; resend cooldown **60 s**; max **3 sends/email/hour** + registration cap 3/IP/hour; identical responses whether or not the email exists; codes never in API responses or logs | 2 |
| T-03 | **Session fixation** (attacker plants a session ID pre-login) | Sessions | Account impersonation | Session ID is generated server-side only; **rotated on login, on privilege change and on MFA completion**; any pre-auth session is destroyed at login; `__Host-` cookie prefix (Secure, Path=/, no Domain) prevents subdomain cookie injection | 2 |
| T-04 | **Session hijacking** (cookie theft via XSS, malware, network) | Sessions | Impersonation | `__Host-session` cookie: Secure + HttpOnly + SameSite=Lax; only a **hash** of the session ID stored in `user_sessions`; idle + absolute expiry; per-user session list with revoke and "log out everywhere"; rotation (T-03); CSP + XSS controls (T-06) reduce theft surface; no session IDs in URLs | 2 |
| T-05 | **CSRF** on state-changing endpoints (cart, checkout, admin actions) | All authenticated APIs | Forged actions in a victim's browser | SameSite=Lax baseline **plus** synchronizer CSRF token required on all state-changing cookie-authenticated requests (custom header verified server-side); strict CORS allowlist (own origin only); state changes never via GET | 1 (middleware), enforced 2+ |
| T-06 | **Stored XSS via CMS rich text / section configuration** (admin-entered content rendered publicly; also news/foundation/testimonial fields) | CMS, museum content | Script execution in visitors' and **admins'** browsers; session theft; admin-action forgery | Rich text sanitized **server-side** against an allowlist before storage and treated as untrusted on render; **no raw-HTML section type**; section configs validated by Zod schemas in the controlled registry (spec §5.3); no administrator-entered JavaScript is ever executed; React escaping as a second layer; restrictive CSP (report-only first, then enforced) | 3, hardened 8 |
| T-07 | Reflected/DOM XSS via search queries and URL parameters (news search, shop filters) | News, shop | Phishing, session theft attempts | React auto-escaping; never render query input via `dangerouslySetInnerHTML`; server validation of filter parameters; CSP | 5, 6 |
| T-08 | **SQL injection** | All APIs | Data theft/destruction, auth bypass | Drizzle ORM parameterized queries everywhere; **no string-concatenated SQL** (lint/review rule); Zod validation of every input incl. IDs, sort fields and pagination; least-privilege DB user; generic error responses — DB errors never reach the client (spec Part 17) | 1+ |
| T-09 | **IDOR / broken object-level authorization**: customer reads/modifies another customer's order, address, cart item or invoice by changing an ID | Account, cart, checkout, invoices | PII disclosure, order/invoice theft, fraud | Ownership scoping in the data layer on every customer query (`PERMISSIONS.md` §6); cross-owner access returns **404**; cart resolved from session, never from a client-supplied ID; invoice download checks invoice→order→user chain; automated IDOR tests in the QA suite (spec Part 23) | 2, 6, 7 |
| T-10 | **Privilege escalation**: customer self-assigns a role; Store Admin calls CMS endpoints; mass-assignment of `role`/`status`/`price` fields | Users, roles, all admin APIs | Full system compromise | Permission middleware, deny-by-default (`PERMISSIONS.md` §1); roles changeable only via `roles.manage` (Super Admin) and audited; allow-listed request schemas strip privileged fields; admin accounts creatable **only** via invitation/bootstrap — no public path; backend re-authorizes every request regardless of UI state | 2 |
| T-11 | **Invitation token leakage or reuse** (forwarded email, logs, browser history, token guessing) | Invitations | Unauthorized **administrator** account creation | ≥256-bit CSPRNG token; only its SHA-256 hash stored; bound to one email + one role; expiry (proposed 72 h — §11); **single-use**, consumed atomically on acceptance; new invitation for the same email revokes the old; revocation supported; tokens never logged, never returned by list APIs; acceptance requires setting a password **and** completing MFA enrolment; all events audited | 2 |
| T-12 | **TOTP secret mishandling**: secrets in logs/responses, plaintext storage, weak recovery | MFA | Silent MFA bypass for privileged accounts | Secrets **encrypted at rest** (AES-256-GCM) with `TOTP_ENCRYPTION_KEY` held only in server env (separate from DB); secret shown once at enrolment (QR) and never returned by any API afterwards; recovery codes stored **hashed**, single-use; secrets/codes explicitly excluded from logging and audit metadata (spec Part 14); MFA reset only via the authorized Super Admin procedure, audited, and invalidates existing sessions | 2 |
| T-13 | **Malicious file uploads**: web shells, polyglot images, malware, oversized files via media library / product images / invoice logo | Media, products, invoices | Server compromise, stored-XSS hosting, storage exhaustion | Validate **content** (magic bytes), not extensions; allowlist of image formats; **re-encode every image with Sharp** (strips embedded payloads); random server-generated filenames; size caps; private files outside `public_html`; no executable types, no SVG by default (open decision §11); uploads require `media.create` / product permissions; served with safe Content-Type + `nosniff` | 3 (media), 6 (products) |
| T-14 | **Path traversal** in file serving/downloads (`../` in names or IDs) | Media, invoice download, backups | Reading config/secrets/other customers' files | Files addressed by database ID only; canonical path resolution with a strict storage-root prefix check; client input never used as a filesystem path; downloads streamed by authorized endpoints | 3, 7 |
| T-15 | **Unauthorized invoice download** (guessing invoice IDs/URLs, direct file access) | Invoices | Financial-document & PII disclosure | PDFs stored **outside `public_html`** with unguessable names; download only via `GET .../invoices/:id/download` endpoints enforcing `store.invoices.manage` (admin) or ownership (customer, T-09); every download audited; no directory listing; signed URLs, if ever introduced, must be short-lived and ownership-bound | 7 |
| T-16 | **Overselling via race conditions** (concurrent checkouts for the last unit) | Checkout, inventory | Oversold stock, cancelled orders, disputes | Stock decremented by **conditional atomic update inside the order transaction** (`UPDATE … SET stock = stock − ? WHERE id = ? AND stock >= ?`, affected-rows checked) or row locks (`SELECT … FOR UPDATE`); transaction rollback on any failure; every movement written to `inventory_movements`; stock can never go negative; concurrency test required by spec Part 23 | 6 |
| T-17 | **Duplicate invoice generation** (double-click, retried/parallel approval requests) | Orders, invoices | Two invoices for one order; accounting confusion | Approval is **idempotent**: order-state check + transition inside one transaction; **unique constraint on `invoices.order_id`** and on invoice number; invoice number allocated from a locked counter row in the same transaction; immutable data snapshot; retries return the existing invoice | 7 |
| T-18 | **Duplicate invoice/order emails** (queue retries, resend misuse, worker restarts) | Email outbox | Customer confusion; perceived unprofessionalism; spam signals | `email_outbox` with an **idempotency key** (unique per type + entity + version); atomic claim (`UPDATE … WHERE status='PENDING'`) before sending; bounded retries with backoff and recorded last error; manual resend re-queues the *same* invoice snapshot as a new outbox row — it can never mint a new invoice; send outcomes recorded, delivery never assumed (spec Part 16) | 7 |
| T-19 | **Audit-log tampering** by a malicious insider or compromised admin | Audit | Loss of accountability; undetectable abuse | **No update/delete endpoints exist** and no role holds such a permission (`PERMISSIONS.md` §3); audit writes are append-only inserts; records include actor, action, target, IP, user agent, result; *designed extra integrity*: each record carries a hash chained to the previous record so silent edits are detectable, plus optional periodic export — adoption is an open decision (§11); DB-level per-table grants for the app user (INSERT/SELECT only on `audit_logs`) applied **if the cPanel MySQL setup permits** (to be verified in the hosting check) | 2 |
| T-20 | **Rate-limit bypass** (rotating IPs, distributed attempts, limits lost on app restart) | Auth, OTP, contact, checkout | Brute force/OTP abuse succeeds despite nominal limits | Limits keyed on **combinations** (account+IP, email, IP) as appropriate — not IP alone; store is **MySQL-backed and persistent** across Passenger workers and restarts (§7) — in-memory counters are explicitly rejected; progressive backoff; no permanent lockout (prevents attacker-induced DoS of a victim's account, spec §15.3) | 1 (store), 2 (policies) |
| T-21 | **Password-reset token abuse** (guessing, reuse, enumeration via response differences) | Password recovery | Account takeover | High-entropy token, hashed at rest, short expiry (proposed 30 min), single-use; requesting a reset returns an identical response for existing/non-existing emails; reset revokes all existing sessions; max 3 requests/email/hour; events audited | 2 |
| T-22 | **Account enumeration** via registration/login/recovery/OTP responses or timing | Auth | Targeted phishing, stuffing lists | Generic messages on all auth flows ("if an account exists…"); duplicate-registration handled without confirming the existing account's details; consistent response shapes; rate limits (T-20) blunt probing | 2 |
| T-23 | **Draft / unpublished content leakage** (public API returning drafts, preview endpoints guessable) | CMS | Premature disclosure; embarrassment | Public `GET /api/pages/:slug` resolves **only the published revision**; drafts exist solely behind `cms.pages.*` permissions; preview uses signed, short-lived, admin-bound tokens; publication is transactional — a failed publish leaves the previous live revision intact (spec §5.5) | 3 |
| T-24 | **Concurrent-edit overwrite** (two admins editing one page; last save silently wins) | CMS builder | Content loss; editors overwriting each other | Optimistic concurrency: every page/section carries a version; saves with a stale version are rejected with a conflict response (spec §5.4); autosave uses the same check | 4 |
| T-25 | **Contact-form abuse** (spam floods; using the form/SMTP as a relay; header injection) | Contact, email | SMTP blacklisting; inbox flooding | Public rate limit (proposed 5/IP/hour) + honeypot/time-trap fields; submissions stored in `contact_submissions` and **not** auto-emailed to arbitrary addresses; any notification email goes only to a fixed internal address; user input never placed raw into SMTP headers; CAPTCHA only if abuse is observed (avoid third-party dependency by default) | 3 |
| T-26 | **Application-layer resource exhaustion** (huge uploads, unpaginated lists, expensive searches) | All APIs | Slow/unavailable site on finite shared hosting | Request-size limits; mandatory pagination with caps; upload size caps (T-13); query timeouts where configurable; expensive admin exports avoided or paginated; honest note: app middleware **cannot** stop volumetric DDoS — that is Cloudflare's layer (T-27) | 1+ |
| T-27 | **Volumetric DDoS / bot floods** | Whole site | Outage | Cloudflare in front (DDoS protection, HTTPS, firewall/bot rules) per spec §15.4; origin rate limits as second layer. **Adoption pending Meena's decision (§11)** — without it, availability risk on shared hosting remains materially higher and is accepted explicitly if declined | 1 / ops |
| T-28 | **Secrets leakage** (committed `.env`, verbose errors, stack traces, debug endpoints) | Platform | Total compromise (A14) | Secrets only in server environment, never in git (`.env.example` with placeholders only); production error handler returns generic messages and logs detail server-side; no debug/test endpoints in production; pre-push secret scanning of the repo; distinct dev/production secrets (spec §19.2) | 1 |
| T-29 | **Backup exposure** (backups left in web-reachable folders — a classic cPanel failure) | Backups | Bulk theft of A1–A13 | Backups written only to private storage outside `public_html`; access via cPanel/SSH only; retention-limited; restore procedure documented and **tested** (spec §15.7, Phase 8); off-host copy recommended (open decision §11) | 8 |
| T-30 | **Clickjacking / browser-side framing & missing security headers** | Whole site | UI redress, data theft attempts | Helmet-managed headers: `X-Frame-Options`/CSP `frame-ancestors`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS (once HTTPS is confirmed end-to-end), and CSP (see T-06) | 1 |
| T-31 | **Email spoofing of museum identity** (attackers sending as the domain) | Email / domain | Phishing of customers using real order details | SPF, DKIM and DMARC records for the sending domain, configured with the chosen SMTP provider; system mail sent only from the configured `SMTP_FROM`; this also protects invoice-email deliverability. Record setup is an ops task for Meena/host (open decision §11) | 7 / ops |

## 6. Core security design summaries

### 6.1 Passwords (spec §15.1)

- **Argon2id** only. No bcrypt/MD5/SHA fallbacks, no plaintext anywhere, passwords never emailed.
- Parameters must be **benchmarked on the actual cPanel server** (spec requires this) targeting
  roughly 250–500 ms per verification within shared-hosting CPU limits. Starting point for the
  benchmark: OWASP minimum profile (memory 19 MiB, iterations 2, parallelism 1), raised toward
  memory 64 MiB / iterations 3 / parallelism 1 if the host sustains it under load. Final values are
  recorded in Phase 2 after benchmarking — they are **not** asserted here.
- Password policy: minimum length proposed at **12 characters** for administrators and **10** for
  customers (open decision §11); no composition rules; blocklist of common passwords. Verification
  failures use generic messages and constant-shape responses.

### 6.2 Sessions (spec §7.4, §15.2)

- Server-side sessions in `user_sessions`; cookie `__Host-session` (Secure, HttpOnly,
  SameSite=Lax, Path=/, no Domain). Only the SHA-256 hash of the session ID is stored.
- Rotation on login, MFA completion and privilege change (T-03).
- Proposed timeouts (**open decision §11**): customers — idle 7 days is *not* proposed; instead
  idle 24 h / absolute 30 days for shopping convenience; administrators — idle 30 min / absolute
  12 h. Admin figures should be stricter than customer figures; final values are Meena's call.
- Logout revokes the server record (not just the cookie). Users can list and revoke their sessions;
  password reset and MFA reset revoke all sessions.

### 6.3 Tokens (verification codes, resets, invitations)

One pattern for all three: CSPRNG generation, **only a keyed hash/HMAC or SHA-256 hash stored**,
expiry, single-use enforced in a transaction, attempt counters where a human types the value,
nothing sensitive in logs or API responses, and invalidation of siblings on success (e.g. a new
invitation supersedes the old; a successful reset kills other reset tokens).

### 6.4 File handling (spec §15.6)

As T-13/T-14: content-based validation, Sharp re-encoding, random names, private storage,
ID-addressed downloads, per-file authorization. Upload endpoints sit behind both a permission
and the rate/size limits.

### 6.5 Audit logging (spec Part 14)

- Events: the full Part 14 list (auth events, MFA, invitations, role changes, CMS publication,
  media, products, inventory, orders, invoices, templates, settings, **permission failures**).
- Each record: event ID, user ID (nullable), actor email snapshot, action, target type/ID,
  timestamp (UTC), IP, user agent, result, and **safe** structured metadata.
- **Never logged:** passwords, OTP codes, reset/invitation tokens, session IDs, TOTP secrets,
  recovery codes (spec Part 14). Log-writing code must use an allow-listed metadata shape so a
  future developer cannot accidentally log a request body.
- Append-only (T-19). Super Admin UI filters by date/actor/role/action/module/result (`audit.read`).

### 6.6 Error handling & information disclosure

Centralized error handler: clients receive a stable error code + generic message; internal detail
(including SQL errors, file paths, stack traces) goes only to server logs. This applies to 401/403
responses as well — a 403 must not reveal *which* permission is missing to an unauthenticated or
lower-privilege caller beyond the standard shape.

## 7. Rate-limiting policy (spec §15.3) and the store decision

### 7.1 Policy table

Values marked **[spec]** are mandated by the master specification. Values marked **[proposed]**
are this document's recommendation and need Meena's approval (§11). All limits are enforced
server-side, per key, with progressive backoff (delay grows with repeated violations) and **no
permanent account lockout** — lockouts let an attacker deny a victim access by failing logins
deliberately (spec §15.3).

| Flow | Limit | Keyed on | Source |
|---|---|---|---|
| Registration attempts | 3 / hour | IP | [spec] |
| Verification-code **sends** | 3 / hour; **60 s** resend cooldown | Email address | [spec] |
| Verification-code **attempts** | Max **5** per issued code, then the code is dead | Code record | [spec] |
| Verification-code lifetime | 10 minutes | Code record | [proposed] |
| Login failures | 5 failed / 15 minutes, then progressive backoff | Account + IP pair | [spec] |
| Password-recovery requests | 3 / hour | Email address | [spec] |
| Password-reset token lifetime | 30 minutes, single-use | Token record | [proposed] |
| **Admin login failures** | 3 failed / 15 minutes, then progressive backoff (doubling, capped); every failure audited; alert to Super Admin after repeated admin-targeted failures | Account + IP pair | [proposed — spec requires "stricter controls and anomaly monitoring" without numbers] |
| MFA verification attempts | 5 per login challenge, then the challenge is destroyed and a fresh login is required | Session challenge | [proposed] |
| Invitation acceptance attempts | Token is single-use; acceptance endpoint 10 / hour | IP | [proposed] |
| Contact-form submissions | 5 / hour | IP | [proposed] |
| Checkout submissions | 10 / hour (plus idempotency on the order itself) | Account | [proposed] |
| General API | Generous ceiling (e.g. 600 / 15 min) as a safety net, tuned after launch | IP + session | [proposed] |

All thresholds live in **protected server configuration** (spec §7.1 requires the OTP policies to
be adjustable), not in code constants scattered across modules.

### 7.2 Store decision: MySQL-backed rate limiting (no Redis)

**Decision (designed): rate-limit state is stored in MySQL, in a dedicated table — not in process
memory, and not in Redis.**

Rationale:

1. **Redis is not expected to be available on cPanel shared hosting** (spec §15.3 anticipates
   exactly this and directs us to "evaluate a properly designed MySQL-backed rate-limit store").
   The hosting feasibility check (Part 3) will confirm; unless it surprises us, Redis is out.
2. **Passenger runs multiple workers and recycles them.** In-memory counters would differ per
   worker and reset on every restart/deploy — an attacker could bypass limits simply by waiting
   for a recycle or by load-balancing across workers. That makes in-memory limiting decorative.
3. MySQL is already the authoritative store; one more small table adds no new infrastructure.

Design:

- Table `rate_limit_buckets`: `key_hash` (SHA-256 of flow + identifier — raw emails/IPs are not
  stored as keys), `window_start`, `hit_count`, `expires_at`; primary key (`key_hash`,
  `window_start`).
- Increment is a **single atomic upsert** (`INSERT … ON DUPLICATE KEY UPDATE hit_count =
  hit_count + 1`), so concurrent requests cannot race past a limit.
- Expired buckets are deleted by the existing cron runner (daily, batched, with a `LIMIT`).
- **Failure mode:** if the rate-limit store is unreachable, authentication-sensitive flows
  (login, OTP send/verify, registration, recovery) **fail closed** (temporarily reject + alert),
  while public read endpoints fail open with server-side logging. A limiter outage must never
  silently disable brute-force protection. (Trade-off recorded for Meena in §11.)
- Cloudflare rate-limiting rules, if Cloudflare is adopted, are a *first* coarse layer only; the
  MySQL store remains authoritative because edge rules cannot key on account identity.

## 8. Assessment: the existing frontend "content protection" hook

**Subject:** `useWebsiteProtection()` in `src/app/components/shared.tsx`, applied in `App.tsx` to
the entire application shell, plus its companion CSS in `src/styles/theme.css`.

### 8.1 What it actually does (verified by reading the code)

- Blocks the browser context menu (`contextmenu`) and all drag starts, site-wide.
- Blocks copy/cut everywhere except inside form fields / `contenteditable` elements.
- On F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C, Ctrl/Cmd+U or Cmd+Shift+S: blurs the whole app
  (`filter: blur(18px); opacity: 0.18`) for 1.4 s.
- Blurs the app whenever the window loses focus or the tab is hidden; shows a fixed black
  `.privacy-screen` overlay while obscured.
- On the PrintScreen key: blurs for 1.4 s.
- CSS additionally sets `user-select: none` on the whole page (except form fields), disables
  image dragging and the mobile long-press callout, and **blanks all printing** (`@media print`
  hides everything behind a black layer).

### 8.2 Honest security evaluation

**This mechanism provides no meaningful security, and must never be counted as a control.**

- Everything it "protects" is public content that the server has already sent to the visitor's
  browser. The page HTML, JS bundle and image URLs can be fetched directly (`curl`, any HTTP
  client, a browser with JavaScript disabled, view-source workarounds, a second browser/profile,
  devtools opened *before* navigation, remote debugging, OS-level screenshot tools, or simply a
  phone camera pointed at the screen). It stops none of these.
- PrintScreen interception is unreliable by design: on Windows the key event is frequently not
  delivered to the page once the Snipping Tool engages; macOS screenshots do not fire it at all.
- DevTools cannot be closed or detected reliably from page script; the keydown blocks only
  inconvenience users of *this* browser window.
- Most importantly, it protects the wrong asset. The genuine risks in the dynamic system are
  server-side — sessions, customer PII, orders, invoice PDFs, admin accounts (§2). Those are
  protected (by design) in §§5–7. A client-side blur contributes **zero** defence to any of them,
  and citing it in a security review would create false assurance.

Its only real effect is **deterrence of casual copying** by non-technical visitors — a business
preference, not a security property — bought at significant cost:

### 8.3 Conflicts with the specification

1. **CMS visual editor (Part 5) — direct functional conflict.** The builder requires
   drag-and-drop section reordering (global `dragstart` is blocked), inline `contenteditable`
   editing with normal text selection (`user-select: none` fights it), copy/paste of content
   while editing (copy/cut blocked outside editable targets), context menus, and image handling
   from the media library (dragging blocked). Window-blur obscuring fires when an editor opens a
   file picker, switches to email to check something, or uses a second monitor — the app blurs
   mid-task. The editor cannot be built on top of this hook.
2. **Accessibility (spec §1.2 "Maintain accessibility", Part 18) — direct conflict.** Global
   `user-select: none` prevents visitors from selecting text (used by read-aloud tools, translators,
   and low-vision/dyslexic users who highlight while reading). Blocking the context menu removes
   browser accessibility and spell-check entry points — including inside form fields, where only
   copy/cut were exempted, not the menu. Blanking print output blocks users who rely on printed
   material. Keyboard interception can interfere with assistive-technology shortcuts.
3. **Testing (spec §1.3, Parts 22–23) — direct conflict.** The Phase 0 audit itself requires
   desktop/mobile screenshots of all seven pages, and later phases require Playwright browser
   tests; blur-on-focus-loss and visibility-obscuring are designed to sabotage exactly these
   captures and make automated screenshots flaky.
4. **Customer workflows — collateral damage.** Customers cannot copy their own order reference,
   select an address, or print anything; support cannot ask a customer for a screenshot of a
   problem (the screenshot is blurred/black). Admins doing data entry across two windows are
   punished continuously.
5. **It also cannot survive contact with the new features anyway:** the hook wraps the *whole*
   shell in `App.tsx`. If retained as-is it would apply to `/admin`, `/account` and checkout —
   the worst possible places for it.

### 8.4 Recommendation

**Remove the hook and its companion CSS (`user-select: none`, print-blanking, image-drag rules)
from the application before Phase 4 (visual builder) at the latest — and preferably in Phase 1,
so no new work is built around it.** This requires Meena's explicit decision (§11), because the
repo history shows the behaviour was added deliberately (commit "disable screenshoot"); it is his
call, but the recommendation is unambiguous.

If Meena wants to keep a *deterrent* against casual image copying on public gallery pages, use
proportionate, honestly-labelled measures instead, scoped to public artwork imagery only:

- Serve **reduced-resolution public renditions** of sensitive artwork images (the CMS already
  re-encodes uploads with Sharp, T-13) and keep full-resolution files in the media library.
- Apply visible **watermarking** to selected high-value images, server-side.
- `draggable={false}` on gallery images only, plus a clear copyright notice.

These deter casual reuse; they do not, and will not be documented as, "protection".

**Until the decision is taken:** the hook must not be extended, must not be cited as a security
control in any phase report, and must be excluded from (or disabled in) all admin, account and
checkout routes from the moment those routes exist.

## 9. OWASP mapping

### 9.1 OWASP API Security Top 10 (2023) → design response

| API risk | Where it bites here | Design response (threat refs) |
|---|---|---|
| API1 Broken Object Level Authorization | Orders, addresses, cart items, invoice downloads | Ownership scoping + 404-on-cross-owner (T-09, T-15) |
| API2 Broken Authentication | Login, OTP, reset, invitations, MFA | §6.1–6.3, T-01, T-02, T-11, T-12, T-21 |
| API3 Broken Object Property Level Authorization | Mass assignment of role/price/status | Allow-listed Zod schemas; server-side price/total recomputation (T-10) |
| API4 Unrestricted Resource Consumption | Uploads, lists, search, email sends | Size caps, pagination caps, rate limits §7 (T-26) |
| API5 Broken Function Level Authorization | Admin endpoints reachable by lower roles | Permission middleware, deny-by-default (T-10; `PERMISSIONS.md`) |
| API6 Unrestricted Access to Sensitive Business Flows | OTP requests, checkout, invitation acceptance | Flow-specific limits §7.1 (T-02, T-16) |
| API7 SSRF | **Low current surface** — the API fetches no user-supplied URLs. Rule: no server-side fetching of admin/customer-supplied URLs (e.g. "import image from URL") may be added without an SSRF review | Standing rule, Phase 3+ reviews |
| API8 Security Misconfiguration | Headers, CORS, errors, debug flags, default accounts | §6.6, T-28, T-30; no seeded demo accounts (spec Part 4) |
| API9 Improper Inventory Management | Shadow/undocumented endpoints, old API versions | Part 17 route inventory is the canonical list; new endpoints require a permission mapping (`PERMISSIONS.md` §1.3) |
| API10 Unsafe Consumption of Third-party APIs | SMTP responses, Cloudflare headers treated as truth | Email delivery never assumed from an API "success" (T-18); client IP taken only from trusted proxy headers configured for our Cloudflare/cPanel chain, never blindly from `X-Forwarded-For` |

### 9.2 OWASP ASVS 5.0

ASVS 5.0 is adopted as the **verification reference for Phase 8** (spec §15): the security test
plan will be organized by ASVS chapters (encoding, validation, session management, access control,
cryptography, error handling, data protection, communications, file handling, API/Web Service).
No ASVS compliance level is claimed at Phase 0; a target level (L2 is the sensible aim for an
application handling PII and financial documents) is proposed for Meena's confirmation (§11).
Phase 8 must produce evidence per requirement area, per spec Part 25 — not a blanket "secure"
assertion.

## 10. Residual risks accepted by design

- **Shared-hosting neighbours (A18):** a compromised co-hosted site could attack at OS level.
  Mitigated (private file placement, permissions, secrets outside web root) but not eliminable on
  cPanel shared hosting. Accepted; revisit if hosting changes.
- **Email as an authentication channel:** verification codes, reset links and invitations all
  depend on the customer's mailbox security. This is inherent to the spec's design; MFA on admin
  accounts is the compensating control for the highest-value targets.
- **COD-only commerce:** no payment-gateway risk (PCI scope avoided entirely, per spec §10.4),
  at the cost of fake-order risk — mitigated partially by verified accounts and order approval.
- **Deterrence ≠ protection for public images:** public artwork images can always be copied by a
  determined visitor (§8). Accepted once Meena decides §8.4.

## 11. Open security decisions requiring Meena's input

These must be settled before (or during) the phase noted. Defaults will **not** be silently
assumed for items 1–5.

1. **Content-protection hook disposition (§8).** Recommendation: remove entirely in Phase 1.
   Alternatives: (a) remove now; (b) keep on public pages only until Phase 3, then remove;
   (c) keep and accept the CMS-editor/accessibility conflicts (not recommended — the visual
   builder cannot meet Part 5 with it in place). *Needed before Phase 4; preferably Phase 1.*
2. **Admin login thresholds & alerting (§7.1).** Approve the proposed 3-failures/15 min +
   progressive backoff, and choose the alert channel for repeated admin-targeted failures
   (email to Super Admin? audit-log-only?). *Needed before Phase 2.*
3. **Session timeout values (§6.2).** Approve or amend: customers idle 24 h / absolute 30 days;
   administrators idle 30 min / absolute 12 h; step-up MFA staleness window 15 min
   (`PERMISSIONS.md` §7). *Needed before Phase 2.*
4. **Password policy (§6.1).** Approve minimum lengths (proposed 12 admin / 10 customer) and
   decide whether to screen new passwords against known-breached lists (an external k-anonymity
   lookup — a privacy/dependency trade-off). *Needed before Phase 2.*
5. **Cloudflare adoption (T-27).** Is the domain's DNS moving to Cloudflare (free tier suffices
   for the spec's requirements)? Who controls the Cloudflare account? Without it, DDoS/bot
   protection rests on shared hosting alone. *Needed before Phase 1 deployment design.*
6. **System email identity (T-31, A15).** Which mailbox/SMTP service sends verification, reset,
   invitation and invoice mail, and who will publish SPF/DKIM/DMARC? Given this domain's prior
   compromised-mailbox spam incident, a dedicated sending mailbox (not a personal one) is
   recommended. *Needed before Phase 2 (auth email) and Phase 7 (invoices).*
7. **ASVS target level (§9.2).** Confirm L2 as the Phase 8 verification target. *Phase 8 planning.*
8. **Audit-log integrity extras (T-19).** Adopt hash-chaining of audit records and/or a periodic
   off-server export? Both add Phase 2/8 effort; hash-chaining is recommended. Also set the
   **audit retention period** (proposed: minimum 12 months online). *Needed before Phase 2.*
9. **Invitation lifetime (§5, T-11).** Approve proposed 72-hour expiry. *Phase 2.*
10. **SVG uploads (T-13).** Allow SVG (needed for logos) only with server-side sanitization, or
    disallow SVG uploads entirely in v1 (logos as PNG)? *Phase 3.*
11. **Rate-limit failure mode (§7.2).** Confirm fail-closed behaviour for auth flows if the
    rate-limit store is down (brief login unavailability vs. unprotected brute-force window).
    *Phase 1/2.*
12. **Optional customer MFA.** Spec mandates MFA for admins only. Offer customers optional TOTP
    later, or not at all? (Recommendation: defer beyond v1.) *Any time before Phase 2 closes.*
13. **Backup location & retention (T-29).** On-host private storage only, or also an off-host
    copy (and where)? Who owns restore testing? *Phase 8 planning.*

---

*End of SECURITY_THREAT_MODEL.md — Phase 0 design document. All controls herein are designed, not
implemented; implementation and test evidence are produced phase by phase per spec Parts 22–25.*
