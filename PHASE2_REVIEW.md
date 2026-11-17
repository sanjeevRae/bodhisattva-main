# Phase 2 Review — Authentication & RBAC

Independent reviews of the Phase 2 design and implementation, per the
master specification Part 21 (ChatGPT + Gemini, design-level brief, no
secrets shared), plus the lead's integration findings. Reviews ran
2026-11-17 after the implementation was verified end to end against a
real MariaDB and a real SMTP sink.

## Verdicts

- **ChatGPT: 8.2/10** — "good security architecture" — strongest: session
  management, token handling, MFA, database-backed authorization.
  Weakest: login abuse resistance, CSRF hardening, audit reliability,
  concurrency around administrative invariants. Production approval:
  conditional on its top-5 fixes.
- **Gemini: 7.5/10** — "exceptionally mature, defense-in-depth" —
  production concerns: the login lockout DoS, DB load on shared hosting,
  trust-proxy configuration, silent audit failures, Argon2id tuning.

## Critical bug found by integration testing (not by either reviewer)

**otplib frozen epoch.** The TOTP authenticator was constructed with a
spread of `authenticator.allOptions()`, which snapshots `epoch:
Date.now()`; stored options override the per-call default, so every code
was checked against the module-load time-step ±1 — MFA would have broken
~60 seconds after every server start. Unit tests passed because they ran
inside the window. Caught by the integration suite's audit-log trail
(`code_mismatch` on a provably correct code), fixed by excluding `epoch`
from the stored options, regression-covered by the integration test that
verifies a TOTP at login long after process start.

Two further lead fixes during integration:

- **Verify-email no-op removed.** An already-verified account presenting
  any code originally received a success no-op; it now gets the same
  indistinguishable `VALIDATION_FAILED` as an unknown email (codes are
  single-use per spec).
- **Invitation-accept CSRF exemption.** The accept route is pre-session
  (the invitee has no cookies yet) and was 403-blocked by the CSRF
  middleware; it is exempt like password-reset/confirm — the invitation
  token itself is the credential.

## Reviewer findings — disposition

### Applied immediately (this phase)

1. **Login lockout DoS (both reviewers' #1).** A successful login now
   clears the ACCOUNT-scope failure counter (`resetScope` in the rate
   limiter). The shared IP scope is deliberately NOT cleared — it is
   shared across accounts and clearing it would refund an attacker's
   budget. Residual: an attacker can still trip the 15-minute account
   block once; the window is short and the legitimate user recovers
   automatically. Progressive throttling remains a Phase 8 candidate.
2. **Last-Super-Admin race (ChatGPT).** The invariant was checked before
   the transaction; two concurrent demotions could both pass. The check
   now also runs INSIDE the role-assignment transaction: all SUPER_ADMIN
   assignment rows are locked `FOR UPDATE` first, serializing demotions,
   and the count is re-read under lock before mutating.
3. **Origin validation (ChatGPT).** New middleware rejects any
   state-changing `/api` request whose `Origin` header is present but not
   on the CORS allowlist — defence in depth alongside the double-submit
   cookie, and it also covers the CSRF-exempt pre-session routes
   (login/registration CSRF).

### Verified already satisfied

- **Trust proxy (Gemini #3).** `app.set("trust proxy", 1)` is set — one
  hop, matching the Passenger topology, not a blanket `true`.
- **Dummy-hash timing equalisation (ChatGPT).** Login verifies against a
  cached dummy Argon2id hash for unknown accounts.
- **Invitation acceptance atomicity (ChatGPT).** Consume + account
  creation + role assignment run in one transaction with a conditional
  UPDATE and affected-rows check.
- **Session-version check on MFA-pending sessions (ChatGPT).**
  `validateSession` enforces the version snapshot at every auth level.

### Recorded for Phase 8 (production hardening), with reasons

- **Session-bound CSRF token (ChatGPT #2).** Storing the CSRF secret on
  the session row (synchronizer pattern) is the stronger design; the
  double-submit cookie + SameSite=Lax + Origin check is a defensible
  posture for the build phases. Scheduled with the other pre-launch
  hardening items.
- **Transactional audit for critical events (ChatGPT #3, Gemini #4).**
  Role changes / MFA resets / invitation creation should commit with
  their audit rows. Today audit failures are pino-logged (Gemini's
  fallback ask is partially met). Threading the transaction through
  `writeAudit` for the critical call sites is scheduled for Phase 8.
- **Per-request permission resolution (Gemini #2).** Gemini proposed a
  15–30 s in-memory cache; NOT adopted — it reintroduces stale-permission
  windows across Passenger workers and contradicts the Phase 0 design.
  The underlying concern (connection limits) is real and belongs to the
  Phase 8 hosting proof-of-concept: pool limit is already env-driven
  (default 5) and will be load-checked on the real host.
- **Argon2id host tuning + bounded hashing concurrency (both).**
  Parameters (64 MiB / t=3 / p=1, ~280 ms here) stay until the real
  cPanel host is benchmarked in Phase 8, per the Phase 0 amendment A12.
- **Password max length + breached-password screening (ChatGPT).**
  Noted for Phase 8 policy pass; no silent truncation exists today.

## Integration-suite stability note

Early suite runs flaked intermittently (roughly 1 run in 3) on THIS
loaded VM. Root cause was in the TEST, not the product: OTP extraction
took the first 8-digit run in the raw mail, and nodemailer's Message-ID
header intermittently starts with an 8-digit run that shadowed the real
code. Extraction is now anchored to the mail template's phrasing. The
TOTP-at-login test additionally waits for a fresh time-step boundary
before generating its code, because the enrolment confirm legitimately
claims the current step (replay protection working as designed).

## Verification evidence

- Server build: clean (`tsc`).
- Unit suite: 48 passed, 7 skipped (integration file skips without
  `INTEGRATION_DB=1`).
- Integration suite (real app + real MariaDB + real SMTP sink; codes and
  tokens read from delivered mail): bootstrap-once, MFA enrolment gate +
  step-up, customer register/OTP single-use/CSRF logout, password reset +
  session revocation, invitation lifecycle + last-Super-Admin 409, MFA
  login + same-step replay rejection, login rate limit — run repeatedly
  green after the fixes above (final counts in the Phase 2 commit).
- Dev database migrated (3 migrations) and seeded: 4 roles, 49
  permissions, 104 role-permission grants, 0 user accounts (bootstrap is
  Meena's step, with his real email, when he is ready).
