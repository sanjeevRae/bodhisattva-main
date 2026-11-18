/**
 * Super Admin cap suite (owner decision 2026-11-18, config/limits.ts):
 * at most MAX_SUPER_ADMINS (3) active Super Admins, enforced on every
 * creation path — role assignment (promotion), invitation creation
 * (pending invitations reserve slots) and invitation acceptance
 * (re-checked before consumption). The minimum-1 floor (last active
 * Super Admin cannot be demoted) is asserted intact.
 *
 * Service-level tests against the REAL MariaDB
 * (`bodhisattva_test_cap`): HTTP wiring and step-up middleware for
 * these services are already covered by the auth suite; what is under
 * test here is the cap logic itself, so actors are fabricated
 * AuthContext objects whose roles the services resolve from the DB.
 *
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@bodhisattva/shared/errors";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { MAX_SUPER_ADMINS } from "../src/config/limits.js";
import {
  createDatabase,
  type Database,
  type DatabaseHandle,
} from "../src/database/client.js";
import {
  invitations,
  roles as rolesTable,
  userRoles,
  users,
} from "../src/database/schema/index.js";
import type { AuthContext } from "../src/middleware/authorization.js";
import {
  acceptInvitation,
  createInvitation,
  revokeInvitation,
  type InvitationsDeps,
} from "../src/modules/invitations/invitations.service.js";
import {
  assignRole,
  type RolesDeps,
} from "../src/modules/roles/roles.service.js";
import {
  countActiveSuperAdmins,
  countPendingSuperAdminInvitations,
} from "../src/modules/roles/super-admin-cap.js";
import { hashPassword } from "../src/utils/password.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_cap";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;

const ROOT_EMAIL = "cap-root@example.com";
const EMAIL_A = "cap-a@example.com";
const EMAIL_B = "cap-b@example.com";
const EMAIL_C = "cap-c@example.com";
const EMAIL_E = "cap-e@example.com";
const INVITE_X = "cap-invite-x@example.com";
const INVITE_Y = "cap-invite-y@example.com";
const INVITE_D = "cap-invite-d@example.com";
const USER_PASSWORD = "cap-user-password-1";

// ---------------------------------------------------------------------------
// Mail helpers (mirror the other suites — invitation tokens arrive by mail)
// ---------------------------------------------------------------------------

function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r\n/g, "")
    .replace(/=\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function mailboxTexts(): string[] {
  try {
    return readdirSync(MAILBOX)
      .filter((f) => f.endsWith(".eml"))
      .sort()
      .map((f) =>
        decodeQuotedPrintable(readFileSync(path.join(MAILBOX, f), "utf8")),
      );
  } catch {
    return [];
  }
}

async function waitForMail(
  predicate: (text: string) => boolean,
  timeoutMs = 20000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = mailboxTexts().find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for expected mail in /tmp/mailbox");
}

async function invitationTokenFor(email: string): Promise<string> {
  const mail = await waitForMail(
    (text) => text.includes(email) && text.includes("accept-invitation?token="),
  );
  const match = mail.match(/accept-invitation\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no invitation token found in mail for ${email}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

async function expectConflict(
  promise: Promise<unknown>,
  messagePart?: string,
): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the operation to throw").toBeInstanceOf(AppError);
  const appErr = err as AppError;
  expect(appErr.code).toBe("CONFLICT");
  expect(appErr.httpStatus).toBe(409);
  if (messagePart) expect(appErr.message).toContain(messagePart);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

interface TestUser {
  id: number;
  email: string;
  fullName: string;
}

describe.skipIf(!RUN)("Super Admin cap (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let db: Database;
  let rolesDeps: RolesDeps;
  let invitationsDeps: InvitationsDeps;
  let roleIdByCode: Map<string, number>;

  const actors = new Map<string, TestUser>();

  function user(email: string): TestUser {
    const found = actors.get(email);
    if (!found) throw new Error(`test user ${email} was not created`);
    return found;
  }

  function actorFor(u: TestUser): AuthContext {
    return {
      userId: u.id,
      sessionId: 0,
      authLevel: "full",
      roles: ["SUPER_ADMIN"],
      isAdmin: true,
      email: u.email,
      fullName: u.fullName,
      stepUpAt: new Date(),
    };
  }

  function rootActor(): AuthContext {
    return actorFor(user(ROOT_EMAIL));
  }

  async function createUser(
    email: string,
    fullName: string,
    adminRole: "SUPER_ADMIN" | null,
  ): Promise<TestUser> {
    const passwordHash = await hashPassword(USER_PASSWORD);
    const [created] = await db
      .insert(users)
      .values({
        fullName,
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
      })
      .$returningId();
    const customerRoleId = roleIdByCode.get("CUSTOMER");
    if (!customerRoleId) throw new Error("CUSTOMER role missing after seed");
    await db.insert(userRoles).values({
      userId: created.id,
      roleId: customerRoleId,
      grantedBy: null,
    });
    if (adminRole) {
      const roleId = roleIdByCode.get(adminRole);
      if (!roleId) throw new Error(`${adminRole} role missing after seed`);
      await db.insert(userRoles).values({
        userId: created.id,
        roleId,
        grantedBy: null,
      });
    }
    const record = { id: created.id, email, fullName };
    actors.set(email, record);
    return record;
  }

  beforeAll(async () => {
    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DATABASE_URL: undefined,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      APP_URL: "http://localhost:5173",
    });
    config = loadConfig(env);
    handle = createDatabase(config);
    db = handle.db;
    await handle.ping();
    // Fresh database: migrate first so the wipe below has tables to hit,
    // then wipe (FK checks off — throwaway test DB) and seed for real.
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    const pool = handle.pool;
    const tables = [
      "credit_notes", "invoices", "email_outbox",
      "invoice_template_versions", "invoice_templates",
      "inventory_movements", "order_status_history", "order_items",
      "orders", "cart_items", "carts", "customer_addresses",
      "invoice_sequences", "product_images", "product_variants",
      "products", "product_categories", "gallery_items", "exhibitions",
      "collections", "news_articles", "news_categories",
      "foundation_programs", "testimonials", "page_sections",
      "page_revisions", "pages", "menu_items", "menus", "site_settings",
      "media_assets", "media_folders", "user_roles", "user_sessions",
      "email_verification_codes", "password_reset_tokens", "invitations",
      "mfa_recovery_codes", "mfa_credentials", "audit_logs",
      "rate_limits", "users",
    ];
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tables) {
      await pool.query(`DELETE FROM \`${table}\``);
    }
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    execFileSync("npx", ["tsx", "src/database/seed.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });

    const roleRows = await db
      .select({ id: rolesTable.id, code: rolesTable.code })
      .from(rolesTable);
    roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));

    rolesDeps = { db, config };
    invitationsDeps = { db, config };

    // Root Super Admin + four plain users, created directly in the DB.
    await createUser(ROOT_EMAIL, "Cap Root", "SUPER_ADMIN");
    await createUser(EMAIL_A, "Cap User A", null);
    await createUser(EMAIL_B, "Cap User B", null);
    await createUser(EMAIL_C, "Cap User C", null);
    await createUser(EMAIL_E, "Cap User E", null);
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("case (a): promotion stops at the cap of 3 active Super Admins", async () => {
    expect(MAX_SUPER_ADMINS).toBe(3);
    expect(await countActiveSuperAdmins(db)).toBe(1);

    const promoteA = await assignRole(
      rolesDeps,
      rootActor(),
      user(EMAIL_A).id,
      "SUPER_ADMIN",
      {},
    );
    expect(promoteA.changed).toBe(true);
    expect(await countActiveSuperAdmins(db)).toBe(2);

    const promoteB = await assignRole(
      rolesDeps,
      rootActor(),
      user(EMAIL_B).id,
      "SUPER_ADMIN",
      {},
    );
    expect(promoteB.changed).toBe(true);
    expect(await countActiveSuperAdmins(db)).toBe(3);

    await expectConflict(
      assignRole(rolesDeps, rootActor(), user(EMAIL_C).id, "SUPER_ADMIN", {}),
      "at most 3 Super Admin accounts",
    );
    expect(await countActiveSuperAdmins(db)).toBe(3);
  });

  it("case (b): demotion floor intact — down to 1 works, the last one is protected", async () => {
    const demoteB = await assignRole(
      rolesDeps,
      rootActor(),
      user(EMAIL_B).id,
      "ADMIN",
      {},
    );
    expect(demoteB.changed).toBe(true);
    expect(await countActiveSuperAdmins(db)).toBe(2);

    const demoteA = await assignRole(
      rolesDeps,
      rootActor(),
      user(EMAIL_A).id,
      "ADMIN",
      {},
    );
    expect(demoteA.changed).toBe(true);
    expect(await countActiveSuperAdmins(db)).toBe(1);

    // The LAST active Super Admin still cannot be demoted (floor).
    await expectConflict(
      assignRole(rolesDeps, rootActor(), user(ROOT_EMAIL).id, "ADMIN", {}),
      "last active Super Admin",
    );
    expect(await countActiveSuperAdmins(db)).toBe(1);

    // Restore to the cap for the invitation cases.
    await assignRole(rolesDeps, rootActor(), user(EMAIL_A).id, "SUPER_ADMIN", {});
    await assignRole(rolesDeps, rootActor(), user(EMAIL_B).id, "SUPER_ADMIN", {});
    expect(await countActiveSuperAdmins(db)).toBe(3);
  });

  it("case (c): pending Super Admin invitations count against the cap", async () => {
    expect(await countActiveSuperAdmins(db)).toBe(3);
    expect(await countPendingSuperAdminInvitations(db)).toBe(0);

    // At the cap, a Super Admin invitation is refused outright.
    await expectConflict(
      createInvitation(
        invitationsDeps,
        rootActor(),
        { email: INVITE_X, role: "SUPER_ADMIN" },
        {},
      ),
      "at most 3 Super Admin accounts",
    );
    expect(await countPendingSuperAdminInvitations(db)).toBe(0);

    // Free one active slot: 2 active + 0 pending.
    await assignRole(rolesDeps, rootActor(), user(EMAIL_B).id, "ADMIN", {});
    expect(await countActiveSuperAdmins(db)).toBe(2);

    // One invitation now fits (2 active + 1 pending = 3).
    const created = await createInvitation(
      invitationsDeps,
      rootActor(),
      { email: INVITE_X, role: "SUPER_ADMIN" },
      {},
    );
    expect(created.status).toBe("PENDING");
    expect(await countPendingSuperAdminInvitations(db)).toBe(1);

    // A second Super Admin invitation would oversubscribe the cap.
    await expectConflict(
      createInvitation(
        invitationsDeps,
        rootActor(),
        { email: INVITE_Y, role: "SUPER_ADMIN" },
        {},
      ),
      "at most 3 Super Admin accounts",
    );
    expect(await countPendingSuperAdminInvitations(db)).toBe(1);

    // Cleanup: revoke the pending invitation so the next case starts
    // from 2 active + 0 pending.
    await revokeInvitation(invitationsDeps, rootActor(), created.id, {});
    expect(await countPendingSuperAdminInvitations(db)).toBe(0);
    expect(await countActiveSuperAdmins(db)).toBe(2);
  });

  it("case (d): acceptance re-checks the cap and does not consume the invitation", async () => {
    expect(await countActiveSuperAdmins(db)).toBe(2);
    expect(await countPendingSuperAdminInvitations(db)).toBe(0);

    const created = await createInvitation(
      invitationsDeps,
      rootActor(),
      { email: INVITE_D, role: "SUPER_ADMIN" },
      {},
    );
    expect(created.status).toBe("PENDING");
    const token = await invitationTokenFor(INVITE_D);

    // The slot fills by direct promotion before D accepts.
    await assignRole(rolesDeps, rootActor(), user(EMAIL_E).id, "SUPER_ADMIN", {});
    expect(await countActiveSuperAdmins(db)).toBe(3);

    await expectConflict(
      acceptInvitation(
        invitationsDeps,
        { token, name: "Invitee D", password: "cap-invitee-pass-1" },
        {},
      ),
      "The Super Admin limit (3) has been reached",
    );

    // The invitation was NOT consumed: still pending and usable, and
    // no account was created for the invitee.
    const [row] = await db
      .select({
        acceptedAt: invitations.acceptedAt,
        acceptedUserId: invitations.acceptedUserId,
        revokedAt: invitations.revokedAt,
      })
      .from(invitations)
      .where(eq(invitations.id, created.id))
      .limit(1);
    expect(row.acceptedAt).toBeNull();
    expect(row.acceptedUserId).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(await countPendingSuperAdminInvitations(db)).toBe(1);
    const [invitee] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalized, INVITE_D))
      .limit(1);
    expect(invitee).toBeUndefined();
  });
});
