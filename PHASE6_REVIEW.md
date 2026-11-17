# Phase 6 — Independent Review Synthesis (Gift Shop Ecommerce)

Reviews run 2026-11-17 against a design-level brief (no code, no secrets,
no real data), per Part 21 of the master specification. This document
records the scores, what was verified against the implementation, and the
disposition of every material point.

## Scores

- **ChatGPT — 8.8/10** ("Strong implementation"; sub-scores: database
  architecture 9, concurrency & inventory 8.5, price integrity 9,
  idempotency 9, security & authorization 8.5, Phase 7 readiness 8).
  Verdict: approve Phase 6 with required follow-up work rather than a
  redesign; singled out that the team "discovered and fixed an actual
  overselling bug rather than assuming that transactions and row locks
  automatically made checkout safe."
- **Gemini — 7.5/10.** Praised server-side integer-paisa maths, no price
  fields in the request, ordered FOR UPDATE locking, the append-only
  ledger, and unique-constraint-backed idempotency; concentrated on
  Phase 7 lock discipline, reservation lifecycle, and snapshot
  completeness.

## The headline event of the phase

The concurrency test **failed on its first run**: two simultaneous
checkouts for the last unit both returned 201. Root cause: under InnoDB's
default REPEATABLE READ, the losing transaction's availability SUM read
its early snapshot and never saw the winner's just-committed RESERVE row.
Fix: checkout and inventory-adjust transactions run at **READ COMMITTED**,
so post-lock reads see committed reservations. Both reviewers confirmed
the reasoning: the barrier is lock serialisation (every writer takes the
product row FOR UPDATE first), not snapshot isolation. The test now
passes consistently — exactly one 201, one 422, one order, one RESERVE,
stock never negative.

## Dispositions

1. **Reservation lifecycle / hoarding (both reviewers' #1).** Accepted as
   a real risk: a PENDING_APPROVAL order holds stock until staff act, and
   COD has no payment friction. NOT adopting automatic expiry now —
   orders wait on staff, not customers, and auto-releasing because staff
   are slow would silently cancel legitimate orders; the window is a
   business-policy choice. Phase 7 mitigations adopted: the admin order
   queue is oldest-first with order age visible, and cancellation
   releases reservations in the same transaction as the status change.
   Recorded for the launch decision (owner): a pending-order TTL with
   auto-release, and/or a per-customer cap on concurrent
   PENDING_APPROVAL orders + checkout rate limiting (Phase 8 hardening).
2. **One canonical inventory protocol (both).** Already the
   implementation's rule and now written into SETUP.md: READ COMMITTED,
   product row FOR UPDATE (variants likewise, id order) before any
   availability read or movement write. Phase 7's fulfilment/cancel
   writers are briefed to the same protocol, plus: lock the order row
   first, validate the transition inside the transaction, movements and
   status change in ONE transaction (ORDER_DEDUCT + RELEASE as a pair),
   conditional status updates requiring exactly one affected row.
3. **Variant vs product stock ownership (ChatGPT #3, Gemini #1).** The
   model is ChatGPT's "Model A": when a product has variants, variant
   stock is authoritative; `products.stock_qty` mirrors the variant sum
   (maintained by the inventory service on every variant stock change)
   and exists as the serialisation lock + aggregate display. Products
   without variants use product stock directly. Checkout locks variant
   rows as well as product rows — Gemini's granularity concern is
   covered in the implementation (its brief summary understated this).
4. **Financial snapshots (Gemini #4, ChatGPT #4).** Orders already store
   subtotal, shipping fee, tax total and grand total, and order items
   snapshot name, SKU, variant name and unit price; invoices (Phase 7)
   will render from these snapshots only. The tax *rate* is not stored —
   amounts are authoritative; if invoices need to display the rate, a
   small Phase 7 migration can add it. Money conversion is exact
   string-based paisa arithmetic (shared money module, Phase 1) — no
   floats anywhere. Rounding policy is single and deterministic: tax is
   computed once on the order subtotal, shipping is not taxed, no
   discounts exist yet.
5. **Idempotency (both).** Design endorsed ("the unique constraint is
   the actual concurrency guarantee"). The duplicate-key catch is
   specific to the idempotency index (errno 1062), and the replayed
   order is re-read scoped to the same user. A request-fingerprint check
   (409 when a key is reused with a different cart/address) is recorded
   as a Phase 8 hardening candidate; current semantics cannot create a
   second order or charge.
6. **Cart-mutation and settings races (Gemini).** Checkout reads the
   cart and the store settings inside its own transaction, so a placed
   order is always internally consistent with its stored totals. A cart
   add from a second tab mid-checkout either lands before the read
   (included) or survives the cart clear (stays in the cart) — benign.
   Accepted; no change.
7. **Ledger reconciliation (both).** The stock/ledger invariant is
   maintained by construction (every stock change writes its movement in
   the same transaction, through one service). A periodic reconciliation
   report (ledger-derived vs stored balances; unclosed reservations vs
   open orders) is a Phase 8 operations addition.
8. **Stress testing (ChatGPT #9).** The two-way race for the last unit
   is proven, plus checkout-vs-adjustment coverage in the suite. A
   20–50-way contention run is recorded for the Phase 8 load checks.
9. **Launch blockers (both, restated for the record).** Seeded stock of
   10 per product is a placeholder, not verified physical inventory;
   shipping/tax settings of 0 are placeholders; production checkout must
   stay closed until the client supplies real stock counts and approves
   real shipping/tax values. These are the client's inputs, flagged in
   the Phase 6 report.

## Frontend notes (from the Phase 6 walkthrough)

- The shop's design is preserved; the grid now follows the backend's
  featured sort, which the lead adjusted to *featured first, then
  creation order* so the seeded catalogue keeps the original
  merchandising order instead of re-sorting alphabetically (one-line
  change, full suite re-run green: 33/33 integration, 74 unit).
- The search + sort toolbar in the tab bar is a deliberate design
  extension (the API requires it); on mobile it adds a second row.
- A real order (ORD-2026-000001, Rs.4,700, COD) was placed through the
  UI against the dev database and verified at the database level:
  snapshots, RESERVE movements, status history, cart cleared.
- Walkthrough caveat, stated plainly: the dev customer's email-verify
  step was completed by activating the local dev row after the sandbox
  proxy blocked the local mail path and the account hit the platform's
  own OTP caps; verify-email itself is covered end-to-end by the
  integration suite against the real mail sink. Local-only accounts.
