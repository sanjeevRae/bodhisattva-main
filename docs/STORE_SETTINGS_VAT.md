# Store settings + Tax → VAT (2026-11-20)

Owner request: Admin and Store Admin must be able to set the shipping
fee and tax rate themselves; the database must hold them; the APIs
must support them; the product page must show them; "Tax" becomes
"VAT" everywhere user-facing, in sync across cart, checkout, orders
and invoices; workable and secure. Plan reviewed before building:
ChatGPT 9/10, Gemini 8/10 — amendments adopted (explicit key
allowlist, validate-all-before-write, exact decimal validation,
no-store public config, snapshot-invariance test).

## What shipped

- **Permissions** — ADMIN gains `store.settings.manage` (seed-data +
  migration `0018_store_settings_admin`, idempotent: INSERT IGNORE
  the ADMIN grant, INSERT IGNORE the three settings rows so every
  database provably has them, refresh the permission description to
  the VAT wording). STORE_ADMIN already held it; SUPER_ADMIN holds
  all. Verified on the dev DB: ADMIN/STORE_ADMIN/SUPER_ADMIN hold it.
- **API hardening** (`cms` module) — PUT /api/admin/settings: callers
  without `settings.manage` may write ONLY the allowlisted keys
  `store.shipping_flat_fee`, `store.tax_rate_percent`,
  `store.cod_enabled` (an explicit list, not a `store.*` prefix); one
  foreign key rejects the whole request with 403. GET is scoped the
  same way (store-only callers see only the three keys). Values are
  strictly validated for EVERY caller inside `updateSettings` before
  the transaction writes anything: fee = decimal 0–100,000, ≤2dp;
  VAT rate = 0–100, ≤2dp; COD = boolean. Invalid → 400, nothing
  written (the checkout-side parsers stay lenient by design, so the
  write path is the strict one). Audit logging unchanged.
- **Admin UI** — Settings page gains a Store settings card (shipping
  fee Rs, VAT rate %, COD toggle) visible to `store.settings.manage`
  holders; the Settings nav item now appears for them too; the raw
  key/value editor stays `settings.manage`-only. If VAT > 0 and the
  invoice template has no VAT registration number, the card shows a
  soft warning pointing at the template screen.
- **Tax → VAT rename (display only)** — checkout summary, customer
  order history, admin order detail, invoice PDF ("VAT" row, "VAT
  Reg. No:"), invoice-template screen labels, cart drawer copy.
  Internal names deliberately unchanged: setting key
  `store.tax_rate_percent`, DB column `tax_total`, API fields
  `taxRatePercent` / `taxTotalPaisa` — documented at the allowlist so
  future readers are not confused.
- **Product page** — the Gift Shop page shows a one-line strip under
  the hero ("Delivery Rs 150 flat per order · Plus VAT (13%) at
  checkout", or "Free delivery") and the QuickView detail shows a
  Delivery & VAT block under the price — both from GET
  /api/shop/config, the same source checkout uses. That endpoint now
  sends `Cache-Control: no-store` and reads the DB per request, so a
  settings change is visible everywhere immediately (verified live:
  fee 150 / VAT 13% appeared in config + page at once).
- **Sync** — cart, checkout, account orders, admin orders and the
  invoice PDF all read the same config (pre-placement) or the order's
  snapshotted totals (post-placement). Changing settings never moves
  a placed order — proven by integration test.

## Tests

- Unit `tests/store-settings.test.ts` (15): role grants, allowlist
  contents, validator accepts/rejects incl. mixed-batch rejection.
- Integration (store-flows, +2 cases): Admin + Store Admin read/write
  scoped to the store keys (global key → 403, mixed batch → 403 with
  nothing written, read shows only the 3 keys); six invalid values →
  400 with nothing written; order placed at fee 100 + VAT 13% keeps
  its totals after settings change to 999 / 20%.
- Full gates: server typecheck clean; unit 170 passed; integration
  124/124 (10 suites); frontend build + lint:hooks clean.

## Open owner decision

VAT is charged on the product subtotal only, NOT on the delivery fee
(the pre-existing formula — unchanged by this round). Both reviewers
flagged this as a business/tax decision: if the shop's accountant
says delivery is part of the taxable supply, the formula becomes
VAT on (subtotal + shipping). One-line change + test update when the
owner decides. The actual fee and rate values also remain the
client's to set — the settings still hold the placeholder defaults
(Rs 0 / 0%) until they do.
