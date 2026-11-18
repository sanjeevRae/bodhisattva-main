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
 * Phase 8 additions (Phase 6/7 review carry-overs):
 *  12. THREE concurrent approvals → still exactly one invoice and one
 *      deduction set (the adopted Phase 8 stress widening of test 2);
 *  13. approve races cancel/reject → exactly one consistent end
 *      state, never partial movements (three legal paths asserted);
 *  14. two racing drainOutbox() passes deliver each email exactly
 *      once, and a stale worker's late completion is fenced out by
 *      lease_version (its write lands on 0 rows; the newer claim's
 *      SENT state stands);
 *  15. credit notes: a post-approval cancel issues CN-<year>-<5-digit>
 *      in the cancel transaction, mirrors the invoice totals, emails
 *      the customer with the PDF, appears on the admin + customer
 *      invoice reads, audits store.invoices.credit_note — and a
 *      pre-approval cancel creates none.
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
      .send({ name, email, password, phone: "+9779812345678" });
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
    await pool.query("DELETE FROM credit_notes");
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
        phone: "+9779800000001",
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

  // ---------------------------------------------------------------------
  // Phase 8 — concurrency stress + credit notes + outbox fencing
  // ---------------------------------------------------------------------

  async function movementCount(orderId: number, type: string): Promise<number> {
    return sqlCount(
      "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = ?",
      [orderId, type],
    );
  }

  async function orderStatus(orderId: number): Promise<string> {
    const row = await sqlOne<{ status: string }>(
      "SELECT status FROM orders WHERE id = ?",
      [orderId],
    );
    return row!.status;
  }

  it("12) THREE concurrent approvals: exactly one 200, one invoice, one deduction set", async () => {
    const product = await adminCreateProduct("race3", 6);
    const order = await placeOrder(product.id, 2, `race3-${runId}`);
    const results = await Promise.all([
      adminPost(order.id, "approve"),
      adminPost(order.id, "approve"),
      adminPost(order.id, "approve"),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 422, 422]);
    for (const loser of results.filter((r) => r.status === 422)) {
      expect(loser.body.error.code).toBe("INVALID_STATE_TRANSITION");
    }
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", [order.id]),
    ).toBe(1);
    expect(await movementCount(order.id, "ORDER_DEDUCT")).toBe(1);
    expect(await movementCount(order.id, "RELEASE")).toBe(1);
    expect(await productStock(product.id)).toBe(4);
    expect(await orderStatus(order.id)).toBe("APPROVED");
  }, 120000);

  it("13a) approve vs reject race: exactly one wins, consistent end state", async () => {
    const product = await adminCreateProduct("raceavsr", 10);
    const order = await placeOrder(product.id, 2, `raceavsr-${runId}`);
    // Reject is only legal from PENDING_APPROVAL, so exactly one of
    // the two transitions can ever commit — no interleaving produces
    // a mixed state.
    const [approveRes, rejectRes] = await Promise.all([
      adminPost(order.id, "approve"),
      adminPost(order.id, "reject", { reason: "Race reject" }),
    ]);
    const statuses = [approveRes.status, rejectRes.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 422]);
    const invoices = await sqlCount(
      "SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?",
      [order.id],
    );
    if (approveRes.status === 200) {
      expect(await orderStatus(order.id)).toBe("APPROVED");
      expect(invoices).toBe(1);
      expect(await movementCount(order.id, "ORDER_DEDUCT")).toBe(1);
      expect(await movementCount(order.id, "RELEASE")).toBe(1); // approve's pair
      expect(await movementCount(order.id, "ORDER_RESTORE")).toBe(0);
      expect(await productStock(product.id)).toBe(8);
    } else {
      expect(await orderStatus(order.id)).toBe("CANCELLED");
      expect(invoices).toBe(0);
      expect(await movementCount(order.id, "ORDER_DEDUCT")).toBe(0);
      expect(await movementCount(order.id, "RELEASE")).toBe(1); // reservation released
      expect(await movementCount(order.id, "ORDER_RESTORE")).toBe(0);
      expect(await productStock(product.id)).toBe(10);
      expect(await publicAvailability(product.slug)).toBe(10);
    }
    // No credit note either way: reject never has an invoice, and a
    // winning approve leaves the order APPROVED.
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM credit_notes WHERE order_id = ?", [order.id]),
    ).toBe(0);
  }, 120000);

  it("13b) approve vs cancel race: one of the three legal end paths, never partial", async () => {
    const product = await adminCreateProduct("raceavsc", 10);
    const order = await placeOrder(product.id, 2, `raceavsc-${runId}`);
    // Cancel is legal from PENDING_APPROVAL *and* APPROVED, so three
    // end paths are legal — the race must land on exactly one of
    // them, with movement counts matching that path precisely.
    const [approveRes, cancelRes] = await Promise.all([
      adminPost(order.id, "approve"),
      adminPost(order.id, "cancel", { reason: "Race cancel" }),
    ]);
    expect(approveRes.status === 200 || cancelRes.status === 200).toBe(true);
    const status = await orderStatus(order.id);
    const invoices = await sqlCount(
      "SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?",
      [order.id],
    );
    const creditNotes = await sqlCount(
      "SELECT COUNT(*) AS c FROM credit_notes WHERE order_id = ?",
      [order.id],
    );
    const deduct = await movementCount(order.id, "ORDER_DEDUCT");
    const release = await movementCount(order.id, "RELEASE");
    const restore = await movementCount(order.id, "ORDER_RESTORE");
    if (cancelRes.status === 200 && approveRes.status !== 200) {
      // Path A — cancel won outright from PENDING_APPROVAL.
      expect(status).toBe("CANCELLED");
      expect(invoices).toBe(0);
      expect(creditNotes).toBe(0);
      expect([deduct, release, restore]).toEqual([0, 1, 0]);
      expect(await productStock(product.id)).toBe(10);
      expect(await publicAvailability(product.slug)).toBe(10);
    } else if (approveRes.status === 200 && cancelRes.status !== 200) {
      // Path B — approve won; the cancel then 422'd.
      expect(cancelRes.status).toBe(422);
      expect(status).toBe("APPROVED");
      expect(invoices).toBe(1);
      expect(creditNotes).toBe(0);
      expect([deduct, release, restore]).toEqual([1, 1, 0]);
      expect(await productStock(product.id)).toBe(8);
    } else {
      // Path C — approve committed first, then the cancel legally ran
      // from APPROVED: invoice issued AND credited, stock restored.
      expect(approveRes.status).toBe(200);
      expect(cancelRes.status).toBe(200);
      expect(status).toBe("CANCELLED");
      expect(invoices).toBe(1);
      expect(creditNotes).toBe(1);
      expect([deduct, release, restore]).toEqual([1, 1, 1]);
      expect(await productStock(product.id)).toBe(10);
      expect(await publicAvailability(product.slug)).toBe(10);
    }
  }, 120000);

  it("14) racing drains deliver exactly once; a stale worker is fenced out", async () => {
    // -- Part 1: two racing drainOutbox() passes over the same rows.
    const invoiceIds: number[] = [];
    const failingTransport = nodemailer.createTransport({
      host: "127.0.0.1",
      port: 59999,
      connectionTimeout: 1000,
      greetingTimeout: 1000,
      socketTimeout: 2000,
    });
    setTransportForTesting(failingTransport);
    try {
      for (const suffix of ["drain-a", "drain-b", "drain-c"]) {
        const product = await adminCreateProduct(suffix, 5);
        const order = await placeOrder(product.id, 1, `${suffix}-${runId}`);
        const res = await adminPost(order.id, "approve");
        expect(res.status).toBe(200);
        invoiceIds.push((res.body.data.invoice as InvoiceViewBody).id);
      }
      // Wait until the opportunistic drains have attempted (and
      // failed) every invoice row, so all three sit PENDING.
      const deadline = Date.now() + 30000;
      for (;;) {
        const pending = await sqlCount(
          "SELECT COUNT(*) AS c FROM email_outbox WHERE type = 'INVOICE' AND related_id IN (?, ?, ?) AND status = 'PENDING' AND attempts >= 1",
          invoiceIds,
        );
        if (pending === 3) break;
        if (Date.now() > deadline) throw new Error("invoice rows never attempted");
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setTransportForTesting(undefined);
    }
    const rowIds = new Map<number, number>();
    for (const invoiceId of invoiceIds) {
      const row = await sqlOne<{ id: number }>(
        "SELECT id FROM email_outbox WHERE type = 'INVOICE' AND related_id = ? ORDER BY id DESC LIMIT 1",
        [invoiceId],
      );
      rowIds.set(invoiceId, row!.id);
    }
    // The mailbox persists across suite runs and invoice numbers
    // restart from the wiped sequence, so scope delivery assertions
    // to mail that arrives from this point on.
    const mailboxBefore = new Set(mailboxTexts());
    const [drain1, drain2] = await Promise.all([
      drainOutbox({ db: handle.db, config }, { workerId: "race-1", now: new Date(Date.now() + 120_000) }),
      drainOutbox({ db: handle.db, config }, { workerId: "race-2", now: new Date(Date.now() + 120_000) }),
    ]);
    // The two passes may also pick up unrelated due rows from earlier
    // tests (the ORDER_CONFIRMED mails of these very checkouts), so
    // the exactly-once guarantee is asserted per invoice row below —
    // the sink count is the evidence that matters.
    expect(drain1.sent + drain2.sent).toBeGreaterThanOrEqual(3);
    // Settle, then count deliveries per invoice in the sink: exactly
    // one each, carrying the deterministic per-row Message-ID.
    await new Promise((r) => setTimeout(r, 750));
    const texts = mailboxTexts().filter((t) => !mailboxBefore.has(t));
    for (const invoiceId of invoiceIds) {
      const invoiceRow = await sqlOne<{ invoice_number: string }>(
        "SELECT invoice_number FROM invoices WHERE id = ?",
        [invoiceId],
      );
      const delivered = texts.filter((t) => t.includes(invoiceRow!.invoice_number));
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toContain(
        `Message-ID: <outbox-${rowIds.get(invoiceId)}@localhost>`,
      );
      const outboxRow = await sqlOne<{ status: string; lease_version: number }>(
        "SELECT status, lease_version FROM email_outbox WHERE id = ?",
        [rowIds.get(invoiceId)],
      );
      expect(outboxRow!.status).toBe("SENT");
      expect(Number(outboxRow!.lease_version)).toBeGreaterThanOrEqual(1);
    }

    // -- Part 2: fencing — a worker whose send outlives its lease
    // cannot record the outcome; the recovering worker's state stands.
    // Flush anything still due so the probe row is the only candidate.
    await drainOutbox({ db: handle.db, config }, { workerId: "settle" });
    const [inserted] = await handle.pool.query(
      "INSERT INTO email_outbox (type, recipient_email, subject, template_data, status) VALUES ('ORDER_SHIPPED', ?, 'Fencing probe', ?, 'PENDING')",
      [EMAIL_A, JSON.stringify({ text: "probe" })],
    );
    const probeId = Number((inserted as { insertId: number }).insertId);

    const base = nodemailer.createTransport({ host: "127.0.0.1", port: 1025 });
    const originalSend = base.sendMail.bind(base);
    let sendCalls = 0;
    let releaseFirstSend: (() => void) | null = null;
    base.sendMail = (async (message: unknown) => {
      sendCalls += 1;
      if (sendCalls === 1) {
        // Worker A's send hangs (a stuck SMTP session) until the test
        // releases it — long past the point where B recovers the row.
        await new Promise<void>((resolve) => {
          releaseFirstSend = resolve;
          setTimeout(resolve, 15000);
        });
      }
      return originalSend(message as never);
    }) as typeof base.sendMail;
    setTransportForTesting(base);
    try {
      const drainA = drainOutbox(
        { db: handle.db, config },
        { workerId: "fence-a" },
      );
      // Wait for A to claim the probe (lease_version 1) and start sending.
      const claimDeadline = Date.now() + 20000;
      for (;;) {
        const row = await sqlOne<{ status: string; claimed_by: string | null; lease_version: number }>(
          "SELECT status, claimed_by, lease_version FROM email_outbox WHERE id = ?",
          [probeId],
        );
        if (
          row?.status === "PROCESSING" &&
          row.claimed_by === "fence-a" &&
          sendCalls >= 1
        ) {
          expect(Number(row.lease_version)).toBe(1);
          break;
        }
        if (Date.now() > claimDeadline) throw new Error("worker A never claimed the probe row");
        await new Promise((r) => setTimeout(r, 100));
      }
      // Age A's claim past the 5-minute lease, then let B drain: B
      // recovers the row (version 2), claims it (version 3) and sends.
      await handle.pool.query(
        "UPDATE email_outbox SET claimed_at = DATE_SUB(NOW(3), INTERVAL 6 MINUTE) WHERE id = ?",
        [probeId],
      );
      const drainBResult = await drainOutbox(
        { db: handle.db, config },
        { workerId: "fence-b" },
      );
      // B sent the probe (it may also flush an unrelated due row);
      // the probe's own row state below is the fencing evidence.
      expect(drainBResult.sent).toBeGreaterThanOrEqual(1);
      // A's stuck send finally completes; its SENT write is fenced.
      releaseFirstSend!();
      const drainAResult = await drainA;
      expect(drainAResult.sent).toBe(0);
      const finalRow = await sqlOne<{ status: string; lease_version: number; attempts: number }>(
        "SELECT status, lease_version, attempts FROM email_outbox WHERE id = ?",
        [probeId],
      );
      expect(finalRow!.status).toBe("SENT"); // B's state, never clobbered
      expect(Number(finalRow!.lease_version)).toBe(3); // claim, recover, claim
      expect(Number(finalRow!.attempts)).toBe(2);
    } finally {
      setTransportForTesting(undefined);
    }
  }, 180000);

  it("15) credit notes: post-approval cancel issues, emails and exposes the note", async () => {
    const product = await adminCreateProduct("crednote", 5);
    const order = await placeOrder(product.id, 2, `crednote-${runId}`);
    const approved = await adminPost(order.id, "approve");
    expect(approved.status).toBe(200);
    const invoice = approved.body.data.invoice as InvoiceViewBody;

    const cancelled = await adminPost(order.id, "cancel", {
      reason: "Customer asked to cancel",
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.status).toBe("CANCELLED");

    // The note exists, mirrors the invoice totals, and its snapshot
    // is re-marked as a credit-note document.
    const note = await sqlOne<{
      id: number;
      credit_note_number: string;
      invoice_id: number;
      grand_total: string;
      reason: string;
      snapshot: unknown;
    }>(
      "SELECT id, credit_note_number, invoice_id, grand_total, reason, snapshot FROM credit_notes WHERE order_id = ?",
      [order.id],
    );
    expect(note).toBeTruthy();
    expect(note!.credit_note_number).toMatch(/^CN-\d{4}-\d{5}$/);
    expect(Number(note!.invoice_id)).toBe(invoice.id);
    expect(Number(note!.grand_total)).toBe(invoice.grandTotalPaisa / 100);
    expect(note!.reason).toBe("Customer asked to cancel");
    const snap = (typeof note!.snapshot === "string"
      ? JSON.parse(note!.snapshot)
      : note!.snapshot) as Record<string, any>;
    expect(snap.documentType).toBe("CREDIT_NOTE");
    expect(snap.creditNoteNumber).toBe(note!.credit_note_number);
    expect(snap.originalInvoiceNumber).toBe(invoice.invoiceNumber);
    expect(snap.totals.grandTotal).toBe((invoice.grandTotalPaisa / 100).toFixed(2));
    // At most one note per invoice (the unique constraint's effect).
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM credit_notes WHERE invoice_id = ?", [invoice.id]),
    ).toBe(1);
    // Creation was audited.
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'store.invoices.credit_note' AND target_id = ?",
        [note!.id],
      ),
    ).toBe(1);

    // Customer reads: invoice metadata carries the summary; the PDF
    // downloads for the owner and 404s for another customer.
    const meta = await state
      .custA!.get(`/api/orders/${order.id}/invoice`)
      .set("X-CSRF-Token", state.csrfA!);
    expect(meta.status).toBe(200);
    expect(meta.body.data.creditNote).toBeTruthy();
    expect(meta.body.data.creditNote.creditNoteNumber).toBe(note!.credit_note_number);
    expect(meta.body.data.creditNote.downloadPath).toBe(
      `/api/orders/${order.id}/credit-note.pdf`,
    );
    const ownPdf = await getBinary(
      state.custA!,
      `/api/orders/${order.id}/credit-note.pdf`,
    );
    expect(ownPdf.status).toBe(200);
    expect(ownPdf.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const cnText = pdfText(ownPdf.body);
    expect(cnText).toContain("CREDIT NOTE");
    expect(cnText).toContain(note!.credit_note_number);
    expect(cnText).toContain(invoice.invoiceNumber);
    const otherPdf = await getBinary(
      state.custB!,
      `/api/orders/${order.id}/credit-note.pdf`,
    );
    expect(otherPdf.status).toBe(404);

    // Admin reads: invoice detail carries the summary; the admin PDF
    // route streams the same document.
    const adminDetail = await state
      .admin!.get(`/api/admin/invoices/${invoice.id}`)
      .set("X-CSRF-Token", state.adminCsrf!);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data.creditNote.creditNoteNumber).toBe(
      note!.credit_note_number,
    );
    const adminPdf = await getBinary(
      state.admin!,
      `/api/admin/invoices/${invoice.id}/credit-note.pdf`,
    );
    expect(adminPdf.status).toBe(200);
    expect(adminPdf.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // The customer was emailed the credit note with its PDF attached.
    const mail = await waitForMail(
      (text) => mailFor(EMAIL_A)(text) && text.includes(note!.credit_note_number),
    );
    expect(mail).toContain("credited in full");
    expect(mail).toContain("JVBERi");

    // A pre-approval cancel creates NO credit note (no invoice yet).
    const plain = await placeOrder(product.id, 1, `nocrednote-${runId}`);
    const plainCancel = await adminPost(plain.id, "cancel", { reason: "Too early" });
    expect(plainCancel.status).toBe(200);
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM credit_notes WHERE order_id = ?", [plain.id]),
    ).toBe(0);
    const noNotePdf = await getBinary(
      state.custA!,
      `/api/orders/${plain.id}/credit-note.pdf`,
    );
    expect(noNotePdf.status).toBe(404);
  }, 120000);
});
