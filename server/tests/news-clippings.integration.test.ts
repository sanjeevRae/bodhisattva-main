/**
 * News Clippings & Digital Press Archive integration suite (migration
 * 0011). Runs the REAL app against a REAL MariaDB
 * (`bodhisattva_test_news`, its own database like the other suites) with
 * the REAL seed, then replaces the seeded news content with controlled
 * fixtures created through the admin API.
 *
 * Covers: migration state; the extended public archive (filters, search
 * incl. content/author/tag matches, sorts, pagination meta, facets);
 * article detail + related + view counter; draft invisibility; the PDF
 * lifecycle (upload → checksum, public view + Range, download counter,
 * replace with history link, remove, draft-PDF privacy, admin serving);
 * duplicate; publish/unpublish + bulk; preview tokens (draft readable,
 * garbage/expired 404); permissions (customer + STORE_ADMIN → 403);
 * XSS sanitisation at save; SQL-injection probe safety; audit rows for
 * the PDF actions. Guarded by INTEGRATION_DB=1 like the other suites.
 *
 * Review fix round (ChatGPT 8.7 / Gemini 8.6) adds: content_plain search
 * (visible words match, markup words like "strong"/"href" never do);
 * the concurrent-replacement race invariant (exactly one ACTIVE
 * attachment, consistent replaced_by chain); the public media route
 * refusing PDF assets; and the sandbox CSP header on PDF responses.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import {
  roles as rolesTable,
  userRoles,
  users,
} from "../src/database/schema/index.js";
import { hashPassword } from "../src/utils/password.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/news-test-uploads";
const MAILBOX = "/tmp/mailbox";
const DB_NAME = "bodhisattva_test_news";
const DB_URL = `mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `news-root-${runId}@example.com`;
const ROOT_PASSWORD = "NewsRoot!2345";
const STORE_EMAIL = `news-store-${runId}@example.com`;
const STORE_PASSWORD = "NewsStore!2345";
const CUSTOMER_EMAIL = `news-customer-${runId}@example.com`;
const CUSTOMER_PASSWORD = "NewsCustomer!2345";

const sha256 = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

/** Hand-built minimal PDF: correct signature + EOF marker, with a unique
 * marker string so byte-identity assertions can tell versions apart. */
function makePdf(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n% ${marker}\n%%EOF`,
    "utf8",
  );
}

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

function extractOtp(text: string): string {
  const anchored = text.match(/verification code is:\s*(\d{8})/);
  if (anchored) return anchored[1];
  const body = text.split(/\r?\n\r?\n/).slice(1).join("\n");
  const m = body.match(/\b(\d{8})\b/);
  if (!m) throw new Error("no 8-digit code found in mail body");
  return m[1];
}

/** Binary-safe GET through supertest (null agent = anonymous). */
async function getBinary(
  agent: ReturnType<typeof request.agent> | null,
  app: ReturnType<typeof createApp>,
  url: string,
  headers: Record<string, string> = {},
) {
  const target = agent ?? request(app);
  let call = target.get(url).buffer(true);
  for (const [key, value] of Object.entries(headers)) call = call.set(key, value);
  return call.parse((response, callback) => {
    const chunks: Buffer[] = [];
    (response as NodeJS.ReadableStream).on("data", (c: Buffer) => chunks.push(c));
    (response as NodeJS.ReadableStream).on("end", () =>
      callback(null, Buffer.concat(chunks)),
    );
  });
}

interface NewsItem {
  id: number;
  slug: string;
  title: string;
  author: string | null;
  articleType: string | null;
  isFeatured: boolean;
  hasPdf: boolean;
  readingTimeMinutes: number | null;
  tags: { id: number; name: string; slug: string }[];
  [key: string]: unknown;
}

describe.skipIf(!RUN)("News clippings archive (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  const state: {
    admin?: ReturnType<typeof request.agent>;
    csrf?: string;
    storeAdmin?: ReturnType<typeof request.agent>;
    storeCsrf?: string;
    customer?: ReturnType<typeof request.agent>;
    customerCsrf?: string;
  } = {};
  const fx: {
    catPress?: number;
    catMedia?: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
    delta?: number;
    epsilon?: number;
    betaMediaId?: number;
  } = {};

  const pool = () => handle.pool;

  async function counterOf(articleId: number, column: "view_count" | "pdf_download_count"): Promise<number> {
    const [rows] = await pool().query(
      `SELECT ${column} AS v FROM news_articles WHERE id = ?`,
      [articleId],
    );
    return Number((rows as { v: number }[])[0].v);
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
    // Self-sufficient: migrate this suite's DB, wipe, then seed for real.
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    const p = handle.pool;
    // Full wipe (FK checks off — throwaway suite DB), mirroring the cap
    // suite's table list plus the news-clippings tables.
    const wipeTables = [
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
    // Controlled fixtures: drop the seeded news content (categories and
    // articles only — roles/permissions from the seed stay).
    await p.query("DELETE FROM news_articles");
    await p.query("DELETE FROM news_categories");
    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("migration 0011 state: columns, tables and the extended FULLTEXT", async () => {
    const [cols] = await pool().query(
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'news_articles'",
      [DB_NAME],
    );
    const names = (cols as { c: string }[]).map((r) => r.c);
    for (const expected of ["content", "content_plain", "author", "is_featured", "view_count", "pdf_download_count"]) {
      expect(names).toContain(expected);
    }
    const [tables] = await pool().query(
      "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [DB_NAME],
    );
    const tableNames = (tables as { t: string }[]).map((r) => r.t);
    for (const expected of ["news_tags", "news_article_tags", "news_attachments", "news_preview_tokens"]) {
      expect(tableNames).toContain(expected);
    }
    const [ft] = await pool().query(
      "SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'news_articles' AND INDEX_NAME = 'ft_news_search' ORDER BY SEQ_IN_INDEX",
      [DB_NAME],
    );
    expect((ft as { c: string }[]).map((r) => r.c)).toEqual([
      "title",
      "summary",
      "outlet",
      "author",
      "content_plain",
    ]);
  });

  it("bootstraps a Super Admin and reaches a full MFA session", async () => {
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "News Root",
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
    state.csrf = csrf;
  }, 120000);

  it("creates controlled fixtures through the admin API", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const catA = await admin
      .post("/api/admin/news/categories")
      .set("X-CSRF-Token", csrf)
      .send({ slug: "press", name: "Press" });
    expect(catA.status).toBe(201);
    fx.catPress = catA.body.data.id as number;
    const catB = await admin
      .post("/api/admin/news/categories")
      .set("X-CSRF-Token", csrf)
      .send({ slug: "media", name: "Media" });
    expect(catB.status).toBe(201);
    fx.catMedia = catB.body.data.id as number;

    const longContent = `<p>${"word ".repeat(240)}quixotic finale</p>`;
    const create = async (
      body: Record<string, unknown>,
    ): Promise<{ status: number; id: number }> => {
      const res = await admin
        .post("/api/admin/news")
        .set("X-CSRF-Token", csrf)
        .send(body);
      return { status: res.status, id: res.body.data?.id as number };
    };

    const alpha = await create({
      slug: "fx-alpha",
      categoryId: fx.catPress,
      title: "Alpha Exhibition Opens",
      outlet: "The Himalayan Times",
      articleType: "News",
      summary: "The alpha exhibition opened in the capital.",
      content: longContent,
      author: "Sita Sharma",
      publishedOn: "2024-03-15",
      isPublished: true,
      isFeatured: true,
      tags: ["Exhibition", "Kathmandu"],
    });
    expect(alpha.status).toBe(201);
    fx.alpha = alpha.id;

    const beta = await create({
      slug: "fx-beta",
      categoryId: fx.catMedia,
      title: "Beta Sculpture Feature",
      outlet: "Kantipur Daily",
      articleType: "Feature",
      summary: "A feature on bronze casting.",
      content: "<p>Short body.</p>",
      author: "Ram Bahadur",
      publishedOn: "2025-06-20",
      isPublished: true,
      tags: ["Sculpture"],
    });
    expect(beta.status).toBe(201);
    fx.beta = beta.id;

    const gamma = await create({
      slug: "fx-gamma",
      categoryId: fx.catPress,
      title: "Gamma Interview",
      outlet: "The Himalayan Times",
      articleType: "Interview",
      summary: "A conversation with the curator.",
      publishedOn: "2025-06-20",
      isPublished: true,
    });
    expect(gamma.status).toBe(201);
    fx.gamma = gamma.id;

    const delta = await create({
      slug: "fx-delta",
      categoryId: fx.catPress,
      title: "Delta Draft Story",
      outlet: "Draft Outlet",
      articleType: "News",
      summary: "Unpublished draft.",
      publishedOn: "2026-01-10",
      isPublished: false,
    });
    expect(delta.status).toBe(201);
    fx.delta = delta.id;

    const epsilon = await create({
      slug: "fx-epsilon",
      categoryId: fx.catMedia,
      title: "Epsilon Review",
      outlet: "Online Khabar",
      articleType: "Review",
      summary: "A review of the retrospective.",
      publishedOn: "2023-01-05",
      isPublished: true,
    });
    expect(epsilon.status).toBe(201);
    fx.epsilon = epsilon.id;
  });

  it("public list: additive item shape, no counters, drafts hidden", async () => {
    const res = await request(app).get("/api/news");
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeUndefined();
    const items = res.body.data.items as NewsItem[];
    expect(items.map((i) => i.slug).sort()).toEqual([
      "fx-alpha",
      "fx-beta",
      "fx-epsilon",
      "fx-gamma",
    ]);
    const alpha = items.find((i) => i.slug === "fx-alpha")!;
    expect(alpha.author).toBe("Sita Sharma");
    expect(alpha.articleType).toBe("News");
    expect(alpha.isFeatured).toBe(true);
    expect(alpha.hasPdf).toBe(false);
    expect(alpha.readingTimeMinutes).toBe(2);
    expect(alpha.tags.map((t) => t.name).sort()).toEqual(["Exhibition", "Kathmandu"]);
    // The list payload must never carry the article body (detail-only).
    expect(alpha).not.toHaveProperty("content");
    expect(alpha).not.toHaveProperty("contentPlain");
    expect(alpha).not.toHaveProperty("viewCount");
    expect(alpha).not.toHaveProperty("pdfDownloadCount");
    expect(alpha).not.toHaveProperty("view_count");
    expect(alpha).not.toHaveProperty("pdf_download_count");
  });

  it("public list filters: category, publication, year, dates, type, featured", async () => {
    const slugs = async (qs: string): Promise<string[]> => {
      const res = await request(app).get(`/api/news?${qs}`);
      expect(res.status).toBe(200);
      return (res.body.data.items as NewsItem[]).map((i) => i.slug).sort();
    };
    expect(await slugs("category=press")).toEqual(["fx-alpha", "fx-gamma"]);
    expect(await slugs("publication=The%20Himalayan%20Times")).toEqual(["fx-alpha", "fx-gamma"]);
    expect(await slugs("year=2025")).toEqual(["fx-beta", "fx-gamma"]);
    expect(await slugs("year=2024")).toEqual(["fx-alpha"]);
    expect(await slugs("dateFrom=2025-01-01&dateTo=2025-12-31")).toEqual(["fx-beta", "fx-gamma"]);
    expect(await slugs("type=Feature")).toEqual(["fx-beta"]);
    expect(await slugs("featured=true")).toEqual(["fx-alpha"]);
    expect(await slugs("hasPdf=false")).toEqual(["fx-alpha", "fx-beta", "fx-epsilon", "fx-gamma"]);
    expect(await slugs("hasPdf=true")).toEqual([]);
  });

  it("public search matches content, author and tag names", async () => {
    const slugs = async (term: string): Promise<string[]> => {
      const res = await request(app).get(`/api/news?search=${encodeURIComponent(term)}`);
      expect(res.status).toBe(200);
      return (res.body.data.items as NewsItem[]).map((i) => i.slug);
    };
    // Content-only word (FULLTEXT over the body).
    expect(await slugs("quixotic")).toEqual(["fx-alpha"]);
    // Author-only match.
    expect(await slugs("Sita")).toEqual(["fx-alpha"]);
    // Tag-name-only match: "Kathmandu" appears nowhere else in alpha.
    expect(await slugs("Kathmandu")).toEqual(["fx-alpha"]);
    expect(await slugs("Sculpture")).toContain("fx-beta");
  });

  it("search matches visible words via content_plain, never markup words", async () => {
    const admin = state.admin!;
    const created = await admin
      .post("/api/admin/news")
      .set("X-CSRF-Token", state.csrf!)
      .send({
        slug: "fx-markup",
        categoryId: fx.catPress,
        title: "Markup Search Probe",
        outlet: "Probe Outlet",
        articleType: "News",
        summary: "A probe of the search index.",
        content:
          '<p>A <strong>bold</strong> claim and a <a href="https://example.com/story">linked report</a> about bronzes.</p>',
        publishedOn: "2025-03-03",
        isPublished: true,
      });
    expect(created.status).toBe(201);
    const probeId = created.body.data.id as number;

    // The stored HTML really carries the markup (so the negative results
    // below are thanks to content_plain, not the sanitizer), and the
    // projection holds only the visible words.
    const [rows] = await pool().query(
      "SELECT content, content_plain AS plain FROM news_articles WHERE id = ?",
      [probeId],
    );
    const stored = (rows as { content: string; plain: string }[])[0];
    expect(stored.content).toContain("<strong>");
    expect(stored.content).toContain("href=");
    expect(stored.plain).toContain("bold claim");
    expect(stored.plain).toContain("linked report");
    expect(stored.plain).not.toContain("strong");
    expect(stored.plain).not.toContain("href");
    expect(stored.plain).not.toContain("<");

    const slugs = async (term: string): Promise<string[]> => {
      const res = await request(app).get(`/api/news?search=${encodeURIComponent(term)}`);
      expect(res.status).toBe(200);
      return (res.body.data.items as NewsItem[]).map((i) => i.slug);
    };
    // Visible words match — the body is still fully searchable.
    expect(await slugs("bold")).toContain("fx-markup");
    expect(await slugs("bronzes")).toContain("fx-markup");
    expect(await slugs("quixotic")).toEqual(["fx-alpha"]);
    // Markup words (tag/attribute names in the stored HTML) never match.
    expect(await slugs("strong")).not.toContain("fx-markup");
    expect(await slugs("href")).not.toContain("fx-markup");

    // Clean up so later list assertions stay deterministic.
    const archived = await admin
      .post("/api/admin/news/bulk")
      .set("X-CSRF-Token", state.csrf!)
      .send({ ids: [probeId], action: "archive" });
    expect(archived.status).toBe(200);
  });

  it("public search survives an SQL-injection probe", async () => {
    const probe = await request(app).get(
      `/api/news?search=${encodeURIComponent("' UNION SELECT password_hash FROM users -- ")}`,
    );
    expect(probe.status).toBe(200);
    expect(probe.body.success).toBe(true);
    expect(JSON.stringify(probe.body)).not.toContain("password_hash");
    const probe2 = await request(app).get(
      `/api/news?publication=${encodeURIComponent("x' OR '1'='1")}`,
    );
    expect(probe2.status).toBe(200);
    expect(probe2.body.data.items).toHaveLength(0);
  });

  it("public sorts: newest, oldest, added, alpha", async () => {
    const order = async (qs: string): Promise<string[]> => {
      const res = await request(app).get(`/api/news?${qs}`);
      expect(res.status).toBe(200);
      return (res.body.data.items as NewsItem[]).map((i) => i.slug);
    };
    expect(await order("")).toEqual(["fx-gamma", "fx-beta", "fx-alpha", "fx-epsilon"]);
    expect(await order("sort=newest")).toEqual(["fx-gamma", "fx-beta", "fx-alpha", "fx-epsilon"]);
    expect(await order("sort=oldest")).toEqual(["fx-epsilon", "fx-alpha", "fx-beta", "fx-gamma"]);
    expect(await order("sort=alpha")).toEqual(["fx-alpha", "fx-beta", "fx-epsilon", "fx-gamma"]);
    expect(await order("sort=added")).toEqual(["fx-epsilon", "fx-gamma", "fx-beta", "fx-alpha"]);
  });

  it("pagination meta appears only when page is supplied", async () => {
    const page1 = await request(app).get("/api/news?page=1&pageSize=2");
    expect(page1.status).toBe(200);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    expect(page1.body.data.items).toHaveLength(2);
    const page2 = await request(app).get("/api/news?page=2&pageSize=2");
    expect(page2.body.data.items).toHaveLength(2);
    const page1Slugs = (page1.body.data.items as NewsItem[]).map((i) => i.slug);
    const page2Slugs = (page2.body.data.items as NewsItem[]).map((i) => i.slug);
    expect([...page1Slugs, ...page2Slugs].sort()).toEqual([
      "fx-alpha",
      "fx-beta",
      "fx-epsilon",
      "fx-gamma",
    ]);
  });

  it("facets: categories, publications, years, types over published only", async () => {
    const res = await request(app).get("/api/news/facets");
    expect(res.status).toBe(200);
    const facets = res.body.data as {
      categories: { slug: string; count: number }[];
      publications: { name: string; count: number }[];
      years: number[];
      types: string[];
    };
    expect(facets.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "press", count: 2 }),
        expect.objectContaining({ slug: "media", count: 2 }),
      ]),
    );
    expect(facets.publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "The Himalayan Times", count: 2 }),
        expect.objectContaining({ name: "Kantipur Daily", count: 1 }),
      ]),
    );
    expect(facets.publications.map((p) => p.name)).not.toContain("Draft Outlet");
    expect(facets.years).toEqual([2025, 2024, 2023]);
    expect(facets.types).toEqual(["Feature", "Interview", "News", "Review"]);
  });

  it("detail: content, related (same category first), view counter increments", async () => {
    const before = await counterOf(fx.alpha!, "view_count");
    const res = await request(app).get("/api/news/fx-alpha");
    expect(res.status).toBe(200);
    const detail = res.body.data as NewsItem & {
      content: string | null;
      pdf: unknown;
      related: NewsItem[];
    };
    expect(detail.content).toContain("quixotic");
    expect(detail.pdf).toBeNull();
    expect(detail.tags.map((t) => t.name).sort()).toEqual(["Exhibition", "Kathmandu"]);
    expect(detail.related.length).toBeGreaterThan(0);
    expect(detail.related.length).toBeLessThanOrEqual(4);
    expect(detail.related[0].slug).toBe("fx-gamma");
    expect(detail.related.map((r) => r.slug)).not.toContain("fx-alpha");
    expect(await counterOf(fx.alpha!, "view_count")).toBe(before + 1);
    const again = await request(app).get("/api/news/fx-alpha");
    expect(again.status).toBe(200);
    expect(await counterOf(fx.alpha!, "view_count")).toBe(before + 2);
  });

  it("draft and unknown article details are 404", async () => {
    const draft = await request(app).get("/api/news/fx-delta");
    expect(draft.status).toBe(404);
    const missing = await request(app).get("/api/news/no-such-article");
    expect(missing.status).toBe(404);
    const draftAttachments = await request(app).get("/api/news/fx-delta/attachments");
    expect(draftAttachments.status).toBe(404);
  });

  it("XSS: script content is sanitised at save", async () => {
    const admin = state.admin!;
    const created = await admin
      .post("/api/admin/news")
      .set("X-CSRF-Token", state.csrf!)
      .send({
        slug: "fx-xss",
        categoryId: fx.catPress,
        title: "XSS Probe",
        outlet: "Probe Outlet",
        articleType: "News",
        summary: "probe",
        content: "<p>Hello readers</p><script>alert(1)</script>",
        publishedOn: "2025-02-02",
        isPublished: true,
      });
    expect(created.status).toBe(201);
    const detail = await request(app).get("/api/news/fx-xss");
    expect(detail.status).toBe(200);
    const content = (detail.body.data as { content: string }).content;
    expect(content).toContain("Hello readers");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("alert(1)");
    // Clean up so later list assertions stay deterministic.
    const archived = await admin
      .post("/api/admin/news/bulk")
      .set("X-CSRF-Token", state.csrf!)
      .send({ ids: [created.body.data.id as number], action: "archive" });
    expect(archived.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // PDF lifecycle
  // -------------------------------------------------------------------------

  const pdfV1 = makePdf("ALPHA-VERSION-ONE");
  const pdfV2 = makePdf("ALPHA-VERSION-TWO-LONGER");

  async function auditCount(action: string): Promise<number> {
    const [rows] = await pool().query(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?",
      [action],
    );
    return Number((rows as { c: number }[])[0].c);
  }

  it("PDF upload: happy path stores the checksum and audits news.pdf.upload", async () => {
    const admin = state.admin!;
    const res = await admin
      .post(`/api/admin/news/${fx.alpha}/pdf`)
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", pdfV1, { filename: "alpha-clipping.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.checksum).toBe(sha256(pdfV1));
    expect(res.body.data.originalName).toBe("alpha-clipping.pdf");
    expect(await auditCount("news.pdf.upload")).toBeGreaterThanOrEqual(1);

    const detail = await request(app).get("/api/news/fx-alpha");
    const pdf = (detail.body.data as { pdf: { originalName: string; fileSize: number; viewUrl: string; downloadUrl: string } | null }).pdf;
    expect(pdf).not.toBeNull();
    expect(pdf!.originalName).toBe("alpha-clipping.pdf");
    expect(pdf!.fileSize).toBe(pdfV1.length);
    expect(pdf!.viewUrl).toBe("/api/news/fx-alpha/pdf/view");
    expect(pdf!.downloadUrl).toBe("/api/news/fx-alpha/pdf/download");

    const list = await request(app).get("/api/news?hasPdf=true");
    expect((list.body.data.items as NewsItem[]).map((i) => i.slug)).toEqual(["fx-alpha"]);

    const attachments = await request(app).get("/api/news/fx-alpha/attachments");
    expect(attachments.status).toBe(200);
    expect(attachments.body.data.items).toHaveLength(1);
    expect(JSON.stringify(attachments.body)).not.toContain("storageName");
    expect(JSON.stringify(attachments.body)).not.toContain("checksum");
  });

  it("public PDF view serves bytes with range support; download counts", async () => {
    const view = await getBinary(null, app, "/api/news/fx-alpha/pdf/view");
    expect(view.status).toBe(200);
    expect(view.headers["content-type"]).toContain("application/pdf");
    expect(view.headers["accept-ranges"]).toBe("bytes");
    expect(view.headers["x-content-type-options"]).toBe("nosniff");
    expect((view.body as Buffer).equals(pdfV1)).toBe(true);

    const ranged = await getBinary(null, app, "/api/news/fx-alpha/pdf/view", {
      Range: "bytes=0-7",
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-range"]).toBe(`bytes 0-7/${pdfV1.length}`);
    expect((ranged.body as Buffer).toString("utf8")).toBe("%PDF-1.4");

    const badRange = await getBinary(null, app, "/api/news/fx-alpha/pdf/view", {
      Range: "bytes=99999-",
    });
    expect(badRange.status).toBe(416);
    expect(badRange.headers["content-range"]).toBe(`bytes */${pdfV1.length}`);

    const before = await counterOf(fx.alpha!, "pdf_download_count");
    const download = await getBinary(null, app, "/api/news/fx-alpha/pdf/download");
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["content-disposition"]).toContain('filename="alpha-clipping.pdf"');
    expect((download.body as Buffer).equals(pdfV1)).toBe(true);
    expect(await counterOf(fx.alpha!, "pdf_download_count")).toBe(before + 1);
  });

  it("PDF validation: bad signature and spoofed extension rejected, state untouched", async () => {
    const admin = state.admin!;
    const badBytes = await admin
      .post(`/api/admin/news/${fx.alpha}/pdf`)
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", Buffer.from("this is not a pdf at all"), {
        filename: "fake.pdf",
        contentType: "application/pdf",
      });
    expect(badBytes.status).toBe(400);
    expect(badBytes.body.error.code).toBe("VALIDATION_FAILED");

    const spoofed = await admin
      .post(`/api/admin/news/${fx.alpha}/pdf`)
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", pdfV1, { filename: "payload.exe", contentType: "application/pdf" });
    expect(spoofed.status).toBe(400);

    // The live document is still version one.
    const view = await getBinary(null, app, "/api/news/fx-alpha/pdf/view");
    expect(view.status).toBe(200);
    expect((view.body as Buffer).equals(pdfV1)).toBe(true);
  });

  it("draft article PDF: public 404, admin can view and download (audited)", async () => {
    const admin = state.admin!;
    const deltaPdf = makePdf("DELTA-DRAFT");
    const upload = await admin
      .post(`/api/admin/news/${fx.delta}/pdf`)
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", deltaPdf, { filename: "delta.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);

    const pubView = await getBinary(null, app, "/api/news/fx-delta/pdf/view");
    expect(pubView.status).toBe(404);
    const pubDownload = await getBinary(null, app, "/api/news/fx-delta/pdf/download");
    expect(pubDownload.status).toBe(404);

    const adminView = await getBinary(state.admin!, app, `/api/admin/news/${fx.delta}/pdf/view`, {
      "X-CSRF-Token": state.csrf!,
    });
    expect(adminView.status).toBe(200);
    expect((adminView.body as Buffer).equals(deltaPdf)).toBe(true);

    const before = await auditCount("news.pdf.download");
    const adminDownload = await getBinary(state.admin!, app, `/api/admin/news/${fx.delta}/pdf/download`, {
      "X-CSRF-Token": state.csrf!,
    });
    expect(adminDownload.status).toBe(200);
    expect(await auditCount("news.pdf.download")).toBe(before + 1);
  });

  it("PDF replace: history link set, metadata preserved, new bytes served", async () => {
    const admin = state.admin!;
    const [beforeRows] = await pool().query(
      "SELECT id, media_id AS mediaId FROM news_attachments WHERE article_id = ? AND status = 'ACTIVE'",
      [fx.alpha],
    );
    const oldAttachment = (beforeRows as { id: number; mediaId: number }[])[0];

    const res = await admin
      .post(`/api/admin/news/${fx.alpha}/pdf`)
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", pdfV2, { filename: "alpha-clipping-v2.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.data.checksum).toBe(sha256(pdfV2));
    expect(await auditCount("news.pdf.replace")).toBeGreaterThanOrEqual(1);

    const [oldRows] = await pool().query(
      "SELECT status, replaced_by_id AS replacedById FROM news_attachments WHERE id = ?",
      [oldAttachment.id],
    );
    const old = (oldRows as { status: string; replacedById: number }[])[0];
    expect(old.status).toBe("REPLACED");
    expect(old.replacedById).toBe(res.body.data.id as number);

    // Article metadata survived the swap; document pointer moved.
    const adminDetail = await admin.get(`/api/admin/news/${fx.alpha}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data.title).toBe("Alpha Exhibition Opens");
    expect(adminDetail.body.data.documentMediaId).toBe(res.body.data.mediaId as number);
    expect(adminDetail.body.data.documentMediaId).not.toBe(oldAttachment.mediaId);
    expect(adminDetail.body.data.attachment.id).toBe(res.body.data.id as number);

    const view = await getBinary(null, app, "/api/news/fx-alpha/pdf/view");
    expect(view.status).toBe(200);
    expect((view.body as Buffer).equals(pdfV2)).toBe(true);
  });

  it("PDF remove: public endpoints 404 and detail pdf becomes null", async () => {
    const admin = state.admin!;
    const removed = await admin
      .delete(`/api/admin/news/${fx.alpha}/pdf`)
      .set("X-CSRF-Token", state.csrf!);
    expect(removed.status).toBe(200);
    expect(await auditCount("news.pdf.remove")).toBeGreaterThanOrEqual(1);

    const view = await getBinary(null, app, "/api/news/fx-alpha/pdf/view");
    expect(view.status).toBe(404);
    const detail = await request(app).get("/api/news/fx-alpha");
    expect((detail.body.data as { pdf: unknown }).pdf).toBeNull();
    const adminDetail = await admin.get(`/api/admin/news/${fx.alpha}`);
    expect(adminDetail.body.data.attachment).toBeNull();
    expect(adminDetail.body.data.documentMediaId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Duplicate, publish/unpublish, bulk
  // -------------------------------------------------------------------------

  it("duplicate: draft copy with -copy slug, tags and shared media", async () => {
    const admin = state.admin!;
    // Give beta a PDF first so the copy must share its media.
    const betaPdf = makePdf("BETA-ORIGINAL");
    const upload = await admin
      .post(`/api/admin/news/${fx.beta}/pdf`)
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", betaPdf, { filename: "beta.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);
    fx.betaMediaId = upload.body.data.mediaId as number;

    const copy = await admin
      .post(`/api/admin/news/${fx.beta}/duplicate`)
      .set("X-CSRF-Token", state.csrf!)
      .send({});
    expect(copy.status).toBe(201);
    expect(copy.body.data.slug).toBe("fx-beta-copy");
    expect(copy.body.data.title).toBe("Beta Sculpture Feature (Copy)");
    expect(copy.body.data.isPublished).toBe(false);
    expect(copy.body.data.tags.map((t: { name: string }) => t.name)).toEqual(["Sculpture"]);
    expect(copy.body.data.attachment).not.toBeNull();
    expect(copy.body.data.attachment.mediaId).toBe(fx.betaMediaId);
    expect(copy.body.data.documentMediaId).toBe(fx.betaMediaId);

    const copy2 = await admin
      .post(`/api/admin/news/${fx.beta}/duplicate`)
      .set("X-CSRF-Token", state.csrf!)
      .send({});
    expect(copy2.status).toBe(201);
    expect(copy2.body.data.slug).toBe("fx-beta-copy-2");

    const list = await request(app).get("/api/news");
    expect((list.body.data.items as NewsItem[]).map((i) => i.slug)).not.toContain("fx-beta-copy");
  });

  it("PDF responses carry the sandbox CSP header (public + admin, view + download)", async () => {
    const expected = "default-src 'none'; sandbox";
    const pubView = await getBinary(null, app, "/api/news/fx-beta/pdf/view");
    expect(pubView.status).toBe(200);
    expect(pubView.headers["content-security-policy"]).toBe(expected);
    expect(pubView.headers["x-content-type-options"]).toBe("nosniff");

    const pubDownload = await getBinary(null, app, "/api/news/fx-beta/pdf/download");
    expect(pubDownload.status).toBe(200);
    expect(pubDownload.headers["content-security-policy"]).toBe(expected);
    expect(pubDownload.headers["content-disposition"]).toContain("attachment");

    const adminView = await getBinary(state.admin!, app, `/api/admin/news/${fx.beta}/pdf/view`, {
      "X-CSRF-Token": state.csrf!,
    });
    expect(adminView.status).toBe(200);
    expect(adminView.headers["content-security-policy"]).toBe(expected);
  });

  it("public media route refuses PDF assets but still serves images", async () => {
    // Beta's PDF media id is known from the duplicate test. The gated
    // news endpoints serve it; the public media file route must not.
    const refused = await getBinary(null, app, `/api/media/${fx.betaMediaId}/file/master`);
    expect(refused.status).toBe(404);

    // Control: a genuine image asset still serves 200 through the route.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = await state.admin!
      .post("/api/admin/media")
      .set("X-CSRF-Token", state.csrf!)
      .attach("file", png, { filename: "pixel.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    const imageId = upload.body.id as number;
    expect(typeof imageId).toBe("number");
    const served = await getBinary(null, app, `/api/media/${imageId}/file/master`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
  });

  it("PDF replace race: two simultaneous uploads leave exactly one ACTIVE attachment", async () => {
    const admin = state.admin!;
    const created = await admin
      .post("/api/admin/news")
      .set("X-CSRF-Token", state.csrf!)
      .send({
        slug: "fx-race",
        categoryId: fx.catPress,
        title: "Race Story",
        outlet: "Race Outlet",
        articleType: "News",
        summary: "Concurrency probe.",
        publishedOn: "2025-07-07",
        isPublished: true,
      });
    expect(created.status).toBe(201);
    const raceId = created.body.data.id as number;

    const pdfA = makePdf("RACE-CANDIDATE-A");
    const pdfB = makePdf("RACE-CANDIDATE-B");
    const uploadOne = (buffer: Buffer, filename: string) =>
      admin
        .post(`/api/admin/news/${raceId}/pdf`)
        .set("X-CSRF-Token", state.csrf!)
        .attach("file", buffer, { filename, contentType: "application/pdf" });
    const [r1, r2] = await Promise.all([
      uploadOne(pdfA, "race-a.pdf"),
      uploadOne(pdfB, "race-b.pdf"),
    ]);
    // Both requests settle: at least one succeeds; the other succeeds or
    // fails cleanly — the DB invariant below is the real assertion.
    const statuses = [r1.status, r2.status];
    expect(statuses).toContain(201);
    for (const status of statuses) {
      if (status !== 201) expect(status).toBeGreaterThanOrEqual(400);
    }

    const [attRows] = await pool().query(
      "SELECT id, media_id AS mediaId, status, replaced_by_id AS replacedById, checksum FROM news_attachments WHERE article_id = ? ORDER BY id",
      [raceId],
    );
    const attachments = attRows as {
      id: number;
      mediaId: number;
      status: string;
      replacedById: number | null;
      checksum: string;
    }[];
    const active = attachments.filter((a) => a.status === "ACTIVE");
    expect(active).toHaveLength(1);
    // The article's document pointer mirrors the surviving attachment.
    const [articleRows] = await pool().query(
      "SELECT document_media_id AS docId FROM news_articles WHERE id = ?",
      [raceId],
    );
    expect((articleRows as { docId: number }[])[0].docId).toBe(active[0].mediaId);
    // Every superseded attachment forms a consistent chain to the winner.
    for (const superseded of attachments.filter((a) => a.status === "REPLACED")) {
      expect(superseded.replacedById).toBe(active[0].id);
    }
    // The public view serves the ACTIVE attachment's bytes, byte-identical.
    const winner = active[0].checksum === sha256(pdfA) ? pdfA : pdfB;
    expect([sha256(pdfA), sha256(pdfB)]).toContain(active[0].checksum);
    const view = await getBinary(null, app, "/api/news/fx-race/pdf/view");
    expect(view.status).toBe(200);
    expect((view.body as Buffer).equals(winner)).toBe(true);
  });

  it("publish/unpublish flips public visibility; bulk publish + archive", async () => {
    const admin = state.admin!;
    const unpublish = await admin
      .post(`/api/admin/news/${fx.epsilon}/unpublish`)
      .set("X-CSRF-Token", state.csrf!)
      .send({});
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.isPublished).toBe(false);
    expect((await request(app).get("/api/news/fx-epsilon")).status).toBe(404);

    const publish = await admin
      .post(`/api/admin/news/${fx.epsilon}/publish`)
      .set("X-CSRF-Token", state.csrf!)
      .send({});
    expect(publish.status).toBe(200);
    expect((await request(app).get("/api/news/fx-epsilon")).status).toBe(200);

    const bulkUnpublish = await admin
      .post("/api/admin/news/bulk")
      .set("X-CSRF-Token", state.csrf!)
      .send({ ids: [fx.gamma, fx.epsilon], action: "unpublish" });
    expect(bulkUnpublish.status).toBe(200);
    expect(bulkUnpublish.body.data.succeeded).toBe(2);
    expect(bulkUnpublish.body.data.failed).toBe(0);
    const listAfter = await request(app).get("/api/news");
    const slugsAfter = (listAfter.body.data.items as NewsItem[]).map((i) => i.slug);
    expect(slugsAfter).not.toContain("fx-gamma");
    expect(slugsAfter).not.toContain("fx-epsilon");

    const bulkPublish = await admin
      .post("/api/admin/news/bulk")
      .set("X-CSRF-Token", state.csrf!)
      .send({ ids: [fx.gamma, fx.epsilon, 99999999], action: "publish" });
    expect(bulkPublish.status).toBe(200);
    expect(bulkPublish.body.data.succeeded).toBe(2);
    expect(bulkPublish.body.data.failed).toBe(1);
    const failedEntry = (bulkPublish.body.data.results as { id: number; ok: boolean }[]).find(
      (r) => r.id === 99999999,
    );
    expect(failedEntry?.ok).toBe(false);

    // Archive = soft delete: gone from admin get and public alike.
    const throwaway = await admin
      .post("/api/admin/news")
      .set("X-CSRF-Token", state.csrf!)
      .send({
        slug: "fx-throwaway",
        title: "Throwaway",
        publishedOn: "2025-05-05",
        isPublished: true,
      });
    expect(throwaway.status).toBe(201);
    const archive = await admin
      .post("/api/admin/news/bulk")
      .set("X-CSRF-Token", state.csrf!)
      .send({ ids: [throwaway.body.data.id as number], action: "archive" });
    expect(archive.body.data.succeeded).toBe(1);
    expect((await admin.get(`/api/admin/news/${throwaway.body.data.id as number}`)).status).toBe(404);
    expect((await request(app).get("/api/news/fx-throwaway")).status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Preview tokens
  // -------------------------------------------------------------------------

  it("preview token: draft readable with preview flag; garbage and expired 404", async () => {
    const admin = state.admin!;
    const viewsBefore = await counterOf(fx.delta!, "view_count");
    const created = await admin
      .post(`/api/admin/news/${fx.delta}/preview`)
      .set("X-CSRF-Token", state.csrf!)
      .send({});
    expect(created.status).toBe(201);
    const token = created.body.data.token as string;
    expect(token).toBeTruthy();
    expect(created.body.data.url).toBe(`/news/preview/${token}`);
    expect(created.body.data.expiresAt).toBeTruthy();

    const preview = await request(app).get(`/api/news/preview/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.slug).toBe("fx-delta");
    expect(preview.body.data.preview).toBe(true);
    expect(preview.headers["cache-control"]).toContain("no-store");
    expect(preview.headers["referrer-policy"]).toBe("no-referrer");
    expect(preview.headers["x-robots-tag"]).toContain("noindex");
    // Previews never bump the public view counter.
    expect(await counterOf(fx.delta!, "view_count")).toBe(viewsBefore);

    const garbage = await request(app).get("/api/news/preview/not-a-real-token");
    expect(garbage.status).toBe(404);

    await pool().query(
      "UPDATE news_preview_tokens SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE token_hash = ?",
      [createHash("sha256").update(token).digest("hex")],
    );
    const expired = await request(app).get(`/api/news/preview/${token}`);
    expect(expired.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  it("creates a STORE_ADMIN user (DB) and a verified customer (API)", async () => {
    const db = handle.db;
    const roleRows = await db
      .select({ id: rolesTable.id, code: rolesTable.code })
      .from(rolesTable);
    const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));
    const passwordHash = await hashPassword(STORE_PASSWORD);
    const [created] = await db
      .insert(users)
      .values({
        fullName: "Store Admin",
        email: STORE_EMAIL,
        emailNormalized: STORE_EMAIL.toLowerCase(),
        passwordHash,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
      })
      .$returningId();
    await db.insert(userRoles).values([
      { userId: created.id, roleId: roleIdByCode.get("CUSTOMER")!, grantedBy: null },
      { userId: created.id, roleId: roleIdByCode.get("STORE_ADMIN")!, grantedBy: null },
    ]);

    const store = request.agent(app);
    const login = await store
      .post("/api/auth/login")
      .send({ email: STORE_EMAIL, password: STORE_PASSWORD });
    expect(login.status).toBe(200);
    const storeCsrf = login.body.csrfToken as string;
    const enrol = await store
      .post("/api/auth/mfa/enrol")
      .set("X-CSRF-Token", storeCsrf)
      .send({});
    expect(enrol.status).toBe(200);
    const confirm = await store
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", storeCsrf)
      .send({ code: authenticator.generate(enrol.body.secret as string) });
    expect(confirm.status).toBe(200);
    state.storeAdmin = store;
    state.storeCsrf = storeCsrf;

    const cust = request.agent(app);
    const reg = await cust.post("/api/auth/register").send({
      name: "News Customer",
      email: CUSTOMER_EMAIL,
      password: CUSTOMER_PASSWORD,
      phone: "+9779812345678",
    });
    expect(reg.status).toBe(200);
    const mail = await waitForMail((t) => t.includes(CUSTOMER_EMAIL));
    const code = extractOtp(mail);
    const verify = await cust
      .post("/api/auth/verify-email")
      .send({ email: CUSTOMER_EMAIL, code });
    expect(verify.status).toBe(200);
    const custLogin = await cust
      .post("/api/auth/login")
      .send({ email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD });
    expect(custLogin.status).toBe(200);
    state.customer = cust;
    state.customerCsrf = custLogin.body.csrfToken as string;
  }, 120000);

  it("customer and STORE_ADMIN get 403 on admin news + PDF endpoints", async () => {
    const agents = [
      { agent: state.customer!, csrf: state.customerCsrf! },
      { agent: state.storeAdmin!, csrf: state.storeCsrf! },
    ];
    for (const { agent, csrf } of agents) {
      const list = await agent.get("/api/admin/news");
      expect(list.status).toBe(403);
      const publish = await agent
        .post(`/api/admin/news/${fx.alpha}/publish`)
        .set("X-CSRF-Token", csrf)
        .send({});
      expect(publish.status).toBe(403);
      const upload = await agent
        .post(`/api/admin/news/${fx.alpha}/pdf`)
        .set("X-CSRF-Token", csrf)
        .attach("file", pdfV1, { filename: "x.pdf", contentType: "application/pdf" });
      expect(upload.status).toBe(403);
      const download = await agent.get(`/api/admin/news/${fx.beta}/pdf/download`);
      expect(download.status).toBe(403);
      const preview = await agent
        .post(`/api/admin/news/${fx.alpha}/preview`)
        .set("X-CSRF-Token", csrf)
        .send({});
      expect(preview.status).toBe(403);
    }
    const anon = await request(app).get("/api/admin/news");
    expect(anon.status).toBe(401);
  });
});
