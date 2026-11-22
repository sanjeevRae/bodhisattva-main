import "dotenv/config";
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { RowDataPacket } from 'mysql2';
import { createPool } from 'mysql2/promise';

interface CountRow extends RowDataPacket {
  count: number;
}

/**
 * `npm run db:migrate` — apply all pending migrations to the configured
 * database (DATABASE_DESIGN.md §13.2).
 *
 * Requires DATABASE_URL, e.g.
 *   mysql://bodhisattva:<password>@127.0.0.1:3306/bodhisattva_dev
 *
 * Migrations are forward-only (§13.1). For local rollback use the reviewed
 * `*_down.sql` file beside the migration being reversed.
 */

const migrationsFolder = fileURLToPath(new URL('../../drizzle/migrations', import.meta.url));

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url && !process.env.DB_PASSWORD) {
    console.error(
      'db:migrate: set DATABASE_URL or the DB_* variables. See server/.env.example.',
    );
    process.exit(1);
  }

  const pool = url
    ? createPool(url)
    : createPool({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });
  try {
    // Design §2.3: every connection works in UTC so DATETIME(3) defaults are UTC.
    const connection = await pool.getConnection();
    try {
      await connection.query("SET time_zone = '+00:00'");
    } finally {
      connection.release();
    }

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });

    const [rows] = await pool.query<CountRow[]>(
      'SELECT COUNT(*) AS count FROM `__drizzle_migrations`',
    );
    console.log(`db:migrate: OK — ${rows[0]?.count ?? 0} migration(s) recorded as applied.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('db:migrate: FAILED', error);
  process.exit(1);
});
