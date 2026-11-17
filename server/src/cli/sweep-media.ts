/**
 * Orphan media sweep — ops utility (Phase 8d).
 *
 * Usage:  npm run media:sweep [-- --delete]
 *
 * DEFAULT IS A DRY RUN: it only reports. It compares the files under
 * UPLOAD_DIRECTORY with the `media_assets` rows and prints
 *   (a) orphan files — on disk but owned by no asset row, and
 *   (b) missing masters — asset rows whose master file is gone.
 * With `--delete`, category (a) files are unlinked; category (b) is
 * never acted on (restoring a file or purging a row is a human call).
 * The `invoices/` subtree (invoice PDFs) is not media and is ignored.
 */
import "dotenv/config";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../database/client.js";
import { mediaAssets } from "../database/schema/index.js";
import { sweepMedia } from "../modules/media/sweep.js";

async function main(): Promise<void> {
  const deleteOrphans = process.argv.includes("--delete");
  const config = loadConfig();
  const handle = createDatabase(config);
  try {
    await handle.ping();
    const rows = await handle.db
      .select({
        id: mediaAssets.id,
        storageName: mediaAssets.storageName,
        deletedAt: mediaAssets.deletedAt,
      })
      .from(mediaAssets);
    const report = await sweepMedia({
      uploadDirectory: config.uploadDirectory,
      assets: rows,
      deleteOrphans,
    });

    console.log(`media:sweep (${deleteOrphans ? "DELETE" : "dry run"})`);
    console.log(`  upload directory : ${report.uploadDirectory}`);
    console.log(`  asset rows       : ${report.assetRows}`);
    console.log(`  files scanned    : ${report.filesScanned}`);
    console.log(`  files matched    : ${report.filesMatched}`);
    console.log(
      `  orphan files     : ${report.orphanFiles.length} (${report.orphanBytes} bytes)`,
    );
    for (const orphan of report.orphanFiles) {
      console.log(`    - ${orphan.relativePath} (${orphan.sizeBytes} bytes)`);
    }
    console.log(`  missing masters  : ${report.missingMasters.length}`);
    for (const missing of report.missingMasters) {
      console.log(
        `    - asset ${missing.assetId}: ${missing.storageName}` +
          (missing.softDeleted ? " (soft-deleted row)" : ""),
      );
    }
    if (deleteOrphans) {
      console.log(`  deleted          : ${report.deletedFiles.length} file(s)`);
    } else if (report.orphanFiles.length > 0) {
      console.log("  re-run with --delete to remove the orphan files");
    }
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(
    "media:sweep: failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
