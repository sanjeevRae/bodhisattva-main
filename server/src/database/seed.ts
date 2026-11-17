import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import {
  permissions as permissionsTable,
  rolePermissions as rolePermissionsTable,
  roles as rolesTable,
} from './schema/authorization.js';
import {
  PERMISSION_SEEDS,
  ROLE_PERMISSIONS,
  ROLE_SEEDS,
} from './seed-data/permissions.js';

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
 * Phase 2 state: three production steps seed the authorization reference
 * data — roles, permissions, role_permissions — from PERMISSIONS.md (§2, §4,
 * §5) via `seed-data/permissions.ts`. They contain no accounts and no
 * secrets, and are safe in every environment including production (§13.3).
 * The `--dev` placeholder step exists only to prove the mechanism
 * end-to-end; it writes nothing.
 */

export interface SeedStep {
  name: string;
  run: (db: MySql2Database) => Promise<void>;
}

/** Production seed steps, executed in order. */
export const seedSteps: SeedStep[] = [
  {
    name: 'roles',
    async run(db) {
      // Upsert on the natural key `roles.code` (uq_roles_code). Re-running
      // refreshes name/description and changes nothing else.
      for (const role of ROLE_SEEDS) {
        await db
          .insert(rolesTable)
          .values({
            code: role.code,
            name: role.name,
            description: role.description,
            isSystem: true,
          })
          .onDuplicateKeyUpdate({
            set: { name: role.name, description: role.description, isSystem: true },
          });
      }
    },
  },
  {
    name: 'permissions',
    async run(db) {
      // Upsert on the natural key `permissions.code` (uq_permissions_code).
      for (const permission of PERMISSION_SEEDS) {
        await db
          .insert(permissionsTable)
          .values({
            code: permission.code,
            module: permission.module,
            description: permission.description,
          })
          .onDuplicateKeyUpdate({
            set: { module: permission.module, description: permission.description },
          });
      }
    },
  },
  {
    name: 'role-permissions',
    async run(db) {
      // Insert only the matrix pairs that are missing (composite PK is the
      // natural key). A re-run inserts nothing — grants are never duplicated
      // and existing rows are untouched.
      const roleRows = await db
        .select({ id: rolesTable.id, code: rolesTable.code })
        .from(rolesTable);
      const permissionRows = await db
        .select({ id: permissionsTable.id, code: permissionsTable.code })
        .from(permissionsTable);
      const roleIdByCode = new Map(roleRows.map((row) => [row.code, row.id]));
      const permissionIdByCode = new Map(
        permissionRows.map((row) => [row.code, row.id]),
      );

      const wanted: { roleId: number; permissionId: number }[] = [];
      for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
        const roleId = roleIdByCode.get(roleCode);
        if (roleId === undefined) {
          throw new Error(`seed role-permissions: role '${roleCode}' not found — run the roles step first`);
        }
        for (const permissionCode of permissionCodes) {
          const permissionId = permissionIdByCode.get(permissionCode);
          if (permissionId === undefined) {
            throw new Error(
              `seed role-permissions: permission '${permissionCode}' not found — run the permissions step first`,
            );
          }
          wanted.push({ roleId, permissionId });
        }
      }

      const existing = await db
        .select({
          roleId: rolePermissionsTable.roleId,
          permissionId: rolePermissionsTable.permissionId,
        })
        .from(rolePermissionsTable);
      const existingKeys = new Set(
        existing.map((row) => `${row.roleId}:${row.permissionId}`),
      );
      const missing = wanted.filter(
        (pair) => !existingKeys.has(`${pair.roleId}:${pair.permissionId}`),
      );
      if (missing.length > 0) {
        await db.insert(rolePermissionsTable).values(missing);
      }
    },
  },
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
    console.log('seed: no seed steps registered. Nothing to do.');
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
