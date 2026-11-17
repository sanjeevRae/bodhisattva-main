# Phase 7 walkthrough — orders, invoices, template, audit log

Local stack, 2026-11-17: MariaDB 10.11 (`bodhisattva_dev`), API on
:4000 (SMTP_HOST=127.0.0.1 → the local mail sink on :1025), vite
preview on :4173, headless Chrome driving real UI clicks.

Subject: the Phase 6 walkthrough order **ORD-2026-000001**
(PENDING_APPROVAL, Rs. 4,700, customer
phase6.walkthrough@example.com). Sessions were established through the
real flows — the dev admin's MFA was reset in the dev DB and
re-enrolled via the API; the customer used the real password-reset
flow (token read from the sink mail).

## What was walked

1. **Orders queue** (`screenshots/orders-queue.png`) — the admin lands
   on the PENDING_APPROVAL filter: oldest-first, the order shows a
   "waiting 1h 21m" age badge, sidebar carries the new Orders /
   Invoices / Invoice Template / Audit Log entries.
2. **Order detail before** (`screenshots/order-detail-before.png`) —
   snapshots, totals, history, and the actions valid for the state.
3. **Approve via the UI** (`screenshots/order-detail-approved.png`) —
   confirm dialog → status APPROVED, invoice card appears with
   **INV-2026-00001** (email badge read "Email pending" at capture
   time; the outbox delivered it seconds later — DB `email_status`
   SENT, outbox row SENT on attempt 1).
4. **Start processing via the UI**
   (`screenshots/order-detail-processing.png`) — APPROVED →
   PROCESSING, history gains the SUPER ADMIN entry.
5. **Invoices** (`screenshots/invoices.png`) — the issued invoice
   listed with total, issue time, email status, PDF download.
6. **Invoice template** (`screenshots/invoice-template.png`) — the
   seeded "Default Museum Invoice" v1 config in the editor (identity,
   colours, toggles, logo picker) + versions list.
7. **Audit log** (`screenshots/audit-log.png`) — filtered to the
   `store.orders` prefix: create (CUSTOMER), approve and update
   (SUPER ADMIN), all SUCCESS.
8. **Customer account** (`screenshots/account-order-invoice.png`) —
   the order row shows "Invoice available"; the expanded detail shows
   the progress timeline (Placed → Approved → Being prepared) and the
   Invoice card with INV-2026-00001 + Download PDF.

## The delivered invoice email

The sink received "Your order ORD-2026-000001 is approved — invoice
INV-2026-00001" addressed to the customer with
`INV-2026-00001.pdf` attached (9,368 bytes; a copy is saved beside
this file as `INV-2026-00001-delivered.pdf`). Text extracted from the
delivered PDF confirms the Part 12 field set renders in the real
document: seller identity (Bodhisattva International, gallery line,
House 91 address, phone, email), invoice number, issue date, order
number + date, billed-to (name, email, phone), deliver-to snapshot,
both line items with SKUs (BOD-010 Rs. 1,800; BOD-012 Rs. 2,900),
subtotal / shipping / tax, grand total Rs. 4,700.00, "Payment method:
Cash on Delivery (COD)", terms and footer. No logo is configured on
the seeded template, so the header is the typographic fallback (the
logo path is covered by unit tests with a generated PNG).

## Test state at walkthrough time

- Server unit suite: 80 passed (incl. 3 new invoice-logo tests).
- Integration: 45/45 across the five suites (incl. the new audit-log
  endpoint test: filters, prefix purity, DENIED rows, actor filter,
  customer 403 / anonymous 401).
- Root + server builds green; frontend typecheck clean apart from the
  pre-existing `main.tsx` @types/react-dom notice.
