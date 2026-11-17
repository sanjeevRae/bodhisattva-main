# Phase 8 — Independent Review Synthesis (Final)

Final reviews run 2026-11-17 against a design-and-evidence summary
(no code, no secrets, no live host), per Part 21.

## Scores

- **ChatGPT — 8.0/10.** "Conditional GO for a staged deployment —
  NOT an unsupervised direct launch." Sub-scores: engineering ~8.5,
  documentation ~8.5, security ~7.5, ops ~7.0, launch readiness ~7.0.
- **Gemini — 7.5/10.** "Approve for staged deployment and gated soft
  launch… do not approve for unconditional public launch." Sub-scores:
  architecture/data integrity 8, concurrency/fencing 8.5, security 7,
  ops 7, deployment readiness 6, business completeness 6.5, docs 8.5.

Both reviewers converge on the same verdict, which matches the
project's own position: **the platform is built and verified locally;
launch is gated on the host and on owner decisions, not on code.**

## Agreed launch gates (both reviewers, adopted as the go-live list)

1. Staging deployment on the real cPanel host + the DEPLOYMENT_GUIDE
   smoke checklist (Node/MariaDB versions, cron, process restart,
   TLS, no `.env` shipped in the app directory).
2. Owner-signed real values: stock counts, shipping fee, tax rate,
   reservation-expiry policy — the seeded placeholders (10 / Rs. 0 /
   0%) must not reach customers.
3. Written VAT confirmation from the owner/accountant. Credit notes
   are accepted by both reviewers as a sound launch posture **only**
   while no VAT is charged and no tax number is claimed; the moment
   the business is (or becomes) VAT-registered, the invoice/credit-
   note wording must be re-reviewed before any taxable sale.
4. Backup/restore rehearsed on the host; the TOTP encryption key
   backed up separately from the database backup.
5. Basic alerting (site down, outbox ageing, backup/cron missed) —
   both reviewers name unattended-failure detection as the single
   most valuable post-launch investment.
6. A full COD cycle on the host with real SMTP: order → approve →
   invoice → cancel → credit note, with SPF/DKIM/DMARC checked.

## Dispositions on the remaining findings

- **Failure-persistence matrix (both reviewers' top test ask).**
  Accepted as the first post-launch test investment, not built in
  Phase 8. Current state, stated precisely: rate-limit counters are
  standalone atomic upserts executed outside business transactions;
  login lockout and (post-fix) OTP exhaustion are covered by tests;
  token consumption is enforced by conditional updates. The unbuilt
  part is the systematic matrix — every counter × rollback ×
  concurrency — including concurrent wrong-OTP attempts. Recorded in
  KNOWN_LIMITATIONS and TESTING_REPORT.
- **SMTP exactly-once.** Both reviewers note fencing closes the
  database state machine, not the SMTP accept-then-crash window.
  Accepted and already stated in PHASE7_REVIEW: at-least-once with
  deterministic Message-IDs is the ceiling; no stronger claim is made.
- **Deadlock retry exercised under a real deadlock.** Fair: the retry
  helper is unit-proven and the transactions are safe by construction
  (re-validation + idempotency), but no test forces a genuine 1213.
  Post-launch test list.
- **Last-good cache staleness policy.** The cache serves only on DB
  read failure and logs a warning; it has no TTL or operator alert.
  Accepted as a limitation; alerting (gate 5) is the remedy.
- **Credit-note wording for COD.** Gemini: a cancelled unpaid COD
  order is a reversal, not a refund, and the document must not imply
  money was returned. The generated email/PDF say the invoice is
  "credited in full" with the cancellation reason — reviewed as
  accounting language, and final wording rides with the VAT
  confirmation in gate 3.
- **F2 (401 vs 404 on unknown paths).** Both reviewers: normalise
  when convenient; not a blocker. Stays documented.
- **Monitoring, backup automation/retention/off-site, log rotation,
  patch cadence.** All host-side: they belong to the deployment
  engagement (gate 1/4/5), not to this codebase phase.

## Phase 8 verification summary

99 unit + 64 integration tests (six suites) green on the final tree;
security suite found and fixed one real vulnerability (OTP attempt
counter rollback); backup restored and smoke-tested in ≈22 s;
production config fail-fast proven on five broken environments;
inventory reconciliation clean on the dev database; documentation set
complete (Part 24). Deployment: **not executed** — awaiting the
owner's cPanel connection and deployment approval, per the standing
instruction.
