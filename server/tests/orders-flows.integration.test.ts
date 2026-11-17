/**
 * Phase 7 integration suite — the Orders & Invoices exit gate
 * (DEVELOPMENT_ROADMAP.md §9).
 *
 * Runs the REAL app against a REAL MariaDB (`bodhisattva_test_orders`,
 * its own database like the other suites) and the REAL SMTP sink.
 * Orders are placed through the real Phase 6 cart/checkout API and
 * driven through the real admin transition endpoints, proving:
 *
 *  1. approval creates exactly one invoice — unique INV number,
 *     complete immutable snapshot, inventory finalised exactly once;
 *  2. a CONCURRENT double approval still yields exactly one invoice
 *     and one set of ORDER_DEDUCT movements (one 200, one 422);
 *  3. with SMTP down, approval still commits; the outbox row waits,
 *     and once the transport recovers a drain delivers the invoice
 *     email WITH the PDF attached — and a second drain sends nothing;
 *  4. cancellation restores availability exactly once at
 *     PENDING_APPROVAL (RELEASE) and at APPROVED (ORDER_RESTORE), the
 *     invoice survives cancellation, history carries actor + reason,
 *     and a second cancel is a 422;
 *  5. forbidden transitions are 422 INVALID_STATE_TRANSITION;
 *  6. a template edit never rewrites an issued invoice (byte-identical
 *     re-download) while the NEXT approval pins the new version;
 *  7. invoice IDOR: another customer's metadata/PDF are 404s;
 *  8. the rendered PDF contains the invoice number, order number, a
 *     line item, the grand total and the seller name.
 *
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatMoney } from "@bodhisattva/shared/money";
import nodemailer from "nodemailer";
import { authenticator } from "otplib";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import {
  createDatabase,
  type DatabaseHandle,
} from "../src/database/client.js";
import { drainOutbox } from "../src/modules/orders/outbox.service.js";
import { setTransportForTesting } from "../src/services/mailer.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/orders-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_orders";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `orders-root-${runId}@example.com`;
const ROOT_PASSWORD = "orders-root-pass-123";
const EMAIL_A = `orders-cust-a-${runId}@example.com`;
const EMAIL_B = `orders-cust-b-${runId}@example.com`;
const PASSWORD_A = "orders-customer-a-pass";
const PASSWORD_B = "orders-customer-b-pass";

// ---------------------------------------------------------------------------
// Mail helpers (mirrors the other suites)
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

/** Decode a rendered invoice PDF's hex-TJ text runs (renderer probe). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = match[1];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

type Agent = ReturnType<typeof request.agent>;

interface OrderBody {
  id: number;
  orderNumber: string;
  status: string;
  grandTotalPaisa: number;
  items: { productId: number | null; name: string; quantity: number }[];
}

interface InvoiceViewBody {
  id: number;
  orderId: number;
  invoiceNumber: string;
  emailStatus: string;
  grandTotalPaisa: number;
}

describe.skipIf(!RUN)("Phase 7 orders & invoices flows (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const state: {
    admin?: Agent;
    adminCsrf?: string;
    adminUserId?: number;
    custA?: Agent;
    csrfA?: string;
    custB?: Agent;
    csrfB?: string;
    addressAId?: number;
    happyOrderId?: number;
    happyOrderNumber?: string;
    happyInvoiceId?: number;
    happyInvoiceNumber?: string;
    happyGrandTotalPaisa?: number;
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

  async function registerCustomer(
    email: string,
    password: string,
    name: string,
  ): Promise<{ agent: Agent; csrf: string }> {
    const agent = request.agent(app);
    const reg = await agent
      .post("/api/auth/register")
      .send({ name, email, password });
    expect(reg.status).toBe(200);
    expect(reg.body.verificationRequired).toBe(true);
    const mail = await waitForMail(mailFor(email));
    const verify = await agent
      .post("/api/auth/verify-email")
      .send({ email, code: extractOtp(mail) });
    expect(verify.status).toBe(200);
    const login = await agent
      .post("/api/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.authLevel).toBe("full");
    return { agent, csrf: login.body.csrfToken as string };
  }

  async function adminCreateProduct(
    suffix: string,
    stockQty: number,
    price = "4500.00",
  ): Promise<{ id: number; slug: string }> {
    const res = await state
      .admin!.post("/api/admin/products")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        slug: `p7-${suffix}-${runId}`,
        sku: `P7-${suffix.toUpperCase()}-${runId}`,
        name: `Phase Seven ${suffix}`,
        price,
        status: "ACTIVE",
        stockQty,
      });
    expect(res.status).toBe(201);
    return res.body.data as { id: number; slug: string };
  }

  async function placeOrder(
    productId: number,
    quantity: number,
    key: string,
  ): Promise<OrderBody> {
    const agent = state.custA!;
    const added = await agent
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId, quantity });
    expect(added.status).toBe(200);
    const placed = await agent
      .post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ addressId: state.addressAId, idempotencyKey: key });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as OrderBody;
    expect(order.status).toBe("PENDING_APPROVAL");
    return order;
  }

  function adminPost(orderId: number, action: string, body?: unknown) {
    return state
      .admin!.post(`/api/admin/orders/${orderId}/${action}`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send(body ?? {});
  }

  async function publicAvailability(slug: string): Promise<number> {
    const res = await request(app).get(`/api/shop/products/${slug}`);
    expect(res.status).toBe(200);
    return res.body.data.availableQty as number;
  }

  async function productStock(productId: number): Promise<number> {
    const row = await sqlOne<{ stock_qty: number }>(
      "SELECT stock_qty FROM products WHERE id = ?",
      [productId],
    );
    return Number(row?.stock_qty ?? -1);
  }

  /** Raw-binary GET (supertest would otherwise try to parse the PDF). */
  function getBinary(agent: Agent, url: string): Promise<{ status: number; body: Buffer; contentType: string }> {
    return new Promise((resolve, reject) => {
      agent
        .get(url)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            cb(null, Buffer.concat(chunks) as unknown as Record<string, unknown>),
          );
          res.on("error", cb);
        })
        .end((err, res) => {
          if (err && !res) return reject(err);
          resolve({
            status: res.status,
            body: res.body as Buffer,
            contentType: String(res.headers["content-type"] ?? ""),
          });
        });
    });
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
    const pool = handle.pool;
    // Wipe orders/invoices + store + identity state (FK-safe order),
    // then migrate + seed for real so the suite is self-contained.
    await pool.query("DELETE FROM invoices");
    await pool.query("DELETE FROM email_outbox");
    // Templates point at their current version — detach before wiping.
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
    app = createApp({
      config,
      database: handle,
      logger: pino({ level: "silent" }),
    });
  }, 240000);

  afterAll(async () => {
    setTransportForTesting(undefined);
    await handle.close();
  });

  it("bootstraps a Super Admin, registers customers and prepares an address", async () => {
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "Orders Root",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASSWORD,
        DATABASE_URL: DB_URL,
      },
      encoding: "utf8",
    });
    const admin = request.agent(app);
    const login = await admin
      .post("/api/auth/login")
      .send({ email: ROOT_EMAIL, password: ROOT_PASSWORD });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    const enrol = await admin
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(enrol.status).toBe(200);
    const confirm = await admin
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(enrol.body.secret as string) });
    expect(confirm.status).toBe(200);
    state.admin = admin;
    state.adminCsrf = csrf;
    const me = await sqlOne<{ id: number }>(
      "SELECT id FROM users WHERE email = ?",
      [ROOT_EMAIL],
    );
    state.adminUserId = me!.id;

    const a = await registerCustomer(EMAIL_A, PASSWORD_A, "Customer A");
    state.custA = a.agent;
    state.csrfA = a.csrf;
    const b = await registerCustomer(EMAIL_B, PASSWORD_B, "Customer B");
    state.custB = b.agent;
    state.csrfB = b.csrf;

    const address = await state
      .custA!.post("/api/addresses")
      .set("X-CSRF-Token", state.csrfA!)
      .send({
        recipientName: "Customer A",
        phone: "9800000001",
        addressLine: "Kupondole Heights",
        city: "Lalitpur",
      });
    expect(address.status).toBe(201);
    state.addressAId = address.body.data.id as number;
  }, 120000);

  it("1) approval creates exactly one invoice with a complete snapshot and finalises stock once", async () => {
    const product = await adminCreateProduct("happy", 10);
    const order = await placeOrder(product.id, 2, `happy-${runId}`);
    state.happyOrderId = order.id;
    state.happyOrderNumber = order.orderNumber;
    state.happyGrandTotalPaisa = order.grandTotalPaisa;
    expect(await publicAvailability(product.slug)).toBe(8);
    expect(await productStock(product.id)).toBe(10); // reserved, not deducted

    const res = await adminPost(order.id, "approve");
    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.order.status).toBe("APPROVED");
    expect(detail.invoice).toBeTruthy();
    const invoice = detail.invoice as InvoiceViewBody;
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/);
    state.happyInvoiceId = invoice.id;
    state.happyInvoiceNumber = invoice.invoiceNumber;

    // Exactly one invoice row; the snapshot is complete and frozen
    // from the order + template version 1.
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", [order.id]),
    ).toBe(1);
    const row = await sqlOne<{ snapshot: unknown; template_version_id: number }>(
      "SELECT snapshot, template_version_id FROM invoices WHERE order_id = ?",
      [order.id],
    );
    const snap = (typeof row!.snapshot === "string"
      ? JSON.parse(row!.snapshot)
      : row!.snapshot) as Record<string, any>;
    expect(snap.seller.name).toBe("Bodhisattva International");
    expect(snap.seller.taxRegistrationNumber).toBeNull(); // never invented
    expect(snap.buyer.email).toBe(EMAIL_A);
    expect(snap.delivery.city).toBe("Lalitpur");
    expect(snap.lines).toHaveLength(1);
    expect(snap.lines[0].name).toBe("Phase Seven happy");
    expect(snap.lines[0].quantity).toBe(2);
    expect(snap.totals.grandTotal).toBe(
      (order.grandTotalPaisa / 100).toFixed(2),
    );
    expect(snap.paymentMethod).toBe("COD");
    expect(snap.template.versionNo).toBe(1);

    // Inventory finalised exactly once: one ORDER_DEDUCT + one
    // RELEASE (closing the reservation) for this order; stock 10 → 8;
    // availability unchanged by the pair.
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = 'ORDER_DEDUCT'",
        [order.id],
      ),
    ).toBe(1);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = 'RELEASE'",
        [order.id],
      ),
    ).toBe(1);
    expect(await productStock(product.id)).toBe(8);
    expect(await publicAvailability(product.slug)).toBe(8);

    // History + the invoice email (opportunistic drain, PDF attached).
    const history = detail.history as { toStatus: string; actorRole: string | null }[];
    expect(history[history.length - 1].toStatus).toBe("APPROVED");
    expect(history[history.length - 1].actorRole).toBe("SUPER_ADMIN");
    const mail = await waitForMail(
      (text) => mailFor(EMAIL_A)(text) && text.includes(invoice.invoiceNumber),
    );
    expect(mail).toContain("JVBERi"); // "%PDF" base64 — the attachment
    const deadline = Date.now() + 15000;
    let emailStatus = "";
    while (Date.now() < deadline) {
      const inv = await sqlOne<{ email_status: string }>(
        "SELECT email_status FROM invoices WHERE id = ?",
        [invoice.id],
      );
      emailStatus = inv!.email_status;
      if (emailStatus === "SENT") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(emailStatus).toBe("SENT");
  }, 120000);

  it("2) concurrent double approval: exactly one invoice, one deduction set, one 422", async () => {
    const product = await adminCreateProduct("race", 5);
    const order = await placeOrder(product.id, 1, `race-${runId}`);
    const [first, second] = await Promise.all([
      adminPost(order.id, "approve"),
      adminPost(order.id, "approve"),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 422]);
    const loser = first.status === 422 ? first : second;
    expect(loser.body.error.code).toBe("INVALID_STATE_TRANSITION");
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", [order.id]),
    ).toBe(1);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = 'ORDER_DEDUCT'",
        [order.id],
      ),
    ).toBe(1);
    expect(await productStock(product.id)).toBe(4);
  }, 120000);

  it("3) SMTP down: approval still commits; recovery drain delivers once with the PDF", async () => {
    const product = await adminCreateProduct("smtp", 5);
    const order = await placeOrder(product.id, 1, `smtp-${runId}`);
    // A transport that always fails fast (nothing listens on 59999).
    setTransportForTesting(
      nodemailer.createTransport({
        host: "127.0.0.1",
        port: 59999,
        connectionTimeout: 1000,
        greetingTimeout: 1000,
        socketTimeout: 2000,
      }),
    );
    try {
      const res = await adminPost(order.id, "approve");
      expect(res.status).toBe(200); // approval NEVER rolls back on mail
      const invoice = res.body.data.invoice as InvoiceViewBody;
      expect(invoice).toBeTruthy();
      // The opportunistic drain attempted, failed, and rescheduled.
      // (INVOICE outbox rows reference the invoice, not the order.)
      const deadline = Date.now() + 20000;
      let outbox: { status: string; attempts: number } | null = null;
      while (Date.now() < deadline) {
        outbox = await sqlOne<{ status: string; attempts: number }>(
          "SELECT status, attempts FROM email_outbox WHERE type = 'INVOICE' AND related_type = 'invoice' AND related_id = ? ORDER BY id DESC LIMIT 1",
          [invoice.id],
        );
        if (outbox && outbox.attempts >= 1 && outbox.status === "PENDING") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(outbox).toBeTruthy();
      expect(outbox!.status).toBe("PENDING");
      expect(outbox!.attempts).toBeGreaterThanOrEqual(1);

      // Transport recovers; a drain past the backoff delivers it.
      setTransportForTesting(undefined);
      const drained = await drainOutbox(
        { db: handle.db, config },
        { workerId: "test-drain", now: new Date(Date.now() + 61_000) },
      );
      expect(drained.sent).toBeGreaterThanOrEqual(1);
      const mail = await waitForMail(
        (text) => mailFor(EMAIL_A)(text) && text.includes(invoice.invoiceNumber),
      );
      expect(mail).toContain("JVBERi");
      const inv = await sqlOne<{ email_status: string }>(
        "SELECT email_status FROM invoices WHERE id = ?",
        [invoice.id],
      );
      expect(inv!.email_status).toBe("SENT");

      // A second drain sends nothing more for this invoice.
      const before = mailboxTexts().filter((t) =>
        t.includes(invoice.invoiceNumber),
      ).length;
      const again = await drainOutbox(
        { db: handle.db, config },
        { workerId: "test-drain-2", now: new Date(Date.now() + 120_000) },
      );
      expect(again.claimed).toBe(0);
      await new Promise((r) => setTimeout(r, 500));
      const after = mailboxTexts().filter((t) =>
        t.includes(invoice.invoiceNumber),
      ).length;
      expect(after).toBe(before);
    } finally {
      setTransportForTesting(undefined);
    }
  }, 120000);

  it("4) cancellation restores availability exactly once; the invoice survives", async () => {
    // (a) At PENDING_APPROVAL: RELEASE only, stock untouched.
    const pA = await adminCreateProduct("cancelp", 5);
    const orderA = await placeOrder(pA.id, 3, `cancelp-${runId}`);
    expect(await publicAvailability(pA.slug)).toBe(2);
    const cancelA = await adminPost(orderA.id, "cancel", {
      reason: "Customer changed their mind",
    });
    expect(cancelA.status).toBe(200);
    expect(cancelA.body.data.order.status).toBe("CANCELLED");
    expect(await publicAvailability(pA.slug)).toBe(5);
    expect(await productStock(pA.id)).toBe(5);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = 'RELEASE'",
        [orderA.id],
      ),
    ).toBe(1);
    const historyA = cancelA.body.data.history as {
      toStatus: string;
      reason: string | null;
      actorId: number | null;
    }[];
    const cancelRow = historyA.find((h) => h.toStatus === "CANCELLED");
    expect(cancelRow?.reason).toBe("Customer changed their mind");
    expect(cancelRow?.actorId).toBe(state.adminUserId);
    const secondCancel = await adminPost(orderA.id, "cancel", { reason: "again" });
    expect(secondCancel.status).toBe(422);

    // (b) At APPROVED: ORDER_RESTORE returns the deducted units; the
    // issued invoice remains as the accounting record.
    const pB = await adminCreateProduct("cancelx", 5);
    const orderB = await placeOrder(pB.id, 2, `cancelx-${runId}`);
    const approved = await adminPost(orderB.id, "approve");
    expect(approved.status).toBe(200);
    expect(await productStock(pB.id)).toBe(3);
    const cancelB = await adminPost(orderB.id, "cancel", {
      reason: "Duplicate order",
    });
    expect(cancelB.status).toBe(200);
    expect(await productStock(pB.id)).toBe(5);
    expect(await publicAvailability(pB.slug)).toBe(5);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = 'ORDER_RESTORE'",
        [orderB.id],
      ),
    ).toBe(1);
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", [orderB.id]),
    ).toBe(1); // invoice NOT deleted

    // (c) Reject: reason required (400 without), then succeeds.
    const orderC = await placeOrder(pB.id, 1, `reject-${runId}`);
    const noReason = await adminPost(orderC.id, "reject", {});
    expect(noReason.status).toBe(400);
    const rejected = await adminPost(orderC.id, "reject", {
      reason: "Cannot fulfil",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.order.status).toBe("CANCELLED");
    expect(await publicAvailability(pB.slug)).toBe(5);
  }, 120000);

  it("5) forbidden transitions are 422; the happy order walks the full lifecycle", async () => {
    const orderId = state.happyOrderId!;
    const deliverEarly = await adminPost(orderId, "deliver");
    expect(deliverEarly.status).toBe(422);
    expect(deliverEarly.body.error.code).toBe("INVALID_STATE_TRANSITION");
    const shipEarly = await adminPost(orderId, "ship"); // APPROVED, not PROCESSING
    expect(shipEarly.status).toBe(422);

    expect((await adminPost(orderId, "process")).status).toBe(200);
    expect((await adminPost(orderId, "deliver")).status).toBe(422); // not shipped yet
    expect((await adminPost(orderId, "ship")).status).toBe(200);
    const cancelShipped = await adminPost(orderId, "cancel", { reason: "too late" });
    expect(cancelShipped.status).toBe(422);
    expect((await adminPost(orderId, "deliver")).status).toBe(200);
    const cancelDelivered = await adminPost(orderId, "cancel", { reason: "too late" });
    expect(cancelDelivered.status).toBe(422);
    const approveAgain = await adminPost(orderId, "approve");
    expect(approveAgain.status).toBe(422);

    // Approving a CANCELLED order is equally forbidden (fresh order).
    const product = await adminCreateProduct("forbid", 3);
    const order = await placeOrder(product.id, 1, `forbid-${runId}`);
    expect(
      (await adminPost(order.id, "cancel", { reason: "no longer needed" })).status,
    ).toBe(200);
    const approveCancelled = await adminPost(order.id, "approve");
    expect(approveCancelled.status).toBe(422);
    expect(approveCancelled.body.error.code).toBe("INVALID_STATE_TRANSITION");
  }, 120000);

  it("6) a template edit never rewrites an issued invoice; the next approval pins the new version", async () => {
    const invoiceId = state.happyInvoiceId!;
    const before = await getBinary(
      state.admin!,
      `/api/admin/invoices/${invoiceId}/download`,
    );
    expect(before.status).toBe(200);
    expect(before.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const current = await state
      .admin!.get("/api/admin/invoice-template")
      .set("X-CSRF-Token", state.adminCsrf!);
    expect(current.status).toBe(200);
    const cfg = current.body.data.activeVersion.config as Record<string, any>;
    const updated = await state
      .admin!.put("/api/admin/invoice-template")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        name: current.body.data.template.name,
        isActive: true,
        config: {
          ...cfg,
          invoicePrefix: "BOD",
          footerText: "CHANGED FOOTER — must not rewrite issued invoices",
        },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.activeVersion.versionNo).toBe(2);

    const after = await getBinary(
      state.admin!,
      `/api/admin/invoices/${invoiceId}/download`,
    );
    expect(after.status).toBe(200);
    expect(after.body.equals(before.body)).toBe(true); // byte-identical

    // The NEXT approval pins version 2 and the BOD prefix.
    const product = await adminCreateProduct("tmpl", 3);
    const order = await placeOrder(product.id, 1, `tmpl-${runId}`);
    const approved = await adminPost(order.id, "approve");
    expect(approved.status).toBe(200);
    const invoice = approved.body.data.invoice as InvoiceViewBody;
    expect(invoice.invoiceNumber).toMatch(/^BOD-\d{4}-\d{5}$/);
    const detail = await state
      .admin!.get(`/api/admin/invoices/${invoice.id}`)
      .set("X-CSRF-Token", state.adminCsrf!);
    expect(detail.status).toBe(200);
    expect(detail.body.data.snapshot.template.versionNo).toBe(2);
    expect(detail.body.data.snapshot.template.config.footerText).toContain(
      "CHANGED FOOTER",
    );
  }, 120000);

  it("7) IDOR: another customer's invoice metadata and PDF are 404; admin routes deny customers", async () => {
    const orderId = state.happyOrderId!;
    const metaB = await state.custB!.get(`/api/orders/${orderId}/invoice`);
    expect(metaB.status).toBe(404);
    const pdfB = await getBinary(state.custB!, `/api/orders/${orderId}/invoice.pdf`);
    expect(pdfB.status).toBe(404);

    const metaA = await state.custA!.get(`/api/orders/${orderId}/invoice`);
    expect(metaA.status).toBe(200);
    expect(metaA.body.data.invoiceNumber).toBe(state.happyInvoiceNumber);
    const pdfA = await getBinary(state.custA!, `/api/orders/${orderId}/invoice.pdf`);
    expect(pdfA.status).toBe(200);
    expect(pdfA.contentType).toContain("application/pdf");
    expect(pdfA.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const adminList = await state.custA!.get("/api/admin/orders");
    expect(adminList.status).toBe(403);
  }, 120000);

  it("8) the invoice PDF text carries the Part 12 essentials", async () => {
    const pdf = await getBinary(
      state.custA!,
      `/api/orders/${state.happyOrderId}/invoice.pdf`,
    );
    expect(pdf.status).toBe(200);
    const text = pdfText(pdf.body);
    expect(text).toContain(state.happyInvoiceNumber!);
    expect(text).toContain(state.happyOrderNumber!);
    expect(text).toContain("Phase Seven happy");
    expect(text).toContain(
      formatMoney((state.happyGrandTotalPaisa! / 100).toFixed(2)),
    );
    expect(text).toContain("Bodhisattva International");
  }, 120000);

  it("9) dead-letter after 5 failed attempts, then manual resend recovers delivery", async () => {
    const product = await adminCreateProduct("dead", 3);
    const order = await placeOrder(product.id, 1, `dead-${runId}`);
    setTransportForTesting(
      nodemailer.createTransport({
        host: "127.0.0.1",
        port: 59999,
        connectionTimeout: 1000,
        greetingTimeout: 1000,
        socketTimeout: 2000,
      }),
    );
    try {
      const approved = await adminPost(order.id, "approve");
      expect(approved.status).toBe(200);
      const invoice = approved.body.data.invoice as InvoiceViewBody;
      // Drive the row through its backoff schedule with a fake clock
      // (1m/5m/30m/2h — the 5th failure dead-letters). The offsets
      // escalate aggressively because the opportunistic drain's first
      // attempt lands asynchronously: whenever it completes, the next
      // fake-clock drain is already past any backoff it scheduled.
      const base = Date.now();
      let row: { status: string; attempts: number } | null = null;
      for (const offsetSec of [61, 10_000, 40_000, 160_000, 640_000, 2_560_000]) {
        await drainOutbox(
          { db: handle.db, config },
          { workerId: "test-dead", now: new Date(base + offsetSec * 1000) },
        );
        row = await sqlOne<{ status: string; attempts: number }>(
          "SELECT status, attempts FROM email_outbox WHERE type = 'INVOICE' AND related_type = 'invoice' AND related_id = ? ORDER BY id DESC LIMIT 1",
          [invoice.id],
        );
        if (row?.status === "DEAD") break;
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(row).toBeTruthy();
      expect(row!.status).toBe("DEAD");
      expect(row!.attempts).toBe(5);
      const dead = await sqlOne<{ email_status: string }>(
        "SELECT email_status FROM invoices WHERE id = ?",
        [invoice.id],
      );
      expect(dead!.email_status).toBe("FAILED");

      // Manual resend enqueues a fresh row; with the transport back,
      // delivery completes and the invoice flips back to SENT.
      const resend = await state
        .admin!.post(`/api/admin/orders/${order.id}/invoice/resend`)
        .set("X-CSRF-Token", state.adminCsrf!)
        .send({});
      expect(resend.status).toBe(200);
      setTransportForTesting(undefined);
      await drainOutbox(
        { db: handle.db, config },
        { workerId: "test-resend", now: new Date() },
      );
      const mail = await waitForMail(
        (text) => mailFor(EMAIL_A)(text) && text.includes(invoice.invoiceNumber),
      );
      expect(mail).toContain("JVBERi");
      const revived = await sqlOne<{ email_status: string }>(
        "SELECT email_status FROM invoices WHERE id = ?",
        [invoice.id],
      );
      expect(revived!.email_status).toBe("SENT");
    } finally {
      setTransportForTesting(undefined);
    }
  }, 120000);

  it("10) the admin pending queue is oldest-first and carries age", async () => {
    const product = await adminCreateProduct("queue", 10);
    const first = await placeOrder(product.id, 1, `queue1-${runId}`);
    // Keep the two placedAt timestamps distinct so the ASC order is
    // decided by time, not by storage order.
    await new Promise((r) => setTimeout(r, 60));
    const second = await placeOrder(product.id, 1, `queue2-${runId}`);
    const res = await state
      .admin!.get("/api/admin/orders?status=PENDING_APPROVAL&pageSize=50")
      .set("X-CSRF-Token", state.adminCsrf!);
    expect(res.status).toBe(200);
    const items = res.body.data as { id: number; ageMs: number }[];
    const ids = items.map((item) => item.id);
    expect(ids.indexOf(first.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    const firstItem = items.find((item) => item.id === first.id)!;
    expect(typeof firstItem.ageMs).toBe("number");
    expect(firstItem.ageMs).toBeGreaterThanOrEqual(0);
  }, 120000);

  it("11) audit log endpoint: audit.read gate + filters (Phase 7b)", async () => {
    type AuditItem = {
      id: number;
      actorId: number | null;
      actorEmail: string | null;
      actorRole: string | null;
      action: string;
      targetType: string | null;
      targetId: number | null;
      result: string;
      ipAddress: string | null;
      createdAt: string;
    };
    const asAdmin = (path: string) =>
      state.admin!.get(path).set("X-CSRF-Token", state.adminCsrf!);

    // The earlier tests wrote order-transition audit rows.
    const all = await asAdmin("/api/admin/audit-logs?pageSize=50");
    expect(all.status).toBe(200);
    const items = all.body.data as AuditItem[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.action === "store.orders.approve")).toBe(true);
    // Newest-first ordering.
    const stamps = items.map((item) => new Date(item.createdAt).getTime());
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);

    // Action prefix filter doubles as the module filter.
    const byAction = await asAdmin("/api/admin/audit-logs?action=store.orders&pageSize=50");
    expect(byAction.status).toBe(200);
    const actionItems = byAction.body.data as AuditItem[];
    expect(actionItems.length).toBeGreaterThan(0);
    expect(actionItems.every((item) => item.action.startsWith("store.orders"))).toBe(true);

    // Result filter: the suite's customer-on-admin probes were DENIED.
    const denied = await asAdmin("/api/admin/audit-logs?result=DENIED&pageSize=50");
    expect(denied.status).toBe(200);
    const deniedItems = denied.body.data as AuditItem[];
    expect(deniedItems.length).toBeGreaterThan(0);
    expect(deniedItems.every((item) => item.result === "DENIED")).toBe(true);

    // Actor filter by id pins every row to the Super Admin.
    const byActor = await asAdmin(
      `/api/admin/audit-logs?actor=${state.adminUserId}&pageSize=50`,
    );
    expect(byActor.status).toBe(200);
    const actorItems = byActor.body.data as AuditItem[];
    expect(actorItems.length).toBeGreaterThan(0);
    expect(actorItems.every((item) => item.actorId === state.adminUserId)).toBe(true);

    // Customers hold no audit.read → 403; anonymous → 401.
    const asCustomer = await state
      .custA!.get("/api/admin/audit-logs")
      .set("X-CSRF-Token", state.csrfA!);
    expect(asCustomer.status).toBe(403);
    const anon = await request(app).get("/api/admin/audit-logs");
    expect(anon.status).toBe(401);
  }, 120000);
});
