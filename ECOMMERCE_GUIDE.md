# Ecommerce Guide — for Gift Shop Staff

How the shop runs day to day, in the admin at **`/admin`**. Store work
needs the STORE_ADMIN role (or a Super Admin). Everything financial in
this system is in **Nepalese rupees**, computed server-side in paisa —
prices you type are rupees; the server never trusts a total sent by a
browser.

> **Launch placeholders — read first.** The seeded catalogue starts
> with **10 units of stock per product**, a **Rs. 0 shipping fee** and
> **0% tax** — placeholders, not the museum's real values. Before the
> shop opens to the public, replace stock with real counts (Inventory,
> below) and set the real shipping/tax under Settings (`store.*`
> keys). See KNOWN_LIMITATIONS.

## Products and categories

- **Product Categories** screen: name, slug, description, active flag.
  A category with products can't be deleted (409) — deactivate it or
  move the products.
- **Products** screen: search, filter by status, and see on-hand /
  reserved / available per product at a glance.
- **Product editor**: name, SKU, category, descriptions, price and
  optional sale price (the effective price is the sale price when
  set), featured flag, status (DRAFT → ACTIVE → ARCHIVED). Deleting a
  product **archives** it — products with order history are never
  hard-deleted, so old orders and invoices always render.
- **Images**: managed in the editor — upload via the media library or
  keep the migrated external URL until it's replaced. The first image
  is the card image.
- **Variants** (e.g. sizes/editions): each variant has its own SKU,
  price delta and **its own stock**. When a product has variants,
  variant stock is what counts; the product's stock figure mirrors the
  variant total automatically.

## Inventory — the ledger rules

Stock is an **append-only ledger** (`inventory_movements`), not a
number someone edits. Every change writes a movement with a reason,
and the stored stock figure is the ledger's running balance:

| Movement | Meaning |
|---|---|
| OPENING | Starting stock when a product/variant is created |
| PURCHASE / ADJUSTMENT_IN | Stock added |
| ADJUSTMENT_OUT | Stock removed (damage, shrinkage…) |
| RESERVE / RELEASE | Units held for / freed from a pending order (availability only — stock itself doesn't move) |
| ORDER_DEDUCT | Stock actually leaves at order approval |
| ORDER_RESTORE | Stock returned when an approved order is cancelled |
| CORRECTION | Manual correction entries |

Rules the system enforces:

- **Available = on-hand − reserved.** A pending order reserves its
  units at checkout, so the last unit can never be sold twice — this
  is proven under simultaneous checkouts, not just in theory.
- **Adjust** stock from the product editor's inventory section:
  enter a delta (or set an absolute quantity) **with a reason**. You
  can't adjust below the quantity currently reserved by pending
  orders (422) — deal with the order first.
- The movement ledger in the same section is the full history; use
  `npm run inventory:reconcile` (a server-side ops command) to verify
  stored balances against the ledger at any time — it reports, never
  silently fixes.

## The order workflow

Customers check out with **cash on delivery** only. Checkout requires
a signed-in account; the cart lives on the server, so it survives
across devices. An order arrives as **PENDING_APPROVAL**:

**Orders screen** — the pending queue is the default view, **oldest
first**, with an amber age badge ("waiting 1h 21m") so no order is
forgotten. Search and date/status filters are at the top.

**Order detail** — line items exactly as sold (name/SKU/price
snapshots — later price changes never rewrite history), totals,
customer + delivery snapshots, the status-history timeline, and the
invoice card once issued.

Actions (each asks for confirmation; invalid ones aren't offered):

| Action | From | Effect |
|---|---|---|
| **Approve** | PENDING_APPROVAL | Stock is deducted, the reservation closes, **the invoice is created** and its email is queued — all in one transaction. Approving twice (even simultaneously, two staff) still creates exactly one invoice |
| **Reject** | PENDING_APPROVAL | Cancels the order; **reason required**; reservation released |
| **Start processing** | APPROVED | → PROCESSING |
| **Ship** | PROCESSING | → SHIPPED |
| **Deliver** | SHIPPED | → DELIVERED |
| **Cancel** | PENDING_APPROVAL / APPROVED / PROCESSING | **Reason required.** Before approval: the reservation is released. After approval: stock is restored and a **credit note** is issued against the invoice (below). After SHIPPED, cancellation is refused (422) — there is no returns workflow yet |

A failed action shows the server's message verbatim (e.g. why a
transition is invalid) — read it before retrying.

## Invoices

- Created **only** by approval, numbered `INV-<year>-<sequence>`, and
  rendered as PDFs from a **frozen snapshot** of the order + the
  invoice-template version active at that moment. An invoice never
  changes afterwards — re-downloading it in a year gives the identical
  file.
- **Invoices screen**: list, detail, download PDF.
- **Email status** on the invoice: PENDING → SENT, or FAILED after
  the delivery queue exhausts its retries. Email is sent by the
  background outbox (automatic retries with backoff); if the mail
  server is down at approval time, the approval still succeeds and
  the email goes out when mail recovers.
- **Resend** (invoice card on the order, or the Invoices screen):
  re-queues the **same** invoice — never a duplicate invoice. It's
  refused while a previous send is still in flight.
- Customers see the same invoice in their account (from APPROVED
  onwards) and can download the PDF themselves; they can never see
  another customer's invoice.

## Invoice template

**Invoice Template screen**: company name/address/phone/email,
optional tax registration number, invoice prefix, colours, footer and
terms text, logo (from the media library), and toggles for which
blocks appear. **Saving creates a new template version** — it applies
to the *next* invoice issued; already-issued invoices keep the version
they were created under. Use **Preview PDF** to check a version before
relying on it.

> The seeded template carries the museum's public identity and **no
> tax registration number** (one was never invented). Add the real
> VAT/PAN details here when the client supplies them; until then
> invoices charge the configured tax rate (currently 0%).

## Credit notes (Phase 8)

When an order is cancelled **after** approval, the invoice already
exists and stays issued — invoices are never deleted or edited.
Instead, the cancellation creates a **credit note**
(`CN-<year>-<sequence>`) in the same transaction: it mirrors the
invoice's totals, references the original invoice number, carries the
cancellation reason, and is emailed to the customer with its PDF. The
invoice detail (admin) and the customer's order page both show the
credit note and offer its PDF. Cancelling *before* approval creates
no credit note (no invoice existed).

Credit notes are full reversals of the whole invoice (the lightweight
design allows at most one per invoice); partial credits and returns
are not supported yet — see KNOWN_LIMITATIONS.

## Settings that affect the shop

Under **Settings** (store staff can edit only the `store.*` keys):

- `store.shipping_flat_fee` — flat shipping fee (rupees)
- `store.tax_rate_percent` — tax rate applied once to the subtotal
  (shipping is not taxed)
- `store.cod_enabled` — cash-on-delivery on/off

Changes apply to the **next** checkout; placed orders keep the totals
they were created with.

## Audit log

**Audit Log screen** (Super Admin only): every significant action —
logins, publishes, settings changes, order transitions, invoice
creation/resends, credit notes — with actor, role, time, result and
details. Filter by date, actor, action prefix (e.g. `store.orders`)
or result. If a customer disputes what happened to an order, this —
plus the order's own status-history timeline — is where the answer
lives. Audit records can't be edited or deleted by anyone.
