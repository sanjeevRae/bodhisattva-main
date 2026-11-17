import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';

/**
 * `npm run db:seed` — safe, idempotent seed runner (DATABASE_DESIGN.md §13.2–13.3,
 * DEVELOPMENT_ROADMAP.md Phase 1 deliverables).
 *
 * Contract for every seed step:
 *  - IDEMPOTENT: safe to re-run at any time. Every insert is an upsert keyed on
 *    a natural unique key (e.g. `roles.code`, `permissions.code`).
 *  - NO ACCOUNTS, EVER: seeds never create user accounts — no demonstration,
 *    test or placeholder admins in any environment (§13.3). The first Super
 *    Admin is created only by the one-time interactive bootstrap command
 *    (Phase 2), never by a seed.
 *  - TRANSACTIONAL: the runner executes each step inside its own transaction;
 *    a failed step rolls back and aborts the run.
 *
 * Phase 1 state: the framework is proven with ZERO production steps.
 * Roles / permissions / role_permissions seeding arrives in Phase 2 and
 * registers in `seedSteps` below. The `--dev` placeholder step exists only to
 * prove the mechanism end-to-end; it writes nothing.
 */

export interface SeedStep {
  name: string;
  run: (db: MySql2Database) => Promise<void>;
}

/** Production seed steps, executed in order. Phase 1: intentionally empty. */
export const seedSteps: SeedStep[] = [
  // Phase 2 registers: roles, permissions, role_permissions (PERMISSIONS.md matrix).
];

/** Development-only steps. Never run in production (enforced in main()). */
export const devSeedSteps: SeedStep[] = [
  {
    name: 'dev-placeholder',
    async run(): Promise<void> {
      // Mechanism proof only — writes nothing, creates no accounts.
      console.log('seed: [dev-placeholder] no-op — seed mechanism OK, no data written.');
    },
  },
];

async function main(): Promise<void> {
  const dev = process.argv.includes('--dev');
  if (dev && process.env.NODE_ENV === 'production') {
    console.error('seed: refusing to run --dev steps with NODE_ENV=production.');
    process.exit(1);
  }

  const steps = dev ? [...seedSteps, ...devSeedSteps] : seedSteps;
  if (steps.length === 0) {
    console.log(
      'seed: no seed steps registered (Phase 1 foundation). Nothing to do — ' +
        'roles/permissions seeding arrives in Phase 2.',
    );
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('seed: DATABASE_URL is not set. See server/.env.example.');
    process.exit(1);
  }

  let pool: Pool | undefined;
  try {
    pool = createPool(url);
    const connection = await pool.getConnection();
    try {
      await connection.query("SET time_zone = '+00:00'"); // design §2.3 — UTC everywhere
    } finally {
      connection.release();
    }
    const db = drizzle(pool);
    for (const step of steps) {
      await db.transaction(async (tx) => {
        await step.run(tx as MySql2Database);
      });
      console.log(`seed: [${step.name}] done.`);
    }
    console.log(`seed: OK — ${steps.length} step(s) completed.`);
  } finally {
    await pool?.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed: FAILED', error);
  process.exit(1);
});
