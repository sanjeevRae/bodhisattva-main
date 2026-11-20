# Order-placed emails — customer confirmation + staff notification

Built 2026-11-20 on the owner's instruction: when an order is placed
on the website, the customer gets an order confirmation email and the
Admin, Super Admin and Store Admin accounts get a new-order
notification — all from the shop's configured mail identity
(`SMTP_FROM`; alerts@bodhisattvainternational.com on the client's
deployment). Plan reviewed before building: ChatGPT 9.3/10, Gemini
9.2/10 — refinements from both are incorporated below.

## How it works

- Checkout previously sent **no** email at all. It now enqueues two
  kinds of mail through the existing transactional outbox
  (`server/src/modules/orders/outbox.service.ts`), inside the
  checkout transaction itself (`enqueueOrderPlacedEmails` in
  `server/src/modules/store/service.ts`):
  - `ORDER_PLACED` → the customer, at the order's snapshotted account
    email: order number, item lines, subtotal, shipping, VAT, total
    on delivery, delivery name/address/phone, and the note that the
    invoice follows on approval (payment is COD).
  - `ORDER_PLACED_ADMIN` → one copy per staff recipient: order
    number, customer name and phone, item lines, grand total,
    delivery block, pointer to Admin → Orders. The customer's account
    email is deliberately NOT in the staff copy (data minimisation —
    staff see it in the admin panel when needed).
- Because the enqueue rides the order's own transaction, an order and
  its emails commit or roll back together; the idempotency replay
  paths never reach the fresh-placement code, so a retried checkout
  can never produce a duplicate set. After commit, checkout nudges
  the opportunistic drain; the `outbox:drain` CLI/cron remains the
  reliable backstop.
- Delivery semantics are **at-least-once** (outbox lease + retry
  backoff + dead-letter): the outbox guarantees atomic enqueueing,
  not exactly-once SMTP delivery — no mail system can promise more.

## Recipients (server-side only)

Staff recipients are resolved at placement time from the DB: users
holding ADMIN, SUPER_ADMIN or STORE_ADMIN (the owner explicitly
included Super Admin) with status ACTIVE and a verified email,
deduplicated by normalized email, and snapshotted into the outbox
rows — later role changes do not rewrite a placed order's
notifications. Nothing about recipients comes from the client; the
checkout request body still contains only addressId, idempotencyKey
and optional notes. If zero staff are eligible, the order still
succeeds and a high-severity error is logged so the gap is visible
rather than silent.

## Security notes

- Sender identity and SMTP credentials live only in the server env;
  no mail setting or address is exposed to the storefront, and no new
  endpoint was added (Swagger surface unchanged).
- Subjects contain only the server-generated order number and totals
  — no user input reaches any header. Bodies are plain text, composed
  from the order snapshot only.
- Free-text values interpolated into the bodies (names, address
  lines, phone, product names) pass through `oneLineText`, which
  collapses newlines/control characters so a crafted address cannot
  forge fake lines inside an email (body-injection hygiene).
- Abuse guard: placing an order fans out email to every staff
  account, so checkout is rate-limited per customer — **20 placed
  orders per hour** (MySQL-backed limiter). The gate is a peek before
  the transaction; the hit is recorded *inside* the transaction, so
  replays, failed checkouts and rolled-back attempts never consume
  quota — only orders that actually commit count. The peek-then-record
  gap lets a small concurrent burst overshoot by its own size;
  acceptable for an abuse guard.

## Tests

store-flows integration (new case): placing an order creates exactly
one `ORDER_PLACED` row for the customer and one `ORDER_PLACED_ADMIN`
row per eligible staff account (Super Admin + ADMIN + STORE_ADMIN);
a SUSPENDED admin and an ACTIVE-but-unverified admin receive nothing;
an idempotent replay adds no rows; the opportunistic drain delivers
the customer confirmation to the SMTP sink naming the order. The
suite's beforeAll wipe now also clears `email_outbox` before the
identity tables (the FK from outbox recipient_user_id requires it —
checkout creating outbox rows is new).

Two failures found and fixed while verifying: the first limiter
draft counted *attempts* before the transaction, which throttled the
orders-flows suite's legitimate 17 orders by one customer (moved to
peek + record-on-commit, limit set to 20/hour).

## Owner steps

`git pull` → restart the server (no migration, no npm install —
server code and tests only).
