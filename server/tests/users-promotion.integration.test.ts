/**
 * Users promotion regression suite (integration) — the admin SPA's
 * role-assignment flow driven over REAL HTTP logins.
 *
 * Why this file exists (owner report, 2026-11-26): "I set another user
 * to Super Admin but they were not promoted." The older suites insert
 * actor sessions directly into the database with the step-up stamp
 * pre-set, so they never exercised the real login → MFA → step-up
 * chain the SPA depends on. This suite drives the exact request
 * sequence the SPA makes:
 *   A  fresh MFA enrolment session promotes immediately;
 *   B  re-login + MFA verify session promotes/demotes;
 *   C  stale step-up → 403 → POST /api/auth/mfa/step-up → retry works;
 *   D  the promoted user's OWN fresh login yields the new role
 *      (sessions are revoked on role change, so this is the moment
 *      the promotion becomes real for the target);
 *   E  an administrative role cannot be granted to a non-active
 *      account (409), while clearing to CUSTOMER stays allowed;
 *   F  two concurrent promotions race for the last Super Admin seat —
 *      exactly one wins (the cap holds under concurrency).
 *
 * Guarded by INTEGRATION_DB=1; own database (bodhisattva_test_promote)
 * like the other dedicated suites.
 */
import { execFileSync } from "node:child_process";
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
const DB_NAME = "bodhisattva_test_promote";
const runId = Date.now().toString(36);
const ROOT = `root-${runId}@example.com`;
const TARGET = `target-${runId}@example.com`;
const TARGET2 = `target2-${runId}@example.com`;
const TARGET3 = `target3-${runId}@example.com`;
const INACTIVE = `inactive-${runId}@example.com`;
const ROOT_PASS = "root-password-123";
const TARGET_PASS = "target-password-1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function nextTotpStep() {
  const msIntoStep = Date.now() % 30000;
  await sleep(30000 - msIntoStep + 400);
}

describe.skipIf(!RUN)("users promotion via real logins (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  let secret = "";
  let targetId = 0;
  let target2Id = 0;
  let target3Id = 0;
  let inactiveId = 0;

  async function insertUser(
    email: string,
    role: string,
    status = "ACTIVE",
    withPassword = false,
  ): Promise<number> {
    const pool = handle.pool;
    const hash = withPassword ? await hashPassword(TARGET_PASS) : null;
    const [ins] = await pool.query(
      "INSERT INTO users (full_name, email, email_normalized, password_hash, status, email_verified_at) VALUES (?, ?, ?, ?, ?, NOW(3))",
      [`User ${email}`, email, email, hash, status],
    );
    const id = (ins as { insertId: number }).insertId;
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?",
      [id, role],
    );
    return id;
  }

  /** Login (fresh agent) for the root admin, completing MFA verify. */
  async function rootAgent() {
    const admin = request.agent(app);
    const login = await admin.post("/api/auth/login").send({ email: ROOT, password: ROOT_PASS });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    if (login.body.authLevel !== "full") {
      await nextTotpStep();
      const verify = await admin
        .post("/api/auth/mfa/verify")
        .set("X-CSRF-Token", csrf)
        .send({ code: authenticator.generate(secret) });
      expect(verify.status).toBe(200);
    }
    return { admin, csrf };
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

    targetId = await insertUser(TARGET, "STORE_ADMIN", "ACTIVE", true);
    target2Id = await insertUser(TARGET2, "STORE_ADMIN");
    target3Id = await insertUser(TARGET3, "STORE_ADMIN");
    inactiveId = await insertUser(INACTIVE, "STORE_ADMIN", "SUSPENDED");

    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
  }, 120000);

  afterAll(async () => {
    await handle.close();
  });

  it("A: enrolment session can promote immediately (fresh step-up)", async () => {
    const admin = request.agent(app);
    const login = await admin.post("/api/auth/login").send({ email: ROOT, password: ROOT_PASS });
    expect(login.status).toBe(200);
    expect(login.body.authLevel).toBe("enrolment_required");
    const csrf = login.body.csrfToken as string;

    const enrol = await admin.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
    expect(enrol.status).toBe(200);
    secret = enrol.body.secret as string;

    const confirm = await admin
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(secret) });
    expect(confirm.status).toBe(200);

    const put = await admin
      .put(`/api/admin/users/${targetId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "SUPER_ADMIN" });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.changed).toBe(true);

    // Read-after-write through the directory the SPA renders.
    const list = await admin.get("/api/admin/users?page=1&pageSize=50");
    const target = (list.body.items as Array<{ id: number; roles: string[] }>).find(
      (u) => u.id === targetId,
    );
    expect(target?.roles).toContain("SUPER_ADMIN");
  }, 120000);

  it("B: re-login + MFA verify session can demote back (fresh step-up)", async () => {
    const { admin, csrf } = await rootAgent();
    const put = await admin
      .put(`/api/admin/users/${targetId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "STORE_ADMIN" });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.changed).toBe(true);
  }, 120000);

  it("C: stale step-up 403s, step-up endpoint re-stamps, retry succeeds", async () => {
    const { admin, csrf } = await rootAgent();

    await handle.pool.query(
      "UPDATE user_sessions SET step_up_at = DATE_SUB(NOW(3), INTERVAL 31 MINUTE) WHERE revoked_at IS NULL",
    );

    const put1 = await admin
      .put(`/api/admin/users/${targetId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "SUPER_ADMIN" });
    expect(put1.status).toBe(403);
    expect(JSON.stringify(put1.body)).toContain("recent MFA verification");

    await nextTotpStep();
    const stepUp = await admin
      .post("/api/auth/mfa/step-up")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(secret) });
    expect(stepUp.status, JSON.stringify(stepUp.body)).toBe(200);

    const put2 = await admin
      .put(`/api/admin/users/${targetId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "SUPER_ADMIN" });
    expect(put2.status, JSON.stringify(put2.body)).toBe(200);
    expect(put2.body.changed).toBe(true);
  }, 180000);

  it("D: the promoted user's own fresh login yields SUPER_ADMIN access", async () => {
    const target = request.agent(app);
    const login = await target
      .post("/api/auth/login")
      .send({ email: TARGET, password: TARGET_PASS });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.authLevel).toBe("enrolment_required");
    const csrf = login.body.csrfToken as string;

    const enrol = await target.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
    expect(enrol.status).toBe(200);
    const confirm = await target
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(enrol.body.secret as string) });
    expect(confirm.status).toBe(200);

    const me = await target.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain("SUPER_ADMIN");

    // A roles.read-gated directory call succeeds for the new Super Admin.
    const roles = await target.get("/api/admin/roles");
    expect(roles.status).toBe(200);
  }, 120000);

  it("E: administrative roles are refused for non-active accounts; clearing is allowed", async () => {
    const { admin, csrf } = await rootAgent();

    const grant = await admin
      .put(`/api/admin/users/${inactiveId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "ADMIN" });
    expect(grant.status, JSON.stringify(grant.body)).toBe(409);
    expect(JSON.stringify(grant.body)).toContain("not active");

    const clear = await admin
      .put(`/api/admin/users/${inactiveId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "CUSTOMER" });
    expect(clear.status, JSON.stringify(clear.body)).toBe(200);
    expect(clear.body.changed).toBe(true);
  }, 120000);

  it("F: concurrent promotions race for the last seat — exactly one wins", async () => {
    const { admin, csrf } = await rootAgent();
    // Seats now: root + target (D) = 2 of 3. Two promotions race for #3.
    const [r2, r3] = await Promise.all([
      admin
        .put(`/api/admin/users/${target2Id}/roles`)
        .set("X-CSRF-Token", csrf)
        .send({ role: "SUPER_ADMIN" }),
      admin
        .put(`/api/admin/users/${target3Id}/roles`)
        .set("X-CSRF-Token", csrf)
        .send({ role: "SUPER_ADMIN" }),
    ]);
    const statuses = [r2.status, r3.status].sort();
    expect(statuses).toEqual([200, 409]);

    const [rows] = await handle.pool.query(
      "SELECT COUNT(*) AS c FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.code = 'SUPER_ADMIN' AND u.status = 'ACTIVE'",
    );
    expect((rows as Array<{ c: number }>)[0].c).toBe(3);
  }, 120000);
});
