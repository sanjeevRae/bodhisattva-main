# Known Limitations

Every limitation, placeholder and deferred item recorded across
Phases 0–8, consolidated. Nothing here is hidden elsewhere: if it's
not in this list and not in the phase review documents, it isn't a
known limitation. Status discipline: the platform is implemented,
tested and verified **locally**; **nothing is deployed**.

## Launch blockers — owner inputs required

1. **Placeholder stock.** Every product is seeded with **10 units** —
   an explicit placeholder, not a count of physical inventory.
   Replace via admin inventory adjustments before the shop opens.
2. **Placeholder shipping/tax.** `store.shipping_flat_fee` = Rs. 0 and
   `store.tax_rate_percent` = 0. Production checkout must stay closed
   until the client supplies real values.
3. **Invoice legal details.** The seeded invoice template uses the
   site's public identity with a **NULL tax registration number** (one
   was never invented). The client must supply their real invoice
   legal data (incl. VAT/PAN) in the template editor.
4. **Real content data.** Inherited from the original site and
   preserved verbatim pending the client's corrections: opening hours
   contradict between the footer and the About page; the team list has
   1 real entry of 8; the Living Crafts of Nepal exhibition carries
   conflicting dates/framing between pages; Home vs Foundation
   statistics wording drifts.
5. **Super Admin bootstrap identity.** Local work used placeholder
   accounts (local databases only). The real bootstrap email is the
   owner's decision at deployment.

## Commerce

6. **No VAT / credit-note tax validation.** Invoices currently charge
   the configured tax rate (0%) and carry no tax registration number.
   Credit notes (Phase 8) are accounting reversals mirroring the
   invoice; **no claim of Nepal VAT compliance is made**. How formal
   the credit-note treatment must be depends on the client's VAT
   registration — part of the owner's open invoice/VAT decision.
7. **Credit notes are whole-invoice only.** At most one credit note
   per invoice, always for the full amount. Partial credits are not
   supported.
8. **No returns/refunds workflow.** Cancellation is refused (422) once
   an order is SHIPPED. Returns — inspection, restockable vs damaged —
   would be a separate workflow, not a status rollback; it is not
   built and the shop must say so if it launches without one.
9. **COD payment collection is not tracked.** DELIVERED means the
   parcel arrived; the lifecycle has no separate "cash collected"
   state (Phase 7 review, ChatGPT). No payment workflow was invented
   uninstructed.
10. **Reservations have no expiry.** A PENDING_APPROVAL order holds
    its stock until staff act. Automatic TTL release and/or a
    per-customer cap on concurrent pending orders are **owner policy
    decisions** (Phase 6 review) — mitigations in place: the admin
    queue is oldest-first with visible order age, and cancellation
    releases in the same transaction. Not implemented.
11. **Checkout idempotency has no request fingerprint.** Reusing an
    idempotency key returns the original order (safe — no second
    order, no double charge) even if the cart/address changed; a
    409-on-different-payload check is a recorded hardening candidate.
12. **Tax rate is not stored on orders.** Order/invoice amounts are
    authoritative; the rate that produced the tax total isn't kept,
    so historical invoices can't re-derive it. Amounts were the
    design's requirement.
13. **Movement exactly-once rests on locking, not a unique key.**
    Duplicate ORDER_DEDUCT/RELEASE/ORDER_RESTORE entries are prevented
    by the order-row lock + in-transaction state validation (accepted
    by both Phase 7 reviewers for the implemented paths). A
    database-level unique key over a per-transition operation token
    is a design candidate — a naive UNIQUE(order_item, movement_type)
    would break legitimate future flows (partial returns).

## Email

14. **At-least-once is the ceiling.** A crash between the SMTP server
    accepting a message and the outbox marking it SENT can produce a
    duplicate on retry. Phase 8 fencing + deterministic Message-IDs
    bound the window; it cannot be fully closed with SMTP.
15. **Sequence numbers serialise approvals.** Invoice/credit-note
    numbers come from a per-year counter row locked inside the
    approval transaction — correct and gap-safe, but approvals queue
    behind each other. Accepted at staff-paced volumes.

## Content & CMS

16. **Dual-image bridge (pending the client's BD-2 decision).**
    Museum records and product images carry both a `cover_media_id` /
    `media_id` and a legacy external `image_url`. The media asset wins
    when both exist. Retirement condition (Phase 5 review): when the
    count of published records still resolving via `image_url`
    reaches zero (or the client approves exceptions), a migration
    imports the URLs into the media library and drops the legacy
    columns. Not done.
17. **Module records edit live.** Collections/exhibitions/news/
    foundation records have no draft/publish split — saving changes
    the public site immediately (validated + audited + soft-deleted,
    but live). A draft/live split for records is a post-launch
    candidate (Phase 5 review).
18. **Foundation statistics live in section config**, not in
    `site_settings` keys as DATABASE_DESIGN sketched — a recorded
    divergence; they're edited in the page builder.
19. **Gallery items have no public consumer yet.** They're managed in
    the exhibition editor and drive exhibition imagery; standalone
    gallery items get a public surface only if exhibition detail
    pages are built.
20. **News category colours are a fixed palette.** The five colour
    tokens are safelisted in `src/styles/tailwind.css`; a brand-new
    token typed into the News admin won't render until it's added to
    that safelist (runtime class names can't be generated by
    Tailwind).
21. **News search** uses MariaDB FULLTEXT, whose minimum token length
    can miss very short search terms; a LIKE fallback covers empty
    result sets only partially. Accepted (Phase 5 review).
22. **WYSIWYG gaps.** `span[class]` and link `title`/`target`/`rel`
    are producible only via the editor's HTML source view (no toolbar
    controls). Two pre-existing renderer quirks: the rich-text section
    wraps values in a `<p>`, so block content renders in base
    typography; Tailwind preflight suppresses public list markers
    that the editor shows. Details in `docs/phase-8/wysiwyg.md`.
23. **Page-editor canvas fidelity.** When `contact_information` and
    `contact_form` sections aren't adjacent, the editor canvas renders
    them as separate bands instead of the composed dark band the
    public page shows. Cosmetic, editor-only (Phase 4).
24. **The content-protection hook is still on the public site.** The
    original bundle's `useWebsiteProtection` (blocks right-click /
    copy / devtools shortcuts, obscures content on window blur) was
    preserved untouched; removing it is an open owner decision.

## Admin & API surface

25. **F2 — unknown-path status inconsistency.** Unknown `/api/*`
    paths return 401 to anonymous callers and 404 to authenticated
    ones. No data leaks; a fingerprinting nit (Phase 8 security
    suite).
26. **Session-less mutations answer 403, not 401** (e.g. anonymous
    checkout): the CSRF layer rejects before auth runs. Platform-wide
    and harmless, but API consumers should not read it as "forbidden
    account".
27. **Admin orders list carries no invoice/email status** — that
    column lives on the order detail and the Invoices screen (the list
    payload doesn't include it).
28. **Template preview renders the last saved version**, not unsaved
    form edits.
29. **Last-good cache covers two reads only** — `GET /api/pages/:slug`
    and `GET /api/site`. Menus and module endpoints have no cache
    fallback; a database outage degrades those to errors while pages
    and settings keep serving.
30. **Media sweep checks masters only.** Missing derivative files
    (thumb/medium) are not reported by `media:sweep`.

## Platform & hosting

31. **Nothing is deployed; all hosting facts are UNVERIFIED.** The
    owner has confirmed Node.js is supported on his cPanel in
    principle and will connect the hosting later; the 10-point
    proof-of-concept (Node version, Passenger limits, native modules,
    cron granularity, SMTP quota, SSL) runs at connection time as the
    Phase 8 deployment gate. See DEPLOYMENT_GUIDE.md §0.
32. **Argon2id parameters are provisional** (64 MiB / t=3 / p=1,
    benchmarked on the development VM only). They must be re-tuned
    against the production host's limits at deployment.
33. **Storage layout diverges from the Phase 0 design names.**
    Design: `cms-media/<yyyy>/<mm>/`; implemented: media under
    `<UPLOAD_DIRECTORY>/<2-char shard>/`, invoice PDFs under
    `<UPLOAD_DIRECTORY>/invoices/`, public media route
    `/api/media/:id/file/:variant` (design sketched
    `/api/media/:id/:size`). The implementation is self-consistent;
    reconcile the design docs if the layout is ever migrated.
34. **No session/token cleanup job yet.** Expired sessions, codes,
    reset tokens and rate-limit rows are inert (every check
    re-validates expiry) but accumulate. The Phase 0 cron plan
    includes a cleanup job; no CLI exists yet — add before table
    growth matters on the host.
35. **Concurrency evidence is bounded.** Proven: 2-way checkout race
    for the last unit (repeatedly), 3-way concurrent approval,
    approve-vs-cancel races, competing outbox drains. A 20–50-way
    checkout stress run (Phase 6 review suggestion) has not been
    executed.
36. **Dev-environment quirks are not production behaviour.** The local
    SMTP sink, the sandbox proxy's `SMTP_HOST=127.0.0.1` workaround,
    and placeholder dev accounts exist only on the development VM.
