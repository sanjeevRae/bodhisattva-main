# Release Report — Bodhisattva Museum Platform (Phases 0–8)

Date: 2026-11-17. Status per the Part 25 discipline — Implemented /
Tested / Verified / Deployed are kept separate throughout.

## Summary

The existing seven-page museum website has been rebuilt as a single
database-driven platform — CMS with visual page builder, museum
content modules, gift-shop ecommerce with COD checkout, PDF invoices
and credit notes, customer accounts, MFA-protected role-based admin,
and full audit logging — **without changing its design or URLs**.
All eight phases are complete in code, tested, and independently
reviewed. The platform is **not deployed**: production deployment
awaits the owner's cPanel connection and deployment approval.

## Implemented + Tested + Verified (locally)

- **CMS**: 7 system pages + custom pages; draft → hashed-token
  preview → publish → rollback with optimistic concurrency; 22
  section types; menus; site settings; media library with a
  sniff-and-re-encode upload pipeline; WYSIWYG editor constrained to
  the server's sanitize allowlist.
- **Museum modules**: collections, exhibitions + gallery items, news
  with categories and full-text search, foundation programs,
  testimonials — all DB-backed with admin CRUD, seeded from the
  original site content record-for-record.
- **Ecommerce**: 5 categories, 12 products; login-gated persistent
  cart; server-side totals; idempotent COD checkout; inventory
  movement ledger with reservations — oversell-proof under
  concurrency (proven), reconciliation CLI clean.
- **Orders & invoices**: centralised state machine; approval issues
  exactly one invoice in the same transaction (proven under triple
  concurrency); deterministic snapshot PDFs; editable versioned
  invoice templates; credit notes on post-approval cancellation;
  email outbox with lease fencing, backoff, dead-letter and resend.
- **Security**: Argon2id, server-side sessions, TOTP MFA + step-up,
  49-permission RBAC, CSRF + Origin checks, MySQL-backed rate limits,
  audit log with admin UI. A dedicated 14-probe attack suite passes —
  and caught one real brute-force bug (OTP attempt counter), fixed
  and regression-locked.
- **Ops**: backup/restore drill (≈22 s restore, byte-identical
  invoice PDF), production fail-fast config, media orphan sweep,
  last-good content fallback, cron-drainable email outbox.
- **Tests**: 99 unit + 64 integration, all green. Independent review
  scores per phase: 8.5, 8.2/7.5, 8.8/8.5, 8.5/8.0, 8.2/7.8, 8.8/7.5,
  8.7/8.5, and final 8.0 (ChatGPT) / 7.5 (Gemini) — both: staged
  deployment, gated soft launch.

## Not implemented (by design or owner decision pending)

- Returns/refunds workflow (cancellation ends at SHIPPED by design).
- COD cash-collection tracking separate from delivery status.
- Reservation expiry policy (owner decision).
- VAT-bearing invoices/credit notes (depends on the client's VAT
  registration — the template carries no tax number; tax rate 0%).
- Online payments (spec is COD-only).

## Known limitations

36 items consolidated in KNOWN_LIMITATIONS.md. The launch-relevant
ones: placeholder stock (10/product), shipping fee Rs. 0 and tax 0%
await the client's real values; module records edit live (no draft
split); product/record images still resolve via legacy URLs pending
the owner's media decision (BD-2); Argon2 parameters are provisional
pending a host benchmark.

## Deployment — NOT DONE

DEPLOYMENT_GUIDE.md is the complete cPanel runbook (setup, env,
migrations, cron, smoke checklist, rollback). It has never been
executed on the target host. Go-live gates (from the final reviews):
host smoke tests, owner-signed commercial values, written VAT
confirmation, on-host backup rehearsal with the TOTP key backed up
separately, basic failure alerting, and one full COD cycle over real
SMTP. When the owner connects the hosting and approves deployment,
that work proceeds against this checklist.
