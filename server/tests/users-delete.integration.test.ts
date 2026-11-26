/**
 * User deletion suite (integration) — DELETE /api/admin/users/:userId.
 *
 * Owner request 2026-11-26 ("add the delete button; delete the user
 * account from the system"), plan reviewed by ChatGPT Thinking (8.2)
 * and Gemini (8.5), both "proceed with changes". Deletion is a
 * tombstone + pseudonymization (hard delete is blocked by ON DELETE
 * RESTRICT across the identity/order graph, and order history must
 * survive). This suite proves, against a real MariaDB:
 *   1. the full effect: directory exclusion, tombstoned + anonymized
 *      row, roles / verification codes / reset tokens / cart / saved
 *      addresses gone, pending invitations in both directions revoked,
 *      an audit row that carries neither the address nor a hash of it,
 *      the old credentials refused at login, and the freed email
 *      registrable again;
 *   2. the guards: self-delete 409; the permission matrix makes user
 *      administration SUPER_ADMIN-only, so an ADMIN's deletes are 403
 *      in both directions, while a Super Admin can delete another
 *      Super Admin who is not the last one (200);
 *   3. the deleted admin's live session dies with the account;
 *   4. the step-up gate (403 when stale, 200 after step-up) and 404 on
 *      a second delete of the same account.
 *
 * Guarded by INTEGRATION_DB=1; own database (bodhisattva_test_users).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import request from "supertest";
import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import { hashPassword } from "../src/utils/password.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DB_NAME = "bodhisattva_test_users";
const MAILBOX = "/tmp/mailbox";
const runId = Date.now().toString(36);
const ROOT = `root-${runId}@example.com`;
const VICTIM = `victim-${runId}@example.com`;
const ADMIN2 = `admin2-${runId}@example.com`;
const STORE = `store-${runId}@example.com`;
const VICTIM_ADMIN = `vadmin-${runId}@example.com`;
const STORE_ACTOR = `sactor-${runId}@example.com`;
const STEPUP_TARGET = `stepup-${runId}@example.com`;
const BY_VICTIM_INVITEE = `byvictim-${runId}@example.com`;
const ROOT_PASS = "root-password-123";
const USER_PASS = "user-password-123";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function nextTotpStep() {
  const msIntoStep = Date.now() % 30000;
  await sleep(30000 - msIntoStep + 400);
}

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
      .map((f) => decodeQuotedPrintable(readFileSync(path.join(MAILBOX, f), "utf8")));
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
    await sleep(250);
  }
  throw new Error("timed out waiting for expected mail in /tmp/mailbox");
}

describe.skipIf(!RUN)("user deletion (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  let secret = "";
  let rootId = 0;
  let victimId = 0;
  let admin2Id = 0;
  let storeId = 0;
  let victimAdminId = 0;
  let stepupTargetId = 0;
  let storeActorId = 0;

  async function insertUser(email: string, role: string): Promise<number> {
    const pool = handle.pool;
    const hash = await hashPassword(USER_PASS);
    const [ins] = await pool.query(
      "INSERT INTO users (full_name, email, email_normalized, password_hash, status, email_verified_at) VALUES (?, ?, ?, ?, 'ACTIVE', NOW(3))",
      [`User ${email}`, email, email, hash],
    );
    const id = (ins as { insertId: number }).insertId;
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?",
      [id, role],
    );
    return id;
  }

  async function enrolAgent(email: string, pass: string) {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password: pass });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const csrf = login.body.csrfToken as string;
    let userSecret = "";
    if (login.body.authLevel !== "full") {
      if (login.body.authLevel === "enrolment_required") {
        const enrol = await agent.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
        expect(enrol.status).toBe(200);
        userSecret = enrol.body.secret as string;
        const confirm = await agent
          .post("/api/auth/mfa/confirm")
          .set("X-CSRF-Token", csrf)
          .send({ code: authenticator.generate(userSecret) });
        expect(confirm.status).toBe(200);
      }
    }
    return { agent, csrf, userSecret, userId: login.body.user.id as number };
  }

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const [rows] = await handle.pool.query(sql, params);
    return (rows as Array<{ c: number }>)[0].c;
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
    await handle.ping();
    const pool = handle.pool;
    await pool.query("DELETE FROM cart_items");
    await pool.query("DELETE FROM carts");
    await pool.query("DELETE FROM customer_addresses");
    await pool.query("DELETE FROM user_roles");
    await pool.query("DELETE FROM user_sessions");
    await pool.query("DELETE FROM email_verification_codes");
    await pool.query("DELETE FROM password_reset_tokens");
    await pool.query("DELETE FROM invitations");
    await pool.query("DELETE FROM mfa_recovery_codes");
    await pool.query("DELETE FROM mfa_credentials");
    await pool.query("DELETE FROM audit_logs");
    await pool.query("DELETE FROM rate_limits");
    await pool.query("DELETE FROM users");

    const cliEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_NAME,
      BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT,
      BOOTSTRAP_SUPER_ADMIN_NAME: "Root Admin",
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASS,
      DATABASE_URL: `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@127.0.0.1:3306/${DB_NAME}`,
    };
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: cliEnv,
      encoding: "utf8",
    });
    const [rootRows] = await pool.query("SELECT id FROM users WHERE email_normalized = ?", [ROOT]);
    rootId = (rootRows as Array<{ id: number }>)[0].id;

    victimId = await insertUser(VICTIM, "CUSTOMER");
    admin2Id = await insertUser(ADMIN2, "CUSTOMER");
    storeId = await insertUser(STORE, "STORE_ADMIN");
    victimAdminId = await insertUser(VICTIM_ADMIN, "STORE_ADMIN");
    storeActorId = await insertUser(STORE_ACTOR, "STORE_ADMIN");
    stepupTargetId = await insertUser(STEPUP_TARGET, "CUSTOMER");

    // Victim's personal-data footprint.
    await pool.query("INSERT INTO carts (user_id) VALUES (?)", [victimId]);
    await pool.query(
      "INSERT INTO customer_addresses (user_id, recipient_name, phone, address_line, city) VALUES (?, 'Victim Person', '+9779800000000', '1 Test Marg', 'Kathmandu')",
      [victimId],
    );
    await pool.query(
      "INSERT INTO email_verification_codes (user_id, code_hmac, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 10 MINUTE))",
      [victimId, "a".repeat(64)],
    );
    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 10 MINUTE))",
      [victimId, "b".repeat(64)],
    );
    const hash1 = createHash("sha256").update("fixture-token-one", "utf8").digest("hex");
    const hash2 = createHash("sha256").update("fixture-token-two", "utf8").digest("hex");
    await pool.query(
      "INSERT INTO invitations (email, email_normalized, role_id, token_hash, invited_by, expires_at) SELECT ?, ?, id, ?, ?, DATE_ADD(NOW(3), INTERVAL 72 HOUR) FROM roles WHERE code = 'STORE_ADMIN'",
      [VICTIM, VICTIM, hash1, rootId],
    );
    await pool.query(
      "INSERT INTO invitations (email, email_normalized, role_id, token_hash, invited_by, expires_at) SELECT ?, ?, id, ?, ?, DATE_ADD(NOW(3), INTERVAL 72 HOUR) FROM roles WHERE code = 'STORE_ADMIN'",
      [BY_VICTIM_INVITEE, BY_VICTIM_INVITEE, hash2, victimId],
    );

    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });

    // Root enrols MFA once; `secret` serves every root session below.
    const root = await enrolAgent(ROOT, ROOT_PASS);
    secret = root.userSecret;
  }, 180000);

  afterAll(async () => {
    await handle.close();
  });

  async function rootAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: ROOT, password: ROOT_PASS });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    if (login.body.authLevel !== "full") {
      await nextTotpStep();
      const verify = await agent
        .post("/api/auth/mfa/verify")
        .set("X-CSRF-Token", csrf)
        .send({ code: authenticator.generate(secret) });
      expect(verify.status).toBe(200);
    }
    return { agent, csrf };
  }

  it("1: full deletion effect — tombstone, cleanup, audit without PII, email freed", async () => {
    const { agent, csrf } = await rootAgent();

    const del = await agent
      .delete(`/api/admin/users/${victimId}`)
      .set("X-CSRF-Token", csrf);
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    const list = await agent.get("/api/admin/users?page=1&pageSize=100");
    expect(
      (list.body.items as Array<{ id: number }>).some((u) => u.id === victimId),
    ).toBe(false);

    const [rows] = await handle.pool.query(
      "SELECT email, email_normalized, full_name, phone, password_hash, status, deleted_at FROM users WHERE id = ?",
      [victimId],
    );
    const row = (
      rows as Array<{
        email: string;
        email_normalized: string;
        full_name: string;
        phone: string | null;
        password_hash: string | null;
        status: string;
        deleted_at: Date | null;
      }>
    )[0];
    expect(row.email).toBe(`deleted-${victimId}@deleted.invalid`);
    expect(row.email_normalized).toBe(`deleted-${victimId}@deleted.invalid`);
    expect(row.full_name).toBe("Deleted user");
    expect(row.phone).toBeNull();
    expect(row.password_hash).toBeNull();
    expect(row.status).toBe("DEACTIVATED");
    expect(row.deleted_at).not.toBeNull();

    expect(await countRows("SELECT COUNT(*) AS c FROM user_roles WHERE user_id = ?", [victimId])).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS c FROM carts WHERE user_id = ?", [victimId])).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS c FROM customer_addresses WHERE user_id = ?", [victimId])).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS c FROM email_verification_codes WHERE user_id = ?", [victimId])).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ?", [victimId])).toBe(0);
    expect(
      await countRows(
        "SELECT COUNT(*) AS c FROM invitations WHERE revoked_at IS NULL AND (invited_by = ? OR email_normalized = ?)",
        [victimId, VICTIM],
      ),
    ).toBe(0);

    const [audit] = await handle.pool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'admin.users.delete' AND target_id = ?",
      [victimId],
    );
    const auditRows = audit as Array<{ metadata: string }>;
    expect(auditRows).toHaveLength(1);
    const metadata = typeof auditRows[0].metadata === "string" ? auditRows[0].metadata : JSON.stringify(auditRows[0].metadata);
    // The audit trail keeps attribution (actor, target id, prior roles
    // and status) but NOT the address — and not a hash of it either:
    // an unsalted hash of a low-entropy email is reversible by
    // guessing (post-implementation review, ChatGPT 9.0/10).
    expect(metadata).not.toContain(VICTIM);
    expect(metadata).not.toContain(
      createHash("sha256").update(VICTIM, "utf8").digest("hex"),
    );
    expect(metadata).toContain("CUSTOMER");

    // Old credentials are refused.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: VICTIM, password: USER_PASS });
    expect(login.status).toBeGreaterThanOrEqual(400);

    // The freed address can register again and verify by emailed OTP.
    const cust = request.agent(app);
    const reg = await cust
      .post("/api/auth/register")
      .send({ name: "Victim Returns", email: VICTIM, password: USER_PASS, phone: "+9779812345678" });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const mail = await waitForMail(
      (t) => t.includes(VICTIM) && t.includes("verification code is:"),
    );
    const code = mail.match(/verification code is:\s*(\d{8})/)?.[1];
    expect(code).toBeTruthy();
    const verify = await cust
      .post("/api/auth/verify-email")
      .send({ email: VICTIM, code });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);
  }, 180000);

  it("2: guards — self-delete 409; user administration is SUPER_ADMIN-only; SA can delete another SA", async () => {
    const { agent, csrf } = await rootAgent();

    const self = await agent.delete(`/api/admin/users/${rootId}`).set("X-CSRF-Token", csrf);
    expect(self.status, JSON.stringify(self.body)).toBe(409);

    // The platform's permission matrix (§5) grants ADMIN no users.*
    // permissions at all: an ADMIN's delete attempts are refused 403
    // at the permission layer, whichever direction they point. (The
    // service-level rank guard behind it is defence-in-depth for any
    // future role that holds users.manage.)
    const promote = await agent
      .put(`/api/admin/users/${admin2Id}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "ADMIN" });
    expect(promote.status).toBe(200);

    const admin2 = await enrolAgent(ADMIN2, USER_PASS);
    const up = await admin2.agent
      .delete(`/api/admin/users/${rootId}`)
      .set("X-CSRF-Token", admin2.csrf);
    expect(up.status, JSON.stringify(up.body)).toBe(403);
    const down = await admin2.agent
      .delete(`/api/admin/users/${storeId}`)
      .set("X-CSRF-Token", admin2.csrf);
    expect(down.status, JSON.stringify(down.body)).toBe(403);

    // A STORE_ADMIN actor is refused too (no users.* grants either).
    const storeActor = await enrolAgent(STORE_ACTOR, USER_PASS);
    const storeTry = await storeActor.agent
      .delete(`/api/admin/users/${victimAdminId}`)
      .set("X-CSRF-Token", storeActor.csrf);
    expect(storeTry.status, JSON.stringify(storeTry.body)).toBe(403);
    expect(storeActorId).toBeGreaterThan(0);

    // A Super Admin CAN delete another Super Admin while one remains:
    // promote the store admin, then delete them as root.
    const promoteStore = await agent
      .put(`/api/admin/users/${storeId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "SUPER_ADMIN" });
    expect(promoteStore.status, JSON.stringify(promoteStore.body)).toBe(200);
    const delSa = await agent.delete(`/api/admin/users/${storeId}`).set("X-CSRF-Token", csrf);
    expect(delSa.status, JSON.stringify(delSa.body)).toBe(200);
  }, 180000);

  it("3: the deleted admin's live session dies with the account", async () => {
    const victim = await enrolAgent(VICTIM_ADMIN, USER_PASS);
    const before = await victim.agent.get("/api/auth/me");
    expect(before.status).toBe(200);
    expect(
      await countRows("SELECT COUNT(*) AS c FROM mfa_credentials WHERE user_id = ?", [victimAdminId]),
    ).toBeGreaterThan(0);

    const { agent, csrf } = await rootAgent();
    const del = await agent
      .delete(`/api/admin/users/${victimAdminId}`)
      .set("X-CSRF-Token", csrf);
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    const after = await victim.agent.get("/api/auth/me");
    expect(after.status).toBe(401);
    expect(
      await countRows("SELECT COUNT(*) AS c FROM mfa_credentials WHERE user_id = ?", [victimAdminId]),
    ).toBe(0);
    expect(
      await countRows("SELECT COUNT(*) AS c FROM mfa_recovery_codes WHERE user_id = ?", [victimAdminId]),
    ).toBe(0);
  }, 180000);

  it("4: step-up gate, then success, then 404 on re-delete", async () => {
    const { agent, csrf } = await rootAgent();
    await handle.pool.query(
      "UPDATE user_sessions SET step_up_at = DATE_SUB(NOW(3), INTERVAL 31 MINUTE) WHERE revoked_at IS NULL",
    );

    const stale = await agent
      .delete(`/api/admin/users/${stepupTargetId}`)
      .set("X-CSRF-Token", csrf);
    expect(stale.status).toBe(403);
    expect(JSON.stringify(stale.body)).toContain("recent MFA verification");

    await nextTotpStep();
    const stepUp = await agent
      .post("/api/auth/mfa/step-up")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(secret) });
    expect(stepUp.status).toBe(200);

    const del = await agent
      .delete(`/api/admin/users/${stepupTargetId}`)
      .set("X-CSRF-Token", csrf);
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    const again = await agent
      .delete(`/api/admin/users/${stepupTargetId}`)
      .set("X-CSRF-Token", csrf);
    expect(again.status).toBe(404);
  }, 180000);
});
