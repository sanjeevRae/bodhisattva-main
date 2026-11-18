/**
 * Super Admin bootstrap (MASTER_SPEC Part 15.1, PERMISSIONS.md §5).
 *
 * Usage:  npm run bootstrap:super-admin
 * Env:    BOOTSTRAP_SUPER_ADMIN_EMAIL, BOOTSTRAP_SUPER_ADMIN_NAME,
 *         BOOTSTRAP_SUPER_ADMIN_PASSWORD (≥ 12 characters)
 *
 * Safety properties:
 *  - Refuses to run once MAX_SUPER_ADMINS active Super Admins exist
 *    (owner decision 2026-11-18, config/limits.ts) — the CLI is usable
 *    while fewer than that many Super Admins exist; beyond the cap,
 *    administrators are created via invitations and role assignment,
 *    which enforce the same ceiling.
 *  - Refuses when the email is already registered, and on weak passwords.
 *  - Creates the account ACTIVE with the email marked verified (the
 *    operator controls the mailbox they configured) and NO MFA credential:
 *    at first login the account is forced through MFA enrolment.
 *  - Never prints the password; prints only the email and the next step.
 *  - The bootstrap itself is written to the audit log as a SYSTEM event.
 *
 * Prerequisites: migrations applied and the seed run (roles must exist).
 * The BOOTSTRAP_* variables should be removed from the environment once
 * the account exists.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { MAX_SUPER_ADMINS } from "../config/limits.js";
import type { Database } from "../database/client.js";
import * as schema from "../database/schema/index.js";
import { countActiveSuperAdmins } from "../modules/roles/super-admin-cap.js";
import { AUDIT_ACTIONS, writeAudit } from "../services/audit.js";
import { hashPassword } from "../utils/password.js";

const MIN_PASSWORD_LENGTH = 12;

function fail(message: string): never {
  console.error(`bootstrap:super-admin: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const emailRaw = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim();
  const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim();
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? "";
  if (!emailRaw || !name || !password) {
    fail(
      "BOOTSTRAP_SUPER_ADMIN_EMAIL, BOOTSTRAP_SUPER_ADMIN_NAME and BOOTSTRAP_SUPER_ADMIN_PASSWORD must all be set.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    fail("BOOTSTRAP_SUPER_ADMIN_EMAIL is not a valid email address.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(
      `BOOTSTRAP_SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const email = emailRaw;
  const emailNormalized = emailRaw.toLowerCase();

  const databaseUrl = process.env.DATABASE_URL;
  const pool = databaseUrl
    ? mysql.createPool(databaseUrl)
    : mysql.createPool({
        host: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });
  const db = drizzle(pool, { schema, mode: "default" }) as unknown as Database;

  try {
    // Refuse once the Super Admin cap is reached (config/limits.ts).
    const [superAdminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.code, "SUPER_ADMIN"))
      .limit(1);
    if (!superAdminRole) {
      fail("Roles are not initialised. Run `npm run db:seed` first.");
    }
    const activeSuperAdmins = await countActiveSuperAdmins(db);
    if (activeSuperAdmins >= MAX_SUPER_ADMINS) {
      fail(
        `The platform already has the maximum of ${MAX_SUPER_ADMINS} Super Admin accounts. Create further administrators via invitations.`,
      );
    }

    const [existingUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.emailNormalized, emailNormalized))
      .limit(1);
    if (existingUser) {
      fail("An account with BOOTSTRAP_SUPER_ADMIN_EMAIL already exists.");
    }

    const passwordHash = await hashPassword(password);
    let userId = 0;
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.users)
        .values({
          fullName: name,
          email,
          emailNormalized,
          passwordHash,
          emailVerifiedAt: new Date(),
          status: "ACTIVE",
        })
        .$returningId();
      userId = created.id;
      await tx.insert(schema.userRoles).values({
        userId,
        roleId: superAdminRole.id,
        grantedBy: null, // bootstrap grant — no human granter exists yet
      });
      await writeAudit(tx as unknown as Database, {
        actorId: null,
        actorType: "SYSTEM",
        actorRole: "SUPER_ADMIN",
        actorEmail: email,
        action: AUDIT_ACTIONS.bootstrapSuperAdmin,
        resourceType: "user",
        resourceId: userId,
        result: "SUCCESS",
        metadata: { userId, email },
      });
    });

    console.log(`Super Admin created: ${email}`);
    console.log(
      "Next step: log in with this account and enrol in two-factor authentication (MFA) — enrolment is required before any admin access is granted.",
    );
    console.log(
      "Remove the BOOTSTRAP_SUPER_ADMIN_* variables from the environment now.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    "bootstrap:super-admin failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
