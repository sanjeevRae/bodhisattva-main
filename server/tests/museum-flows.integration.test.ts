/**
 * Phase 5 integration suite — the museum-module exit gate.
 *
 * Runs the REAL app against a REAL MariaDB (`bodhisattva_test_museum`,
 * its own database like the auth/CMS suites) with the REAL seeded module
 * content (the suite wipes the module + identity tables, then runs the
 * actual seed CLI). Exercises: seeded public payloads (counts, image
 * resolution, derived date/status labels), the collection lifecycle
 * (draft → publish → reorder → delete), duplicate-slug 409,
 * unauthenticated 401, news FULLTEXT search + category filter, the news
 * category delete guard, and the media reference scan extension
 * (collection cover blocks a media delete). No mail is needed.
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/museum-test-uploads";
const DB_URL =
  "mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/bodhisattva_test_museum";
const runId = Date.now().toString(36);
const ROOT_EMAIL = `museum-root-${runId}@example.com`;
const ROOT_PASSWORD = "MuseumRoot!2026";

interface CollectionItem {
  id: number;
  slug: string;
  worksCountLabel: string | null;
  image: { url: string; alt: string } | null;
}

describe.skipIf(!RUN)("Phase 5 museum flows (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  const state: { admin?: ReturnType<typeof request.agent>; csrf?: string } = {};

  beforeAll(async () => {
    rmSync(UPLOADS, { recursive: true, force: true });
    mkdirSync(UPLOADS, { recursive: true });
    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME: "bodhisattva_test_museum",
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
    // Wipe module + identity state (FK-safe order), then seed for real.
    await pool.query("DELETE FROM gallery_items");
    await pool.query("DELETE FROM news_articles");
    await pool.query("DELETE FROM news_categories");
    await pool.query("DELETE FROM testimonials");
    await pool.query("DELETE FROM foundation_programs");
    await pool.query("DELETE FROM exhibitions");
    await pool.query("DELETE FROM collections");
    await pool.query("DELETE FROM media_assets");
    await pool.query("DELETE FROM media_folders");
    await pool.query("DELETE FROM user_roles");
    await pool.query("DELETE FROM user_sessions");
    await pool.query("DELETE FROM invitations");
    await pool.query("DELETE FROM mfa_recovery_codes");
    await pool.query("DELETE FROM mfa_credentials");
    await pool.query("DELETE FROM audit_logs");
    await pool.query("DELETE FROM rate_limits");
    await pool.query("DELETE FROM users");
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
  }, 180000);

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
        BOOTSTRAP_SUPER_ADMIN_NAME: "Museum Root",
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

  it("serves the seeded public payloads with resolved images and labels", async () => {
    const collections = await request(app).get("/api/collections");
    expect(collections.status).toBe(200);
    const items = collections.body.data.items as CollectionItem[];
    expect(items).toHaveLength(4);
    expect(items[0].slug).toBe("paubha-paintings");
    // Real collections publish no artwork count (migration 0013).
    expect(items[0].worksCountLabel).toBeNull();
    expect(items[0].image?.url).toBe("/images/collections/paubha-paintings.jpg");
    expect(items[0].image?.alt).toBeTruthy();

    const exhibitions = await request(app).get("/api/exhibitions");
    expect(exhibitions.status).toBe(200);
    const shows = exhibitions.body.data.items as {
      slug: string;
      status: string;
      dateLabel: string | null;
      locationLabel: string | null;
    }[];
    expect(shows).toHaveLength(21);
    expect(shows[0].slug).toBe("ten-years-of-celebrating-embodied-enlightenment");
    expect(shows[0].status).toBe("current");
    expect(shows[0].dateLabel).toBe("Nov – Dec 2026");
    expect(shows[0].locationLabel).toBe("Purna Museum of Newa Art & Bodhisattva Gallery, Kupondole");

    const news = await request(app).get("/api/news");
    expect(news.status).toBe(200);
    expect(news.body.data.categories).toHaveLength(5);
    const articles = news.body.data.items as {
      slug: string;
      categorySlug: string | null;
      colorToken: string | null;
      sourceName: string | null;
      publishedDate: string | null;
    }[];
    expect(articles).toHaveLength(23);
    // Default ordering is newest first: the November 2026 inauguration
    // coverage (migration 0015) leads, ahead of the 2011–2022 archive.
    expect(articles[0].slug).toBe("art-exhibition-opens-at-bodhisattva");
    expect(articles[0].categorySlug).toBe("news");
    expect(articles[0].colorToken).toBeTruthy();
    expect(articles[0].sourceName).toBe("The Rising Nepal");
    expect(articles[0].publishedDate).toBe("2026-11-17");
    expect([articles[1].slug, articles[2].slug].sort()).toEqual([
      "himani-inaugurates-art-exhibition-kathmandu",
      "himani-shah-inaugurates-embodied-enlightenment",
    ]);
    const flagship = articles.find(
      (a) => a.slug === "into-the-exquisite-world-of-religious-art",
    );
    expect(flagship?.sourceName).toBe("The Kathmandu Post");
    expect(flagship?.publishedDate).toBe("2022-03-10");

    const foundation = await request(app).get("/api/foundation");
    expect(foundation.status).toBe(200);
    expect(foundation.body.data.programs).toHaveLength(3);
    expect(foundation.body.data.testimonials).toHaveLength(4);
    const contexts = (
      foundation.body.data.testimonials as { context: string }[]
    ).map((t) => t.context);
    expect(contexts).toContain("curator");
    expect(contexts.filter((c) => c === "foundation")).toHaveLength(3);
  });

  it("filters news by category and searches headline text", async () => {
    const byCategory = await request(app).get("/api/news?category=interview");
    expect(byCategory.status).toBe(200);
    const catItems = byCategory.body.data.items as { categorySlug: string }[];
    expect(catItems.length).toBeGreaterThan(0);
    expect(catItems.every((a) => a.categorySlug === "interview")).toBe(true);

    const search = await request(app).get("/api/news?search=Karunamaya");
    expect(search.status).toBe(200);
    const hits = search.body.data.items as { slug: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.slug)).toContain("into-the-exquisite-world-of-religious-art");

    const unknown = await request(app).get("/api/news?category=no-such-slug");
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.items).toHaveLength(0);
  });

  it("runs the collection lifecycle: draft → publish → reorder → delete", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const slugA = `lifecycle-a-${runId}`;
    const slugB = `lifecycle-b-${runId}`;

    const createdA = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({ slug: slugA, name: "Lifecycle A", isPublished: false });
    expect(createdA.status).toBe(201);
    const idA = createdA.body.data.id as number;
    expect(createdA.body.data.isPublished).toBe(false);

    const createdB = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({ slug: slugB, name: "Lifecycle B", isPublished: true });
    expect(createdB.status).toBe(201);
    const idB = createdB.body.data.id as number;

    const slugsOf = async (): Promise<string[]> => {
      const res = await request(app).get("/api/collections");
      return (res.body.data.items as CollectionItem[]).map((i) => i.slug);
    };

    // Draft A is absent publicly; published B is present.
    let slugs = await slugsOf();
    expect(slugs).not.toContain(slugA);
    expect(slugs).toContain(slugB);

    // Publish A → present.
    const publish = await admin
      .patch(`/api/admin/collections/${idA}`)
      .set("X-CSRF-Token", csrf)
      .send({ isPublished: true });
    expect(publish.status).toBe(200);
    slugs = await slugsOf();
    expect(slugs).toContain(slugA);
    expect(slugs.indexOf(slugA)).toBeLessThan(slugs.indexOf(slugB));

    // Reorder [B, A] → public order flips.
    const reorder = await admin
      .post("/api/admin/collections/reorder")
      .set("X-CSRF-Token", csrf)
      .send({ ids: [idB, idA] });
    expect(reorder.status).toBe(200);
    slugs = await slugsOf();
    expect(slugs.indexOf(slugB)).toBeLessThan(slugs.indexOf(slugA));

    // Reorder with a foreign id → 400.
    const badReorder = await admin
      .post("/api/admin/collections/reorder")
      .set("X-CSRF-Token", csrf)
      .send({ ids: [idA, 99999999] });
    expect(badReorder.status).toBe(400);

    // Delete A → absent publicly and from admin reads.
    const removed = await admin
      .delete(`/api/admin/collections/${idA}`)
      .set("X-CSRF-Token", csrf);
    expect(removed.status).toBe(200);
    slugs = await slugsOf();
    expect(slugs).not.toContain(slugA);
    const goneAdmin = await admin
      .get(`/api/admin/collections/${idA}`)
      .set("X-CSRF-Token", csrf);
    expect(goneAdmin.status).toBe(404);
  }, 60000);

  it("rejects duplicate slugs with 409 and anonymous admin calls with 401", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const slug = `dupe-${runId}`;
    const first = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({ slug, name: "Dupe One" });
    expect(first.status).toBe(201);
    const second = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({ slug, name: "Dupe Two" });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("CONFLICT");

    const anon = await request(app).get("/api/admin/collections");
    expect(anon.status).toBe(401);
    // An anonymous mutation is stopped even earlier — by the CSRF layer
    // (no session, no token) — with a 403 before auth runs.
    const anonWrite = await request(app).post("/api/admin/collections").send({
      slug: `anon-${runId}`,
      name: "Anon",
    });
    expect(anonWrite.status).toBe(403);
  }, 60000);

  it("guards news category deletes while articles reference the category", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const category = await admin
      .post("/api/admin/news/categories")
      .set("X-CSRF-Token", csrf)
      .send({ slug: `guard-${runId}`, name: "Guard Category" });
    expect(category.status).toBe(201);
    const categoryId = category.body.data.id as number;

    const article = await admin
      .post("/api/admin/news")
      .set("X-CSRF-Token", csrf)
      .send({
        slug: `guard-article-${runId}`,
        title: "Guard Article",
        categoryId,
        outlet: "Test Outlet",
        publishedOn: "2026-11-01",
        summary: "A short summary for the guard test.",
      });
    expect(article.status).toBe(201);
    const articleId = article.body.data.id as number;

    const blocked = await admin
      .delete(`/api/admin/news/categories/${categoryId}`)
      .set("X-CSRF-Token", csrf);
    expect(blocked.status).toBe(409);

    const removedArticle = await admin
      .delete(`/api/admin/news/${articleId}`)
      .set("X-CSRF-Token", csrf);
    expect(removedArticle.status).toBe(200);
    // Soft-deleted articles still hold the FK — the category stays blocked
    // until the referencing row is gone entirely; assert the documented
    // behaviour by checking it is still 409 here.
    const stillBlocked = await admin
      .delete(`/api/admin/news/categories/${categoryId}`)
      .set("X-CSRF-Token", csrf);
    expect(stillBlocked.status).toBe(409);
  }, 60000);

  it("blocks media deletes while a collection cover references the asset", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const png = await sharp({
      create: { width: 800, height: 400, channels: 3, background: "#445566" },
    })
      .png()
      .toBuffer();
    const upload = await admin
      .post("/api/admin/media")
      .set("X-CSRF-Token", csrf)
      .attach("file", png, "cover.png");
    expect(upload.status).toBe(201);
    const assetId = upload.body.id as number;
    expect(assetId).toBeTruthy();

    const created = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({
        slug: `cover-holder-${runId}`,
        name: "Cover Holder",
        coverMediaId: assetId,
        isPublished: true,
      });
    expect(created.status).toBe(201);
    const collectionId = created.body.data.id as number;

    // Public payload resolves the cover through the media pipeline.
    const pub = await request(app).get("/api/collections");
    const holder = (pub.body.data.items as CollectionItem[]).find(
      (i) => i.id === collectionId,
    );
    expect(holder?.image?.url).toBe(`/api/media/${assetId}/file/master`);

    const blocked = await admin
      .delete(`/api/admin/media/${assetId}`)
      .set("X-CSRF-Token", csrf);
    expect(blocked.status).toBe(409);

    const unset = await admin
      .patch(`/api/admin/collections/${collectionId}`)
      .set("X-CSRF-Token", csrf)
      .send({ coverMediaId: null });
    expect(unset.status).toBe(200);
    const removed = await admin
      .delete(`/api/admin/media/${assetId}`)
      .set("X-CSRF-Token", csrf);
    expect(removed.status).toBe(200);
  }, 120000);

  it("cover placement (0024): persists, validates, and clears with the cover source", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const placement = {
      fit: "cover",
      desktop: { x: 20, y: 30, zoom: 1.5 },
      mobile: { x: 25, y: 35, zoom: 2 },
    };
    const slug = `placement-show-${runId}`;

    // Create WITH a placement on a legacy-URL cover → stored verbatim
    // (JSON round trip returns an object, not a string).
    const created = await admin
      .post("/api/admin/exhibitions")
      .set("X-CSRF-Token", csrf)
      .send({
        slug,
        title: "Placement Show",
        imageUrl: "https://example.com/covers/placement-a.jpg",
        imageAlt: "Placement A",
        coverPlacement: placement,
        isPublished: true,
      });
    expect(created.status).toBe(201);
    const showId = created.body.data.id as number;
    expect(created.body.data.coverPlacement).toEqual(placement);

    // Public payload carries it on the resolved image.
    const pubOf = async () => {
      const res = await request(app).get("/api/exhibitions");
      const items = res.body.data.items as {
        id: number;
        image: { url: string; alt: string; placement?: unknown } | null;
      }[];
      return items.find((i) => i.id === showId);
    };
    expect((await pubOf())?.image?.placement).toEqual(placement);

    // Alt-text-only and aspect-only updates preserve the placement.
    const altOnly = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({ imageAlt: "Placement A (revised)" });
    expect(altOnly.status).toBe(200);
    expect(altOnly.body.data.coverPlacement).toEqual(placement);
    const aspectOnly = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({ coverAspect: "tall" });
    expect(aspectOnly.status).toBe(200);
    expect(aspectOnly.body.data.coverPlacement).toEqual(placement);

    // Changing the cover source WITHOUT a placement clears it server-side.
    const swapped = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({ imageUrl: "https://example.com/covers/placement-b.jpg" });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.coverPlacement).toBeNull();
    expect((await pubOf())?.image).not.toHaveProperty("placement");

    // Setting a new placement works; explicit null clears it.
    const replacement = { desktop: { x: 80, y: 10, zoom: 1.2 } };
    const setAgain = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({ coverPlacement: replacement });
    expect(setAgain.status).toBe(200);
    expect(setAgain.body.data.coverPlacement).toEqual(replacement);
    const cleared = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({ coverPlacement: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.coverPlacement).toBeNull();

    // Changing the source WITH a new placement keeps the new one.
    const swapWith = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({
        imageUrl: "https://example.com/covers/placement-c.jpg",
        coverPlacement: placement,
      });
    expect(swapWith.status).toBe(200);
    expect(swapWith.body.data.coverPlacement).toEqual(placement);

    // Removing the cover entirely forces the placement out, even when
    // the payload (wrongly) carries one.
    const removedCover = await admin
      .patch(`/api/admin/exhibitions/${showId}`)
      .set("X-CSRF-Token", csrf)
      .send({ imageUrl: null, coverPlacement: placement });
    expect(removedCover.status).toBe(200);
    expect(removedCover.body.data.coverPlacement).toBeNull();
    expect((await pubOf())?.image).toBeNull();

    // Invalid placements are rejected at the schema boundary.
    const invalid = await admin
      .post("/api/admin/exhibitions")
      .set("X-CSRF-Token", csrf)
      .send({
        slug: `placement-bad-${runId}`,
        title: "Bad Placement",
        imageUrl: "https://example.com/covers/bad.jpg",
        coverPlacement: { desktop: { x: 120, y: 0, zoom: 1 } },
      });
    expect(invalid.status).toBe(400);
    const invalidZoom = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({
        slug: `placement-bad-zoom-${runId}`,
        name: "Bad Zoom",
        imageUrl: "https://example.com/covers/bad.jpg",
        coverPlacement: { desktop: { x: 50, y: 50, zoom: 4 } },
      });
    expect(invalidZoom.status).toBe(400);

    // A record created without a placement: stored NULL, and the public
    // image object has NO placement key (response shape unchanged).
    const plain = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({
        slug: `placement-plain-${runId}`,
        name: "Plain Collection",
        imageUrl: "https://example.com/covers/plain.jpg",
        isPublished: true,
      });
    expect(plain.status).toBe(201);
    expect(plain.body.data.coverPlacement).toBeNull();
    const plainId = plain.body.data.id as number;
    const pubCols = await request(app).get("/api/collections");
    const plainPub = (
      pubCols.body.data.items as { id: number; image: Record<string, unknown> | null }[]
    ).find((i) => i.id === plainId);
    expect(plainPub?.image).not.toHaveProperty("placement");

    // Media-library covers: placement rides along, and swapping the
    // asset without a placement clears it (collection flavour).
    const pngA = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#775533" },
    })
      .png()
      .toBuffer();
    const pngB = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#335577" },
    })
      .png()
      .toBuffer();
    const upA = await admin
      .post("/api/admin/media")
      .set("X-CSRF-Token", csrf)
      .attach("file", pngA, "placement-a.png");
    expect(upA.status).toBe(201);
    const upB = await admin
      .post("/api/admin/media")
      .set("X-CSRF-Token", csrf)
      .attach("file", pngB, "placement-b.png");
    expect(upB.status).toBe(201);
    const mediaCol = await admin
      .post("/api/admin/collections")
      .set("X-CSRF-Token", csrf)
      .send({
        slug: `placement-media-${runId}`,
        name: "Media Placement",
        coverMediaId: upA.body.id,
        coverPlacement: placement,
        isPublished: true,
      });
    expect(mediaCol.status).toBe(201);
    expect(mediaCol.body.data.coverPlacement).toEqual(placement);
    const mediaColId = mediaCol.body.data.id as number;
    const swapAsset = await admin
      .patch(`/api/admin/collections/${mediaColId}`)
      .set("X-CSRF-Token", csrf)
      .send({ coverMediaId: upB.body.id });
    expect(swapAsset.status).toBe(200);
    expect(swapAsset.body.data.coverPlacement).toBeNull();
  }, 120000);
});
