/**
 * Email outbox drain — the reliable delivery path (ARCHITECTURE.md §10).
 *
 * Usage:  npm run outbox:drain [-- --batch 50]
 *
 * Intended to run from cPanel cron every minute in production; the API
 * also drains opportunistically after each enqueue, but Passenger may
 * idle-kill the web process, so cron is the guarantee. Claims due
 * PENDING rows under the A8 lease, sends them via the configured SMTP
 * transport, reschedules failures with backoff and dead-letters after
 * 5 attempts (DATABASE_DESIGN.md §11.1). Safe to run concurrently with
 * the API and with other drain processes — the claim is an atomic
 * conditional UPDATE, so a row is sent by exactly one worker.
 *
 * "Sent" means the SMTP server accepted the message; it is not a claim
 * of inbox delivery (spec Part 25).
 */
import "dotenv/config";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../database/client.js";
import { drainOutbox } from "../modules/orders/outbox.service.js";

async function main(): Promise<void> {
  const batchArg = process.argv.indexOf("--batch");
  const batchSize =
    batchArg >= 0 ? Number(process.argv[batchArg + 1]) || 20 : 20;
  const config = loadConfig();
  const handle = createDatabase(config);
  try {
    await handle.ping();
    const result = await drainOutbox(
      { db: handle.db, config },
      { workerId: `cli-${process.pid}`, batchSize },
    );
    console.log(
      `outbox:drain: claimed=${result.claimed} sent=${result.sent} ` +
        `failed=${result.failed} dead=${result.dead} recovered=${result.recovered}`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error("outbox:drain: failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
