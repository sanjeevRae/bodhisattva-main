# Testing Report — Bodhisattva Museum Platform (through Phase 8)

All results below are from the local development environment (MariaDB
10.11, real application, real SMTP sink). Nothing here is a claim about
the production host — the deployment smoke tests in
DEPLOYMENT_GUIDE.md §11 run when the owner connects cPanel.

## Automated suites

| Suite | Tests | Result |
|---|---|---|
| Unit (server) | 99 | ✅ all passing |
| Integration — auth flows | 8 | ✅ |
| Integration — CMS flows | 6 | ✅ |
| Integration — museum flows | 7 | ✅ |
| Integration — store flows | 12 | ✅ |
| Integration — orders flows | 17 | ✅ |
| Integration — security probes | 14 | ✅ (1 real bug found + fixed, see below) |
| **Integration total** | **64** | ✅ |

Frontend: production build green; admin is a lazy chunk; the public
site never downloads admin or editor code.

## Acceptance coverage (Part 23 mapping)

- **Public routes**: all 7 pages render from the API with 0.00%
  strong pixel-diff against the pre-platform design captures
  (Phases 3/5); shop/auth/account/checkout routes added in Phase 6
  walkthrough-verified.
- **CMS**: draft → preview (hashed expiring tokens) → publish →
  rollback round trips; optimistic-concurrency 409s; section
  validation at save and again at publish; system pages undeletable.
- **Auth/RBAC**: registration + email OTP (incl. exhaustion after the
  Phase 8 fix), login lockouts, session rotation + invalidation, MFA
  enrol/verify/recovery/step-up, invitations (rank caps, single-use),
  last-Super-Admin protection, per-permission 403s, cross-owner 404s.
- **Ecommerce**: login-gated cart, server-side totals, idempotent
  checkout, two-buyer/one-unit oversell test → exactly one order;
  inventory ledger invariants; reconciliation CLI reports the dev
  database fully consistent.
- **Orders/invoices**: approval creates exactly one invoice under
  triple concurrency; approve-vs-cancel races end in legal states with
  exact movement counts; SMTP-down approval commits and delivers on
  recovery; template edits never alter issued PDFs (byte-identical);
  credit notes issued on post-approval cancellation with PDF + email;
  invoice IDOR → 404.
- **Security (Phase 8 suite)**: SQL injection, stored XSS, CSRF,
  IDOR, session fixation, brute force, privilege escalation, path
  traversal, malicious uploads, information disclosure, headers —
  14/14. **F1 (fixed): the OTP wrong-attempt counter was rolled back
  by its own transaction, so the 5-attempt limit never engaged** —
  verification codes were brute-forceable within their validity
  window. Fixed so the increment commits; regression-locked (test
  6b). F2 (documented, not fixed): unknown /api/* paths return 401
  anonymously vs 404 authenticated — no data leak.
- **Backup/restore drill**: dump + storage restored into a scratch DB
  in ≈22 s; restored-instance smoke tests passed, including admin
  MFA login and a byte-identical invoice PDF (docs/phase-8/).

## Manual walkthroughs (evidence in docs/phase-N/)

Phases 4–8 each include a browser walkthrough with screenshots:
builder editing + autosave conflict handling (P4), module CRUD +
reorder round trip (P5), a real order placed through the shop UI
(P6), order approval → invoice email with PDF (P7), WYSIWYG editing
+ paste-cleanup + publish (P8).

## Not tested / not claimed

- The cPanel host itself (Node/MariaDB versions, Passenger behaviour,
  cron, SMTP egress, TLS) — the Phase 8 deployment gate, pending the
  owner's hosting connection.
- Real email deliverability (SPF/DKIM/DMARC) — a deployment task.
- Load beyond the concurrency proofs (no 20–50-way stress run; the
  reviewers' suggestion is recorded in PHASE8_REVIEW.md).
- A failure-persistence matrix across every counter (both final
  reviewers' top test recommendation — recorded as the first
  post-launch test investment; the rate-limit counters are standalone
  atomic upserts outside business transactions by design, and the
  login/OTP paths are covered, but the full matrix is not built).
