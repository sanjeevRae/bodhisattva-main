/**
 * Inventory reconciliation — ops utility (Phase 8d).
 *
 * Usage:  npm run inventory:reconcile
 *
 * Recomputes stock from the append-only inventory ledger and compares
 * it with the stored balances, then checks order-line movement nets
 * and invoice / credit-note referential sanity (see
 * modules/store/reconcile.ts). REPORT ONLY — it never writes a fix.
 * Exit code is 1 when any discrepancy is found, so it can gate a cron
 * job or a deploy checklist.
 */
import "dotenv/config";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../database/client.js";
import { reconcileInventory } from "../modules/store/reconcile.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDatabase(config);
  try {
    await handle.ping();
    const report = await reconcileInventory(handle.db);

    console.log("inventory:reconcile");
    console.log(
      `  checked: ${report.productsChecked} products, ${report.variantsChecked} variants, ` +
        `${report.ordersChecked} orders, ${report.invoicesChecked} invoices, ` +
        `${report.creditNotesChecked} credit notes ` +
        `(${report.orderLinesSkipped} order lines skipped: untracked or product gone)`,
    );
    console.log("  stock (stored / ledger on-hand / reserved / available):");
    for (const line of report.stockLines) {
      console.log(
        `    ${line.label}: ${line.storedStock} / ${line.ledgerOnHand} / ` +
          `${line.reservedOutstanding} / ${line.ledgerAvailable}`,
      );
    }
    if (report.discrepancies.length === 0) {
      console.log("  result: all consistent — no discrepancies");
      return;
    }
    console.log(`  result: ${report.discrepancies.length} discrepancy(ies):`);
    for (const d of report.discrepancies) {
      console.log(`    [${d.check}] ${d.detail}`);
    }
    process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(
    "inventory:reconcile: failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
