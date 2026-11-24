/**
 * Phase 6 integration suite — the Gift Shop ecommerce exit gate
 * (DEVELOPMENT_ROADMAP.md §8).
 *
 * Runs the REAL app against a REAL MariaDB (`bodhisattva_test_store`,
 * its own database like the other suites) with the REAL seeded catalogue
 * (the suite wipes the store + identity tables, runs the actual migrate
 * and seed CLIs, bootstraps a Super Admin and registers customers
 * through the real auth endpoints, reading OTPs from the SMTP sink).
 *
 * Exercises the exit-gate list: anonymous browsing, login-gated cart
 * that persists across sessions, stock validation on add/PATCH,
 * server-recalculated checkout totals (client prices ignored),
 * price/name snapshots immune to later admin edits, reservations
 * (A1), the two-customers-one-unit concurrency race, idempotent
 * checkout replays (A2), failed-checkout atomicity, cross-customer
 * ownership 404s, admin inventory adjustments bounded by reservations,
 * and the store.* settings scope.
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import {
  roles as rolesTable,
  userRoles,
  users,
} from "../src/database/schema/index.js";
import { hashPassword } from "../src/utils/password.js";
import {
  createDatabase,
  type DatabaseHandle,
} from "../src/database/client.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/store-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_store";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `store-root-${runId}@example.com`;
const ROOT_PASSWORD = "store-root-pass-123";
const EMAIL_A = `store-cust-a-${runId}@example.com`;
const EMAIL_B = `store-cust-b-${runId}@example.com`;
const PASSWORD_A = "store-customer-a-pass";
const PASSWORD_B = "store-customer-b-pass";

// ---------------------------------------------------------------------------
// Mail helpers (mirrors the auth suite: nodemailer writes quoted-printable)
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
  const anchored = text.match(/verification code is:\s*(\d{8})/);
  if (anchored) return anchored[1];
  const body = text.split(/\r?\n\r?\n/).slice(1).join("\n");
  const m = body.match(/\b(\d{8})\b/);
  if (!m) throw new Error("no 8-digit code found in mail body");
  return m[1];
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

type Agent = ReturnType<typeof request.agent>;

interface ShopItem {
  id: number;
  slug: string;
  sku: string | null;
  pricePaisa: number;
  salePricePaisa: number | null;
  effectivePricePaisa: number;
  categorySlug: string | null;
  image: { url: string; alt: string } | null;
  availableQty: number;
  inStock: boolean;
}

interface OrderBody {
  id: number;
  orderNumber: string;
  status: string;
  subtotalPaisa: number;
  shippingFeePaisa: number;
  taxTotalPaisa: number;
  grandTotalPaisa: number;
  items: {
    productId: number | null;
    name: string;
    unitPricePaisa: number;
    quantity: number;
    lineTotalPaisa: number;
  }[];
}

describe.skipIf(!RUN)("Phase 6 store flows (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const state: {
    admin?: Agent;
    adminCsrf?: string;
    custA?: Agent;
    csrfA?: string;
    custB?: Agent;
    csrfB?: string;
    bod001Id?: number;
    bod001Slug?: string;
    addressAId?: number;
    orderAId?: number;
    scarceId?: number;
    scarceOrderId?: number;
    raceId?: number;
    roleAdmin?: Agent;
    roleAdminCsrf?: string;
    storeAdmin?: Agent;
    storeAdminCsrf?: string;
  } = {};

  async function sqlCount(sql: string, params: unknown[]): Promise<number> {
    const [rows] = await handle.pool.query(sql, params);
    const list = rows as { c: number | string }[];
    return Number(list[0]?.c ?? 0);
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

  async function adminCreateProduct(body: Record<string, unknown>) {
    const res = await state
      .admin!.post("/api/admin/products")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.data as { id: number; slug: string };
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
    // Wipe store + identity state (FK-safe order), then migrate + seed
    // for real so the suite is self-contained.
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
    // Checkout now enqueues order-placed emails (recipient_user_id →
    // users): the outbox must be wiped before the identity tables.
    await pool.query("DELETE FROM email_outbox");
    await pool.query("DELETE FROM user_roles");
    await pool.query("DELETE FROM user_sessions");
    await pool.query("DELETE FROM email_verification_codes");
    await pool.query("DELETE FROM password_reset_tokens");
    await pool.query("DELETE FROM invitations");
    await pool.query("DELETE FROM mfa_recovery_codes");
    await pool.query("DELETE FROM mfa_credentials");
    await pool.query("DELETE FROM audit_logs");
    await pool.query("DELETE FROM rate_limits");
    // site_settings.updated_by references users (set by the settings
    // test in a previous run) — detach before the identity wipe.
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
    await handle.close();
  });

  it("bootstraps a Super Admin and reaches a full MFA session", async () => {
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "Store Root",
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
  }, 120000);

  it("serves the seeded catalogue anonymously; drafts and archived products 404", async () => {
    const list = await request(app).get("/api/shop/products?pageSize=100");
    expect(list.status).toBe(200);
    const items = list.body.data as ShopItem[];
    expect(items).toHaveLength(12);
    expect(list.body.meta.total).toBe(12);
    const bod001 = items.find((item) => item.sku === "BOD-001");
    expect(bod001).toBeTruthy();
    expect(bod001!.pricePaisa).toBe(450000);
    expect(bod001!.salePricePaisa).toBeNull();
    expect(bod001!.effectivePricePaisa).toBe(450000);
    expect(bod001!.categorySlug).toBe("paintings");
    expect(bod001!.image?.url).toContain("images.unsplash.com");
    expect(bod001!.availableQty).toBe(10);
    expect(bod001!.inStock).toBe(true);
    state.bod001Id = bod001!.id;
    state.bod001Slug = bod001!.slug;

    const categories = await request(app).get("/api/shop/categories");
    expect(categories.status).toBe(200);
    const cats = categories.body.data.items as {
      slug: string;
      productCount: number;
    }[];
    expect(cats).toHaveLength(5);
    expect(cats.reduce((sum, c) => sum + c.productCount, 0)).toBe(12);

    const books = await request(app).get("/api/shop/products?category=books");
    expect(books.status).toBe(200);
    expect((books.body.data as ShopItem[]).length).toBeGreaterThan(0);
    expect(
      (books.body.data as ShopItem[]).every(
        (item) => item.categorySlug === "books",
      ),
    ).toBe(true);

    const detail = await request(app).get(
      `/api/shop/products/${state.bod001Slug}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(state.bod001Id);
    expect(detail.body.data.images).toHaveLength(1);
    expect(detail.body.data.variants).toEqual([]);

    const configRes = await request(app).get("/api/shop/config");
    expect(configRes.status).toBe(200);
    expect(configRes.body.data.currency).toBe("NPR");
    expect(configRes.body.data.codEnabled).toBe(true);

    // A DRAFT product is invisible publicly.
    const draft = await adminCreateProduct({
      slug: `draft-${runId}`,
      sku: `DRAFT-${runId}`,
      name: "Draft Relic",
      price: "10.00",
      status: "DRAFT",
      stockQty: 3,
    });
    const draftDetail = await request(app).get(
      `/api/shop/products/draft-${runId}`,
    );
    expect(draftDetail.status).toBe(404);

    // An archived product disappears publicly but stays in the admin.
    const temp = await adminCreateProduct({
      slug: `temp-${runId}`,
      sku: `TEMP-${runId}`,
      name: "Temporary Relic",
      price: "10.00",
      status: "ACTIVE",
      stockQty: 3,
    });
    const archived = await state
      .admin!.delete(`/api/admin/products/${temp.id}`)
      .set("X-CSRF-Token", state.adminCsrf!);
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("ARCHIVED");
    const goneDetail = await request(app).get(`/api/shop/products/temp-${runId}`);
    expect(goneDetail.status).toBe(404);
    expect(draft.id).toBeGreaterThan(0);
  });

  it("activate (un-archive): restores the product publicly, idempotent, one audit row, draft conflicts", async () => {
    const admin = state.admin!;
    const csrf = state.adminCsrf!;
    const product = await adminCreateProduct({
      slug: `reactivate-${runId}`,
      sku: `REACT-${runId}`,
      name: "Reactivated Relic",
      price: "25.00",
      status: "ACTIVE",
      stockQty: 4,
    });
    const archived = await admin
      .delete(`/api/admin/products/${product.id}`)
      .set("X-CSRF-Token", csrf);
    expect(archived.body.data.status).toBe("ARCHIVED");
    const gone = await request(app).get(`/api/shop/products/reactivate-${runId}`);
    expect(gone.status).toBe(404);

    // Two concurrent activations: both succeed, the row flips once.
    const [first, second] = await Promise.all([
      admin.post(`/api/admin/products/${product.id}/activate`).set("X-CSRF-Token", csrf),
      admin.post(`/api/admin/products/${product.id}/activate`).set("X-CSRF-Token", csrf),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.status).toBe("ACTIVE");
    const back = await request(app).get(`/api/shop/products/reactivate-${runId}`);
    expect(back.status).toBe(200);

    // Re-activating an ACTIVE product is an idempotent no-op — and after
    // all three calls there is still exactly ONE activation audit row.
    const again = await admin
      .post(`/api/admin/products/${product.id}/activate`)
      .set("X-CSRF-Token", csrf);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("ACTIVE");
    const auditCount = await sqlCount(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'store.products.activate' AND target_id = ?",
      [product.id],
    );
    expect(auditCount).toBe(1);

    // A draft cannot be activated — 409, and it stays a draft.
    const draftProduct = await adminCreateProduct({
      slug: `reactivate-draft-${runId}`,
      sku: `REACTD-${runId}`,
      name: "Draft Relic",
      price: "25.00",
      status: "DRAFT",
      stockQty: 1,
    });
    const draftAttempt = await admin
      .post(`/api/admin/products/${draftProduct.id}/activate`)
      .set("X-CSRF-Token", csrf);
    expect(draftAttempt.status).toBe(409);
    const draftAfter = await admin.get(`/api/admin/products/${draftProduct.id}`);
    expect(draftAfter.body.data.status).toBe("DRAFT");

    // Unknown product → 404. No session → rejected before any state
    // change: the CSRF layer refuses tokenless mutations with 403
    // (the same answer every admin mutation gives an anonymous caller).
    const missing = await admin
      .post("/api/admin/products/99999999/activate")
      .set("X-CSRF-Token", csrf);
    expect(missing.status).toBe(404);
    const anon = await request(app).post(`/api/admin/products/${product.id}/activate`);
    expect(anon.status).toBe(403);
    const stillActive = await admin.get(`/api/admin/products/${product.id}`);
    expect(stillActive.body.data.status).toBe("ACTIVE");
  });

  it("product image placement (0025): persists, validates, clears with the source", async () => {
    const admin = state.admin!;
    const csrf = state.adminCsrf!;
    const product = await adminCreateProduct({
      slug: `placement-${runId}`,
      sku: `PLC-${runId}`,
      name: "Placement Relic",
      price: "25.00",
      status: "ACTIVE",
      stockQty: 2,
    });
    const created = await admin
      .post(`/api/admin/products/${product.id}/images`)
      .set("X-CSRF-Token", csrf)
      .send({ imageUrl: "https://example.com/relic.jpg", altText: "Relic", isPrimary: true, sortOrder: 0 });
    expect(created.status).toBe(201);
    const imageId = created.body.data.id as number;
    expect(created.body.data.placement).toBeNull();

    // Unset placement: the key is ABSENT from the public DTOs.
    const pubBefore = await request(app).get(`/api/shop/products/placement-${runId}`);
    expect(pubBefore.status).toBe(200);
    expect(pubBefore.body.data.images).toHaveLength(1);
    expect("placement" in pubBefore.body.data.images[0]).toBe(false);
    expect("placement" in pubBefore.body.data.image).toBe(false);

    const placement = {
      desktop: { x: 30, y: 40, zoom: 1.6 },
      mobile: { x: 35, y: 45, zoom: 1.8 },
    };
    const patched = await admin
      .patch(`/api/admin/products/images/${imageId}`)
      .set("X-CSRF-Token", csrf)
      .send({ placement });
    expect(patched.status).toBe(200);
    expect(patched.body.data.placement).toMatchObject(placement);

    // Public detail images AND the list/detail primary image carry it.
    const pubAfter = await request(app).get(`/api/shop/products/placement-${runId}`);
    expect(pubAfter.body.data.images[0].placement).toMatchObject(placement);
    expect(pubAfter.body.data.image.placement).toMatchObject(placement);

    // Out-of-bounds placement is rejected by the shared schema.
    const invalid = await admin
      .patch(`/api/admin/products/images/${imageId}`)
      .set("X-CSRF-Token", csrf)
      .send({ placement: { desktop: { x: 30, y: 40, zoom: 99 } } });
    expect(invalid.status).toBe(400);

    // An unrelated update (alt text) preserves the placement.
    const altOnly = await admin
      .patch(`/api/admin/products/images/${imageId}`)
      .set("X-CSRF-Token", csrf)
      .send({ altText: "Relic II" });
    expect(altOnly.status).toBe(200);
    expect(altOnly.body.data.placement).toMatchObject(placement);

    // A source change without a placement clears it server-side.
    const sourceChange = await admin
      .patch(`/api/admin/products/images/${imageId}`)
      .set("X-CSRF-Token", csrf)
      .send({ imageUrl: "https://example.com/relic-2.jpg" });
    expect(sourceChange.status).toBe(200);
    expect(sourceChange.body.data.placement).toBeNull();

    // Set again, then an explicit null clears it.
    const setAgain = await admin
      .patch(`/api/admin/products/images/${imageId}`)
      .set("X-CSRF-Token", csrf)
      .send({ placement });
    expect(setAgain.body.data.placement).toMatchObject(placement);
    const cleared = await admin
      .patch(`/api/admin/products/images/${imageId}`)
      .set("X-CSRF-Token", csrf)
      .send({ placement: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.placement).toBeNull();
  });

  it("gates the cart behind login and persists it across logout + fresh login", async () => {
    const anonCart = await request(app).get("/api/cart");
    expect(anonCart.status).toBe(401);
    const anonOrders = await request(app).get("/api/orders");
    expect(anonOrders.status).toBe(401);
    const anonAddresses = await request(app).get("/api/addresses");
    expect(anonAddresses.status).toBe(401);
    // A session-less mutation never reaches the auth gate: the CSRF
    // layer rejects it first (403), as everywhere else in the app.
    const anonCheckout = await request(app)
      .post("/api/checkout")
      .send({ idempotencyKey: "anon" });
    expect(anonCheckout.status).toBe(403);

    const { agent, csrf } = await registerCustomer(
      EMAIL_A,
      PASSWORD_A,
      "Customer A",
    );
    state.custA = agent;
    state.csrfA = csrf;

    const added = await agent
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrf)
      .send({ productId: state.bod001Id, quantity: 1 });
    expect(added.status).toBe(200);
    expect(added.body.data.itemCount).toBe(1);

    const logout = await agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(logout.status).toBe(200);

    // A brand-new session (another "device") sees the same cart.
    const fresh = request.agent(app);
    const relogin = await fresh
      .post("/api/auth/login")
      .send({ email: EMAIL_A, password: PASSWORD_A });
    expect(relogin.status).toBe(200);
    state.custA = fresh;
    state.csrfA = relogin.body.csrfToken as string;
    const cart = await fresh.get("/api/cart");
    expect(cart.status).toBe(200);
    expect(cart.body.data.itemCount).toBe(1);
    expect(cart.body.data.items[0].productId).toBe(state.bod001Id);

    const cleared = await fresh
      .delete("/api/cart")
      .set("X-CSRF-Token", state.csrfA!);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.items).toEqual([]);
  }, 60000);

  it("rejects cart quantities beyond availability on add and on PATCH", async () => {
    const agent = state.custA!;
    const csrf = state.csrfA!;
    const tooMany = await agent
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrf)
      .send({ productId: state.bod001Id, quantity: 11 });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe("INSUFFICIENT_STOCK");

    const added = await agent
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrf)
      .send({ productId: state.bod001Id, quantity: 2 });
    expect(added.status).toBe(200);
    const itemId = added.body.data.items[0].id as number;

    const patchTooMany = await agent
      .patch(`/api/cart/items/${itemId}`)
      .set("X-CSRF-Token", csrf)
      .send({ quantity: 11 });
    expect(patchTooMany.status).toBe(422);
    expect(patchTooMany.body.error.code).toBe("INSUFFICIENT_STOCK");

    const patched = await agent
      .patch(`/api/cart/items/${itemId}`)
      .set("X-CSRF-Token", csrf)
      .send({ quantity: 3 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.items[0].quantity).toBe(3);

    await agent.delete("/api/cart").set("X-CSRF-Token", csrf);
  });

  it("checks out with server-recalculated totals and immutable snapshots", async () => {
    const agent = state.custA!;
    const csrf = state.csrfA!;

    const address = await agent
      .post("/api/addresses")
      .set("X-CSRF-Token", csrf)
      .send({
        recipientName: "Customer A",
        phone: "+9779800000001",
        addressLine: "Kupondole Heights",
        city: "Lalitpur",
      });
    expect(address.status).toBe(201);
    expect(address.body.data.isDefault).toBe(true);
    state.addressAId = address.body.data.id as number;

    const added = await agent
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrf)
      .send({ productId: state.bod001Id, quantity: 2 });
    expect(added.status).toBe(200);

    // Independent recalculation from the public payloads.
    const detail = await request(app).get(
      `/api/shop/products/${state.bod001Slug}`,
    );
    const cfg = await request(app).get("/api/shop/config");
    const unit = detail.body.data.effectivePricePaisa as number;
    const fee = cfg.body.data.shippingFeePaisa as number;
    const rate = cfg.body.data.taxRatePercent as number;
    const expectedSubtotal = unit * 2;
    const expectedShipping = expectedSubtotal > 0 ? fee : 0;
    const expectedTax = Math.round((expectedSubtotal * rate) / 100);
    const expectedTotal = expectedSubtotal + expectedShipping + expectedTax;

    // Bogus client-supplied price/total fields must be ignored.
    const checkoutRes = await agent
      .post("/api/checkout")
      .set("X-CSRF-Token", csrf)
      .send({
        addressId: state.addressAId,
        idempotencyKey: `order-a-${runId}`,
        total: 1,
        grandTotalPaisa: 1,
        items: [{ productId: state.bod001Id, price: 1, quantity: 2 }],
      });
    expect(checkoutRes.status).toBe(201);
    const order = checkoutRes.body.data.order as OrderBody;
    expect(order.status).toBe("PENDING_APPROVAL");
    expect(order.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(order.subtotalPaisa).toBe(expectedSubtotal);
    expect(order.shippingFeePaisa).toBe(expectedShipping);
    expect(order.taxTotalPaisa).toBe(expectedTax);
    expect(order.grandTotalPaisa).toBe(expectedTotal);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].name).toBe(detail.body.data.name);
    expect(order.items[0].unitPricePaisa).toBe(unit);
    expect(order.items[0].lineTotalPaisa).toBe(unit * 2);
    state.orderAId = order.id;

    // The cart was consumed.
    const cart = await agent.get("/api/cart");
    expect(cart.body.data.items).toEqual([]);

    // A later admin price change does not rewrite the snapshot.
    const priceChange = await state
      .admin!.patch(`/api/admin/products/${state.bod001Id}`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ price: "9999.00" });
    expect(priceChange.status).toBe(200);
    const reread = await agent.get(`/api/orders/${state.orderAId}`);
    expect(reread.status).toBe(200);
    expect(reread.body.data.items[0].unitPricePaisa).toBe(unit);
    const restored = await state
      .admin!.patch(`/api/admin/products/${state.bod001Id}`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ price: "4500.00" });
    expect(restored.status).toBe(200);
  });

  it("reserves stock at checkout: the last unit cannot be sold twice", async () => {
    const scarce = await adminCreateProduct({
      slug: `scarce-${runId}`,
      sku: `SCARCE-${runId}`,
      name: "Scarce Relic",
      price: "100.00",
      status: "ACTIVE",
      stockQty: 1,
    });
    state.scarceId = scarce.id;

    const { agent: agentB, csrf: csrfB } = await registerCustomer(
      EMAIL_B,
      PASSWORD_B,
      "Customer B",
    );
    state.custB = agentB;
    state.csrfB = csrfB;

    const agentA = state.custA!;
    const added = await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId: scarce.id, quantity: 1 });
    expect(added.status).toBe(200);
    const placed = await agentA
      .post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({
        addressId: state.addressAId,
        idempotencyKey: `scarce-a-${runId}`,
      });
    expect(placed.status).toBe(201);
    state.scarceOrderId = (placed.body.data.order as OrderBody).id;

    // The reservation removes the unit from the public pool.
    const detail = await request(app).get(
      `/api/shop/products/scarce-${runId}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.availableQty).toBe(0);
    expect(detail.body.data.inStock).toBe(false);

    // Customer B cannot even cart it now.
    const bAdd = await agentB
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrfB)
      .send({ productId: scarce.id, quantity: 1 });
    expect(bAdd.status).toBe(422);
    expect(bAdd.body.error.code).toBe("INSUFFICIENT_STOCK");
  }, 60000);

  it("allows exactly one winner when two customers race for the last unit", async () => {
    const race = await adminCreateProduct({
      slug: `race-${runId}`,
      sku: `RACE-${runId}`,
      name: "Race Relic",
      price: "50.00",
      status: "ACTIVE",
      stockQty: 1,
    });
    state.raceId = race.id;

    const agentA = state.custA!;
    const agentB = state.custB!;
    // Both carts load fine — carts do not reserve.
    const addA = await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId: race.id, quantity: 1 });
    expect(addA.status).toBe(200);
    const addB = await agentB
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfB!)
      .send({ productId: race.id, quantity: 1 });
    expect(addB.status).toBe(200);

    const addressB = await agentB
      .post("/api/addresses")
      .set("X-CSRF-Token", state.csrfB!)
      .send({
        recipientName: "Customer B",
        phone: "+9779800000002",
        addressLine: "Thamel",
        city: "Kathmandu",
      });
    expect(addressB.status).toBe(201);

    const [resA, resB] = await Promise.all([
      agentA
        .post("/api/checkout")
        .set("X-CSRF-Token", state.csrfA!)
        .send({
          addressId: state.addressAId,
          idempotencyKey: `race-a-${runId}`,
        }),
      agentB
        .post("/api/checkout")
        .set("X-CSRF-Token", state.csrfB!)
        .send({
          addressId: addressB.body.data.id,
          idempotencyKey: `race-b-${runId}`,
        }),
    ]);
    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 422]);
    const loser = resA.status === 422 ? resA : resB;
    expect(loser.body.error.code).toBe("INSUFFICIENT_STOCK");

    // Exactly one order, one order line, one reservation — and the
    // on-hand stock column was never touched by the reservation.
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?",
        [race.id],
      ),
    ).toBe(1);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE product_id = ? AND movement_type = 'RESERVE'",
        [race.id],
      ),
    ).toBe(1);
    const [stockRows] = await handle.pool.query(
      "SELECT stock_qty AS q FROM products WHERE id = ?",
      [race.id],
    );
    expect(Number((stockRows as { q: number }[])[0].q)).toBe(1);

    const detail = await request(app).get(`/api/shop/products/race-${runId}`);
    expect(detail.body.data.availableQty).toBe(0);
  });

  it("replays an idempotent checkout with no duplicate order or reservation", async () => {
    const agentB = state.custB!;
    const csrfB = state.csrfB!;
    // The race loser still holds the race relic — start from a clean cart.
    await agentB.delete("/api/cart").set("X-CSRF-Token", csrfB);
    const list = await request(app).get("/api/shop/products?category=books");
    const book = (list.body.data as ShopItem[])[0];
    const added = await agentB
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrfB)
      .send({ productId: book.id, quantity: 1 });
    expect(added.status).toBe(200);

    const addresses = await agentB.get("/api/addresses");
    const addressId = addresses.body.data.items[0].id as number;
    const key = `idem-b-${runId}`;
    const first = await agentB
      .post("/api/checkout")
      .set("X-CSRF-Token", csrfB)
      .send({ addressId, idempotencyKey: key });
    expect(first.status).toBe(201);
    const orderId = (first.body.data.order as OrderBody).id;

    // The cart is empty now; the replay must still return the order.
    const replay = await agentB
      .post("/api/checkout")
      .set("X-CSRF-Token", csrfB)
      .send({ addressId, idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect((replay.body.data.order as OrderBody).id).toBe(orderId);

    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM orders WHERE idempotency_key = ?", [
        key,
      ]),
    ).toBe(1);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = ? AND movement_type = 'RESERVE'",
        [orderId],
      ),
    ).toBe(1);
  });

  it("rolls a failed checkout back completely: no order, no reservation, cart intact", async () => {
    const good = await adminCreateProduct({
      slug: `fail-good-${runId}`,
      sku: `FAILGOOD-${runId}`,
      name: "Good Relic",
      price: "20.00",
      status: "ACTIVE",
      stockQty: 5,
    });
    const bad = await adminCreateProduct({
      slug: `fail-bad-${runId}`,
      sku: `FAILBAD-${runId}`,
      name: "Bad Relic",
      price: "20.00",
      status: "ACTIVE",
      stockQty: 5,
    });
    const agentA = state.custA!;
    const csrfA = state.csrfA!;
    // Start clean regardless of who lost the race in the previous test.
    await agentA.delete("/api/cart").set("X-CSRF-Token", csrfA);
    await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrfA)
      .send({ productId: good.id, quantity: 1 });
    const addedBad = await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrfA)
      .send({ productId: bad.id, quantity: 2 });
    expect(addedBad.status).toBe(200);

    // Admin cuts the second product's stock below the carted quantity.
    const cut = await state
      .admin!.post(`/api/admin/products/${bad.id}/inventory/adjust`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ setQuantity: 1, reason: "test stock cut" });
    expect(cut.status).toBe(200);

    const ordersBefore = await agentA.get("/api/orders");
    const totalBefore = ordersBefore.body.meta.total as number;

    const attempt = await agentA
      .post("/api/checkout")
      .set("X-CSRF-Token", csrfA)
      .send({
        addressId: state.addressAId,
        idempotencyKey: `fail-a-${runId}`,
      });
    expect(attempt.status).toBe(422);
    expect(attempt.body.error.code).toBe("INSUFFICIENT_STOCK");

    const ordersAfter = await agentA.get("/api/orders");
    expect(ordersAfter.body.meta.total).toBe(totalBefore);
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM inventory_movements WHERE product_id = ? AND movement_type = 'RESERVE'",
        [good.id],
      ),
    ).toBe(0);
    const cart = await agentA.get("/api/cart");
    expect(cart.body.data.items).toHaveLength(2);

    await agentA.delete("/api/cart").set("X-CSRF-Token", csrfA);
  });

  it("hides other customers' addresses and orders behind 404", async () => {
    const agentB = state.custB!;
    const csrfB = state.csrfB!;
    const added = await agentB
      .post("/api/cart/items")
      .set("X-CSRF-Token", csrfB)
      .send({ productId: state.bod001Id, quantity: 1 });
    expect(added.status).toBe(200);
    const bCartBefore = added.body.data.itemCount as number;

    const foreignOrder = await agentB.get(`/api/orders/${state.scarceOrderId}`);
    expect(foreignOrder.status).toBe(404);
    const foreignPatch = await agentB
      .patch(`/api/addresses/${state.addressAId}`)
      .set("X-CSRF-Token", csrfB)
      .send({ city: "Pokhara" });
    expect(foreignPatch.status).toBe(404);
    const foreignDelete = await agentB
      .delete(`/api/addresses/${state.addressAId}`)
      .set("X-CSRF-Token", csrfB);
    expect(foreignDelete.status).toBe(404);

    const bCart = await agentB.get("/api/cart");
    expect(bCart.body.data.itemCount).toBe(bCartBefore);
    // A's address is untouched.
    const aAddresses = await state.custA!.get("/api/addresses");
    const aAddress = (
      aAddresses.body.data.items as { id: number; city: string }[]
    ).find((row) => row.id === state.addressAId);
    expect(aAddress?.city).toBe("Lalitpur");

    await agentB.delete("/api/cart").set("X-CSRF-Token", csrfB);
  });

  it("adjusts inventory within the reservation floor and lists the ledger", async () => {
    const admin = state.admin!;
    const csrf = state.adminCsrf!;
    const productId = state.scarceId!;

    const plus = await admin
      .post(`/api/admin/products/${productId}/inventory/adjust`)
      .set("X-CSRF-Token", csrf)
      .send({ quantity: 5, reason: "restock" });
    expect(plus.status).toBe(200);
    expect(plus.body.data.stockQty).toBe(6);
    expect(plus.body.data.reservedQty).toBe(1);
    expect(plus.body.data.availableQty).toBe(5);

    const minus = await admin
      .post(`/api/admin/products/${productId}/inventory/adjust`)
      .set("X-CSRF-Token", csrf)
      .send({ quantity: -3, reason: "damage write-off" });
    expect(minus.status).toBe(200);
    expect(minus.body.data.stockQty).toBe(3);
    expect(minus.body.data.availableQty).toBe(2);

    const view = await admin.get(`/api/admin/products/${productId}/inventory`);
    expect(view.status).toBe(200);
    expect(view.body.data.stockQty).toBe(3);
    const types = (view.body.data.items as { movementType: string }[]).map(
      (row) => row.movementType,
    );
    expect(types).toContain("OPENING");
    expect(types).toContain("RESERVE");
    expect(types).toContain("ADJUSTMENT_IN");
    expect(types).toContain("ADJUSTMENT_OUT");

    // One unit is reserved by A's pending order: stock may not drop to 0.
    const belowReserved = await admin
      .post(`/api/admin/products/${productId}/inventory/adjust`)
      .set("X-CSRF-Token", csrf)
      .send({ setQuantity: 0 });
    expect(belowReserved.status).toBe(422);
    expect(belowReserved.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("scopes store settings: fee flows into config and checkout; customers get 403", async () => {
    const admin = state.admin!;
    const setFee = await admin
      .put("/api/admin/settings")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        settings: [{ key: "store.shipping_flat_fee", value: "250.00" }],
      });
    expect(setFee.status).toBe(200);

    const cfg = await request(app).get("/api/shop/config");
    expect(cfg.body.data.shippingFeePaisa).toBe(25000);

    const agentA = state.custA!;
    const list = await request(app).get("/api/shop/products?category=souvenirs");
    const item = (list.body.data as ShopItem[])[0];
    const added = await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId: item.id, quantity: 1 });
    expect(added.status).toBe(200);
    const placed = await agentA
      .post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({
        addressId: state.addressAId,
        idempotencyKey: `fee-a-${runId}`,
      });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as OrderBody;
    expect(order.shippingFeePaisa).toBe(25000);
    expect(order.grandTotalPaisa).toBe(
      item.effectivePricePaisa + 25000 + order.taxTotalPaisa,
    );

    // A plain customer may not write settings at all.
    const forbidden = await agentA
      .put("/api/admin/settings")
      .set("X-CSRF-Token", state.csrfA!)
      .send({
        settings: [{ key: "store.shipping_flat_fee", value: "1.00" }],
      });
    expect(forbidden.status).toBe(403);

    // Restore the placeholder default for any later suite runs.
    const restore = await admin
      .put("/api/admin/settings")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        settings: [{ key: "store.shipping_flat_fee", value: "0.00" }],
      });
    expect(restore.status).toBe(200);
    const cfgAfter = await request(app).get("/api/shop/config");
    expect(cfgAfter.body.data.shippingFeePaisa).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Store settings by role (2026-11-20): Admin + Store Admin manage the
  // shipping fee / VAT rate / COD, scoped to exactly those keys; values
  // are strictly validated; placed orders never move when settings do.
  // -------------------------------------------------------------------------

  async function makeRoleAgent(
    email: string,
    pass: string,
    roleCode: string,
  ): Promise<{ agent: Agent; csrf: string }> {
    const db = handle.db;
    const roleRows = await db
      .select({ id: rolesTable.id, code: rolesTable.code })
      .from(rolesTable);
    const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));
    const passwordHash = await hashPassword(pass);
    const [created] = await db
      .insert(users)
      .values({
        fullName: `Role ${roleCode}`,
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
      })
      .$returningId();
    await db.insert(userRoles).values([
      { userId: created.id, roleId: roleIdByCode.get(roleCode)!, grantedBy: null },
    ]);
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ email, password: pass });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    const enrol = await agent
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(enrol.status).toBe(200);
    const confirm = await agent
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(enrol.body.secret as string) });
    expect(confirm.status).toBe(200);
    return { agent, csrf };
  }

  it("Admin and Store Admin manage store settings, scoped to the store keys only", async () => {
    const adminRole = await makeRoleAgent(
      `store-role-admin-${runId}@example.com`,
      "role-admin-pass-2026",
      "ADMIN",
    );
    state.roleAdmin = adminRole.agent;
    state.roleAdminCsrf = adminRole.csrf;
    const storeRole = await makeRoleAgent(
      `store-role-store-${runId}@example.com`,
      "role-store-pass-2026",
      "STORE_ADMIN",
    );
    state.storeAdmin = storeRole.agent;
    state.storeAdminCsrf = storeRole.csrf;

    const STORE_KEYS = ["store.cod_enabled", "store.shipping_flat_fee", "store.tax_rate_percent"];

    // Both roles read ONLY the store keys — global settings stay hidden.
    for (const { agent } of [adminRole, storeRole]) {
      const list = await agent.get("/api/admin/settings");
      expect(list.status).toBe(200);
      const keys = (list.body.items as { key: string }[]).map((i) => i.key).sort();
      expect(keys).toEqual([...STORE_KEYS].sort());
    }

    // Admin writes the shipping fee; it flows into the public config.
    const setFee = await adminRole.agent
      .put("/api/admin/settings")
      .set("X-CSRF-Token", adminRole.csrf)
      .send({ settings: [{ key: "store.shipping_flat_fee", value: "120.00" }] });
    expect(setFee.status).toBe(200);
    const cfg = await request(app).get("/api/shop/config");
    expect(cfg.body.data.shippingFeePaisa).toBe(12000);

    // Admin may NOT touch a global key.
    const foreign = await adminRole.agent
      .put("/api/admin/settings")
      .set("X-CSRF-Token", adminRole.csrf)
      .send({ settings: [{ key: "site.tagline", value: "nope" }] });
    expect(foreign.status).toBe(403);

    // Store Admin writes the VAT rate.
    const setRate = await storeRole.agent
      .put("/api/admin/settings")
      .set("X-CSRF-Token", storeRole.csrf)
      .send({ settings: [{ key: "store.tax_rate_percent", value: "13" }] });
    expect(setRate.status).toBe(200);
    const cfg2 = await request(app).get("/api/shop/config");
    expect(cfg2.body.data.taxRatePercent).toBe(13);

    // A mixed batch (one store key + one global key) is rejected whole:
    // the fee must NOT move.
    const mixed = await storeRole.agent
      .put("/api/admin/settings")
      .set("X-CSRF-Token", storeRole.csrf)
      .send({
        settings: [
          { key: "store.shipping_flat_fee", value: "130.00" },
          { key: "site.tagline", value: "nope" },
        ],
      });
    expect(mixed.status).toBe(403);
    const cfg3 = await request(app).get("/api/shop/config");
    expect(cfg3.body.data.shippingFeePaisa).toBe(12000);

    // Restore placeholders.
    const restore = await state.admin!
      .put("/api/admin/settings")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({
        settings: [
          { key: "store.shipping_flat_fee", value: "0.00" },
          { key: "store.tax_rate_percent", value: "0" },
        ],
      });
    expect(restore.status).toBe(200);
  }, 120000);

  it("store setting values are strictly validated, and placed orders keep their snapshot", async () => {
    const admin = state.admin!;
    const put = (settings: { key: string; value: unknown }[]) =>
      admin
        .put("/api/admin/settings")
        .set("X-CSRF-Token", state.adminCsrf!)
        .send({ settings });

    for (const bad of [
      { key: "store.shipping_flat_fee", value: "-5" },
      { key: "store.shipping_flat_fee", value: "10.999" },
      { key: "store.shipping_flat_fee", value: "100001" },
      { key: "store.tax_rate_percent", value: "101" },
      { key: "store.tax_rate_percent", value: "abc" },
      { key: "store.cod_enabled", value: "yes" },
    ]) {
      const res = await put([bad]);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // Mixed valid + invalid: rejected whole, the valid key does not move.
    const mixed = await put([
      { key: "store.shipping_flat_fee", value: "111.00" },
      { key: "store.tax_rate_percent", value: "abc" },
    ]);
    expect(mixed.status).toBe(400);
    const cfg0 = await request(app).get("/api/shop/config");
    expect(cfg0.body.data.shippingFeePaisa).toBe(0);
    expect(cfg0.body.data.taxRatePercent).toBe(0);

    // Place an order at fee Rs 100 + VAT 13%.
    expect((await put([
      { key: "store.shipping_flat_fee", value: "100.00" },
      { key: "store.tax_rate_percent", value: "13" },
    ])).status).toBe(200);
    const agentA = state.custA!;
    const list = await request(app).get("/api/shop/products?category=souvenirs");
    const item = (list.body.data as ShopItem[])[0];
    const added = await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId: item.id, quantity: 1 });
    expect(added.status).toBe(200);
    const placed = await agentA
      .post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ addressId: state.addressAId, idempotencyKey: `vat-snap-${runId}` });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as OrderBody;
    expect(order.shippingFeePaisa).toBe(10000);
    const expectedTax = Math.round((item.effectivePricePaisa * 13) / 100);
    expect(order.taxTotalPaisa).toBe(expectedTax);
    expect(order.grandTotalPaisa).toBe(item.effectivePricePaisa + 10000 + expectedTax);

    // Change both settings afterwards: the placed order must not move.
    expect((await put([
      { key: "store.shipping_flat_fee", value: "999.00" },
      { key: "store.tax_rate_percent", value: "20" },
    ])).status).toBe(200);
    const cfgNew = await request(app).get("/api/shop/config");
    expect(cfgNew.body.data.shippingFeePaisa).toBe(99900);
    const reread = await agentA.get(`/api/orders/${order.id}`);
    expect(reread.status).toBe(200);
    const again = reread.body.data as OrderBody;
    expect(again.shippingFeePaisa).toBe(10000);
    expect(again.taxTotalPaisa).toBe(expectedTax);
    expect(again.grandTotalPaisa).toBe(order.grandTotalPaisa);

    // Restore placeholders.
    expect((await put([
      { key: "store.shipping_flat_fee", value: "0.00" },
      { key: "store.tax_rate_percent", value: "0" },
    ])).status).toBe(200);
  });

  it("order placement emails the customer and all staff roles — once, and never on replay", async () => {
    const db = handle.db;
    // Two INELIGIBLE staff accounts: a SUSPENDED admin (verified) and
    // an ACTIVE admin whose email was never verified. Neither may
    // receive the staff notification.
    const roleRows = await db
      .select({ id: rolesTable.id, code: rolesTable.code })
      .from(rolesTable);
    const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));
    const suspendedEmail = `store-suspended-admin-${runId}@example.com`;
    const unverifiedEmail = `store-unverified-admin-${runId}@example.com`;
    const hash = await hashPassword("ineligible-staff-pass");
    const [suspended] = await db
      .insert(users)
      .values({
        fullName: "Suspended Admin",
        email: suspendedEmail,
        emailNormalized: suspendedEmail,
        passwordHash: hash,
        emailVerifiedAt: new Date(),
        status: "SUSPENDED",
      })
      .$returningId();
    const [unverified] = await db
      .insert(users)
      .values({
        fullName: "Unverified Admin",
        email: unverifiedEmail,
        emailNormalized: unverifiedEmail,
        passwordHash: hash,
        emailVerifiedAt: null,
        status: "ACTIVE",
      })
      .$returningId();
    await db.insert(userRoles).values([
      { userId: suspended.id, roleId: roleIdByCode.get("ADMIN")!, grantedBy: null },
      { userId: unverified.id, roleId: roleIdByCode.get("ADMIN")!, grantedBy: null },
    ]);

    const outboxFor = async (orderId: number) => {
      const [rows] = await handle.pool.query(
        "SELECT type, recipient_email FROM email_outbox WHERE related_type = 'order' AND related_id = ?",
        [orderId],
      );
      return rows as { type: string; recipient_email: string }[];
    };

    const agentA = state.custA!;
    const list = await request(app).get("/api/shop/products?category=souvenirs");
    const item = (list.body.data as ShopItem[])[0];
    const added = await agentA
      .post("/api/cart/items")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ productId: item.id, quantity: 1 });
    expect(added.status).toBe(200);
    const placed = await agentA
      .post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ addressId: state.addressAId, idempotencyKey: `placed-mail-${runId}` });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as OrderBody;

    const rows = await outboxFor(order.id);
    const customerRows = rows.filter((r) => r.type === "ORDER_PLACED");
    const staffRows = rows.filter((r) => r.type === "ORDER_PLACED_ADMIN");
    expect(customerRows).toEqual([
      { type: "ORDER_PLACED", recipient_email: EMAIL_A },
    ]);
    const staffRecipients = staffRows.map((r) => r.recipient_email).sort();
    expect(staffRecipients).toEqual(
      [
        ROOT_EMAIL, // Super Admin (bootstrapped)
        `store-role-admin-${runId}@example.com`, // ADMIN
        `store-role-store-${runId}@example.com`, // STORE_ADMIN
      ].sort(),
    );
    expect(staffRecipients).not.toContain(suspendedEmail);
    expect(staffRecipients).not.toContain(unverifiedEmail);
    expect(staffRecipients).not.toContain(EMAIL_B);

    // Replay with the same idempotency key: no second set of emails.
    const replay = await agentA
      .post("/api/checkout")
      .set("X-CSRF-Token", state.csrfA!)
      .send({ addressId: state.addressAId, idempotencyKey: `placed-mail-${runId}` });
    expect(replay.status).toBe(200);
    const rowsAfter = await outboxFor(order.id);
    expect(rowsAfter).toHaveLength(rows.length);

    // The opportunistic drain actually delivers: the sink ends up
    // holding the customer confirmation naming this order.
    const mail = await waitForMail(
      (t) => t.includes(EMAIL_A) && t.includes(order.orderNumber),
      20000,
    );
    expect(mail).toContain("has been placed");
  }, 120000);
});
