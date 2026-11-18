import "dotenv/config";
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { createPool } from 'mysql2/promise';

interface CountRow extends RowDataPacket {
  count: number;
}

/**
 * `npm run db:status` — list migrations from the journal and which of them the
 * configured database has applied (DATABASE_DESIGN.md §13.2).
 *
 * Drizzle applies migrations strictly in journal order and records one row per
 * applied migration in `__drizzle_migrations`, so the first N journal entries
 * are the applied ones. Without DATABASE_URL (or before the first migrate)
 * every entry is reported as pending.
 */

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  entries: JournalEntry[];
}

const migrationsDir = fileURLToPath(new URL('../../drizzle/migrations', import.meta.url));

async function appliedCount(): Promise<number | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const pool = createPool(url);
  try {
    const [rows] = await pool.query<CountRow[]>(
      'SELECT COUNT(*) AS count FROM `__drizzle_migrations`',
    );
    return rows[0]?.count ?? 0;
  } catch {
    // Table does not exist yet → nothing has ever been applied.
    return 0;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const journal = JSON.parse(
    await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;

  const applied = await appliedCount();
  if (applied === null) {
    console.log('db:status: DATABASE_URL not set — showing migration files only.\n');
  }

  for (const entry of journal.entries) {
    const state = applied !== null && entry.idx < applied ? 'applied' : 'pending';
    console.log(`${state.padEnd(8)} ${entry.tag}`);
  }
  console.log(
    `\ndb:status: ${journal.entries.length} migration(s) total` +
      (applied !== null ? `, ${applied} applied.` : '.'),
  );
}

main().catch((error: unknown) => {
  console.error('db:status: FAILED', error);
  process.exit(1);
});
