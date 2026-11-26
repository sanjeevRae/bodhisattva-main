/**
 * Branded auth emails (integration, 2026-11-26).
 *
 * Proves against the REAL app + REAL SMTP sink that the redesigned
 * emails arrive as designed and the flows behind them are intact:
 *
 *  1. the verification mail is multipart; the code in the SUBJECT
 *     (grouped), the code in the TEXT part and the 8 boxed digits in
 *     the HTML are all the SAME code — and that code verifies the
 *     account;
 *  2. a customer password reset: the mail's subject carries no token,
 *     the reset URL appears in text and HTML, the token resets the
 *     password exactly once (reuse is refused), and a reset request
 *     for an unknown email answers identically and sends nothing;
 *  3. an ADMIN password reset does NOT bypass MFA: after resetting,
 *     login still demands the TOTP challenge and only the enrolled
 *     authenticator completes it (ChatGPT review condition, plan
 *     2026-11-26).
 *
 * Own database (bodhisattva_test_mail); guarded by INTEGRATION_DB=1.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
import request, { type Agent } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import { hashPassword } from "../src/utils/password.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/mail-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_mail";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const CUST_EMAIL = `mail-cust-${runId}@example.com`;
const CUST_PASS = "mail-cust-pass-123";
const CUST_PASS2 = "mail-cust-pass-456";
const ADMIN_EMAIL = `mail-admin-${runId}@example.com`;
const ADMIN_PASS = "mail-admin-pass-123";
const ADMIN_PASS2 = "mail-admin-pass-456-long";
const GHOST_EMAIL = `mail-ghost-${runId}@example.com`;

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
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for expected mail in /tmp/mailbox");
}

const mailFor = (email: string) => (text: string) => text.includes(email);

/** A TOTP generated with enough of its 30s window left to be usable. */
async function freshTotp(secret: string): Promise<string> {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 8) await new Promise((r) => setTimeout(r, (remaining + 1) * 1000));
  return authenticator.generate(secret);
}

describe.skipIf(!RUN)("branded auth emails (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    rmSync(UPLOADS, { recursive: true, force: true });
    mkdirSync(UPLOADS, { recursive: true });
    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DATABASE_URL: DB_URL,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      APP_URL: "http://localhost:5173",
      UPLOAD_DIRECTORY: UPLOADS,
    });
    config = loadConfig(env);
    handle = createDatabase(config);
    await handle.ping();
    const pool = handle.pool;
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    await pool.query("DELETE FROM user_roles");
    await pool.query("DELETE FROM user_sessions");
    await pool.query("DELETE FROM email_verification_codes");
    await pool.query("DELETE FROM password_reset_tokens");
    await pool.query("DELETE FROM invitations");
    await pool.query("DELETE FROM mfa_recovery_codes");
    await pool.query("DELETE FROM mfa_credentials");
    await pool.query("DELETE FROM audit_logs");
    await pool.query("DELETE FROM rate_limits");
    await pool.query("UPDATE site_settings SET updated_by = NULL");
    await pool.query("DELETE FROM users");
    execFileSync("npx", ["tsx", "src/database/seed.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("1: verification mail — subject, text and boxed digits carry the same code", async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post("/api/auth/register")
      .send({ name: "Mail Customer", email: CUST_EMAIL, password: CUST_PASS, phone: "+9779812345678" });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);

    const mail = await waitForMail(mailFor(CUST_EMAIL));
    expect(mail).toContain("multipart/alternative");
    expect(mail).toContain("text/html");

    const subject = /^Subject: (.+)$/m.exec(mail)?.[1] ?? "";
    const subjectCode = /\[(\d{4}) (\d{4})\]/.exec(subject);
    expect(subjectCode, subject).not.toBeNull();
    const textCode = /Your email verification code is: (\d{8})/.exec(mail)?.[1];
    expect(textCode).toBeTruthy();
    expect(`${subjectCode![1]}${subjectCode![2]}`).toBe(textCode);

    const boxed = [...mail.matchAll(/font-size:20px;font-weight:bold[^>]*>(\d)</g)]
      .map((m) => m[1])
      .join("");
    expect(boxed).toBe(textCode);
    expect(mail).toContain(`Code: <strong>${textCode}</strong>`);

    const verify = await agent
      .post("/api/auth/verify-email")
      .send({ email: CUST_EMAIL, code: textCode });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  }, 120000);

  it("2: customer reset — URL in both parts, single use, unknown email stays silent", async () => {
    const requestReset = (email: string) =>
      request(app).post("/api/auth/password-reset/request").send({ email });
    const res = await requestReset(CUST_EMAIL);
    expect(res.status).toBe(200);

    const mail = await waitForMail(
      (t) => mailFor(CUST_EMAIL)(t) && t.includes("Reset your Bodhisattva Museum password"),
    );
    const subject = /^Subject: (.+)$/m.exec(mail)?.[1] ?? "";
    const token = /reset-password\?token=([A-Za-z0-9_\-]+)/.exec(mail)?.[1];
    expect(token).toBeTruthy();
    expect(subject).not.toContain(token!);
    // Text line + html button href + html fallback href/text.
    expect(mail.split(`reset-password?token=${token}`).length - 1).toBeGreaterThanOrEqual(3);
    expect(mail).toContain("Reset your password</a>");

    const confirm = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, newPassword: CUST_PASS2 });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: CUST_EMAIL, password: CUST_PASS2 });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const reuse = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, newPassword: CUST_PASS });
    expect(reuse.status).toBeGreaterThanOrEqual(400);

    const ghost = await requestReset(GHOST_EMAIL);
    expect(ghost.status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    expect(mailboxTexts().some(mailFor(GHOST_EMAIL))).toBe(false);
  }, 120000);

  it("3: admin reset preserves MFA — TOTP still required and sufficient", async () => {
    const hash = await hashPassword(ADMIN_PASS);
    const [inserted] = await handle.pool.query(
      "INSERT INTO users (full_name, email, email_normalized, phone, password_hash, email_verified_at, status) VALUES ('Mail Admin', ?, ?, '+9779812345678', ?, NOW(), 'ACTIVE')",
      [ADMIN_EMAIL, ADMIN_EMAIL.toLowerCase(), hash],
    );
    const adminId = (inserted as { insertId: number }).insertId;
    await handle.pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'ADMIN'",
      [adminId],
    );
    await handle.pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'CUSTOMER'",
      [adminId],
    );

    // Enrol MFA through the real login flow; keep the secret.
    const agent: Agent = request.agent(app);
    const login1 = await agent
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    expect(login1.status, JSON.stringify(login1.body)).toBe(200);
    expect(login1.body.authLevel).toBe("enrolment_required");
    const csrf = login1.body.csrfToken as string;
    const enrol = await agent.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
    expect(enrol.status, JSON.stringify(enrol.body)).toBe(200);
    const secret = enrol.body.secret as string;
    const confirmCode = await freshTotp(secret);
    // The step the confirm code BELONGS to (freshTotp may have waited
    // into a new window) — replay protection keys off this step.
    const confirmStep = Math.floor(Date.now() / 30000);
    const confirmEnrol = await agent
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: confirmCode });
    expect(confirmEnrol.status, JSON.stringify(confirmEnrol.body)).toBe(200);

    // Reset the password through the emailed link.
    const reqRes = await request(app)
      .post("/api/auth/password-reset/request")
      .send({ email: ADMIN_EMAIL });
    expect(reqRes.status).toBe(200);
    const mail = await waitForMail(
      (t) => mailFor(ADMIN_EMAIL)(t) && t.includes("Reset your Bodhisattva Museum password"),
    );
    const token = /reset-password\?token=([A-Za-z0-9_\-]+)/.exec(mail)?.[1];
    expect(token).toBeTruthy();
    const confirm = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, newPassword: ADMIN_PASS2 });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    // Login with the NEW password must stop at the MFA challenge —
    // the reset did not clear the enrolment or grant a full session.
    const agent2: Agent = request.agent(app);
    const login2 = await agent2
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS2 });
    expect(login2.status, JSON.stringify(login2.body)).toBe(200);
    expect(login2.body.authLevel).not.toBe("full");
    const csrf2 = login2.body.csrfToken as string;
    // TOTP replay protection: the enrolment step's code cannot be
    // reused, so wait for a later step before verifying (a human
    // resetting a password takes longer than one 30s step anyway).
    while (Math.floor(Date.now() / 30000) <= confirmStep) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    const verify = await agent2
      .post("/api/auth/mfa/verify")
      .set("X-CSRF-Token", csrf2)
      .send({ code: await freshTotp(secret) });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    const me = await agent2.get("/api/auth/me");
    expect(me.status).toBe(200);
  }, 120000);
});
