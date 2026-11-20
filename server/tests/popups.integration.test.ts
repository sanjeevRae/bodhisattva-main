/**
 * Website popup integration suite (migration 0019). Runs the REAL app
 * against a REAL MariaDB (`bodhisattva_test_popups`, its own database
 * like the other suites) with the REAL seed.
 *
 * Covers: the permission matrix (Super Admin + Admin hold
 * popup.manage; Store Admin and Customer get 403; anonymous 401);
 * create validation (the URL bypass catalogue, label-without-link and
 * link-without-label, unknown media id, length caps); activation
 * exclusivity (activating B deactivates A; exactly one active row in
 * the DB — the generated-column unique index is the backstop);
 * public exposure (only the active popup is ever returned, with
 * Cache-Control: no-store; inactive/deleted popups vanish); version
 * semantics (content edits bump, identical edits and hide/show do
 * not); and audit rows for create/activate.
 *
 * Guarded by INTEGRATION_DB=1 like the other suites.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "otplib";
import pino from "pino";
import request, { type Agent } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import { createDatabase, type DatabaseHandle } from "../src/database/client.js";
import { roles as rolesTable, userRoles, users } from "../src/database/schema/index.js";
import { hashPassword } from "../src/utils/password.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/popups-test-uploads";
const DB_NAME = "bodhisattva_test_popups";
const DB_URL = `mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `popups-root-${runId}@example.com`;
const ROOT_PASS = "popups-root-pass-2026";

interface PopupBody {
  id: number;
  heading: string;
  message: string;
  imageMediaId: number | null;
  imageUrl: string | null;
  buttonLabel: string | null;
  linkUrl: string | null;
  isActive: boolean;
  version: number;
}

describe.runIf(RUN)("website popup (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const state: {
    root?: Agent;
    rootCsrf?: string;
    admin?: Agent;
    adminCsrf?: string;
    storeAdmin?: Agent;
    storeAdminCsrf?: string;
    customer?: Agent;
    customerCsrf?: string;
    popupA?: number;
    popupB?: number;
    mediaId?: number;
  } = {};

  const pool = () => handle.pool;

  async function makeRoleAgent(
    email: string,
    pass: string,
    roleCode: string,
    withMfa: boolean,
  ): Promise<{ agent: Agent; csrf: string }> {
    const db = handle.db;
    const roleRows = await db.select({ id: rolesTable.id, code: rolesTable.code }).from(rolesTable);
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
    const login = await agent.post("/api/auth/login").send({ email, password: pass });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    if (withMfa) {
      const enrol = await agent.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
      expect(enrol.status).toBe(200);
      const confirm = await agent
        .post("/api/auth/mfa/confirm")
        .set("X-CSRF-Token", csrf)
        .send({ code: authenticator.generate(enrol.body.secret as string) });
      expect(confirm.status).toBe(200);
    }
    return { agent, csrf };
  }

  async function createPopup(
    agent: Agent,
    csrf: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; data: PopupBody }> {
    const res = await agent.post("/api/admin/popups").set("X-CSRF-Token", csrf).send(body);
    return { status: res.status, data: res.body.data as PopupBody };
  }

  async function publicPopup(): Promise<{ status: number; data: PopupBody | null; cacheControl: string }> {
    const res = await request(app).get("/api/popup");
    return {
      status: res.status,
      data: (res.body.data as PopupBody | null) ?? null,
      cacheControl: String(res.headers["cache-control"] ?? ""),
    };
  }

  beforeAll(async () => {
    rmSync(UPLOADS, { recursive: true, force: true });
    mkdirSync(UPLOADS, { recursive: true });
    const env = testEnv({
      NODE_ENV: "test",
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_NAME,
      DB_USER: "bodhisattva",
      DB_PASSWORD: "bodhisattva_dev_pw",
      DATABASE_URL: DB_URL,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      APP_URL: "http://localhost:5173",
      UPLOAD_DIRECTORY: UPLOADS,
    });
    config = loadConfig(env);
    handle = createDatabase(config);
    await handle.ping();
    const p = pool();
    // Migrate FIRST (a brand-new suite database has no tables at all
    // to wipe), then wipe popup + identity state in FK-safe order,
    // then seed. On later runs the migrate is a no-op.
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    await p.query("DELETE FROM site_popups");
    await p.query("DELETE FROM email_outbox");
    await p.query("DELETE FROM user_roles");
    await p.query("DELETE FROM user_sessions");
    await p.query("DELETE FROM email_verification_codes");
    await p.query("DELETE FROM password_reset_tokens");
    await p.query("DELETE FROM invitations");
    await p.query("DELETE FROM mfa_recovery_codes");
    await p.query("DELETE FROM mfa_credentials");
    await p.query("DELETE FROM audit_logs");
    await p.query("DELETE FROM rate_limits");
    await p.query("UPDATE site_settings SET updated_by = NULL");
    await p.query("DELETE FROM users");
    execFileSync("npx", ["tsx", "src/database/seed.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
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
        BOOTSTRAP_SUPER_ADMIN_NAME: "Popup Root",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: ROOT_PASS,
        DATABASE_URL: DB_URL,
      },
      encoding: "utf8",
    });
    const root = request.agent(app);
    const login = await root.post("/api/auth/login").send({ email: ROOT_EMAIL, password: ROOT_PASS });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    const enrol = await root.post("/api/auth/mfa/enrol").set("X-CSRF-Token", csrf).send({});
    expect(enrol.status).toBe(200);
    const confirm = await root
      .post("/api/auth/mfa/confirm")
      .set("X-CSRF-Token", csrf)
      .send({ code: authenticator.generate(enrol.body.secret as string) });
    expect(confirm.status).toBe(200);
    state.root = root;
    state.rootCsrf = csrf;
  }, 120000);

  it("public endpoint is null (and no-store) before any popup exists", async () => {
    const res = await publicPopup();
    expect(res.status).toBe(200);
    expect(res.data).toBeNull();
    expect(res.cacheControl).toContain("no-store");
  });

  it("permission matrix: anonymous 401, Store Admin and Customer 403, Admin allowed", async () => {
    const anon = await request(app).get("/api/admin/popups");
    expect(anon.status).toBe(401);

    const adminRole = await makeRoleAgent(`popups-admin-${runId}@example.com`, "popups-admin-pass-2026", "ADMIN", true);
    state.admin = adminRole.agent;
    state.adminCsrf = adminRole.csrf;
    const storeRole = await makeRoleAgent(`popups-store-${runId}@example.com`, "popups-store-pass-2026", "STORE_ADMIN", true);
    state.storeAdmin = storeRole.agent;
    state.storeAdminCsrf = storeRole.csrf;
    const customer = await makeRoleAgent(`popups-customer-${runId}@example.com`, "popups-customer-pass-2026", "CUSTOMER", false);
    state.customer = customer.agent;
    state.customerCsrf = customer.csrf;

    const storeList = await state.storeAdmin!.get("/api/admin/popups");
    expect(storeList.status).toBe(403);
    const storeCreate = await state.storeAdmin!
      .post("/api/admin/popups")
      .set("X-CSRF-Token", state.storeAdminCsrf!)
      .send({ heading: "Nope", message: "Store admins cannot do this." });
    expect(storeCreate.status).toBe(403);

    const customerList = await state.customer!.get("/api/admin/popups");
    expect(customerList.status).toBe(403);

    const adminList = await state.admin!.get("/api/admin/popups");
    expect(adminList.status).toBe(200);
    expect(adminList.body.data).toEqual([]);
  }, 120000);

  it("create validation rejects the URL bypass catalogue and bad shapes", async () => {
    const badUrls = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "//evil.example.com",
      "https://exa mple.com",
      " https://example.com",
      "https:\\\\evil.example.com",
      "ftp://example.com/file",
    ];
    for (const linkUrl of badUrls) {
      const res = await createPopup(state.admin!, state.adminCsrf!, {
        heading: "Bad link",
        message: "This must not save.",
        buttonLabel: "Go",
        linkUrl,
      });
      expect(res.status, `expected 400 for ${linkUrl}`).toBe(400);
    }

    const noLabel = await createPopup(state.admin!, state.adminCsrf!, {
      heading: "No label",
      message: "A link needs button text.",
      linkUrl: "/shop",
    });
    expect(noLabel.status).toBe(400);

    const badMedia = await createPopup(state.admin!, state.adminCsrf!, {
      heading: "Ghost image",
      message: "The media id does not exist.",
      imageMediaId: 999999,
    });
    expect(badMedia.status).toBe(400);

    const longHeading = await createPopup(state.admin!, state.adminCsrf!, {
      heading: "x".repeat(161),
      message: "Too long a heading.",
    });
    expect(longHeading.status).toBe(400);

    const list = await state.admin!.get("/api/admin/popups");
    expect(list.body.data).toEqual([]);
  });

  it("creates popups inactive at version 1; the public endpoint stays null", async () => {
    // A media row to attach (file serving is the media suite's concern;
    // the popup only needs the resolved URL string).
    const [media] = await pool().query(
      "INSERT INTO media_assets (storage_name, mime_type, file_size, alt_text) VALUES (?, 'image/jpeg', 1024, 'Exhibition hall')",
      [`popup-test-${runId}.jpg`],
    );
    state.mediaId = (media as { insertId: number }).insertId;

    const a = await createPopup(state.admin!, state.adminCsrf!, {
      heading: "Welcome to Bodhisattva",
      message: "The retrospective is now open.",
      imageMediaId: state.mediaId,
      buttonLabel: "Plan your visit",
      linkUrl: "/museum",
    });
    expect(a.status).toBe(201);
    expect(a.data.isActive).toBe(false);
    expect(a.data.version).toBe(1);
    expect(a.data.imageUrl).toBe(`/api/media/${state.mediaId}/file/master`);
    state.popupA = a.data.id;

    const b = await createPopup(state.root!, state.rootCsrf!, {
      heading: "Gift Shop",
      message: "New pieces in the shop.",
      buttonLabel: "Browse the shop",
      linkUrl: "https://example.com/shop",
    });
    expect(b.status).toBe(201);
    state.popupB = b.data.id;

    const pub = await publicPopup();
    expect(pub.data).toBeNull();
  });

  it("activation is exclusive: showing B hides A, in the API and in the table", async () => {
    const actA = await state.admin!
      .post(`/api/admin/popups/${state.popupA}/activate`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(actA.status).toBe(200);
    expect(actA.body.data.isActive).toBe(true);

    let pub = await publicPopup();
    expect(pub.data?.id).toBe(state.popupA);
    expect(pub.data?.heading).toBe("Welcome to Bodhisattva");
    expect(pub.data?.imageUrl).toBe(`/api/media/${state.mediaId}/file/master`);

    const actB = await state.admin!
      .post(`/api/admin/popups/${state.popupB}/activate`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(actB.status).toBe(200);

    pub = await publicPopup();
    expect(pub.data?.id).toBe(state.popupB);

    const [rows] = await pool().query("SELECT COUNT(*) AS n FROM site_popups WHERE is_active = 1");
    expect((rows as Array<{ n: number }>)[0].n).toBe(1);

    const list = await state.admin!.get("/api/admin/popups");
    const byId = new Map((list.body.data as PopupBody[]).map((p) => [p.id, p]));
    expect(byId.get(state.popupA!)!.isActive).toBe(false);
    expect(byId.get(state.popupB!)!.isActive).toBe(true);
  });

  it("version bumps only on content change — not on identical edits or hide/show", async () => {
    const before = await state.admin!.get("/api/admin/popups");
    const bNow = (before.body.data as PopupBody[]).find((p) => p.id === state.popupB)!;
    expect(bNow.version).toBe(1);

    // Hide + re-show: no bump.
    const hide = await state.admin!
      .post(`/api/admin/popups/${state.popupB}/deactivate`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(hide.status).toBe(200);
    expect(hide.body.data.version).toBe(1);
    expect((await publicPopup()).data).toBeNull();
    const show = await state.admin!
      .post(`/api/admin/popups/${state.popupB}/activate`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({});
    expect(show.body.data.version).toBe(1);

    // Identical content edit: no bump.
    const same = await state.admin!
      .patch(`/api/admin/popups/${state.popupB}`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ heading: "Gift Shop" });
    expect(same.status).toBe(200);
    expect(same.body.data.version).toBe(1);

    // Real content edit: bump, and the public payload follows.
    const edited = await state.admin!
      .patch(`/api/admin/popups/${state.popupB}`)
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ heading: "Gift Shop — New Arrivals" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.version).toBe(2);
    const pub = await publicPopup();
    expect(pub.data?.version).toBe(2);
    expect(pub.data?.heading).toBe("Gift Shop — New Arrivals");
  });

  it("deleting the live popup clears the public endpoint; audit rows exist", async () => {
    const del = await state.admin!
      .delete(`/api/admin/popups/${state.popupB}`)
      .set("X-CSRF-Token", state.adminCsrf!);
    expect(del.status).toBe(200);
    expect((await publicPopup()).data).toBeNull();

    const [rows] = await pool().query(
      "SELECT action FROM audit_logs WHERE action LIKE 'popup.%' ORDER BY id",
    );
    const actions = (rows as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toContain("popup.create");
    expect(actions).toContain("popup.activate");
    expect(actions).toContain("popup.update");
    expect(actions).toContain("popup.delete");
  });
});
