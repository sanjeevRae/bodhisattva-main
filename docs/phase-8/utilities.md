# Phase 8d — Operations Utilities

Three utilities were added in Phase 8d, plus the reconciliation run
against the development database. All were verified locally on
2026-11-17 (builds green; unit suite 99 passed including 9 new tests;
integration suites 64/64 still green after the routes change).

## 1. Orphan media sweep — `npm run media:sweep` (in `server/`)

`server/src/cli/sweep-media.ts` + `server/src/modules/media/sweep.ts`.

Compares the files under `UPLOAD_DIRECTORY` with the `media_assets`
rows and reports:

- **(a) orphan files** — files on disk that no asset row accounts for
  (neither a master `storage_name` nor its `_thumb` / `_medium`
  derivatives). Only files inside the two-character shard directories
  are in scope; the `invoices/` subtree (invoice PDFs) is not media
  and is never touched.
- **(b) missing masters** — asset rows whose master file is absent
  from its canonical shard path (soft-deleted rows are flagged as
  such; their files are retained by design, so their presence is not
  an orphan condition).

**The default is a dry run — report only.** Deletion requires the
explicit `--delete` flag and only ever removes category (a) files;
category (b) is a human decision (restore the file or purge the row).

Classification is unit-tested in `server/tests/media-sweep.test.ts`
(temp upload dir + supplied rows: known master/derivative matched,
unknown files orphaned with byte totals, `invoices/` ignored, delete
mode removes only orphans).

Dev run (2026-11-17, dry run): the development database currently has
**0 media asset rows** and the dev upload directory contains no media
files (only the `invoices/` subtree), so the sweep reported 0 scanned /
0 orphans / 0 missing — a clean, empty result, included here for
completeness rather than as evidence of classification on real data
(the unit tests carry that evidence).

## 2. Last-good published-content cache

`server/src/modules/cms/last-good.ts`, wired into the two public CMS
reads in `server/src/modules/cms/routes.ts`.

- On every successful `GET /api/pages/:slug` and `GET /api/site`, the
  JSON payload is written (best effort) to
  `<UPLOAD_DIRECTORY>/../cache/last-good/page-<slug>.json` /
  `site.json`.
- If the read then fails with a non-application error (the database
  outage case), the cached payload is served instead, the response is
  marked `X-Content-Source: last-good-cache`, and a warning is logged.
- Application errors (AppError — e.g. a genuine 404 for an unpublished
  page) always propagate: the cache covers outages, never editorial
  state. With no cache file, the original error propagates unchanged.
- Admin, draft and preview reads are never cached.

Unit-tested in `server/tests/last-good.test.ts` with an injected fake
failing read: live read refreshes the cache file; DB-style failure
serves the cache; missing cache rethrows; AppError never falls back;
cache names are sanitised so a crafted slug cannot escape the cache
directory.

## 3. Inventory reconciliation — `npm run inventory:reconcile` (in `server/`)

`server/src/cli/reconcile-inventory.ts` +
`server/src/modules/store/reconcile.ts`. **Report-only — it never
writes a fix.** Exit code 1 when discrepancies are found, so it can
gate a cron job or a deploy checklist.

Checks, recomputed from the append-only `inventory_movements` ledger:

- per product (no variants) / per variant: on-hand ledger sum
  (OPENING, PURCHASE, ADJUSTMENT_IN/OUT, ORDER_DEDUCT, ORDER_RESTORE,
  CORRECTION) vs the stored `stock_qty`; for variant products,
  `products.stock_qty` vs the variant sum (the §9.4 mirror);
- ledger-derived availability (`stock_qty` + RESERVE/RELEASE sum)
  negative anywhere;
- per order line: RESERVE/RELEASE and ORDER_DEDUCT/ORDER_RESTORE nets
  vs the line quantity, with per-status expectations (PENDING_APPROVAL:
  reserved, not deducted; APPROVED and beyond: reservation closed,
  deducted; CANCELLED: everything netted to zero). Lines of untracked
  products and lines whose product row is gone are counted as skipped,
  never flagged — they carry no movements by design;
- invoices whose order is missing; orders APPROVED or beyond with no
  invoice; credit notes whose invoice is missing.

### Dev-database result

Full output in [reconciliation-dev.md](reconciliation-dev.md):
**all consistent, exit code 0** — 12 products, 1 order, 1 invoice,
0 credit notes checked. The two products at stock 9 are exactly the
two lines of the Phase 6/7 walkthrough order, and their ledger sums
agree; the PROCESSING order's movement nets match its status; the
approved order has its invoice.
