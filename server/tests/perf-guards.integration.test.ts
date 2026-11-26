/**
 * Performance guards (integration) — 2026-11-26 admin speed-up.
 *
 * Pins the three behaviour contracts the optimisation must not break:
 *  1. STOCK DIFFERENTIAL: the products list computes reservedQty with
 *     ONE grouped SUM (reservedQtyByProduct) instead of the old
 *     per-product reservedQty() calls. For every product on the page
 *     this suite recomputes the expected value with the OLD algorithm
 *     (per-product SQL, RESERVE/RELEASE only, negated sum) over
 *     fixtures that include a RELEASE-only product (negative
 *     reserved), an excluded movement type and a product with no
 *     movements at all — the grouped result must match exactly, and
 *     availableQty must equal stockQty − reserved (or stockQty for
 *     untracked products).
 *  2. NEWS LIST TRIM: GET /api/admin/news items carry no `content` /
 *     `contentPlain` keys (the editor uses the detail endpoint, which
 *     still returns the body).
 *  3. COMPRESSION POLICY: JSON responses gzip when the client asks;
 *     the invoice PDF preview is NEVER compressed (application/pdf is
 *     excluded) and stays a valid PDF byte stream.
 *
 * Own database (bodhisattva_test_perf); guarded by INTEGRATION_DB=1.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
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
const UPLOADS = "/tmp/perf-test-uploads";
const DB_NAME = "bodhisattva_test_perf";
const DB_URL = `mysql://${process.env.DB_USER ?? "bodhisattva"}:${
  process.env.DB_PASSWORD ?? ""
}@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `perf-root-${runId}@example.com`;
const ROOT_PASS = "perf-root-pass-123";

describe.skipIf(!RUN)("performance guards (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let server: Server;
  let base = "";
  let csrf = "";
  const cookieJar = new Map<string, string>();
  const cookie = () =>
    [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorbCookies = (headers: Headers) => {
    for (const raw of headers.getSetCookie()) {
      const pair = raw.split(";")[0]!;
      const eq = pair.indexOf("=");
      if (eq > 0) cookieJar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };

  async function api(
    method: string,
    urlPath: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: Headers; json: any; bytes: Uint8Array }> {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookieJar.size > 0 ? { Cookie: cookie() } : {}),
        ...(csrf && method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    absorbCookies(res.headers);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let json: any = null;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, bytes };
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
    // Fresh database: migrate BEFORE the wipe (the tables must exist).
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    const pool = handle.pool;
    await pool.query("DELETE FROM inventory_movements");
    await pool.query("DELETE FROM product_images");
    await pool.query("DELETE FROM product_variants");
    await pool.query("DELETE FROM products");
    await pool.query("DELETE FROM product_categories");
    await pool.query("DELETE FROM news_attachments");
    await pool.query("DELETE FROM news_article_tags");
    await pool.query("DELETE FROM news_articles");
    await pool.query("DELETE FROM news_categories");
    await pool.query("DELETE FROM user_roles");
    await pool.query("DELETE FROM user_sessions");
    await pool.query("DELETE FROM mfa_recovery_codes");
    await pool.query("DELETE FROM mfa_credentials");
    await pool.query("DELETE FROM audit_logs");
    await pool.query("DELETE FROM users");
    execFileSync("npx", ["tsx", "src/database/seed.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    const app = createApp({
      config,
      database: handle,
      logger: pino({ level: "silent" }),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
        resolve();
      });
    });
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "Perf Root",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASS,
        DATABASE_URL: DB_URL,
      },
      encoding: "utf8",
    });
    // Real login + TOTP enrolment → full session (test-process only).
    const login = await api("POST", "/api/auth/login", {
      email: ROOT_EMAIL,
      password: ROOT_PASS,
    });
    expect(login.status, JSON.stringify(login.json)).toBe(200);
    absorbCookies(login.headers);
    csrf = login.json.csrfToken as string;
    if (login.json.authLevel !== "full") {
      const enrol = await api("POST", "/api/auth/mfa/enrol", {});
      expect(enrol.status, JSON.stringify(enrol.json)).toBe(200);
      const confirm = await api("POST", "/api/auth/mfa/confirm", {
        code: authenticator.generate(enrol.json.secret as string),
      });
      expect(confirm.status, JSON.stringify(confirm.json)).toBe(200);
      absorbCookies(confirm.headers);
    }
  }, 240000);

  afterAll(async () => {
    server?.close();
    await handle?.close();
  });

  it("grouped reserved matches the per-product algorithm for every product", async () => {
    const list0 = await api("GET", "/api/admin/products?page=1&pageSize=50");
    expect(list0.status, JSON.stringify(list0.json)).toBe(200);
    const items0 = list0.json.data as Array<{ id: number }>;
    expect(items0.length).toBeGreaterThanOrEqual(4);
    const [p1, p2, p3, p4] = items0;
    const pool = handle.pool;
    const move = async (productId: number, type: string, qty: number) => {
      await pool.query(
        "INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after) VALUES (?, ?, ?, 0)",
        [productId, type, qty],
      );
    };
    await move(p1.id, "RESERVE", -3);
    await move(p1.id, "RELEASE", 1);
    await move(p1.id, "ORDER_DEDUCT", -4);
    await move(p2.id, "RELEASE", 2);
    // Zero-sum pair: reserved must come out exactly 0 (the −0/+0
    // parity the raw negated sum hides in-process).
    await move(p3.id, "RESERVE", -2);
    await move(p3.id, "RELEASE", 2);
    // Untracked product with live movements: reserved still reports
    // the grouped value, but availableQty must ignore it entirely.
    await pool.query("UPDATE products SET track_inventory = 0 WHERE id = ?", [
      p4.id,
    ]);
    await move(p4.id, "RESERVE", -5);
    // Over-reservation + multi-variant spread on p1: reservations
    // across two variants (product-level grouping must sum them all)
    // push reserved past the stock on hand — availableQty must go
    // negative exactly like the old math, never clamped.
    await pool.query(
      "INSERT INTO product_variants (product_id, name) VALUES (?, 'Perf V1'), (?, 'Perf V2')",
      [p1.id, p1.id],
    );
    const [vRows] = await pool.query(
      "SELECT id FROM product_variants WHERE product_id = ? ORDER BY id",
      [p1.id],
    );
    const vIds = (vRows as Array<{ id: number }>).map((r) => r.id);
    expect(vIds.length).toBeGreaterThanOrEqual(2);
    const moveVariant = async (variantId: number, type: string, qty: number) => {
      await pool.query(
        "INSERT INTO inventory_movements (product_id, variant_id, movement_type, quantity, balance_after) VALUES (?, ?, ?, ?, 0)",
        [p1.id, variantId, type, qty],
      );
    };
    await moveVariant(vIds[0]!, "RESERVE", -20);
    await moveVariant(vIds[1]!, "RELEASE", 3);

    const list = await api("GET", "/api/admin/products?page=1&pageSize=50");
    expect(list.status).toBe(200);
    const items = list.json.data as Array<{
      id: number;
      reservedQty: number;
      availableQty: number;
      stockQty: number;
      trackInventory: boolean;
    }>;
    expect(items.length).toBe(items0.length);
    for (const item of items) {
      const [rows] = await pool.query(
        "SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_movements WHERE product_id = ? AND movement_type IN ('RESERVE', 'RELEASE')",
        [item.id],
      );
      // `|| 0` normalises -0 (the raw negated sum) to the +0 the JSON
      // contract carries — the old per-product function returns the
      // same -0 in-process, so this is parity, not a fudge.
      const expectedReserved =
        -Number((rows as Array<{ total: number | string }>)[0]?.total ?? 0) ||
        0;
      expect(item.reservedQty, `product ${item.id} reserved`).toBe(
        expectedReserved,
      );
      expect(item.availableQty, `product ${item.id} available`).toBe(
        item.trackInventory
          ? item.stockQty - expectedReserved
          : item.stockQty,
      );
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    // p1: −3 +1 (product-level) −20 +3 (two variants) = reserved 19,
    // over its stock — availableQty negative, unclamped.
    expect(byId.get(p1.id)?.reservedQty).toBe(19);
    expect(byId.get(p1.id)?.availableQty).toBe(
      byId.get(p1.id)!.stockQty - 19,
    );
    expect(byId.get(p1.id)?.availableQty).toBeLessThan(0);
    expect(byId.get(p2.id)?.reservedQty).toBe(-2);
    expect(byId.get(p3.id)?.reservedQty).toBe(0);
    const untracked = byId.get(p4.id)!;
    expect(untracked.trackInventory).toBe(false);
    expect(untracked.reservedQty).toBe(5);
    expect(untracked.availableQty).toBe(untracked.stockQty);
  });

  it("news list omits the body; the detail keeps it", async () => {
    const created = await api("POST", "/api/admin/news", {
      title: `Perf Guards Article ${runId}`,
      slug: `perf-guards-${runId}`,
      summary: "Short summary.",
      content: "<p>The full body that must not ride the list.</p>",
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const id = created.json.data.id as number;
    const list = await api("GET", "/api/admin/news?page=1&pageSize=25");
    expect(list.status).toBe(200);
    const item = (list.json.data as Array<Record<string, unknown>>).find(
      (a) => a.id === id,
    );
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("contentPlain");
    const detail = await api("GET", `/api/admin/news/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.content).toContain("full body");
  });

  it("JSON gzips on request; the invoice PDF never compresses", async () => {
    const gz = await api("GET", "/api/admin/news?page=1&pageSize=25", undefined, {
      "Accept-Encoding": "gzip",
    });
    expect(gz.status).toBe(200);
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    // fetch transparently decompressed: the payload still parses.
    expect(Array.isArray(gz.json.data)).toBe(true);

    const pdf = await api(
      "GET",
      "/api/admin/invoice-template/preview.pdf",
      undefined,
      { "Accept-Encoding": "gzip" },
    );
    expect(pdf.status, `pdf status ${pdf.status}`).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(pdf.headers.get("content-encoding")).toBeNull();
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 4))).toBe("%PDF");
  });
});
