/**
 * Contact-form integration suite (migration 0012). Runs the REAL app
 * against a REAL MariaDB (`bodhisattva_test_contact`, its own database
 * like the other suites) with the REAL seed — so the subject allowlist
 * is read from the seeded, published CMS About page — and the REAL
 * local mail sink (127.0.0.1:1025, files in /tmp/mailbox).
 *
 * Covers: migration state; the happy path (200 envelope, row SENT with
 * the SMTP message id, exact From/To/Reply-To headers, subject line,
 * text + HTML parts); validation (bad email, header-injection email,
 * unknown subject, short/long message, smuggled routing field);
 * the live-CMS allowlist (a subject added to the published section
 * config becomes acceptable); the honeypot (success shape, no row,
 * no mail); rate limiting (4th rapid submission from one IP → 429);
 * Origin rejection; Turnstile-configured-without-token → 400; and an
 * injected SMTP failure (503, row FAILED, honest status).
 *
 * Isolation: every test uses a distinct X-Forwarded-For IP (the app
 * trusts one proxy hop) and unique message markers (the mailbox is
 * shared with other suites when the full run executes). Guarded by
 * INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import type { Mailer } from "../src/services/mailer.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/contact-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_contact";
const DB_URL = `mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
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

describe.runIf(RUN)("contact form (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  let ipCounter = 10;

  const pool = () => handle.pool;
  const nextIp = () => `203.0.113.${ipCounter++}`;

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      firstName: "Asha",
      lastName: "Sharma",
      email: `visitor-${runId}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      subject: "General Enquiry",
      message: `Hello, I would like to plan a visit. (${runId})`,
      ...overrides,
    };
  }

  async function postContact(
    target: ReturnType<typeof createApp>,
    payload: unknown,
    ip: string,
    headers: Record<string, string> = {},
  ) {
    let call = request(target)
      .post("/api/contact")
      .set("X-Forwarded-For", ip);
    for (const [key, value] of Object.entries(headers)) call = call.set(key, value);
    return call.send(payload as Record<string, unknown>);
  }

  async function submissionRows() {
    const [rows] = await pool().query(
      "SELECT id, first_name, last_name, email, subject, status, email_message_id FROM contact_submissions ORDER BY id",
    );
    return rows as {
      id: number;
      first_name: string;
      last_name: string;
      email: string;
      subject: string;
      status: string;
      email_message_id: string | null;
    }[];
  }

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
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    const p = handle.pool;
    const wipeTables = [
      "contact_submissions",
      "news_preview_tokens", "news_attachments", "news_article_tags", "news_tags",
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
    await p.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of wipeTables) {
      await p.query(`DELETE FROM \`${table}\``);
    }
    await p.query("SET FOREIGN_KEY_CHECKS = 1");
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

  beforeEach(async () => {
    await pool().query("DELETE FROM contact_submissions");
    await pool().query("DELETE FROM rate_limits WHERE scope LIKE 'contact:%'");
  });

  it("migration 0012 state: contact_submissions exists with the design columns", async () => {
    const [cols] = await pool().query(
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'contact_submissions'",
      [DB_NAME],
    );
    const names = (cols as { c: string }[]).map((r) => r.c);
    for (const expected of [
      "id", "first_name", "last_name", "email", "subject", "message",
      "status", "email_message_id", "created_at", "updated_at",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("valid submission: 200 envelope, row SENT with message id, exact mail headers and both parts", async () => {
    const marker = `MARKER-VALID-${runId}`;
    const payload = validPayload({
      email: `valid-${runId}@example.com`,
      message: `Namaste, we are planning a school visit next month. ${marker}`,
    });
    const res = await postContact(app, payload, nextIp());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { submitted: true } });

    const rows = await submissionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      first_name: "Asha",
      last_name: "Sharma",
      email: `valid-${runId}@example.com`,
      subject: "General Enquiry",
      status: "SENT",
    });
    expect(rows[0].email_message_id).toBeTruthy();

    const rawMail = await waitForMail((text) => text.includes(marker));
    // RFC 5322 header folding splits long headers across lines — unfold
    // before asserting on them.
    const mail = rawMail.replace(/\r?\n[ \t]+/g, " ");
    expect(mail).toContain(
      "From: Bodhisattva International Website <alerts@bodhisattvainternational.com>",
    );
    expect(mail).toContain("To: info@bodhisattvainternational.com");
    expect(mail).toContain(`Reply-To: valid-${runId}@example.com`);
    expect(mail).toContain("Subject: [Website Contact] - General Enquiry");
    // Both alternatives are present, and both carry name + message.
    expect(mail).toContain("text/plain");
    expect(mail).toContain("text/html");
    expect(mail).toContain("Asha Sharma");
    expect(mail).toContain(marker);
    // The stored message id is the one the SMTP server reported.
    expect(mail).toContain(`Message-ID: ${rows[0].email_message_id}`);
  }, 30000);

  it("invalid email is rejected with VALIDATION_FAILED and stores nothing", async () => {
    const res = await postContact(
      app,
      validPayload({ email: "not-an-email" }),
      nextIp(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(await submissionRows()).toHaveLength(0);
  });

  it("header-injection email (%0d%0a) is rejected", async () => {
    const res = await postContact(
      app,
      validPayload({ email: `visitor%0D%0A@example.com` }),
      nextIp(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    // Exactly one email detail — the combined schema check must not
    // report the same failure twice (QA cosmetic defect).
    const emailDetails = (res.body.error.details ?? []).filter(
      (d: { field?: string }) => d.field === "email",
    );
    expect(emailDetails).toHaveLength(1);
    expect(await submissionRows()).toHaveLength(0);
  });

  it("a subject outside the CMS allowlist is rejected", async () => {
    const res = await postContact(
      app,
      validPayload({ subject: "Lottery Winnings" }),
      nextIp(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(await submissionRows()).toHaveLength(0);
  });

  it("the allowlist is read live from the published CMS section config", async () => {
    // Add a brand-new subject to the published About contact_form config.
    const [sectionRows] = await pool().query(
      `SELECT ps.id AS id, ps.config AS config
         FROM pages p
         JOIN page_sections ps ON ps.revision_id = p.published_revision_id
        WHERE p.slug = 'about' AND ps.type = 'contact_form'
        LIMIT 1`,
    );
    const section = (sectionRows as { id: number; config: unknown }[])[0];
    expect(section).toBeTruthy();
    const cfg = (typeof section.config === "string"
      ? JSON.parse(section.config)
      : section.config) as { subjectOptions: string[] };
    const original = cfg.subjectOptions;
    await pool().query("UPDATE page_sections SET config = ? WHERE id = ?", [
      JSON.stringify({ ...cfg, subjectOptions: [...original, "Archive Donation"] }),
      section.id,
    ]);
    try {
      const res = await postContact(
        app,
        validPayload({ subject: "Archive Donation" }),
        nextIp(),
      );
      expect(res.status).toBe(200);
      const rows = await submissionRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe("Archive Donation");
    } finally {
      await pool().query("UPDATE page_sections SET config = ? WHERE id = ?", [
        JSON.stringify(cfg),
        section.id,
      ]);
    }
  }, 30000);

  it("too-short and too-long messages are rejected", async () => {
    const short = await postContact(
      app,
      validPayload({ message: "short" }),
      nextIp(),
    );
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("VALIDATION_FAILED");
    const long = await postContact(
      app,
      validPayload({ message: `x`.repeat(5001) }),
      nextIp(),
    );
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe("VALIDATION_FAILED");
    expect(await submissionRows()).toHaveLength(0);
  });

  it("a smuggled routing field (to) is rejected by the strict schema", async () => {
    const res = await postContact(
      app,
      validPayload({ to: "attacker@example.com" }),
      nextIp(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(await submissionRows()).toHaveLength(0);
  });

  it("honeypot filled: success shape, but no row and no mail", async () => {
    const marker = `MARKER-HONEYPOT-${runId}`;
    const res = await postContact(
      app,
      validPayload({
        website: "http://spam.example.com",
        message: `Buy our ranking services now. ${marker}`,
      }),
      nextIp(),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { submitted: true } });
    expect(await submissionRows()).toHaveLength(0);
    // Give any (wrongly) sent mail a chance to land, then prove absence.
    await new Promise((r) => setTimeout(r, 1500));
    expect(mailboxTexts().some((text) => text.includes(marker))).toBe(false);
  });

  it("rate limit: the 4th rapid submission from one IP is a 429", async () => {
    const ip = nextIp();
    for (let i = 1; i <= 3; i++) {
      const res = await postContact(
        app,
        validPayload({ email: `rl-${i}-${runId}@example.com` }),
        ip,
      );
      expect(res.status).toBe(200);
    }
    const fourth = await postContact(
      app,
      validPayload({ email: `rl-4-${runId}@example.com` }),
      ip,
    );
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe("RATE_LIMITED");
    expect(await submissionRows()).toHaveLength(3);
  }, 30000);

  it("HTML in the message is escaped in the HTML part (raw in the text part)", async () => {
    const marker = `MARKER-XSS-${runId}`;
    const res = await postContact(
      app,
      validPayload({
        message: `<script>alert(1)</script> Please send the schools pack. ${marker}`,
      }),
      nextIp(),
    );
    expect(res.status).toBe(200);
    const mail = await waitForMail((text) => text.includes(marker));
    const htmlPart = mail.split("text/html")[1] ?? "";
    expect(htmlPart).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(htmlPart).not.toContain("<script>alert(1)</script>");
  }, 30000);

  it("a request from a non-allowlisted Origin is rejected 403", async () => {
    const res = await postContact(app, validPayload(), nextIp(), {
      Origin: "http://evil.example.com",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(await submissionRows()).toHaveLength(0);
  });

  it("Turnstile configured but token missing: fails closed with 400", async () => {
    const tsConfig = loadConfig(
      testEnv({
        NODE_ENV: "test",
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_NAME,
        DB_USER: process.env.DB_USER,
        DB_PASSWORD: process.env.DB_PASSWORD,
        DATABASE_URL: DB_URL,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1025",
        APP_URL: "http://localhost:5173",
        UPLOAD_DIRECTORY: UPLOADS,
        TURNSTILE_SECRET_KEY: "test-turnstile-secret-not-real",
      }),
    );
    const tsApp = createApp({
      config: tsConfig,
      database: handle,
      logger: pino({ level: "silent" }),
    });
    const res = await postContact(tsApp, validPayload(), nextIp());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(await submissionRows()).toHaveLength(0);
  });

  it("SMTP failure: 503 with the safe message, row recorded FAILED", async () => {
    const failingMailer: Mailer = {
      async sendMail() {
        throw new Error("connect ECONNREFUSED 127.0.0.1:1025 (simulated)");
      },
    };
    const failApp = createApp({
      config,
      database: handle,
      logger: pino({ level: "silent" }),
      mailer: failingMailer,
    });
    const res = await postContact(failApp, validPayload(), nextIp());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error.message).toBe(
      "Your message could not be sent. Please try again later.",
    );
    const rows = await submissionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].email_message_id).toBeNull();
  });

  it("GET /api/contact answers 405, not the session guard's 401 (QA D-2)", async () => {
    const res = await request(app)
      .get("/api/contact")
      .set("Origin", "http://localhost:5173");
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(res.headers.allow).toBe("POST");
  });
});
