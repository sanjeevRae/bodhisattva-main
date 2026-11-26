/**
 * Invitation link suite (integration) — the emailed invitation, end to
 * end (owner request 2026-11-26: "check if the invitation is correctly
 * working and the link redirection").
 *
 * The bug that prompted this: invitation emails were correct, but the
 * /accept-invitation page did not exist in the public SPA, so the link
 * bounced to the homepage (fixed in 643a7615 and browser-verified).
 * This suite locks the server half of the chain against a real
 * MariaDB + SMTP sink:
 *   - creating an invitation delivers an email whose link is EXACTLY
 *     APP_URL + /accept-invitation?token=<raw token>;
 *   - accepting through the public API the page calls creates the
 *     account with the invited role, and the first login is gated
 *     behind MFA enrolment;
 *   - an expired invitation and a revoked invitation are both refused
 *     with a 4xx and create nothing.
 *
 * Guarded by INTEGRATION_DB=1; own database (bodhisattva_test_invite).
 */
import { execFileSync } from "node:child_process";
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
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DB_NAME = "bodhisattva_test_invite";
const MAILBOX = "/tmp/mailbox";
const APP_URL = "http://localhost:5173";
const runId = Date.now().toString(36);
const ROOT = `root-${runId}@example.com`;
const INVITEE = `invitee-${runId}@example.com`;
const EXPIRED = `expired-${runId}@example.com`;
const REVOKED = `revoked-${runId}@example.com`;
const RACED = `raced-${runId}@example.com`;
const ROOT_PASS = "root-password-123";
const INVITEE_PASS = "invitee-password-1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
function extractToken(mail: string): string {
  const m = mail.match(/accept-invitation\?token=([A-Za-z0-9_-]{20,})/);
  if (!m) throw new Error("no accept-invitation token link found in mail");
  return m[1];
}

describe.skipIf(!RUN)("invitation link end to end (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

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
      APP_URL,
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

    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
  }, 120000);

  afterAll(async () => {
    await handle.close();
  });

  let rootSecret = "";

  async function rootAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: ROOT, password: ROOT_PASS });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    if (login.body.authLevel === "enrolment_required") {
      const enrol = await agent.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
      expect(enrol.status).toBe(200);
      rootSecret = enrol.body.secret as string;
      const confirm = await agent
        .post("/api/auth/mfa/confirm")
        .set("X-CSRF-Token", csrf)
        .send({ code: authenticator.generate(rootSecret) });
      expect(confirm.status).toBe(200);
    } else if (login.body.authLevel !== "full") {
      // Already enrolled on a later login: wait out the current TOTP
      // step (the confirm code above is single-use per step) and verify.
      const msIntoStep = Date.now() % 30000;
      await sleep(30000 - msIntoStep + 400);
      const verify = await agent
        .post("/api/auth/mfa/verify")
        .set("X-CSRF-Token", csrf)
        .send({ code: authenticator.generate(rootSecret) });
      expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    }
    return { agent, csrf };
  }

  async function invite(agent: request.Agent, csrf: string, email: string) {
    const res = await agent
      .post("/api/admin/invitations")
      .set("X-CSRF-Token", csrf)
      .send({ email, role: "ADMIN" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const mail = await waitForMail(
      (t) => t.includes(email) && t.includes("accept-invitation?token="),
    );
    return { res, mail, token: extractToken(mail) };
  }

  it("the emailed link is exact, acceptance creates the account with the invited role", async () => {
    const { agent, csrf } = await rootAgent();
    const { mail, token } = await invite(agent, csrf, INVITEE);

    // The link in the delivered email points at the acceptance page on
    // the configured app URL — not the homepage, not a bare token.
    expect(mail).toContain(`${APP_URL}/accept-invitation?token=${token}`);

    const accept = await request(app)
      .post("/api/auth/invitations/accept")
      .send({ token, name: "Invitee One", password: INVITEE_PASS });
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);

    const list = await agent.get("/api/admin/users?page=1&pageSize=100");
    const created = (
      list.body.items as Array<{ email: string; roles: string[]; status: string }>
    ).find((u) => u.email === INVITEE);
    expect(created?.roles).toContain("ADMIN");
    expect(created?.status).toBe("ACTIVE");

    // First login is gated behind MFA enrolment.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: INVITEE, password: INVITEE_PASS });
    expect(login.status).toBe(200);
    expect(login.body.authLevel).toBe("enrolment_required");
  }, 120000);

  it("an expired invitation is refused and creates nothing", async () => {
    const { agent, csrf } = await rootAgent();
    const { token } = await invite(agent, csrf, EXPIRED);
    await handle.pool.query(
      "UPDATE invitations SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE email_normalized = ?",
      [EXPIRED],
    );

    const accept = await request(app)
      .post("/api/auth/invitations/accept")
      .send({ token, name: "Too Late", password: INVITEE_PASS });
    expect(accept.status).toBeGreaterThanOrEqual(400);

    const [rows] = await handle.pool.query(
      "SELECT COUNT(*) AS c FROM users WHERE email_normalized = ?",
      [EXPIRED],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBe(0);
  }, 120000);

  it("a revoked invitation is refused and creates nothing", async () => {
    const { agent, csrf } = await rootAgent();
    const { res, token } = await invite(agent, csrf, REVOKED);
    const invitationId = (res.body as { id?: number }).id;
    expect(invitationId).toBeTruthy();

    const revoke = await agent
      .post(`/api/admin/invitations/${invitationId}/revoke`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);

    const accept = await request(app)
      .post("/api/auth/invitations/accept")
      .send({ token, name: "Revoked One", password: INVITEE_PASS });
    expect(accept.status).toBeGreaterThanOrEqual(400);

    const [rows] = await handle.pool.query(
      "SELECT COUNT(*) AS c FROM users WHERE email_normalized = ?",
      [REVOKED],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBe(0);
  }, 120000);

  it("two concurrent acceptances of one token create exactly one account", async () => {
    const { agent, csrf } = await rootAgent();
    const { token } = await invite(agent, csrf, RACED);

    const [a, b] = await Promise.all([
      request(app)
        .post("/api/auth/invitations/accept")
        .send({ token, name: "Raced One", password: INVITEE_PASS }),
      request(app)
        .post("/api/auth/invitations/accept")
        .send({ token, name: "Raced One", password: INVITEE_PASS }),
    ]);
    const statuses = [a.status, b.status].sort();
    // Exactly one success; the loser gets a clean 4xx refusal, never a
    // 500 from a unique-constraint race.
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(statuses[1]).toBeLessThan(500);

    const [rows] = await handle.pool.query(
      "SELECT COUNT(*) AS c FROM users WHERE email_normalized = ?",
      [RACED],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBe(1);
  }, 120000);
});
