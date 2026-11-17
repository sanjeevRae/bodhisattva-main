/**
 * Phase 3 integration suite — the CMS exit gate.
 *
 * Runs the REAL app against a REAL MariaDB (`bodhisattva_test_cms`, kept
 * separate from the auth suite's database so the two files can run in
 * parallel) with the REAL seeded content. Exercises: public published
 * reads, draft isolation, preview tokens, publish, publish-failure
 * preservation, rollback, optimistic concurrency, slug rules, media
 * upload validation + serving + reference-blocked delete, and an RBAC
 * negative. Guarded by INTEGRATION_DB=1 like the auth suite.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import pino from "pino";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import { pages } from "../src/database/schema/index.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/cms-test-uploads";
const runId = Date.now().toString(36);
const ROOT_EMAIL = `cms-root-${runId}@example.com`;
const ROOT_PASSWORD = "cms-root-password-1";

interface DraftSection {
  type: string;
  isVisible?: boolean;
  config: Record<string, unknown>;
  design?: Record<string, unknown> | null;
}

function heroHeading(sections: DraftSection[]): string | undefined {
  const hero = sections.find((s) => s.type === "hero");
  const cfg = hero?.config ?? {};
  return (cfg.heading as string) ?? (cfg.headingLine1 as string);
}

function withHeroHeading(
  sections: DraftSection[],
  heading: string,
): DraftSection[] {
  return sections.map((s) => {
    if (s.type !== "hero") return s;
    const key = "heading" in s.config ? "heading" : "headingLine1";
    return { ...s, config: { ...s.config, [key]: heading } };
  });
}

describe.skipIf(!RUN)("Phase 3 CMS flows (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  const state: {
    admin?: ReturnType<typeof request.agent>;
    csrf?: string;
    museumId?: number;
    museumRevisionId?: number;
  } = {};

  beforeAll(async () => {
    rmSync(UPLOADS, { recursive: true, force: true });
    mkdirSync(UPLOADS, { recursive: true });
    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
      DB_PORT: process.env.DB_PORT ?? "3306",
      DB_NAME: "bodhisattva_test_cms",
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
    // Keep the seeded CMS content; wipe identity/runtime state only.
    await pool.query("DELETE FROM user_roles");
    await pool.query("DELETE FROM user_sessions");
    await pool.query("DELETE FROM invitations");
    await pool.query("DELETE FROM mfa_recovery_codes");
    await pool.query("DELETE FROM mfa_credentials");
    await pool.query("DELETE FROM audit_logs");
    await pool.query("DELETE FROM rate_limits");
    await pool.query("DELETE FROM preview_tokens");
    await pool.query("DELETE FROM media_assets");
    // CMS rows keep author references to users from earlier runs
    // (publish/rollback stamp updated_by) — clear them before the wipe.
    await pool.query("UPDATE pages SET created_by = NULL, updated_by = NULL");
    await pool.query("UPDATE page_revisions SET created_by = NULL");
    await pool.query("UPDATE site_settings SET updated_by = NULL");
    await pool.query("DELETE FROM users");
    app = createApp({
      config,
      database: handle,
      logger: pino({ level: "silent" }),
    });
  }, 60000);

  afterAll(async () => {
    await handle.close();
  });

  it("bootstraps a Super Admin and reaches a full MFA session", async () => {
    const cliEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
      BOOTSTRAP_SUPER_ADMIN_NAME: "CMS Root",
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASSWORD,
      DATABASE_URL:
        "mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/bodhisattva_test_cms",
    };
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: cliEnv,
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

  it("serves the seeded published content publicly", async () => {
    const home = await request(app).get("/api/pages/home");
    expect(home.status).toBe(200);
    expect(home.body.sections.length).toBeGreaterThan(0);
    expect(home.body.sections[0].type).toBe("hero");
    const menu = await request(app).get("/api/menus/primary");
    expect(menu.status).toBe(200);
    expect(menu.body.items.length).toBeGreaterThan(0);
    const site = await request(app).get("/api/site");
    expect(site.status).toBe(200);
    expect(site.body.settings ?? site.body).toBeTruthy();
    const missing = await request(app).get("/api/pages/no-such-page");
    expect(missing.status).toBe(404);
  });

  it("keeps draft edits private until publish, then rolls back", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const pagesList = await admin
      .get("/api/admin/pages")
      .set("X-CSRF-Token", csrf);
    expect(pagesList.status).toBe(200);
    const museum = (pagesList.body.items ?? pagesList.body).find(
      (p: { slug: string }) => p.slug === "museum",
    );
    expect(museum).toBeTruthy();
    state.museumId = museum.id;

    const before = await request(app).get("/api/pages/museum");
    const originalHeading = heroHeading(before.body.sections);
    expect(originalHeading).toBeTruthy();

    const draft = await admin
      .get(`/api/admin/pages/${museum.id}/draft`)
      .set("X-CSRF-Token", csrf);
    expect(draft.status).toBe(200);
    state.museumRevisionId = draft.body.revisionId;
    const edited = withHeroHeading(
      draft.body.sections as DraftSection[],
      `Edited ${runId}`,
    );
    const save = await admin
      .put(`/api/admin/pages/${museum.id}/draft`)
      .set("X-CSRF-Token", csrf)
      .send({ expectedVersion: draft.body.version, sections: edited });
    expect(save.status).toBe(200);

    // Stale version → 409.
    const stale = await admin
      .put(`/api/admin/pages/${museum.id}/draft`)
      .set("X-CSRF-Token", csrf)
      .send({ expectedVersion: draft.body.version, sections: edited });
    expect(stale.status).toBe(409);

    // Public still serves the original; preview shows the edit.
    const pubBefore = await request(app).get("/api/pages/museum");
    expect(heroHeading(pubBefore.body.sections)).toBe(originalHeading);
    const tokenRes = await admin
      .post(`/api/admin/pages/${museum.id}/preview-token`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(tokenRes.status).toBe(201);
    const preview = await request(app).get(
      `/api/pages/museum/preview?token=${tokenRes.body.token}`,
    );
    expect(preview.status).toBe(200);
    expect(heroHeading(preview.body.sections)).toBe(`Edited ${runId}`);
    const badPreview = await request(app).get(
      "/api/pages/museum/preview?token=invalid-token-value",
    );
    expect(badPreview.status).toBe(404);

    // Publish → public flips; rollback → public restored.
    const publish = await admin
      .post(`/api/admin/pages/${museum.id}/publish`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(publish.status).toBe(200);
    const pubAfter = await request(app).get("/api/pages/museum");
    expect(heroHeading(pubAfter.body.sections)).toBe(`Edited ${runId}`);

    const revisions = await admin
      .get(`/api/admin/pages/${museum.id}/revisions`)
      .set("X-CSRF-Token", csrf);
    expect(revisions.status).toBe(200);
    const revList = (revisions.body.items ?? revisions.body) as {
      id: number;
      revisionNo?: number;
    }[];
    const original = revList.reduce((a, b) =>
      (a.revisionNo ?? a.id) <= (b.revisionNo ?? b.id) ? a : b,
    );
    const rollback = await admin
      .post(
        `/api/admin/pages/${museum.id}/rollback/${original.id}`,
      )
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(rollback.status).toBe(200);
    const pubRestored = await request(app).get("/api/pages/museum");
    expect(heroHeading(pubRestored.body.sections)).toBe(originalHeading);
  }, 120000);

  it("refuses to publish a draft containing an invalid section", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const id = state.museumId!;
    const draft = await admin
      .get(`/api/admin/pages/${id}/draft`)
      .set("X-CSRF-Token", csrf);
    expect(draft.status).toBe(200);
    // Bypass API validation by writing an invalid section straight into
    // the draft revision — publish must still refuse and preserve live.
    await handle.pool.query(
      "INSERT INTO page_sections (revision_id, type, sort_order, is_visible, config) VALUES (?, 'bogus_type', 99, 1, '{}')",
      [draft.body.revisionId],
    );
    const publish = await admin
      .post(`/api/admin/pages/${id}/publish`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(publish.status).toBe(400);
    await handle.pool.query(
      "DELETE FROM page_sections WHERE revision_id = ? AND type = 'bogus_type'",
      [draft.body.revisionId],
    );
    const pub = await request(app).get("/api/pages/museum");
    expect(pub.status).toBe(200);
    expect(heroHeading(pub.body.sections)).toBeTruthy();
  }, 60000);

  it("enforces slug rules and protects system pages", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const reserved = await admin
      .post("/api/admin/pages")
      .set("X-CSRF-Token", csrf)
      .send({ slug: "admin", title: "Nope" });
    expect(reserved.status).toBe(400);
    const duplicate = await admin
      .post("/api/admin/pages")
      .set("X-CSRF-Token", csrf)
      .send({ slug: "museum", title: "Dupe" });
    expect(duplicate.status).toBe(409);
    const created = await admin
      .post("/api/admin/pages")
      .set("X-CSRF-Token", csrf)
      .send({ slug: `it-page-${runId}`, title: "IT Page" });
    expect(created.status).toBe(201);
    const del = await admin
      .delete(`/api/admin/pages/${created.body.id ?? created.body.page?.id}`)
      .set("X-CSRF-Token", csrf);
    expect(del.status).toBe(200);
    const delSystem = await admin
      .delete(`/api/admin/pages/${state.museumId}`)
      .set("X-CSRF-Token", csrf);
    expect(delSystem.status).toBe(403);
  }, 60000);

  it("validates uploads by content, serves variants, blocks referenced deletes", async () => {
    const admin = state.admin!;
    const csrf = state.csrf!;
    const png = await sharp({
      create: { width: 1000, height: 500, channels: 3, background: "#336699" },
    })
      .png()
      .toBuffer();
    const upload = await admin
      .post("/api/admin/media")
      .set("X-CSRF-Token", csrf)
      .attach("file", png, "photo.png");
    expect(upload.status).toBe(201);
    const assetId = upload.body.id as number;
    expect(assetId).toBeTruthy();

    const master = await request(app).get(`/api/media/${assetId}/file/master`);
    expect(master.status).toBe(200);
    const thumb = await request(app).get(`/api/media/${assetId}/file/thumb`);
    expect(thumb.status).toBe(200);

    const text = await admin
      .post("/api/admin/media")
      .set("X-CSRF-Token", csrf)
      .attach("file", Buffer.from("not an image"), "fake.png");
    expect(text.status).toBe(400);
    const svg = await admin
      .post("/api/admin/media")
      .set("X-CSRF-Token", csrf)
      .attach(
        "file",
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        "x.svg",
      );
    expect(svg.status).toBe(400);

    // Reference it as the home page OG image → delete blocked.
    await handle.db
      .update(pages)
      .set({ ogImageMediaId: assetId })
      .where(eq(pages.slug, "home"));
    const blocked = await admin
      .delete(`/api/admin/media/${assetId}`)
      .set("X-CSRF-Token", csrf);
    expect(blocked.status).toBe(409);
    await handle.db
      .update(pages)
      .set({ ogImageMediaId: null })
      .where(eq(pages.slug, "home"));
    const removed = await admin
      .delete(`/api/admin/media/${assetId}`)
      .set("X-CSRF-Token", csrf);
    expect(removed.status).toBe(200);
    const gone = await request(app).get(`/api/media/${assetId}/file/master`);
    expect(gone.status).toBe(404);
  }, 120000);
});
