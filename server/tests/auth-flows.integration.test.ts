/**
 * Phase 2 integration suite — the phase exit gate.
 *
 * Runs the REAL app against a REAL MariaDB (`bodhisattva_test`) and a REAL
 * SMTP sink on localhost:1025 (aiosmtpd file sink; see SETUP.md). OTP codes,
 * reset tokens and invitation tokens are read from the delivered mail —
 * never from the database — so the whole chain (hashing, mailing, atomic
 * consumption, sessions, CSRF, MFA, RBAC) is exercised end to end.
 *
 * Guarded by INTEGRATION_DB=1 so the default `npm test` stays DB-free.
 * Run with: npm run test:integration
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
const MAILBOX = "/tmp/mailbox";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";

const runId = Date.now().toString(36);
const EMAILS = {
  root: `root-${runId}@example.com`,
  cust1: `cust1-${runId}@example.com`,
  cust2: `cust2-${runId}@example.com`,
  invitee: `invitee-${runId}@example.com`,
};
const PASSWORDS = {
  root: "root-password-123",
  cust1: "customer-one-pass",
  cust1New: "customer-one-newpass",
  cust2: "customer-two-pass",
  invitee: "invitee-password-1",
};

/**
 * Nodemailer sends quoted-printable: URLs soft-wrap across lines (`=\r\n`)
 * and `=` becomes `=3D`. Decode before extracting anything, exactly as a
 * real mail client would — the raw .eml bytes are NOT the message text.
 */
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
  timeoutMs = 15000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = mailboxTexts().find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for expected mail in /tmp/mailbox");
}

const mailFor = (email: string) => (text: string) =>
  text.includes(`To: ${email}`) || text.includes(email);

function extractOtp(text: string): string {
  // Anchor to the mail template's phrasing: the raw message also contains
  // 8-digit runs in HEADERS (nodemailer's Message-ID starts with one),
  // which intermittently shadowed the real code when taking the first
  // match in the whole message.
  const anchored = text.match(/verification code is:\s*(\d{8})/);
  if (anchored) return anchored[1];
  const body = text.split(/\r?\n\r?\n/).slice(1).join("\n");
  const m = body.match(/\b(\d{8})\b/);
  if (!m) throw new Error("no 8-digit code found in mail body");
  return m[1];
}

function extractToken(text: string): string {
  const m = text.match(/token=([A-Za-z0-9_-]{20,})/);
  if (!m) throw new Error("no token link found in mail");
  return m[1];
}

describe.skipIf(!RUN)("Phase 2 auth flows (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const newAgent = () => request.agent(app);

  beforeAll(async () => {
    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME: "bodhisattva_test",
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
    // Clean slate: wipe transactional rows, keep the seeded roles/matrix.
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
    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
  }, 60000);

  afterAll(async () => {
    await handle.close();
  });

  it("bootstraps the first Super Admin exactly once", async () => {
    const cliEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME: "bodhisattva_test",
      BOOTSTRAP_SUPER_ADMIN_EMAIL: EMAILS.root,
      BOOTSTRAP_SUPER_ADMIN_NAME: "Root Admin",
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: PASSWORDS.root,
      // The CLI loads server/.env itself (dotenv), and a present
      // DATABASE_URL wins over the discrete settings — point it at the
      // TEST database explicitly, or the CLI would bootstrap the dev DB.
      DATABASE_URL: `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@127.0.0.1:3306/bodhisattva_test`,
    };
    const out = execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: cliEnv,
      encoding: "utf8",
    });
    expect(out).toContain(EMAILS.root);
    // Second run must refuse: a Super Admin already exists.
    expect(() =>
      execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
        cwd: serverDir,
        env: cliEnv,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
  }, 120000);

  it("gates the new admin behind MFA enrolment, then lets TOTP step up to full", async () => {
    const admin = newAgent();
    const login = await admin
      .post("/api/auth/login")
      .send({ email: EMAILS.root, password: PASSWORDS.root });
    expect(login.status).toBe(200);
    expect(login.body.authLevel).toBe("enrolment_required");
    expect(login.body.mfaEnrolmentRequired).toBe(true);
    const csrf = login.body.csrfToken as string;
    expect(csrf).toBeTruthy();

    // Level gate: admin endpoints refuse an enrolment_required session.
    const denied = await admin.get("/api/admin/roles");
    expect(denied.status).toBe(403);

    const enrol = await admin
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(enrol.status).toBe(200);
    const secret = enrol.body.secret as string;
    expect(secret).toBeTruthy();

    const confirm = await admin
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);

    const roles = await admin.get("/api/admin/roles");
    expect(roles.status).toBe(200);

    // Stash for later tests.
    Object.assign(state, { admin, csrf, secret, rootId: login.body.user.id });
  }, 120000);

  it("registers a customer, verifies the emailed OTP once, and enforces CSRF on logout", async () => {
    const cust = newAgent();
    const reg = await cust
      .post("/api/auth/register")
      .send({ name: "Customer One", email: EMAILS.cust1, password: PASSWORDS.cust1 });
    expect(reg.status).toBe(200);
    expect(reg.body.verificationRequired).toBe(true);

    const mail = await waitForMail(mailFor(EMAILS.cust1));
    const code = extractOtp(mail);
    const wrong = code === "00000000" ? "11111111" : "00000000";

    const badVerify = await cust
      .post("/api/auth/verify-email")
      .send({ email: EMAILS.cust1, code: wrong });
    expect(badVerify.status).toBe(400);

    const verify = await cust
      .post("/api/auth/verify-email")
      .send({ email: EMAILS.cust1, code });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);

    // Single use: the same code cannot verify twice.
    const reuse = await cust
      .post("/api/auth/verify-email")
      .send({ email: EMAILS.cust1, code });
    expect(reuse.status).toBe(400);

    const login = await cust
      .post("/api/auth/login")
      .send({ email: EMAILS.cust1, password: PASSWORDS.cust1 });
    expect(login.status).toBe(200);
    expect(login.body.authLevel).toBe("full");
    const csrf = login.body.csrfToken as string;

    const me = await cust.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(EMAILS.cust1);

    // RBAC negative: a customer cannot read the admin role matrix.
    const forbidden = await cust.get("/api/admin/roles");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    // CSRF: state-changing call without the header is refused…
    const noCsrf = await cust.post("/api/auth/logout").send({});
    expect(noCsrf.status).toBe(403);
    // …and succeeds with it, revoking the session.
    const logout = await cust
      .post("/api/auth/logout")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(logout.status).toBe(200);
    const meAfter = await cust.get("/api/auth/me");
    expect(meAfter.status).toBe(401);

    Object.assign(state, { cust1Agent: cust });
  }, 120000);

  it("resets a password via the emailed token and revokes existing sessions", async () => {
    const cust = newAgent();
    const login = await cust
      .post("/api/auth/login")
      .send({ email: EMAILS.cust1, password: PASSWORDS.cust1 });
    expect(login.status).toBe(200);

    const reqReset = await request(app)
      .post("/api/auth/password-reset/request")
      .send({ email: EMAILS.cust1 });
    expect(reqReset.status).toBe(200);

    const mail = await waitForMail(
      (t) => mailFor(EMAILS.cust1)(t) && t.includes("token="),
    );
    const token = extractToken(mail);

    const confirm = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, newPassword: PASSWORDS.cust1New });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    // Token is single-use.
    const reuse = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, newPassword: PASSWORDS.cust1New });
    expect(reuse.status).toBe(400);

    // The pre-reset session was revoked by the reset.
    const meAfter = await cust.get("/api/auth/me");
    expect(meAfter.status).toBe(401);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAILS.cust1, password: PASSWORDS.cust1 });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAILS.cust1, password: PASSWORDS.cust1New });
    expect(newLogin.status).toBe(200);
  }, 120000);

  it("runs the invitation lifecycle and protects the last Super Admin", async () => {
    const { admin, csrf, rootId } = state as {
      admin: ReturnType<typeof request.agent>;
      csrf: string;
      rootId: number;
    };

    const invite = await admin
      .post("/api/admin/invitations")
      .set("X-CSRF-Token", csrf)
      .send({ email: EMAILS.invitee, role: "STORE_ADMIN" });
    expect(invite.status).toBe(201);

    const mail = await waitForMail(
      (t) => mailFor(EMAILS.invitee)(t) && t.includes("token="),
    );
    const token = extractToken(mail);

    // A fresh invitee with no cookies at all can accept (pre-session route).
    const accept = await request(app)
      .post("/api/auth/invitations/accept")
      .send({ token, name: "Invitee One", password: PASSWORDS.invitee });
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);

    const reuse = await request(app)
      .post("/api/auth/invitations/accept")
      .send({ token, name: "Invitee One", password: PASSWORDS.invitee });
    expect(reuse.status).toBeGreaterThanOrEqual(400);

    // The invitee is an admin without MFA: login gates at enrolment.
    const inviteeLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAILS.invitee, password: PASSWORDS.invitee });
    expect(inviteeLogin.status).toBe(200);
    expect(inviteeLogin.body.authLevel).toBe("enrolment_required");

    // The only Super Admin cannot be demoted.
    const demote = await admin
      .put(`/api/admin/users/${rootId}/roles`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "ADMIN" });
    expect(demote.status).toBe(409);
  }, 120000);

  it("requires a fresh TOTP at login for the MFA-enabled admin and rejects replay within the same step", async () => {
    const { secret } = state as { secret: string };
    // The enrolment CONFIRM earlier already claimed its TOTP step, and the
    // replay protection (correctly) rejects any code from a claimed step.
    // Wait for a fresh step so this test exercises a genuinely new code —
    // without the wait, a fast suite run lands in the confirm's step and
    // the (correct) rejection looks like a failure.
    const msToNextStep = 30000 - (Date.now() % 30000);
    await new Promise((r) => setTimeout(r, msToNextStep + 1000));
    const admin = newAgent();
    const login = await admin
      .post("/api/auth/login")
      .send({ email: EMAILS.root, password: PASSWORDS.root });
    expect(login.status).toBe(200);
    expect(login.body.authLevel).toBe("mfa_pending");
    expect(login.body.mfaRequired).toBe(true);
    const csrf = login.body.csrfToken as string;

    const code = authenticator.generate(secret);
    const verify = await admin
      .post("/api/auth/mfa/verify")
      .set("X-CSRF-Token", csrf)
      .send({ code });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);

    const roles = await admin.get("/api/admin/roles");
    expect(roles.status).toBe(200);

    // Replay: if we are still inside the same 30 s step, the same code must
    // now be rejected because its step was already claimed.
    if (authenticator.generate(secret) === code) {
      const admin2 = newAgent();
      const login2 = await admin2
        .post("/api/auth/login")
        .send({ email: EMAILS.root, password: PASSWORDS.root });
      expect(login2.body.authLevel).toBe("mfa_pending");
      const replay = await admin2
        .post("/api/auth/mfa/verify")
        .set("X-CSRF-Token", login2.body.csrfToken as string)
        .send({ code });
      expect(replay.status).toBeGreaterThanOrEqual(400);
    }
  }, 120000);
  it("rate-limits login after 5 failures, even for the correct password", async () => {
    const cust = newAgent();
    await cust
      .post("/api/auth/register")
      .send({ name: "Customer Two", email: EMAILS.cust2, password: PASSWORDS.cust2 });
    const mail = await waitForMail(mailFor(EMAILS.cust2));
    const verify = await cust
      .post("/api/auth/verify-email")
      .send({ email: EMAILS.cust2, code: extractOtp(mail) });
    expect(verify.status).toBe(200);

    // Isolate this test's IP-scope bucket: earlier tests legitimately
    // recorded login failures from the shared loopback IP, and the IP
    // scope would otherwise trip one attempt early. The app runs behind
    // trust-proxy, so X-Forwarded-For sets the rate-limit identity.
    const testIp = "203.0.113.99";
    for (let i = 0; i < 5; i++) {
      const fail = await cust
        .post("/api/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: EMAILS.cust2, password: "wrong-password-x" });
      expect(fail.status).toBe(401);
    }
    const blocked = await cust
      .post("/api/auth/login")
      .set("X-Forwarded-For", testIp)
      .send({ email: EMAILS.cust2, password: PASSWORDS.cust2 });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  }, 120000);

});

// Shared cross-test state (agents carry cookies between its).
const state: Record<string, unknown> = {};
