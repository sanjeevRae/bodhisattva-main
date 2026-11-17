# Security Guide — the Security Model as Built

This describes the security controls **as implemented** in the code
(Phases 1–8), with the evidence for each. Design rationale lives in
`SECURITY_THREAT_MODEL.md`; hosting-side requirements in
`DEPLOYMENT_REQUIREMENTS.md`. Nothing here is deployed yet.

## Accounts, passwords, verification

- **Passwords** are hashed with **Argon2id** (memory 64 MiB, 3
  iterations, parallelism 1 — ≈260–370 ms on the development VM;
  **provisional** until benchmarked on the production host, see
  KNOWN_LIMITATIONS). Minimum length 10 characters, 12 for
  admin-role holders.
- **Registration** verifies the email with an **8-digit one-time
  code**: stored only as an HMAC-SHA-256 (keyed with a server secret,
  bound to purpose + email), single-use, expiring, with a 60-second
  resend cooldown and a 3-per-hour cap. **Five wrong attempts burn the
  code** (`OTP_ATTEMPTS_EXCEEDED`).
- **Password reset** uses a one-time token link (1 h), consumed
  atomically; completing a reset revokes all of the user's sessions.
- Login failures are deliberately generic (no account-existence
  signal) and timing-equalised against a dummy hash.

### The OTP attempt-counter bug (found by the Phase 8 security suite — stated plainly)

The Phase 8 security suite found that the wrong-code attempt counter
was incremented **inside** the verification transaction, and the error
thrown immediately afterwards rolled the increment back — the counter
stayed at 0 forever, the 5-attempt limit never fired, and verification
codes could be brute-forced without limit inside their validity
window. No earlier suite had tested attempt exhaustion, which is why
it survived Phases 2–7. **Fixed** in Phase 8 (the mismatch is signalled
out of the transaction so the increment commits; the error is thrown
afterwards) and regression-locked by security-suite test 6b: the 5th
wrong attempt now returns 429 and the correct code is burned too.

## Sessions

- Server-side sessions; the cookie carries a random token and only
  its **SHA-256 hash** is stored. Cookie: `__Host-session` in
  production (HttpOnly, SameSite=Lax, Secure in production).
- Lifetimes: **customers** idle 24 h / absolute 7 days; **admin-role
  holders** idle 30 min / absolute 12 h.
- A fresh token is issued at login (no fixation — tested). Logout
  kills the session; "log out everywhere" bumps a per-user
  `session_version` that every session snapshot is checked against,
  revoking all devices at once. Role changes also revoke the target's
  sessions.

## MFA (TOTP)

- **Required** for SUPER_ADMIN, ADMIN and STORE_ADMIN: enrolment is
  forced at first login; login completes only after a code verifies.
- Secrets are stored **AES-256-GCM-encrypted** under
  `TOTP_ENCRYPTION_KEY`. Replay is rejected: a time-step, once used,
  can never verify again. Ten one-time recovery codes are issued at
  enrolment (Argon2id-hashed at rest).
- **Step-up**: invitations, role assignment, MFA resets and global
  settings require an MFA verification within the last 15 minutes;
  the admin UI prompts in place. Step-up failures are rate-limited
  (5 per 15 min).

## Authorisation (RBAC)

- **49 permissions, 4 roles** (SUPER_ADMIN, ADMIN, STORE_ADMIN,
  CUSTOMER), deny-by-default; the matrix is in `PERMISSIONS.md`.
- Permissions are resolved **fresh from the database on every
  request** (no cross-request cache — a Passenger multi-process host
  makes caches lie). At most one administrative role per user;
  granting roles is rank-capped, and the last active SUPER_ADMIN
  cannot be demoted (checked under lock).
- **Resource-level ownership**: customers only ever reach their own
  cart, addresses, orders and invoices — another user's object is a
  **404, identical to a nonexistent one**, so ids can't be enumerated.
- Admin invitations are one-time, hashed at rest, 72 h, email-bound;
  re-issuing revokes predecessors.

## Request-level defences

- **CSRF**: double-submit cookie (`X-CSRF-Token` header, constant-time
  compare) on every state-changing session request; the only
  exemptions are the pre-session public auth posts. An `Origin`
  header, when present, must exactly match the CORS allowlist (403
  otherwise).
- **Rate limiting**: fixed-window counters in MySQL (works across
  Passenger workers, unlike in-memory limiters), scopes keyed by
  HMAC — raw emails/IPs are never stored as scope keys. The limiter
  **fails closed**: if its store errors, the request is refused
  (503), not waved through.
- **Headers**: helmet defaults on API responses
  (`X-Content-Type-Options`, frame protections, …).
- **Errors** use one envelope and hide internals: no stack traces,
  SQL, or file paths in any response (tested, including forced-500
  and oversized-body cases).

## Content & uploads

- **Rich text** is sanitized at save with a formatting-only
  sanitize-html allowlist, and every CMS section is schema-validated
  on save and again at publish. Plain-text fields are rendered as
  React text (never raw HTML) — the only `dangerouslySetInnerHTML`
  paths in the codebase are the server-sanitized rich-text ones.
- **Uploads**: 10 MiB cap; the type is **sniffed from content** by
  Sharp (JPEG/PNG/WebP/GIF/AVIF only — SVG and executables are
  rejected); images are **re-encoded** (EXIF and smuggled metadata
  stripped) with a 40-megapixel decompression cap; files get random
  128-bit names and are served only through the API from paths built
  from the stored name (no user input in paths — traversal-tested).
  A referenced asset cannot be deleted.
- **Preview links** are hashed, page+revision-bound, 30-minute tokens;
  every failure returns the same 404 (no oracle), with
  no-store/noindex headers.

## Email outbox integrity (Phase 8 hardening)

Invoice/credit-note email goes through a transactional outbox
(at-least-once delivery is the ceiling for SMTP — stated plainly):

- Rows are claimed by an atomic conditional update under a lease;
  Phase 8 added a **lease-version fencing token**: the SENT / failure
  updates are conditional on the claimed version, so a stale worker's
  late write affects 0 rows and can't clobber a newer state.
- SMTP timeouts (10 s connect/greet, 30 s socket) sit far below the
  5-minute lease, so a hung connection can't outlive its claim.
- Each outbox row has a **deterministic Message-ID**, stable across
  its retries, so downstream systems can dedupe; a manual resend is a
  new row with a new Message-ID, and the dead-lettered original is
  preserved for audit.
- Stored error messages have SMTP credentials stripped.

## Audit

Append-only audit log for authentication events, CMS changes,
settings (with old/new values), store operations, order transitions
and invoice actions. Metadata is sanitized (keys matching
password/otp/token/secret/code are dropped recursively). No role —
including SUPER_ADMIN — has audit update or delete permissions.

## Phase 8 security suite — results

`server/tests/security.integration.test.ts` (own database, runs in
`npm run test:integration`): **14/14 passed** after the OTP fix.

| Probe | Result |
|---|---|
| SQL injection (shop/news/admin search: `' OR '1'='1`, UNION, comments) | Pass — sane payloads, no 500s, no cross-table data |
| XSS (rich text + product/news plain-text fields) | Pass — rich text sanitized at save; plain text rendered as React text only |
| CSRF (missing + wrong token on cart/settings/order actions) | Pass — 403 both ways |
| IDOR (cart, addresses, orders, invoice metadata + PDF; sequential ids) | Pass — uniform 404, no enumeration oracle |
| Session fixation + logout invalidation | Pass — fresh token per login; old id 401s after logout |
| Brute force: login lockout · registration per-IP cap | Pass — 429s trip as designed |
| Brute force: OTP exhaustion | **Failed → fixed (see above)** — now 429 on attempt 5, code burned |
| Privilege escalation (customer → admin routes; STORE_ADMIN → role management; customer → approve) | Pass — 403s |
| Malicious uploads (SVG-with-script, executable-as-.png, zip; valid PNG control) | Pass — rejected by content sniffing; control accepted |
| Path traversal (media route, encoded variants) | Pass — paths built only from stored names |
| Information disclosure + helmet headers | Pass, with minor finding F2 below |

**F2 (known, accepted, not a vulnerability):** unknown `/api/*` paths
return 401 to anonymous callers (the customer routers' auth wall fires
first) but 404 to authenticated callers. No data leaks either way;
it's a fingerprinting nit, recorded in KNOWN_LIMITATIONS, and the
suite asserts both behaviours so fixing it later is a deliberate
change.

## Production secrets handling

- The API **fails fast at boot** on missing/placeholder secrets:
  `SESSION_SECRET`, `OTP_HMAC_SECRET`, `TOTP_ENCRYPTION_KEY` must each
  be ≥32 characters, **pairwise distinct**, free of placeholder
  markers in production, and the TOTP key must decode to exactly
  32 bytes. Verified by booting with five deliberately broken
  environments (all exit 1 naming the variable) — see
  `docs/phase-8/production-config.md`.
- Secrets are per-environment, generated uniquely, never committed
  (no `.env` exists in the repository), and never shared with
  external reviewers.
- **Deployment rule: no `.env` file may ship inside the deployed app
  directory.** `server.ts` loads dotenv before validation, so a stray
  `.env` would silently fill variables the host configuration forgot
  and weaken the fail-fast guarantee. Production values belong in the
  cPanel Node.js app configuration.
- Backups must include the configuration (especially
  `TOTP_ENCRYPTION_KEY`) alongside the database — without the key, a
  restored database's MFA secrets are undecryptable and every admin
  must re-enrol (see BACKUP_RESTORE.md).
