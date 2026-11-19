/**
 * Phase 8 security suite — the Security & Deployment exit gate
 * (DEVELOPMENT_ROADMAP.md §10): SQL injection, XSS, CSRF, IDOR,
 * session fixation, brute force / rate limits, privilege escalation,
 * path traversal, malicious uploads, information disclosure and
 * unauthorized invoice downloads, executed against the REAL app on a
 * REAL MariaDB (`bodhisattva_test_security`) and the REAL SMTP sink.
 *
 * Conventions mirror the other suites: every actor is created through
 * the real API, codes/tokens are read from delivered mail, and each
 * rate-limit-sensitive flow runs under its own X-Forwarded-For bucket
 * (trust proxy = 1, so XFF sets the rate-limit identity) to keep the
 * buckets independent.
 *
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import {
  createDatabase,
  type DatabaseHandle,
} from "../src/database/client.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/security-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_security";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);

const ROOT_EMAIL = `sec-root-${runId}@example.com`;
const ROOT_PASSWORD = "sec-root-password-1";
const EMAIL_A = `sec-cust-a-${runId}@example.com`;
const EMAIL_B = `sec-cust-b-${runId}@example.com`;
const EMAIL_S = `sec-store-${runId}@example.com`;
const EMAIL_W = `sec-victim-${runId}@example.com`;
const EMAIL_V = `sec-otp-${runId}@example.com`;
const PASSWORD_A = "sec-customer-a-pass";
const PASSWORD_B = "sec-customer-b-pass";
const PASSWORD_S = "sec-store-admin-pass";
const PASSWORD_W = "sec-victim-password";

// ---------------------------------------------------------------------------
// Mail helpers (mirror the other suites)
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

const mailFor = (email: string) => (text: string) =>
  text.includes(`To: ${email}`) || text.includes(email);

function extractOtp(text: string): string {
  const anchored = text.match(/verification code is:\s*(\d{8})/);
  if (anchored) return anchored[1];
  const body = text.split(/\r?\n\r?\n/).slice(1).join("\n");
  const m = body.match(/\b(\d{8})\b/);
  if (!m) throw new Error("no 8-digit code found in mail body");
  return m[1];
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

const LEAK_MARKERS = [
  "node_modules",
  "/home/",
  "at Object.",
  "at Module.",
  "    at ",
  "SELECT ",
  "INSERT INTO",
  "UPDATE `",
  "password_hash",
  "argon2",
  "stack",
];

/** Error bodies must be the clean envelope — no internals, ever. */
function expectNoLeak(body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  for (const marker of LEAK_MARKERS) {
    expect(text, `error body leaked marker ${JSON.stringify(marker)}`).not.toContain(marker);
  }
}

function sessionCookieValue(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const entry of list) {
    const m = String(entry).match(/(?:^|;\s*)session=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

type Agent = ReturnType<typeof request.agent>;

describe.skipIf(!RUN)("Phase 8 security probes (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const state: {
    admin?: Agent;
    adminCsrf?: string;
    adminTotpSecret?: string;
    custA?: Agent;
    csrfA?: string;
    custAId?: number;
    custB?: Agent;
    csrfB?: string;
    storeAdmin?: Agent;
    storeCsrf?: string;
    addressAId?: number;
    orderAId?: number;
    cartItemAId?: number;
    assetId?: number;
  } = {};

  async function sqlOne<T>(sql: string, params: unknown[]): Promise<T | null> {
    const [rows] = await handle.pool.query(sql, params);
    const list = rows as T[];
    return list[0] ?? null;
  }

  /** Register + verify a customer from a dedicated IP bucket. */
  async function registerCustomer(
    email: string,
    password: string,
    name: string,
    ip: string,
  ): Promise<{ agent: Agent; csrf: string }> {
    const agent = request.agent(app);
    const reg = await agent
      .post("/api/auth/register")
      .set("X-Forwarded-For", ip)
      .send({ name, email, password, phone: "+9779812345678" });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const mail = await waitForMail(mailFor(email));
    const verify = await agent
      .post("/api/auth/verify-email")
      .send({ email, code: extractOtp(mail) });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    const login = await agent
      .post("/api/auth/login")
      .send({ email, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.authLevel).toBe("full");
    return { agent, csrf: login.body.csrfToken as string };
  }

  async function waitForNextTotpStep(): Promise<void> {
    const msToNextStep = 30000 - (Date.now() % 30000);
    await new Promise((r) => setTimeout(r, msToNextStep + 1000));
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
      DATABASE_URL: undefined,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      APP_URL: "http://localhost:5173",
      UPLOAD_DIRECTORY: UPLOADS,
    });
    config = loadConfig(env);
    handle = createDatabase(config);
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
      "invoices", "email_outbox", "invoice_template_versions",
      "invoice_templates", "inventory_movements", "order_status_history",
      "order_items", "orders", "cart_items", "carts", "customer_addresses",
      "invoice_sequences", "product_images", "product_variants", "products",
      "product_categories", "gallery_items", "exhibitions", "collections",
      "news_articles", "news_categories", "foundation_programs",
      "testimonials", "page_sections", "page_revisions", "pages",
      "menu_items", "menus", "site_settings", "media_assets",
      "media_folders", "user_roles", "user_sessions",
      "email_verification_codes", "password_reset_tokens", "invitations",
      "mfa_recovery_codes", "mfa_credentials", "audit_logs", "rate_limits",
      "users",
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
    app = createApp({
      config,
      database: handle,
      logger: pino({ level: "silent" }),
    });
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  // ------------------------------------------------------------- actors ---

  it("sets up actors: Super Admin with MFA, two customers, a STORE_ADMIN", async () => {
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "Security Root",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASSWORD,
        DATABASE_URL: DB_URL,
      },
      encoding: "utf8",
    });
    const admin = request.agent(app);
    const login = await admin
      .post("/api/auth/login")
      .send({ email: ROOT_EMAIL, password: ROOT_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const csrf = login.body.csrfToken as string;
    const enrol = await admin
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(enrol.status, JSON.stringify(enrol.body)).toBe(200);
    state.adminTotpSecret = enrol.body.secret as string;
    const confirm = await admin
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(state.adminTotpSecret) });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    state.admin = admin;
    state.adminCsrf = csrf;

    const a = await registerCustomer(EMAIL_A, PASSWORD_A, "Customer A", "198.51.100.11");
    state.custA = a.agent;
    state.csrfA = a.csrf;
    const aRow = await sqlOne<{ id: number }>(
      "SELECT id FROM users WHERE email = ?",
      [EMAIL_A],
    );
    state.custAId = aRow!.id;

    const b = await registerCustomer(EMAIL_B, PASSWORD_B, "Customer B", "198.51.100.12");
    state.custB = b.agent;
    state.csrfB = b.csrf;

    // STORE_ADMIN: register as a customer, then the Super Admin assigns
    // the administrative role (roles.manage + step-up).
    const sReg = request.agent(app);
    const reg = await sReg
      .post("/api/auth/register")
      .set("X-Forwarded-For", "198.51.100.13")
      .send({ name: "Store Admin", email: EMAIL_S, password: PASSWORD_S, phone: "+9779812345678" });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const sMail = await waitForMail(mailFor(EMAIL_S));
    const sVerify = await sReg
      .post("/api/auth/verify-email")
      .send({ email: EMAIL_S, code: extractOtp(sMail) });
    expect(sVerify.status, JSON.stringify(sVerify.body)).toBe(200);
    const sRow = await sqlOne<{ id: number }>(
      "SELECT id FROM users WHERE email = ?",
      [EMAIL_S],
    );
    let assign = await state
      .admin!.put(`/api/admin/users/${sRow!.id}/roles`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ role: "STORE_ADMIN" });
    if (
      assign.status === 403 &&
      JSON.stringify(assign.body).includes("recent MFA verification")
    ) {
      await waitForNextTotpStep();
      const stepUp = await state
        .admin!.post("/api/auth/mfa/step-up")
        .set("X-CSRF-Token", state.adminCsrf!)
        .send({ code: authenticator.generate(state.adminTotpSecret!) });
      expect(stepUp.status, JSON.stringify(stepUp.body)).toBe(200);
      assign = await state
        .admin!.put(`/api/admin/users/${sRow!.id}/roles`)
        .set("X-CSRF-Token", state.adminCsrf!)
        .send({ role: "STORE_ADMIN" });
    }
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);

    // The new admin-role holder is gated at MFA enrolment on login,
    // enrols, and reaches a full session.
    const sLogin = await sReg
      .post("/api/auth/login")
      .send({ email: EMAIL_S, password: PASSWORD_S });
    expect(sLogin.status, JSON.stringify(sLogin.body)).toBe(200);
    expect(sLogin.body.authLevel).toBe("enrolment_required");
    const sCsrf = sLogin.body.csrfToken as string;
    const sEnrol = await sReg
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", sCsrf)
      .send({});
    expect(sEnrol.status, JSON.stringify(sEnrol.body)).toBe(200);
    const sConfirm = await sReg
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", sCsrf)
      .send({ code: authenticator.generate(sEnrol.body.secret as string) });
    expect(sConfirm.status, JSON.stringify(sConfirm.body)).toBe(200);
    state.storeAdmin = sReg;
    state.storeCsrf = sCsrf;
  }, 180000);

  it("prepares customer A assets: address, approved order + invoice, live cart item", async () => {
    const address = await state
      .custA!.post("/api/addresses")
      .set("X-CSRF-Token", state.csrfA!)
      .send({
        recipientName: "Customer A",
        phone: "+9779800000011",
        addressLine: "Kupondole Heights",
        city: "Lalitpur",
      });
    expect(address.status, JSON.stringify(address.body)).toBe(201);
    state.addressAId = address.body.data.id as number;

    const created = await state
      .admin!.post("/api/admin/products")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        slug: `sec-asset-${runId}`,
        sku: `SEC-ASSET-${runId}`,
        name: "Security Asset Product",
        price: "1200.00",
        status: "ACTIVE",
        stockQty: 5,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const productId = created.body.data.id as number;

    const added = await state
      .custA!.post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId, quantity: 1 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const placed = await state
      .custA!.post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ addressId: state.addressAId, idempotencyKey: `sec-order-${runId}` });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    state.orderAId = placed.body.data.order.id as number;

    const approve = await state
      .admin!.post(`/api/admin/orders/${state.orderAId}/approve`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.data.invoice).toBeTruthy();

    // A live cart item for the cart IDOR probes (checkout cleared the cart).
    const reAdded = await state
      .custA!.post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId, quantity: 1 });
    expect(reAdded.status, JSON.stringify(reAdded.body)).toBe(200);
    const cart = await state.custA!.get("/api/cart");
    expect(cart.status).toBe(200);
    const items = (cart.body.data?.items ?? cart.body.items) as { id: number }[];
    expect(items.length).toBeGreaterThan(0);
    state.cartItemAId = items[0].id;
  }, 120000);

  // ---------------------------------------------------------- 1. SQLi ---

  it("1) SQL injection probes return sane payloads, never data or 500s", async () => {
    const baseline = await request(app).get("/api/shop/products");
    expect(baseline.status).toBe(200);
    const baselineTotal = baseline.body.meta?.total ?? baseline.body.data?.length;
    expect(baselineTotal).toBeGreaterThan(0);

    const tautology = await request(app).get(
      `/api/shop/products?search=${encodeURIComponent("' OR '1'='1")}`,
    );
    expect(tautology.status).toBe(200);
    expect(tautology.body.meta.total).toBe(0);
    expectNoLeak(tautology.body);

    const union = await request(app).get(
      `/api/shop/products?search=${encodeURIComponent(
        "' UNION SELECT email, password_hash FROM users -- ",
      )}`,
    );
    expect(union.status).toBe(200);
    expect(union.body.meta.total).toBe(0);
    expect(JSON.stringify(union.body)).not.toContain("@example.com");
    expectNoLeak(union.body);

    // LIKE wildcards are escaped: a bare %_ pattern matches literally.
    const wildcards = await request(app).get(
      `/api/shop/products?search=${encodeURIComponent("%_")}`,
    );
    expect(wildcards.status).toBe(200);
    expect(wildcards.body.meta.total).toBe(0);

    const category = await request(app).get(
      `/api/shop/products?category=${encodeURIComponent("' OR '1'='1")}`,
    );
    expect(category.status).toBe(200);
    expect(category.body.meta.total).toBe(0);

    // News search exercises the FULLTEXT path and its LIKE fallback.
    // (Control term updated for the real seed content, migration 0013.)
    const control = await request(app).get(
      `/api/news?search=${encodeURIComponent("Karunamaya")}`,
    );
    expect(control.status).toBe(200);
    expect(control.body.data.items.length).toBeGreaterThan(0);

    const allNews = await request(app).get("/api/news");
    expect(allNews.status).toBe(200);
    const allNewsCount = allNews.body.data.items.length;
    expect(allNewsCount).toBeGreaterThan(0);

    const newsProbe = await request(app).get(
      `/api/news?search=${encodeURIComponent("' OR '1'='1 -- ")}`,
    );
    expect(newsProbe.status).toBe(200);
    expect(newsProbe.body.data.items.length).toBeLessThanOrEqual(allNewsCount);
    expectNoLeak(newsProbe.body);

    // A UNION breakout would have to surface user rows; in natural
    // language mode the payload is inert search text and matches nothing.
    const newsUnion = await request(app).get(
      `/api/news?search=${encodeURIComponent(
        "' UNION SELECT password_hash FROM users -- ",
      )}`,
    );
    expect(newsUnion.status).toBe(200);
    expect(newsUnion.body.data.items.length).toBe(0);
    expect(JSON.stringify(newsUnion.body)).not.toContain("argon2");
    expectNoLeak(newsUnion.body);

    // Admin list searches (authenticated) behave the same way.
    const adminProducts = await state.admin!.get(
      `/api/admin/products?search=${encodeURIComponent("' OR '1'='1")}`,
    );
    expect(adminProducts.status).toBe(200);
    expect(adminProducts.body.meta.total).toBe(0);
    expectNoLeak(adminProducts.body);

    const auditProbe = await state.admin!.get(
      `/api/admin/audit-logs?actor=${encodeURIComponent("' OR '1'='1")}`,
    );
    expect(auditProbe.status).toBe(200);
    expect(auditProbe.body.meta.total).toBe(0);
    expectNoLeak(auditProbe.body);

    const adminNews = await state.admin!.get(
      `/api/admin/news?search=${encodeURIComponent("%' UNION SELECT NULL -- ")}`,
    );
    expect(adminNews.status).toBe(200);
    expectNoLeak(adminNews.body);
  }, 60000);

  // ----------------------------------------------------------- 2. XSS ---

  it("2) XSS payloads are sanitized in rich text and inert as plain-text data", async () => {
    // --- CMS rich text: script/handlers/javascript: URLs must be stripped
    // at save by sanitize-html; benign formatting must survive.
    const page = await state
      .admin!.post("/api/admin/pages")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ slug: `sec-xss-${runId}`, title: "Security XSS Probe" });
    expect(page.status, JSON.stringify(page.body)).toBe(201);
    const pageId = page.body.id as number;

    const draft = await state.admin!.get(`/api/admin/pages/${pageId}/draft`);
    expect(draft.status).toBe(200);
    const saved = await state
      .admin!.put(`/api/admin/pages/${pageId}/draft`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        revisionId: draft.body.revisionId,
        expectedVersion: draft.body.version,
        sections: [
          {
            type: "rich_text",
            isVisible: true,
            config: {
              paragraphs: [
                "<p>Hello <strong>world</strong></p><script>alert(1)</script>",
                // (An img-only paragraph sanitizes to "" and the schema
                // rejects it — so the handler probe rides inside text.)
                '<p>Text <img src="x" onerror="alert(2)"> tail</p>',
                '<a href="javascript:alert(3)">click</a>',
              ],
            },
          },
          {
            type: "rich_text",
            isVisible: true,
            config: {
              layout: "two-column statements",
              columns: [
                {
                  label: "Probe",
                  body: '<svg onload="alert(4)"></svg><em>fine</em>',
                  emphasis: "body",
                },
                { label: "Second", body: "Plain text", emphasis: "body" },
              ],
            },
          },
        ],
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const publish = await state
      .admin!.post(`/api/admin/pages/${pageId}/publish`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(publish.status, JSON.stringify(publish.body)).toBe(200);

    const pub = await request(app).get(`/api/pages/sec-xss-${runId}`);
    expect(pub.status).toBe(200);
    const rendered = JSON.stringify(pub.body);
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("onerror");
    expect(rendered).not.toContain("javascript:");
    expect(rendered).not.toContain("<svg");
    expect(rendered).not.toContain("onload");
    expect(rendered).toContain("<strong>world</strong>");
    expect(rendered).toContain("<em>fine</em>");

    // --- Product name: plain-text field. Stored verbatim, served as a
    // JSON string (data, not markup); the storefront renders it as React
    // text. Assert the API round-trips it as inert data.
    const payloadName = `<script>alert('p')</script>"><img src=x onerror=alert(1)>`;
    const product = await state
      .admin!.post("/api/admin/products")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        slug: `sec-xss-product-${runId}`,
        sku: `SEC-XSS-${runId}`,
        name: payloadName,
        price: "100.00",
        status: "ACTIVE",
        stockQty: 1,
      });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const pubProduct = await request(app).get(
      `/api/shop/products/sec-xss-product-${runId}`,
    );
    expect(pubProduct.status).toBe(200);
    expect(pubProduct.headers["content-type"]).toContain("application/json");
    expect(pubProduct.body.data.name).toBe(payloadName);

    // --- News title: same plain-text treatment.
    const category = await state
      .admin!.post("/api/admin/news/categories")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        slug: `sec-cat-${runId}`,
        name: "Security Category",
        colorToken: "bg-red-100 text-red-800",
      });
    expect(category.status, JSON.stringify(category.body)).toBe(201);
    const payloadTitle = `<script>alert('n')</script> Museum Probe`;
    const article = await state
      .admin!.post("/api/admin/news")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        slug: `sec-xss-news-${runId}`,
        title: payloadTitle,
        categoryId: category.body.data.id,
        outlet: "Probe Outlet",
        summary: "Probe summary",
        publishedOn: "2026-11-17",
        isPublished: true,
      });
    expect(article.status, JSON.stringify(article.body)).toBe(201);
    const pubNews = await request(app).get(
      `/api/news?search=${encodeURIComponent("Museum Probe")}`,
    );
    expect(pubNews.status).toBe(200);
    const found = (pubNews.body.data.items as { title: string }[]).find(
      (i) => i.title === payloadTitle,
    );
    expect(found).toBeTruthy();
  }, 120000);

  // ---------------------------------------------------------- 3. CSRF ---

  it("3) CSRF: session mutations without (or with a wrong) token are 403", async () => {
    const noToken = await state.custA!.post("/api/cart/items").send({
      productId: 1,
      quantity: 1,
    });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe("FORBIDDEN");
    expectNoLeak(noToken.body);

    const wrongToken = await state
      .custA!.post("/api/cart/items")
      .set("X-CSRF-Token", "00000000000000000000000000000000")
      .send({ productId: 1, quantity: 1 });
    expect(wrongToken.status).toBe(403);
    expect(wrongToken.body.error.code).toBe("FORBIDDEN");

    const settings = await state
      .admin!.put("/api/admin/settings")
      .send({ settings: [] });
    expect(settings.status).toBe(403);
    expect(settings.body.error.code).toBe("FORBIDDEN");

    const approve = await state
      .admin!.post(`/api/admin/orders/${state.orderAId}/approve`)
      .send({});
    expect(approve.status).toBe(403);
    expect(approve.body.error.code).toBe("FORBIDDEN");
  }, 60000);

  // ---------------------------------------------------------- 4. IDOR ---

  it("4) IDOR sweep: customer B cannot reach customer A's objects", async () => {
    const foreign = await state.custB!.get(`/api/orders/${state.orderAId}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");

    const missing = await state.custB!.get(`/api/orders/99999999`);
    expect(missing.status).toBe(404);
    // No enumeration oracle: foreign and nonexistent are indistinguishable.
    expect(Object.keys(missing.body)).toEqual(Object.keys(foreign.body));
    expect(missing.body.error.code).toBe(foreign.body.error.code);

    const invoiceMeta = await state.custB!.get(
      `/api/orders/${state.orderAId}/invoice`,
    );
    expect(invoiceMeta.status).toBe(404);

    const invoicePdf = await state.custB!.get(
      `/api/orders/${state.orderAId}/invoice.pdf`,
    );
    expect(invoicePdf.status).toBe(404);

    const patchAddress = await state
      .custB!.patch(`/api/addresses/${state.addressAId}`)
      .set("X-CSRF-Token", state.csrfB!)
      .send({ city: "Kathmandu" });
    expect(patchAddress.status).toBe(404);

    const deleteAddress = await state
      .custB!.delete(`/api/addresses/${state.addressAId}`)
      .set("X-CSRF-Token", state.csrfB!);
    expect(deleteAddress.status).toBe(404);

    const patchCart = await state
      .custB!.patch(`/api/cart/items/${state.cartItemAId}`)
      .set("X-CSRF-Token", state.csrfB!)
      .send({ quantity: 3 });
    expect(patchCart.status).toBe(404);

    const deleteCart = await state
      .custB!.delete(`/api/cart/items/${state.cartItemAId}`)
      .set("X-CSRF-Token", state.csrfB!);
    expect(deleteCart.status).toBe(404);

    // A's objects are untouched by B's attempts.
    const aOrder = await state.custA!.get(`/api/orders/${state.orderAId}`);
    expect(aOrder.status).toBe(200);
    const aAddresses = await state.custA!.get("/api/addresses");
    expect(aAddresses.status).toBe(200);
    const aAddrList = aAddresses.body.data.items as {
      id: number;
      city: string;
    }[];
    expect(aAddrList.find((x) => x.id === state.addressAId)?.city).toBe("Lalitpur");

    // Media admin surface is not reachable by a customer at all.
    const mediaList = await state.custB!.get("/api/admin/media");
    expect(mediaList.status).toBe(403);
  }, 60000);

  // ----------------------------------------------- 5. Session fixation ---

  it("5) session fixation: fresh token per login, logout kills the old one", async () => {
    const anon = await request(app).get("/api/auth/me");
    expect(anon.status).toBe(401);
    expect(sessionCookieValue(anon)).toBeNull();

    const agent = request.agent(app);
    const login1 = await agent
      .post("/api/auth/login")
      .send({ email: EMAIL_A, password: PASSWORD_A });
    expect(login1.status).toBe(200);
    const v1 = sessionCookieValue(login1);
    expect(v1).toBeTruthy();

    const meWithV1 = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `session=${encodeURIComponent(v1!)}`);
    expect(meWithV1.status).toBe(200);

    const logout = await agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", login1.body.csrfToken as string)
      .send({});
    expect(logout.status).toBe(200);

    const meAfterLogout = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `session=${encodeURIComponent(v1!)}`);
    expect(meAfterLogout.status).toBe(401);

    const login2 = await agent
      .post("/api/auth/login")
      .send({ email: EMAIL_A, password: PASSWORD_A });
    expect(login2.status).toBe(200);
    const v2 = sessionCookieValue(login2);
    expect(v2).toBeTruthy();
    expect(v2).not.toBe(v1);
  }, 60000);

  // --------------------------------------------------- 6. Rate limits ---

  it("6) brute force: login failures lock the account scope at 429", async () => {
    const w = await registerCustomer(EMAIL_W, PASSWORD_W, "Victim W", "198.51.100.14");
    expect(w.agent).toBeTruthy();
    const ip = "198.51.100.77";
    for (let i = 0; i < 5; i++) {
      const fail = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: EMAIL_W, password: "wrong-password" });
      expect(fail.status, `attempt ${i + 1}`).toBe(401);
    }
    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: EMAIL_W, password: PASSWORD_W });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expectNoLeak(blocked.body);

    // The lock is scoped: another account from another IP still logs in.
    const other = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.78")
      .send({ email: EMAIL_B, password: PASSWORD_B });
    expect(other.status).toBe(200);
  }, 120000);

  it("6b) brute force: OTP attempts exhaust at 429 and burn the code", async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post("/api/auth/register")
      .set("X-Forwarded-For", "198.51.100.15")
      .send({ name: "OTP Victim", email: EMAIL_V, password: "sec-otp-password", phone: "+9779812345678" });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const mail = await waitForMail(mailFor(EMAIL_V));
    const realCode = extractOtp(mail);
    const wrongCode = realCode === "11111111" ? "22222222" : "11111111";

    for (let i = 0; i < 4; i++) {
      const attempt = await agent
        .post("/api/auth/verify-email")
        .send({ email: EMAIL_V, code: wrongCode });
      expect(attempt.status, `wrong attempt ${i + 1}`).toBe(400);
    }
    const fifth = await agent
      .post("/api/auth/verify-email")
      .send({ email: EMAIL_V, code: wrongCode });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");

    const correct = await agent
      .post("/api/auth/verify-email")
      .send({ email: EMAIL_V, code: realCode });
    expect(correct.status).not.toBe(200);
  }, 120000);

  it("6c) brute force: registration is capped per IP per hour", async () => {
    const ip = "198.51.100.99";
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", ip)
        .send({
          name: `Rate Probe ${i}`,
          email: `sec-rate-${i}-${runId}@example.com`,
          phone: "+9779812345678",
          password: "sec-rate-password",
        });
      expect(res.status, `registration ${i + 1}`).toBe(200);
    }
    const fourth = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", ip)
      .send({
        name: "Rate Probe 4",
        email: `sec-rate-4-${runId}@example.com`,
        phone: "+9779812345678",
        password: "sec-rate-password",
      });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe("RATE_LIMITED");
  }, 120000);

  // -------------------------------------------- 7. Privilege escalation ---

  it("7) privilege escalation: customers and STORE_ADMIN stay in their lane", async () => {
    const custUsers = await state.custA!.get("/api/admin/users");
    expect(custUsers.status).toBe(403);
    expect(custUsers.body.error.code).toBe("FORBIDDEN");

    const custProducts = await state.custA!.get("/api/admin/products");
    expect(custProducts.status).toBe(403);

    const custApprove = await state
      .custA!.post(`/api/admin/orders/${state.orderAId}/approve`)
      .set("X-CSRF-Token", state.csrfA!)
      .send({});
    expect(custApprove.status).toBe(403);

    const custUpload = await state
      .custA!.post("/api/admin/media")
      .set("X-CSRF-Token", state.csrfA!)
      .attach("file", Buffer.from("not an image"), "fake.png");
    expect(custUpload.status).toBe(403);

    // STORE_ADMIN holds the store permissions but NOT roles.* — the
    // control request proves the session is genuinely a STORE_ADMIN
    // session, so the 403s are permission decisions, not auth failures.
    const storeControl = await state.storeAdmin!.get("/api/admin/products");
    expect(storeControl.status).toBe(200);

    const storeUsers = await state.storeAdmin!.get("/api/admin/users");
    expect(storeUsers.status).toBe(403);

    const storeRoles = await state
      .storeAdmin!.put(`/api/admin/users/${state.custAId}/roles`)
      .set("X-CSRF-Token", state.storeCsrf!)
      .send({ role: "ADMIN" });
    expect(storeRoles.status).toBe(403);
    expect(storeRoles.body.error.code).toBe("FORBIDDEN");
  }, 60000);

  // ------------------------------------------------- 8. Upload probes ---

  it("8) malicious uploads are rejected by content; a real PNG is accepted", async () => {
    const svg = await state
      .admin!.post("/api/admin/media")
      .set("X-CSRF-Token", state.adminCsrf!)
      .attach(
        "file",
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        "x.svg",
      );
    expect(svg.status).toBe(400);
    expectNoLeak(svg.body);

    const exe = Buffer.alloc(512, 0);
    exe.write("MZ", 0, "ascii");
    const renamed = await state
      .admin!.post("/api/admin/media")
      .set("X-CSRF-Token", state.adminCsrf!)
      .attach("file", exe, "evil.png");
    expect(renamed.status).toBe(400);

    const zip = Buffer.alloc(256, 0);
    zip.write("PK\x03\x04", 0, "latin1");
    const zipped = await state
      .admin!.post("/api/admin/media")
      .set("X-CSRF-Token", state.adminCsrf!)
      .attach("file", zip, "archive.zip");
    expect(zipped.status).toBe(400);

    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#224466" },
    })
      .png()
      .toBuffer();
    const ok = await state
      .admin!.post("/api/admin/media")
      .set("X-CSRF-Token", state.adminCsrf!)
      .attach("file", png, "control.png");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    state.assetId = ok.body.id as number;
    expect(state.assetId).toBeTruthy();
  }, 60000);

  // ------------------------------------------------ 9. Path traversal ---

  it("9) path traversal probes never escape the media store", async () => {
    const control = await request(app).get(
      `/api/media/${state.assetId}/file/master`,
    );
    expect(control.status).toBe(200);
    expect(control.headers["content-type"]).toContain("image/");

    const probes = [
      `/api/media/${state.assetId}/file/${encodeURIComponent("../../../server/.env")}`,
      `/api/media/${encodeURIComponent("../../.env")}/file/master`,
      `/api/media/${state.assetId}/file/master%2f..%2fsecret`,
      `/api/media/${encodeURIComponent("1 OR 1=1")}/file/master`,
      `/api/media/${state.assetId}/file/%2e%2e%2f%2e%2e%2f.env`,
    ];
    for (const url of probes) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("SESSION_SECRET");
      expect(JSON.stringify(res.body)).not.toContain("DB_PASSWORD");
    }
  }, 60000);

  // ------------------------------------- 10. Disclosure + security headers ---

  it("10) error responses leak nothing; helmet headers are present", async () => {
    const badJson = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe("VALIDATION_FAILED");
    expectNoLeak(badJson.text);

    const oversized = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({
          email: "a@example.com",
          password: "x".repeat(1_100_000),
        }),
      );
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expectNoLeak(oversized.text);

    // Unknown /api paths: an authenticated caller reaches the JSON 404.
    // An anonymous caller is stopped at 401 by the customer routers'
    // auth wall before route matching (Phase 8 finding F2 — no data
    // leaks either way; the responses stay indistinguishable in shape).
    const unknown = await state.custB!.get("/api/definitely-not-a-route");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");
    expectNoLeak(unknown.text);

    const unknownAnon = await request(app).get("/api/definitely-not-a-route");
    expect(unknownAnon.status).toBe(401);
    expect(unknownAnon.body.error.code).toBe("UNAUTHENTICATED");
    expectNoLeak(unknownAnon.text);

    const malformed = await request(app).get("/api/shop/products/%E0%A4%A");
    expect([400, 404, 500]).toContain(malformed.status);
    expectNoLeak(malformed.text);
    expect(malformed.text).not.toContain("URIError");

    const pub = await request(app).get("/api/shop/config");
    expect(pub.status).toBe(200);
    expect(pub.headers["x-content-type-options"]).toBe("nosniff");
    expect(pub.headers["x-frame-options"]).toBeTruthy();
    expect(pub.headers["x-powered-by"]).toBeUndefined();
  }, 60000);
});
