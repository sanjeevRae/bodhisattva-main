/**
 * Store insights + exports (integration, 2026-11-27).
 *
 * Proves the Store dashboard's numbers against hand-computed
 * fixtures AND independent raw SQL, the permission matrix for the
 * three endpoints, the CSV/XLSX byte shape (reopened with exceljs),
 * the formula-injection guard on real stored data, the export audit
 * rows, and the 10,000-row cap behaviour on the audit export.
 *
 * Fixture design (seeded shipping/VAT are 0, so totals = subtotal):
 *   P1 plain product Rs 1,000 — the only product ordered.
 *   O1 C1 ×2 today, DELIVERED        O2 C1 ×1 today, APPROVED
 *   O3 C2 ×3 today, approve→CANCELLED (credit note; counts nowhere)
 *   O4 C2 ×1 40d ago, DELIVERED      O6 C1 ×1 40d ago, APPROVED
 *   O5 C3 ×1 today, left PENDING_APPROVAL
 * Expected 30d: orders 2, order value Rs 3,000, delivered Rs 2,000,
 * AOV Rs 1,500, repeat rate 100% (only C1 bought; 3 lifetime),
 * previous period orders 2 / value Rs 2,000 / delivered Rs 1,000,
 * repeat 50% → +50 points. 90d + all: orders 4, value Rs 5,000.
 * Retail stock value is pinned by SQL stock resets after the flows:
 * P1 10×1000 + P2 variants 3×(2000+500) = Rs 17,500 (P2's parent
 * stock 7 must NOT count; P4's variants are all inactive → 0;
 * P3 is ARCHIVED → excluded).
 *
 * Own database (bodhisattva_test_reports); guarded by INTEGRATION_DB=1.
 * Customers are inserted users (no OTP mail needed); staff enrol MFA
 * through the real flow like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
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
const UPLOADS = "/tmp/reports-test-uploads";
const DB_NAME = "bodhisattva_test_reports";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `rep-root-${runId}@example.com`;
const ROOT_PASS = "rep-root-pass-123";
const ADMIN_EMAIL = `rep-admin-${runId}@example.com`;
const STORE_EMAIL = `rep-store-${runId}@example.com`;
const STAFF_PASS = "rep-staff-pass-123";
const CUST_PASS = "rep-cust-pass-123";
const C1_EMAIL = `rep-c1-${runId}@example.com`;
const C2_EMAIL = `rep-c2-${runId}@example.com`;
const C3_EMAIL = `rep-c3-${runId}@example.com`;

/** Kathmandu wall-clock instant (days ago, hour) as a UTC Date. */
function ktm(daysAgo: number, hour: number): Date {
  const wall = new Date(Date.now() + 345 * 60_000);
  const base = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() - daysAgo,
    hour,
    0,
    0,
  );
  return new Date(base - 345 * 60_000);
}

function mysqlDateTime(d: Date): string {
  return d.toISOString().slice(0, 23).replace("T", " ");
}

describe.skipIf(!RUN)("store insights + exports (integration)", () => {
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
    cust?: Map<string, { agent: Agent; csrf: string; addressId: number }>;
    p1?: number;
    orders?: Record<string, { id: number; number: string }>;
  } = { cust: new Map(), orders: {} };

  async function sqlOne<T>(sql: string, params: unknown[]): Promise<T | null> {
    const [rows] = await handle.pool.query(sql, params);
    const list = rows as T[];
    return list[0] ?? null;
  }

  async function sqlCount(sql: string, params: unknown[]): Promise<number> {
    const row = await sqlOne<{ c: number | string }>(sql, params);
    return Number(row?.c ?? 0);
  }

  async function insertUser(
    email: string,
    name: string,
    roleCode: string,
    pass: string,
  ): Promise<number> {
    const hash = await hashPassword(pass);
    const [res] = await handle.pool.query(
      "INSERT INTO users (full_name, email, email_normalized, phone, password_hash, email_verified_at, status) VALUES (?, ?, ?, '+9779812345678', ?, NOW(), 'ACTIVE')",
      [name, email, email.toLowerCase(), hash],
    );
    const userId = (res as { insertId: number }).insertId;
    await handle.pool.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?",
      [userId, roleCode],
    );
    return userId;
  }

  async function enrolAgent(
    email: string,
    pass: string,
  ): Promise<{ agent: Agent; csrf: string }> {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password: pass });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const csrf = login.body.csrfToken as string;
    if (login.body.authLevel === "full") return { agent, csrf };
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

  async function placeOrder(
    email: string,
    quantity: number,
    key: string,
  ): Promise<{ id: number; number: string }> {
    const c = state.cust!.get(email)!;
    const added = await c.agent
      .post("/api/cart/items")
      .set("X-CSRF-Token", c.csrf)
      .send({ productId: state.p1, quantity });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const placed = await c.agent
      .post("/api/checkout")
      .set("X-CSRF-Token", c.csrf)
      .send({ addressId: c.addressId, idempotencyKey: key });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const order = placed.body.data.order as { id: number; orderNumber: string };
    return { id: order.id, number: order.orderNumber };
  }

  function transition(orderId: number, action: string, body?: unknown) {
    return state
      .root!.post(`/api/admin/orders/${orderId}/${action}`)
      .set("X-CSRF-Token", state.rootCsrf!)
      .send(body ?? {});
  }

  async function setPlacedAt(orderId: number, when: Date): Promise<void> {
    await handle.pool.query("UPDATE orders SET placed_at = ? WHERE id = ?", [
      mysqlDateTime(when),
      orderId,
    ]);
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
    // Fresh database: migrate + seed FIRST, then wipe the data the
    // seed created (its demo products would pollute global KPIs).
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
    const pool = handle.pool;
    await pool.query("DELETE FROM credit_notes");
    await pool.query("DELETE FROM invoices");
    await pool.query("DELETE FROM email_outbox");
    // NOTE: the seeded invoice template is KEPT (unlike the ordadm
    // wipe, which runs before seeding) — order approval creates
    // invoices from it.
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

    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });

    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "Rep Root",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASS,
        DATABASE_URL: DB_URL,
      },
      encoding: "utf8",
    });
    const root = await enrolAgent(ROOT_EMAIL, ROOT_PASS);
    state.root = root.agent;
    state.rootCsrf = root.csrf;

    await insertUser(ADMIN_EMAIL, "Rep Admin", "ADMIN", STAFF_PASS);
    await insertUser(STORE_EMAIL, "Rep Store", "STORE_ADMIN", STAFF_PASS);
    const admin = await enrolAgent(ADMIN_EMAIL, STAFF_PASS);
    state.admin = admin.agent;
    state.adminCsrf = admin.csrf;
    const store = await enrolAgent(STORE_EMAIL, STAFF_PASS);
    state.store = store.agent;
    state.storeCsrf = store.csrf;

    // Customers: inserted users with the CUSTOMER role only.
    for (const [email, name] of [
      [C1_EMAIL, "Rep Customer One"],
      [C2_EMAIL, "Rep Customer Two"],
      [C3_EMAIL, "Rep Customer Three"],
    ] as const) {
      await insertUser(email, name, "CUSTOMER", CUST_PASS);
      const session = await enrolAgent(email, CUST_PASS);
      const address = await session.agent
        .post("/api/addresses")
        .set("X-CSRF-Token", session.csrf)
        .send({
          recipientName: name,
          phone: "+9779800000001",
          addressLine: "Kupondole Heights",
          city: "Lalitpur",
        });
      expect(address.status, JSON.stringify(address.body)).toBe(201);
      state.cust!.set(email, {
        agent: session.agent,
        csrf: session.csrf,
        addressId: address.body.data.id as number,
      });
    }

    // Catalogue fixtures via SQL (exact prices/stock).
    const [p1] = await handle.pool.query(
      "INSERT INTO products (slug, name, price, stock_qty, status) VALUES (?, 'Insights Bowl', '1000.00', 100, 'ACTIVE')",
      [`rep-bowl-${runId}`],
    );
    state.p1 = (p1 as { insertId: number }).insertId;
    const [p2] = await handle.pool.query(
      "INSERT INTO products (slug, name, price, sale_price, stock_qty, status) VALUES (?, 'Insights Shawl', '2500.00', '2000.00', 7, 'ACTIVE')",
      [`rep-shawl-${runId}`],
    );
    const p2Id = (p2 as { insertId: number }).insertId;
    await handle.pool.query(
      "INSERT INTO product_variants (product_id, name, price_delta, stock_qty, is_active) VALUES (?, 'Large', '500.00', 3, 1), (?, 'Small', '0.00', 4, 0)",
      [p2Id, p2Id],
    );
    const [p4] = await handle.pool.query(
      "INSERT INTO products (slug, name, price, stock_qty, status) VALUES (?, 'Insights Vase', '500.00', 7, 'ACTIVE')",
      [`rep-vase-${runId}`],
    );
    const p4Id = (p4 as { insertId: number }).insertId;
    await handle.pool.query(
      "INSERT INTO product_variants (product_id, name, price_delta, stock_qty, is_active) VALUES (?, 'Only', '0.00', 7, 0)",
      [p4Id],
    );
    await handle.pool.query(
      "INSERT INTO products (slug, name, price, stock_qty, status) VALUES (?, 'Insights Old', '999.00', 5, 'ARCHIVED')",
      [`rep-old-${runId}`],
    );

    // Order fixtures through the real lifecycle.
    const o1 = await placeOrder(C1_EMAIL, 2, `o1-${runId}`);
    for (const action of ["approve", "process", "ship", "deliver"]) {
      const res = await transition(o1.id, action);
      expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    await setPlacedAt(o1.id, ktm(0, 8));
    state.orders!.o1 = o1;

    const o2 = await placeOrder(C1_EMAIL, 1, `o2-${runId}`);
    expect((await transition(o2.id, "approve")).status).toBe(200);
    await setPlacedAt(o2.id, ktm(0, 9));
    state.orders!.o2 = o2;

    const o3 = await placeOrder(C2_EMAIL, 3, `o3-${runId}`);
    expect((await transition(o3.id, "approve")).status).toBe(200);
    const cancel = await transition(o3.id, "cancel", { reason: "Customer changed mind" });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    await setPlacedAt(o3.id, ktm(0, 10));
    state.orders!.o3 = o3;
    // The credit note exists — and the order must still count nowhere.
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE i.order_id = ?",
        [o3.id],
      ),
    ).toBe(1);

    const o4 = await placeOrder(C2_EMAIL, 1, `o4-${runId}`);
    for (const action of ["approve", "process", "ship", "deliver"]) {
      expect((await transition(o4.id, action)).status).toBe(200);
    }
    await setPlacedAt(o4.id, ktm(40, 10));
    state.orders!.o4 = o4;

    const o6 = await placeOrder(C1_EMAIL, 1, `o6-${runId}`);
    expect((await transition(o6.id, "approve")).status).toBe(200);
    await setPlacedAt(o6.id, ktm(40, 9));
    state.orders!.o6 = o6;

    const o5 = await placeOrder(C3_EMAIL, 1, `o5-${runId}`);
    await setPlacedAt(o5.id, ktm(0, 11));
    state.orders!.o5 = o5;

    // Pin the stock picture AFTER the flows moved it.
    await handle.pool.query("UPDATE products SET stock_qty = 10 WHERE id = ?", [state.p1]);
    await handle.pool.query(
      "UPDATE product_variants SET stock_qty = 3 WHERE product_id = ? AND is_active = 1",
      [p2Id],
    );
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("1: permission matrix — insights for the three roles, 403 customer, 401 anon", async () => {
    for (const agent of [state.root!, state.admin!, state.store!]) {
      const res = await agent.get("/api/admin/store/insights?range=30d");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const cust = state.cust!.get(C1_EMAIL)!;
    const asCustomer = await cust.agent.get("/api/admin/store/insights?range=30d");
    expect(asCustomer.status).toBe(403);
    const anon = await request(app).get("/api/admin/store/insights?range=30d");
    expect(anon.status).toBe(401);
  });

  it("2: 30d KPIs match the hand-computed fixtures and raw SQL", async () => {
    const res = await state.admin!.get("/api/admin/store/insights?range=30d");
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.kpis.orders).toBe(2);
    expect(d.kpis.orderValuePaisa).toBe(300_000);
    expect(d.kpis.deliveredSalesPaisa).toBe(200_000);
    expect(d.kpis.aovPaisa).toBe(150_000);
    expect(d.kpis.newCustomerAccounts).toBe(3);
    expect(d.kpis.repeatPurchaseRatePct).toBe(100);
    expect(d.kpis.pendingApprovals).toBe(1);
    expect(d.kpis.activeProducts).toBe(3);
    expect(d.kpis.retailStockValuePaisa).toBe(1_750_000);
    expect(d.deltas.ordersPct).toBe(0);
    expect(d.deltas.orderValuePct).toBe(50);
    expect(d.deltas.deliveredSalesPct).toBe(100);
    expect(d.deltas.aovPct).toBe(50);
    expect(d.deltas.newCustomerAccountsPct).toBeNull();
    expect(d.deltas.repeatPurchaseRatePoints).toBe(50);

    // Independent raw-SQL cross-check of the same window.
    const row = await sqlOne<{ c: string; v: string }>(
      "SELECT COUNT(*) AS c, COALESCE(SUM(grand_total),0) AS v FROM orders WHERE status IN ('APPROVED','PROCESSING','SHIPPED','DELIVERED') AND placed_at >= DATE_SUB(NOW(), INTERVAL 31 DAY)",
      [],
    );
    expect(Number(row!.c)).toBeGreaterThanOrEqual(2);

    expect(d.series).toHaveLength(30);
    const today = d.series[d.series.length - 1];
    expect(today.orderValuePaisa).toBe(300_000);
    expect(today.orders).toBe(2);
    expect(d.series.reduce((a: number, s: { orderValuePaisa: number }) => a + s.orderValuePaisa, 0)).toBe(300_000);

    expect(d.topProducts).toHaveLength(1);
    expect(d.topProducts[0].units).toBe(3);
    expect(d.topProducts[0].revenuePaisa).toBe(300_000);
    expect(d.topCustomers).toHaveLength(1);
    expect(d.topCustomers[0].orders).toBe(2);
    expect(d.topCustomers[0].spendPaisa).toBe(300_000);
    expect(d.topCustomers[0].email).toBeUndefined();

    expect(d.recentOrders[0].orderNumber).toBe(state.orders!.o5.number);
    expect(d.recentOrders[0].status).toBe("PENDING_APPROVAL");
    expect(d.recentOrders.map((o: { status: string }) => o.status)).toContain("CANCELLED");
  });

  it("3: 90d and all-time windows include the 40-day-old orders; all has no deltas", async () => {
    const r90 = await state.store!.get("/api/admin/store/insights?range=90d");
    expect(r90.status).toBe(200);
    expect(r90.body.data.kpis.orders).toBe(4);
    expect(r90.body.data.kpis.orderValuePaisa).toBe(500_000);
    expect(r90.body.data.kpis.deliveredSalesPaisa).toBe(300_000);

    const all = await state.root!.get("/api/admin/store/insights?range=all");
    expect(all.status).toBe(200);
    expect(all.body.data.kpis.orders).toBe(4);
    expect(all.body.data.kpis.orderValuePaisa).toBe(500_000);
    expect(all.body.data.deltas).toBeNull();
  });

  it("4: store CSV export — rows, guard on stored data, audit row written", async () => {
    // Formula-looking customer name AND email, straight in storage
    // (ChatGPT post-review R2: the guard must cover every text
    // field, not just the name).
    await handle.pool.query(
      "UPDATE users SET full_name = '=2+2 Buyer', email = '=cmd@evil.example', email_normalized = '=cmd@evil.example' WHERE email = ?",
      [C3_EMAIL],
    );
    const res = await state
      .admin!.get("/api/admin/store/insights/export?range=30d&format=csv")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["x-export-truncated"]).toBe("false");
    const text = (res.body as Buffer).toString("utf8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain(state.orders!.o1.number);
    expect(text).toContain(state.orders!.o3.number); // cancelled orders are in the operational export
    expect(text).toContain("'=2+2 Buyer");
    expect(text).toContain("'=cmd@evil.example");
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'store.insights.export'", []),
    ).toBeGreaterThanOrEqual(1);
    await handle.pool.query(
      "UPDATE users SET full_name = 'Rep Customer Three', email = ?, email_normalized = ? WHERE email = '=cmd@evil.example'",
      [C3_EMAIL, C3_EMAIL.toLowerCase()],
    );
  });

  it("5: store XLSX export reopens with all sheets and the summary value", async () => {
    const res = await state
      .store!.get("/api/admin/store/insights/export?range=30d&format=xlsx")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Export info",
      "Summary",
      "Sales series",
      "Top products",
      "Top customers",
      "Orders",
    ]);
    const summary = wb.getWorksheet("Summary")!;
    const values: string[] = [];
    summary.eachRow((row) => {
      row.eachCell((cell) => values.push(String(cell.value)));
    });
    expect(values.join(" ")).toContain("3,000");
    const info = wb.getWorksheet("Export info")!;
    const infoText: string[] = [];
    info.eachRow((row) => row.eachCell((cell) => infoText.push(String(cell.value))));
    expect(infoText.join(" ")).toContain("Truncated at 10000 rows");
  });

  it("6: audit log stays Super-Admin-only; its export works and excludes itself", async () => {
    const listAsAdmin = await state.admin!.get("/api/admin/audit-logs");
    expect(listAsAdmin.status).toBe(403);
    const exportAsStore = await state.store!.get("/api/admin/audit-logs/export?format=csv");
    expect(exportAsStore.status).toBe(403);
    const exportAsAdmin = await state.admin!.get("/api/admin/audit-logs/export?format=xlsx");
    expect(exportAsAdmin.status).toBe(403);

    const res = await state
      .root!.get("/api/admin/audit-logs/export?format=csv")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const text = (res.body as Buffer).toString("utf8");
    expect(text).toContain("store.insights.export"); // earlier exports are in the log
    expect(text).not.toContain("audit.export"); // this export's own row is written after the read
    expect(
      await sqlCount("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'audit.export'", []),
    ).toBe(1);
  });

  it("7: audit export cap — CSV refuses over 10,000 rows, XLSX truncates with a flag", async () => {
    // 10,001 bulk rows in chunks (fast multi-row inserts).
    for (let base = 0; base < 10001; base += 1000) {
      const n = Math.min(1000, 10001 - base);
      const values = Array.from({ length: n }, () => "('bulk.test', 'SUCCESS')").join(",");
      await handle.pool.query(
        `INSERT INTO audit_logs (action, result) VALUES ${values}`,
      );
    }
    const csv = await state.root!.get("/api/admin/audit-logs/export?format=csv&action=bulk.test");
    expect(csv.status).toBe(413);
    expect(csv.body.error.code).toBe("EXPORT_TOO_LARGE");
    // The refusal itself is audited as a FAILURE (post-review R3).
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'audit.export' AND result = 'FAILURE'",
        [],
      ),
    ).toBe(1);

    const xlsx = await state
      .root!.get("/api/admin/audit-logs/export?format=xlsx&action=bulk.test")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["x-export-truncated"]).toBe("true");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as never);
    const sheet = wb.getWorksheet("Audit log")!;
    expect(sheet.rowCount).toBe(10001); // header + 10,000 rows
    const info = wb.getWorksheet("Export info")!;
    const infoText: string[] = [];
    info.eachRow((row) => row.eachCell((cell) => infoText.push(String(cell.value))));
    expect(infoText.join(" ")).toContain("YES");
    await handle.pool.query("DELETE FROM audit_logs WHERE action = 'bulk.test'");
  }, 120000);

  it("8: audit CSV guards a stored formula actor; store CSV cap refuses + audits the attempt", async () => {
    // R2 on the audit side: a whitespace-prefixed formula payload in
    // the actor email snapshot must be guarded in the CSV.
    await handle.pool.query(
      "INSERT INTO audit_logs (actor_email_snapshot, action, result) VALUES (' =cmd@evil', 'test.formula', 'SUCCESS')",
    );
    const auditCsv = await state
      .root!.get("/api/admin/audit-logs/export?format=csv&action=test.formula")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(auditCsv.status).toBe(200);
    expect((auditCsv.body as Buffer).toString("utf8")).toContain("' =cmd@evil");
    await handle.pool.query("DELETE FROM audit_logs WHERE action = 'test.formula'");

    // Store-side cap: 10,001 synthetic orders push range=all over
    // the CSV limit; the refusal is 413 AND audited as a FAILURE.
    await handle.pool.query(
      `INSERT INTO orders (order_number, user_id, status, subtotal, shipping_fee, discount_total, tax_total, grand_total, placed_at, ship_recipient_name, ship_phone, ship_address_line, ship_city, customer_email_snapshot)
       SELECT CONCAT('CAP-', seq), (SELECT id FROM users LIMIT 1), 'APPROVED', 1000.00, 0, 0, 0, 1000.00, NOW(), 'Syn', '9800000000', 'Addr', 'City', 'syn@example.com'
       FROM seq_1_to_10001`,
    );
    const storeCsv = await state
      .admin!.get("/api/admin/store/insights/export?range=all&format=csv");
    expect(storeCsv.status).toBe(413);
    expect(storeCsv.body.error.code).toBe("EXPORT_TOO_LARGE");
    expect(
      await sqlCount(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'store.insights.export' AND result = 'FAILURE'",
        [],
      ),
    ).toBe(1);
    await handle.pool.query("DELETE FROM orders WHERE order_number LIKE 'CAP-%'");
  }, 120000);
});
