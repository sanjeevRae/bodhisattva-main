# Phase 8d — Inventory Reconciliation, Development Database

Run: 2026-11-17, `npm run inventory:reconcile` in `server/` against
`bodhisattva_dev` (the local development database, which carries the
Phase 6/7 walkthrough data: 12 seeded products, one real order
`ORD-2026-000001` walked to PROCESSING, and its invoice
`INV-2026-00001`).

The tool is report-only; nothing below was "fixed" by it — there was
nothing to fix.

## Output (verbatim)

```
inventory:reconcile
  checked: 12 products, 0 variants, 1 orders, 1 invoices, 0 credit notes (0 order lines skipped: untracked or product gone)
  stock (stored / ledger on-hand / reserved / available):
    Gandharan Buddha — Museum Edition Giclée Print: 10 / 10 / 0 / 10
    Silk Road: Art Along the Trade Routes: 10 / 10 / 0 / 10
    Terracotta Dharma Wheel Pendant: 10 / 10 / 0 / 10
    Buddhist Manuscript Facsimile Portfolio: 10 / 10 / 0 / 10
    Hand-Painted Miniature — Bodhisattva: 10 / 10 / 0 / 10
    Sancai-Glazed Ceramic Bowl: 10 / 10 / 0 / 10
    The Bodhisattva Collection — 2026 Catalog: 10 / 10 / 0 / 10
    Brass Lotus Incense Holder: 10 / 10 / 0 / 10
    Carved Soapstone Ganesha Figurine: 10 / 10 / 0 / 10
    Ajanta Caves — Fine Art Poster Set: 9 / 9 / 0 / 9
    Patachitra Notebook — Handmade Paper: 10 / 10 / 0 / 10
    Blue Pottery Sake Set: 9 / 9 / 0 / 9
  result: all consistent — no discrepancies
```

Exit code 0.

## Reading the result

- Every product's stored `stock_qty` equals its on-hand ledger sum —
  including the two products at 9, which are exactly the two lines of
  the walkthrough order (one unit each deducted at approval).
- The order's movement nets match its status (PROCESSING):
  RESERVE/RELEASE net 0 (reservation closed at approval),
  ORDER_DEDUCT net −1 per line.
- The APPROVED-or-beyond order has its invoice; the invoice's order
  exists; there are no credit notes to check.
- No negative availability anywhere.
