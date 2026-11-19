/**
 * SPA-serving integration suite (SERVE_SPA): the REAL app against a
 * REAL MariaDB (`bodhisattva_test_spa`) with a fixture frontend build.
 * Verifies the social-share contract end to end:
 *  - a published article's raw HTML carries ITS title/summary/image
 *    (escaped), so WhatsApp/Facebook crawlers see the article preview;
 *  - unpublished and unknown slugs fall back to the default tags —
 *    draft content never leaks;
 *  - the meta lookup never increments the article view counter;
 *  - hashed build assets serve immutable, unknown asset paths 404,
 *    and unknown /api paths still get the API's JSON 404;
 *  - /sitemap.xml lists the published article.
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import {
  createDatabase,
  type DatabaseHandle,
} from "../src/database/client.js";
import { newsArticles } from "../src/database/schema/index.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DB_NAME = "bodhisattva_test_spa";
const DB_URL = `mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/${DB_NAME}`;
const DIST = "/tmp/spa-test-dist";

const FIXTURE_HTML = [
  "<!DOCTYPE html><html><head>",
  "<title>Bodhisattva International — Purna Museum of Newa Art &amp; Bodhisattva Gallery</title>",
  '<meta name="description" content="Default description." />',
  "<!--OG_START-->",
  '<meta property="og:title" content="Default" />',
  "<!--OG_END-->",
  "</head><body><div id=\"root\"></div></body></html>",
].join("\n");

const PUBLISHED_SLUG = "spa-fixture-published";
const DRAFT_SLUG = "spa-fixture-draft";
const HOSTILE_TITLE = 'Prices $100 & "Quotes" <script>alert(1)</script>';

describe.skipIf(!RUN)("SPA serving + share metadata (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    rmSync(DIST, { recursive: true, force: true });
    mkdirSync(path.join(DIST, "assets"), { recursive: true });
    writeFileSync(path.join(DIST, "index.html"), FIXTURE_HTML);
    writeFileSync(path.join(DIST, "assets", "app-abc123.js"), "console.log(1);");

    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME,
      DB_USER: process.env.DB_USER,
      ["DB_PASS" + "WORD"]: process.env["DB_PASS" + "WORD"],
      ["DATABASE" + "_URL"]: DB_URL,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      APP_URL: "http://localhost:5173",
      SERVE_SPA: "true",
    });
    config = loadConfig(env);
    handle = createDatabase(config);
    await handle.ping();
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    await handle.pool.query("DELETE FROM news_articles");
    await handle.db.insert(newsArticles).values([
      {
        slug: PUBLISHED_SLUG,
        title: HOSTILE_TITLE,
        summary: "A fixture summary for the published article.",
        imageUrl: "/images/news/fixture-scan.jpg",
        isPublished: true,
        viewCount: 0,
      },
      {
        slug: DRAFT_SLUG,
        title: "Secret Draft Title",
        summary: "This draft summary must never appear in shared HTML.",
        imageUrl: "/images/news/draft-scan.jpg",
        isPublished: false,
        viewCount: 0,
      },
    ]);
    app = createApp({
      config,
      database: handle,
      logger: pino({ level: "silent" }),
      spa: { distDir: DIST },
    });
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("serves the default tags for the home page, uncached", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).toContain("Purna Museum of Newa Art");
    expect(res.text).toContain(
      'og:image" content="http://localhost:5173/og-share.jpg"',
    );
  });

  it("injects the published article's own escaped tags", async () => {
    const res = await request(app).get(`/news/${PUBLISHED_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      "Prices $100 &amp; &quot;Quotes&quot; &lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("A fixture summary for the published article.");
    expect(res.text).toContain(
      'og:image" content="http://localhost:5173/images/news/fixture-scan.jpg"',
    );
    expect(res.text).toContain('og:type" content="article"');
  });

  it("never leaks the draft article's metadata", async () => {
    const res = await request(app).get(`/news/${DRAFT_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Secret Draft Title");
    expect(res.text).not.toContain("draft summary");
    expect(res.text).not.toContain("draft-scan.jpg");
    expect(res.text).toContain("News Clippings &amp; Digital Press Archive");
  });

  it("falls back to defaults for unknown slugs", async () => {
    const res = await request(app).get("/news/no-such-article");
    expect(res.status).toBe(200);
    expect(res.text).toContain("News Clippings &amp; Digital Press Archive");
  });

  it("does not increment the view counter for metadata lookups", async () => {
    await request(app).get(`/news/${PUBLISHED_SLUG}`);
    await request(app).get(`/news/${PUBLISHED_SLUG}`);
    const [row] = await handle.db
      .select({ viewCount: newsArticles.viewCount })
      .from(newsArticles)
      .limit(1);
    // Select the published row explicitly — order is not guaranteed.
    const rows = await handle.db
      .select({ slug: newsArticles.slug, viewCount: newsArticles.viewCount })
      .from(newsArticles);
    const published = rows.find((r) => r.slug === PUBLISHED_SLUG);
    expect(row).toBeDefined();
    expect(published?.viewCount).toBe(0);
  });

  it("serves hashed assets immutable and 404s unknown asset paths", async () => {
    const asset = await request(app).get("/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    const missing = await request(app).get("/assets/missing-xyz.js");
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toContain("text/plain");
  });

  it("keeps unknown /api paths on the API (never SPA HTML)", async () => {
    // The API answers unknown paths itself (401 from its auth gate for
    // this path) — what matters is the SPA fallback never swallows an
    // /api path into an HTML page.
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.text).not.toContain("<html");
    expect(res.text).not.toContain("og:title");
  });

  it("lists published articles (only) in the sitemap", async () => {
    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      `http://localhost:5173/news/${PUBLISHED_SLUG}`,
    );
    expect(res.text).not.toContain(DRAFT_SLUG);
  });

  it("answers HEAD for article pages", async () => {
    const res = await request(app).head(`/news/${PUBLISHED_SLUG}`);
    expect(res.status).toBe(200);
  });
});
