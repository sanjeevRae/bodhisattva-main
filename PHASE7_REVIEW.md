# Phase 7 — Independent Review Synthesis (Orders & Invoices)

Reviews run 2026-11-17 against a design-level brief (no code, no secrets,
no real data), per Part 21 of the master specification, focused on
duplicate invoices, stock restoration and email-retry failure modes.

## Scores

- **ChatGPT — 8.7/10** ("Strong architecture"). "Approve Phase 7 with
  conditions": credit-note/accounting validation and email-worker
  fencing are mandatory before production; returns/refunds may be a
  later phase if the shop launches without them and says so.
- **Gemini — 8.5/10.** "A well-engineered state machine and
  transactional core" — pessimistic locking, UNIQUE(order_id),
  immutable snapshots and the transactional outbox "eliminate the most
  common concurrency bugs."

Both reviewers independently confirmed the two properties the phase was
built around: **no credible path to a duplicate invoice** (state
validation under the order-row lock + UNIQUE(order_id) + in-transaction
sequence), and the **RELEASE vs ORDER_RESTORE split is correct** —
cancelling after approval must restore on-hand stock, not re-open a
reservation that approval already closed.

## Dispositions

1. **Credit notes for approved-then-cancelled orders (both, top
   accounting point).** Accepted. Today the original invoice stays
   issued and immutable (correct), but no reversal document exists.
   Phase 8 adds a lightweight credit-note record: its own sequence,
   created inside the post-approval cancellation transaction, linked to
   the original invoice, mirroring its totals, with a customer email.
   Important context: the seeded template carries **no tax
   registration number and the tax rate is 0%**, so invoices currently
   charge no VAT at all — the credit note is an accounting reversal,
   and how formal it must be depends on the client's VAT registration,
   which is part of the owner's open invoice/VAT decision. No
   VAT-compliance claim is made anywhere.
2. **Outbox fencing (both).** Accepted, Phase 8: a lease-version
   fencing token on email_outbox (SENT/failure updates conditional on
   the claimed version, so a stale worker's late write affects 0 rows),
   SMTP timeouts set far below the 5-minute lease, a deterministic
   Message-ID per outbox row, and a single-flight guard on the
   in-process drain. At-least-once delivery remains the ceiling — both
   reviewers accept it given bounded retries, visible status and safe
   manual resend, all of which exist. Manual resend already preserves
   the dead-lettered original and enqueues a fresh row (audited).
3. **Database-level movement idempotency (Gemini #2, ChatGPT).**
   Recorded with a caveat. Exactly-once today comes from the order-row
   lock + in-transaction state validation, which both reviewers accept
   for the implemented paths. A naive UNIQUE(order_item_id,
   movement_type) is NOT safe — legitimate future flows (partial
   returns) need repeated movement types per line. The safe form (a
   unique key over a per-transition operation token) is a Phase 8
   design candidate, not a bolt-on.
4. **Deadlock handling (ChatGPT; Gemini's lock-order concern).** The
   global lock order is documented (sequence → order → products →
   variants, ids ascending); checkout takes product rows only (its
   order doesn't exist yet), so the cross-flow vector Gemini describes
   is minimal. A bounded deadlock/lock-wait retry (MariaDB 1213/1205)
   for checkout and transition transactions is adopted for Phase 8,
   with re-read-before-retry semantics (never blindly repeat).
5. **Sequence-row contention (Gemini #3).** Accepted at this scale:
   approvals are staff-paced; the sequence lock is held only inside
   the approval transaction. Revisit only if approval volume changes
   by orders of magnitude.
6. **Fire-and-forget drain (Gemini #5).** The cron/CLI drain is the
   reliable path by design; the in-process drain is opportunistic and
   gets the single-flight guard (item 2). PDF rendering is PDFKit
   in-process — there is no headless browser anywhere near the API.
7. **Isolation level (Gemini).** Every inventory/order transaction
   sets READ COMMITTED explicitly; the MariaDB default never silently
   applies to these paths.
8. **COD payment collection (ChatGPT).** Fair product point: DELIVERED
   does not record cash collection, and the spec's lifecycle has no
   payment state. Recorded as a known limitation and a post-launch
   candidate for the owner's decision — no payment workflow is being
   invented uninstructed.
9. **Returns/refunds after SHIPPED/DELIVERED.** Out of the master
   spec's lifecycle; cancellation is correctly rejected (422) once
   SHIPPED. Recorded as a documented gap: if the shop wants returns,
   they are a separate workflow (inspection, restockable vs damaged),
   not a status rollback.
10. **Phase 8 test list (from ChatGPT).** Adopted into the Phase 8
    brief where cheap: three-way concurrent approval, concurrent
    approve-vs-cancel, competing outbox claimers, ledger
    reconciliation check. The SMTP-accept-then-crash window is bounded
    by item 2's fencing + Message-ID, not fully closable — stated
    plainly.

## Phase 7 verification summary

45/45 integration tests across five suites (orders suite: happy
approval, concurrent double approval, SMTP-down approval + retry,
both cancellation paths, forbidden transitions, template snapshot
byte-stability, invoice IDOR, dead-letter + resend, audit filters) and
80 unit tests. UI walkthrough: the Phase 6 order was approved through
the real admin UI — invoice INV-2026-00001 issued, emailed with its PDF
(Part 12 fields verified by text extraction), order walked to
PROCESSING, customer account shows the invoice download.
