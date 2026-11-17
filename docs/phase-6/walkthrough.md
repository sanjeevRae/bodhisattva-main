# Phase 6 — Shop Frontend Walkthrough & Visual Diff

Date: 2026-11-17. Environment: API on :4000 (`node dist/server.js`,
dev DB `bodhisattva_dev`), `vite preview` on :4173 proxying /api,
headless Chrome via CDP (the Phase 4–5 harness). Product imagery is
Unsplash, which the sandbox cannot reach — images render as alt-text
panels in every capture, exactly as in the Phase 5 baselines, so the
comparison is like-for-like.

## Captures (docs/phase-6/screenshots/)

| File | What it proves |
| --- | --- |
| shop-desktop.png / shop-mobile.png | Public shop on the real APIs, anonymous. Diffed below. |
| quick-view.png | Quick-view modal fed by GET /api/shop/products/:slug — category, detail, price, stock state, quantity stepper; anonymous CTA reads "Sign In to Add". |
| login.png | /login in the site's design system; solid nav (see "Nav fix"). |
| cart-intent.png | The spec §10.3 round trip: anonymous "Add to Cart" → /login?return=/shop → sign-in → back on /shop with the drawer open showing the exact item clicked (Ajanta Poster Set, Rs.1,800). |
| cart-drawer.png | Drawer with 2 items, steppers, line totals, subtotal Rs.4,700. |
| checkout.png | Saved default address preselected, new-address option, order notes, COD panel, summary (server values). Re-shot after the Nav fix with a 1-item cart (Rs.1,800); the 2-item state is the one that produced the order below. |
| order-success.png | Real order placed by clicking Place Order in the UI: **ORD-2026-000001**, "awaiting approval", Rs.4,700 COD. |
| account-orders.png | The same order in /account/orders, expanded: item snapshots (BOD-010/BOD-012), totals, delivery block. |
| account.png / account-addresses.png | Account home and the address book (the API-created "Home" default address, edit/delete affordances). |
| admin-products.png | Products list: category, price, status, on hand / reserved / available — the two ordered products show Reserved 1, Available 9. |
| admin-product-edit.png | Product editor after flagging Featured through the real UI switch and saving ("Product saved.", ACTIVE + FEATURED badges, rupee inputs). |
| admin-product-inventory.png | Variants empty state + inventory section inside the editor: summary cards, adjust form, movement ledger (OPENING +10 "Initial stock (seed)"). |
| admin-product-categories.png | Product Categories CRUD list (5 seeded categories, sort order, Active state). |
| admin-editor-featured.png | Page-editor canvas: a featured_products section rendering the 3 flagged products as real cards (Gandharan Rs.4,500, Silk Road Rs.2,800, Terracotta Rs.1,200). The section was removed again after the capture — navigator count verified 8 → 9 → 8, Home draft left as found. |

## Independent verification of the placed order (DB)

`orders`: ORD-2026-000001, PENDING_APPROVAL, COD, NPR, subtotal
4700.00, shipping 0.00, tax 0.00, grand total 4700.00 — equal to the
UI's figures. `order_items` carry name/SKU/unit-price snapshots
(1800.00 + 2900.00). `inventory_movements` show RESERVE −1 for both
products (available balance 9, on-hand untouched), and
`order_status_history` records PENDING_APPROVAL.

Cart persistence (exit gate): an item added via the API was still in
the cart after logout + a fresh login (quantity intact); the probe
line was removed afterwards.

## Visual diff vs Phase 5 shop captures

Method (Phase 5): every 2nd pixel, channel-sum difference > 90.

- Desktop (1440×900): **1.25%** differing.
- Mobile (390×844): **5.36%** differing.

Every differing region is one of these enumerated, intended changes —
the layout, typography, card design and price strings ("Rs.1,800",
en-IN grouping, no space) are otherwise identical:

1. **Nav**: the new "Sign In" / account-name link (desktop rows
   y≈28–34). On mobile the nav is unchanged.
2. **Tab-bar toolbar**: search input + sort select added at the right
   of the category tab bar (desktop); on mobile they form a compact
   second row under the tabs, which shifts the grid down (~48 px) and
   accounts for most of the mobile percentage. This is the one
   deliberate design extension — the design had no search/sort
   controls, and the API contract requires them.
3. **Product order**: the grid now follows the store API's "featured"
   order (flagged first, then name A–Z) instead of the old hardcoded
   array order. Cards, prices and details are unchanged; only the
   sequence differs. If the old merchandising order must be kept, the
   backend's featured sort is the place to change it (products carry
   no sort column; seed order survives only in product ids).

## Nav fix found by this walkthrough

`pageFromPath()` defaults unknown paths to "home", so the Nav treated
/login, /checkout and /account/* as the home page: transparent bar
with white text on a cream background (unreadable until scroll) and
"Home" marked active. Nav.tsx now only applies CMS-page state to the
seven known page paths. The 7 CMS pages are unaffected; login.png and
checkout.png were re-shot after the fix and show the solid bar.

## Walkthrough data — how it was made (and one substitution)

- The customer (Asha Walkthrough, phase6.walkthrough@example.com)
  was created through the **real registration API**; three
  verification codes were genuinely issued by the server. Delivery of
  the code email initially failed in this sandbox: nodemailer's
  connection to `localhost` is intercepted by the egress proxy (raw
  TCP to 127.0.0.1 works; the API was restarted with
  `SMTP_HOST=127.0.0.1`, after which a probe mail landed in the sink).
  By then the account had hit the platform's own anti-abuse limits
  (register 429; OTP hourly send cap reached — resends are silently
  skipped by design), so the verify step could not be completed
  through the inbox within the walkthrough window. The dev-DB row was
  therefore activated directly (status + email_verified_at) — a
  local-only walkthrough account. The verify-email endpoint itself is
  covered end-to-end by the Phase 6b integration suite (33/33), which
  registers and verifies customers through the sink. Login, cart,
  address, checkout and the order were all exercised through the real
  APIs/UI with no further substitution.
- The dev admin's MFA was reset in the dev DB and re-enrolled through
  the real API enrolment flow (fresh secret from the enrol response,
  TOTP computed locally, confirmed via /api/auth/mfa/confirm) — the
  Phase 4 pattern. Products 2 and 3 were flagged featured via the
  admin API; product 1 via the editor UI switch.
- The walkthrough order (ORD-2026-000001) and the customer's address
  remain in the dev DB as evidence; the cart was left empty.

## Known limitations

- No dedicated /cart page — the cart is a slide-over drawer (fits the
  design's modal idiom; /cart stays reserved so a page can be added
  without a URL change).
- The checkout summary's shipping/tax lines mirror the server's
  arithmetic from /api/shop/config for display; the placed order's
  own totals (shown on the success screen) are authoritative.
- Seed stock (10 per product), shipping fee (0) and tax rate (0) are
  the Phase 6a/6b placeholder values, still awaiting the client's
  real configuration.
