/**
 * Orders — Admin access + list-path transitions (integration).
 *
 * Owner decision 2026-11-26: Admins run Gift Shop order statuses from
 * the Orders list alongside Super Admin and Store Admin. Migration
 * 0026 + the seed matrix grant ADMIN store.orders.read / .approve /
 * .cancel / .update — and nothing else in the store domain. The list
 * dropdown calls the SAME transition endpoints as the detail page, so
 * this suite proves the DELTA (the state machine itself is covered by
 * orders-flows):
 *
 *  1. an ADMIN (real login + MFA enrolment) lists orders and walks one
 *     through approve → process → ship → deliver, with exactly one
 *     invoice created at approval;
 *  2. the grant is exactly scoped: ADMIN still gets 403 on invoices,
 *     product creation, inventory adjustment and invoice resend;
 *  3. reason rules hold on this path: reject/cancel without a reason,
 *     or with a whitespace-only reason, are 400s; with a reason the
 *     cancel succeeds and restores the deducted stock;
 *  4. a CUSTOMER gets 403 on the admin list and every transition, and
 *     a transition POST without the CSRF header is refused;
 *  5. an illegal jump (deliver a PENDING order) is a 422, and a
 *     STORE_ADMIN's access is unchanged.
 *
 * Own database (bodhisattva_test_ordadm) like the other suites;
 * guarded by INTEGRATION_DB=1.
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
const UPLOADS = "/tmp/ordadm-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_ordadm";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `ordadm-root-${runId}@example.com`;
const ROOT_PASS = "ordadm-root-pass-123";
const ADMIN_EMAIL = `ordadm-admin-${runId}@example.com`;
const STORE_EMAIL = `ordadm-store-${runId}@example.com`;
const USER_PASS = "ordadm-user-pass-123";
const CUST_EMAIL = `ordadm-cust-${runId}@example.com`;
const CUST_PASS = "ordadm-cust-pass-123";

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

describe.skipIf(!RUN)("orders admin access (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const state: {
    root?: Agent;
    rootCsrf?: string;
    admin?: Agent;
    adminCsrf?: string;
    store?: Agent;
    storeCsrf?: string;
    cust?: Agent;
    custCsrf?: string;
    addressId?: number;
    productId?: number;
  } = {};

  async function sqlOne<T>(sql: string, params: unknown[]): Promise<T | null> {
    const [rows] = await handle.pool.query(sql, params);
    const list = rows as T[];
    return list[0] ?? null;
  }

  async function sqlCount(sql: string, params: unknown[]): Promise<number> {
    const row = await sqlOne<{ c: number | string }>(sql, params);
    return Number(row?.c ?? 0);
  }

  async function insertUser(email: string, roleCode: string): Promise<number> {
    const hash = await hashPassword(USER_PASS);
    const [res] = await handle.pool.query(
      "INSERT INTO users (full_name, email, email_normalized, phone, password_hash, email_verified_at, status) VALUES (?, ?, ?, '+9779812345678', ?, NOW(), 'ACTIVE')",
      [email, email, email.toLowerCase(), hash],
    );
    const userId = (res as { insertId: number }).insertId;
    await handle.pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?",
      [userId, roleCode],
    );
    await handle.pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'CUSTOMER'",
      [userId],
    );
    return userId;
  }

  /** Login + (for admin roles) enrol-and-confirm TOTP → full session. */
  async function enrolAgent(
    email: string,
pass: string,
  ): Promise<{ agent: Agent; csrf: string }> {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password: pass });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const csrf = login.body.csrfToken as string;
    if (login.body.authLevel === "full") return { agent, csrf };
    expect(login.body.authLevel).toBe("enrolment_required");
    const enrol = await agent
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(enrol.status, JSON.stringify(enrol.body)).toBe(200);
    const confirm = await agent
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(enrol.body.secret as string) });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    return { agent, csrf };
  }

  async function placeOrder(quantity: number, key: string): Promise<{ id: number }> {
    const added = await state
      .cust!.post("/api/cart/items")
      .set("X-CSRF-Token", state.custCsrf!)
      .send({ productId: state.productId, quantity });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const placed = await state
      .cust!.post("/api/checkout")
      .set("X-CSRF-Token", state.custCsrf!)
      .send({ addressId: state.addressId, idempotencyKey: key });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    return placed.body.data.order as { id: number };
  }

  function transition(agent: Agent, csrf: string, orderId: number, action: string, body?: unknown) {
    return agent
      .post(`/api/admin/orders/${orderId}/${action}`)
      .set("X-CSRF-Token", csrf)
      .send(body ?? {});
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
    const pool = handle.pool;
    await pool.query("DELETE FROM credit_notes");
    await pool.query("DELETE FROM invoices");
    await pool.query("DELETE FROM email_outbox");
    await pool.query("UPDATE invoice_templates SET current_version_id = NULL");
    await pool.query("DELETE FROM invoice_template_versions");
    await pool.query("DELETE FROM invoice_templates");
    await pool.query("DELETE FROM inventory_movements");
    await pool.query("DELETE FROM order_status_history");
    await pool.query("DELETE FROM order_items");
    await pool.query("DELETE FROM orders");
    await pool.query("DELETE FROM cart_items");
    await pool.query("DELETE FROM carts");
    await pool.query("DELETE FROM customer_addresses");
    await pool.query("DELETE FROM invoice_sequences");
    await pool.query("DELETE FROM product_images");
    await pool.query("DELETE FROM product_variants");
    await pool.query("DELETE FROM products");
    await pool.query("DELETE FROM product_categories");
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
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    execFileSync("npx", ["tsx", "src/database/seed.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });

    // Root Super Admin via the bootstrap CLI (the production path).
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "OrdAdm Root",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASS,
        DATABASE_URL: DB_URL,
      },
      encoding: "utf8",
    });
    const root = await enrolAgent(ROOT_EMAIL, ROOT_PASS);
    state.root = root.agent;
    state.rootCsrf = root.csrf;

    await insertUser(ADMIN_EMAIL, "ADMIN");
    await insertUser(STORE_EMAIL, "STORE_ADMIN");
    const admin = await enrolAgent(ADMIN_EMAIL, USER_PASS);
    state.admin = admin.agent;
    state.adminCsrf = admin.csrf;
    const store = await enrolAgent(STORE_EMAIL, USER_PASS);
    state.store = store.agent;
    state.storeCsrf = store.csrf;

    // Customer through the real registration + OTP flow.
    const custAgent = request.agent(app);
    const reg = await custAgent
      .post("/api/auth/register")
      .send({ name: "OrdAdm Customer", email: CUST_EMAIL, password: CUST_PASS, phone: "+9779812345678" });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    // Match ONLY this run's recipient: /tmp/mailbox accumulates mail
    // from every suite, and a looser predicate extracts a stale code.
    const mail = await waitForMail((t) => t.includes(CUST_EMAIL));
    const code = /verification code is:?\s*(\d{8})/i.exec(mail)?.[1];
    expect(code).toBeTruthy();
    const verify = await custAgent
      .post("/api/auth/verify-email")
      .send({ email: CUST_EMAIL, code });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    const custLogin = await custAgent
      .post("/api/auth/login")
      .send({ email: CUST_EMAIL, password: CUST_PASS });
    expect(custLogin.status, JSON.stringify(custLogin.body)).toBe(200);
    state.cust = custAgent;
    state.custCsrf = custLogin.body.csrfToken as string;

    const address = await state
      .cust!.post("/api/addresses")
      .set("X-CSRF-Token", state.custCsrf!)
      .send({
        recipientName: "OrdAdm Customer",
        phone: "+9779800000001",
        addressLine: "Kupondole Heights",
        city: "Lalitpur",
      });
    expect(address.status, JSON.stringify(address.body)).toBe(201);
    state.addressId = address.body.data.id as number;

    // One product with stock 10, created by the Super Admin.
    const product = await state
      .root!.post("/api/admin/products")
      .set("X-CSRF-Token", state.rootCsrf!)
      .send({
        slug: `ordadm-${runId}`,
        sku: `ORDADM-${runId}`,
        name: "OrdAdm Product",
        price: "4500.00",
        status: "ACTIVE",
        stockQty: 10,
      });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    state.productId = product.body.data.id as number;
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("1: ADMIN walks an order through the whole lifecycle; one invoice", async () => {
    const list = await state.admin!.get("/api/admin/orders");
    expect(list.status, JSON.stringify(list.body)).toBe(200);

    const order = await placeOrder(1, `walk-${runId}`);
    for (const action of ["approve", "process", "ship", "deliver"] as const) {
      const res = await transition(state.admin!, state.adminCsrf!, order.id, action);
      expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const detail = await state.admin!.get(`/api/admin/orders/${order.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.order.status).toBe("DELIVERED");
    expect(detail.body.data.invoice).not.toBeNull();
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", [order.id]),
    ).toBe(1);
  }, 120000);

  it("2: the ADMIN grant is exactly scoped — the rest of the store stays 403", async () => {
    const invoices = await state.admin!.get("/api/admin/invoices");
    expect(invoices.status).toBe(403);
    const createProduct = await state
      .admin!.post("/api/admin/products")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ slug: `nope-${runId}`, sku: `NOPE-${runId}`, name: "Nope", price: "1.00", status: "ACTIVE", stockQty: 1 });
    expect(createProduct.status).toBe(403);
    const adjust = await state
      .admin!.post(`/api/admin/products/${state.productId}/inventory/adjust`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ setQuantity: 3 });
    expect(adjust.status).toBe(403);
    const order = await placeOrder(1, `scope-${runId}`);
    const approve = await transition(state.admin!, state.adminCsrf!, order.id, "approve");
    expect(approve.status).toBe(200);
    const resend = await state
      .admin!.post(`/api/admin/orders/${order.id}/invoice/resend`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(resend.status).toBe(403);
  }, 120000);

  it("3: reason rules on this path; a reasoned cancel restores stock", async () => {
    const order = await placeOrder(2, `reason-${runId}`);
    const noReason = await transition(state.admin!, state.adminCsrf!, order.id, "reject", {});
    expect(noReason.status).toBe(400);
    const blankReason = await transition(state.admin!, state.adminCsrf!, order.id, "reject", { reason: "   " });
    expect(blankReason.status).toBe(400);

    const approve = await transition(state.admin!, state.adminCsrf!, order.id, "approve");
    expect(approve.status).toBe(200);
    const stockAfterApprove = await sqlOne<{ stock_qty: number }>(
      "SELECT stock_qty FROM products WHERE id = ?",
      [state.productId],
    );
    const cancelNoReason = await transition(state.admin!, state.adminCsrf!, order.id, "cancel", {});
    expect(cancelNoReason.status).toBe(400);
    const cancel = await transition(state.admin!, state.adminCsrf!, order.id, "cancel", {
      reason: "Customer asked to cancel",
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const stockAfterCancel = await sqlOne<{ stock_qty: number }>(
      "SELECT stock_qty FROM products WHERE id = ?",
      [state.productId],
    );
    expect(Number(stockAfterCancel!.stock_qty)).toBe(Number(stockAfterApprove!.stock_qty) + 2);
    const history = await sqlOne<{ reason: string | null }>(
      "SELECT reason FROM order_status_history WHERE order_id = ? AND to_status = 'CANCELLED' ORDER BY id DESC LIMIT 1",
      [order.id],
    );
    expect(history?.reason).toBe("Customer asked to cancel");
  }, 120000);

  it("4: customers are locked out; CSRF header is required", async () => {
    const list = await state.cust!.get("/api/admin/orders");
    expect(list.status).toBe(403);
    const order = await placeOrder(1, `cust-${runId}`);
    const attempt = await state
      .cust!.post(`/api/admin/orders/${order.id}/approve`)
      .set("X-CSRF-Token", state.custCsrf!)
      .send({});
    expect(attempt.status).toBe(403);
    const noCsrf = await state.admin!.post(`/api/admin/orders/${order.id}/approve`).send({});
    expect(noCsrf.status).toBe(403);
  }, 120000);

  it("5: illegal jump is a 422; STORE_ADMIN access is unchanged", async () => {
    const order = await placeOrder(1, `illegal-${runId}`);
    const deliver = await transition(state.admin!, state.adminCsrf!, order.id, "deliver");
    expect(deliver.status).toBe(422);

    const storeList = await state.store!.get("/api/admin/orders");
    expect(storeList.status).toBe(200);
    const approve = await transition(state.store!, state.storeCsrf!, order.id, "approve");
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const process = await transition(state.store!, state.storeCsrf!, order.id, "process");
    expect(process.status).toBe(200);
  }, 120000);
});
