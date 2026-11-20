/**
 * Policy pages integration suite (migration 0020). Runs the REAL app
 * against a REAL MariaDB (`bodhisattva_test_policies`, its own
 * database like the other suites) with the REAL seed.
 *
 * Covers: the migration's seeded starter pages + INSERT IGNORE
 * idempotency (re-seeding never overwrites an admin edit); the DB
 * CHECK constraint rejecting a fourth slug; public reads (all three
 * pages, no-store, sanitized on read even when the stored row is
 * dirty, no editor metadata, unknown slug 404); the permission
 * matrix (Super Admin + Admin hold policy.manage; Store Admin and
 * Customer 403; anonymous 401; an admin whose MFA enrolment is
 * incomplete is refused); CSRF on writes; update semantics (publish
 * + version bump + previous content snapshotted as a revision +
 * audit row, all-or-nothing); optimistic concurrency (stale version
 * → 409, nothing written); write-time sanitization; strict bodies
 * (unknown keys rejected); and revision view + restore (restore
 * snapshots the current content first, so it is itself reversible).
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
import { assertPermissionCatalogueMatchesDb } from "../src/services/permissions.js";
import { hashPassword } from "../src/utils/password.js";
import { testEnv } from "./helpers.js";

const RUN = process.env.INTEGRATION_DB === "1";
const serverDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const UPLOADS = "/tmp/policies-test-uploads";
const DB_NAME = "bodhisattva_test_policies";
const DB_URL = `mysql://bodhisattva:bodhisattva_dev_pw@127.0.0.1:3306/${DB_NAME}`;
const runId = Date.now().toString(36);
const ROOT_EMAIL = `policies-root-${runId}@example.com`;
const ROOT_PASS = "policies-root-pass-2026";

const PRIVACY_V1 = "<h2>Who we are</h2><p>Original privacy text.</p>";
const TERMS_DIRTY_STORED =
  '<h2 onclick="steal()">Terms head</h2><p>Terms text.</p><script>alert(1)</script>';

interface PolicyBody {
  slug: string;
  title: string;
  bodyHtml: string;
  version: number;
  updatedAt: string;
  updatedBy?: number | null;
  revisionsCount?: number;
}

interface RevisionBody {
  id: number;
  slug: string;
  title: string;
  version: number;
  bodyHtml?: string;
  createdAt: string;
}

describe.runIf(RUN)("policy pages (integration)", () => {
  let config: AppConfig;
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const state: {
    root?: Agent;
    rootCsrf?: string;
    admin?: Agent;
    adminCsrf?: string;
    seededSlugs?: string[];
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
    // to wipe). On the first run this also seeds the three starter
    // policy rows; capture what the migration left before wiping.
    execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    const [seededRows] = await p.query(
      "SELECT slug FROM site_policies ORDER BY slug",
    ) as unknown as [{ slug: string }[]];
    state.seededSlugs = (seededRows as unknown as { slug: string }[]).map((r) => r.slug);
    await p.query("DELETE FROM site_policy_revisions");
    await p.query("DELETE FROM site_policies");
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
    // Controlled rows: privacy is clean, terms is deliberately stored
    // DIRTY (the public read must sanitize on the way out),
    // accessibility has no headings.
    await p.query(
      "INSERT INTO site_policies (slug, title, body_html) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
      [
        "privacy-policy", "Privacy Policy", PRIVACY_V1,
        "terms-of-use", "Terms of Use", TERMS_DIRTY_STORED,
        "accessibility", "Accessibility", "<p>Plain text, no headings.</p>",
      ],
    );
    app = createApp({ config, database: handle, logger: pino({ level: "silent" }) });
  }, 240000);

  afterAll(async () => {
    await handle.close();
  });

  it("migration seeded exactly the three starter pages", () => {
    expect(state.seededSlugs).toEqual(["accessibility", "privacy-policy", "terms-of-use"]);
  });

  it("the database itself rejects a fourth slug (CHECK constraint)", async () => {
    const p = pool();
    await expect(
      p.query("INSERT INTO site_policies (slug, title, body_html) VALUES ('evil-page', 'X', '<p>x</p>')"),
    ).rejects.toThrow(/chk_policies_slug/);
  });

  it("re-running the seed inserts never overwrites an edited page (INSERT IGNORE)", async () => {
    const p = pool();
    await p.query(
      "INSERT IGNORE INTO site_policies (slug, title, body_html) VALUES ('privacy-policy', 'Changed Title', '<p>changed</p>')",
    );
    const [rows] = await p.query(
      "SELECT title, body_html FROM site_policies WHERE slug = 'privacy-policy'",
    ) as unknown as [{ title: string; body_html: string }[]];
    const row = (rows as unknown as { title: string; body_html: string }[])[0];
    expect(row.title).toBe("Privacy Policy");
    expect(row.body_html).toBe(PRIVACY_V1);
  });

  it("bootstraps a Super Admin and reaches a full MFA session", async () => {
    execFileSync("npx", ["tsx", "src/cli/bootstrap-super-admin.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: ROOT_EMAIL,
        BOOTSTRAP_SUPER_ADMIN_NAME: "Policies Root",
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

  it("public reads: all three pages, no-store, sanitized on read, no editor metadata", async () => {
    for (const slug of ["privacy-policy", "terms-of-use", "accessibility"]) {
      const res = await request(app).get(`/api/policies/${slug}`);
      expect(res.status, slug).toBe(200);
      expect(String(res.headers["cache-control"] ?? "")).toContain("no-store");
      const data = res.body.data as PolicyBody;
      expect(data.slug).toBe(slug);
      expect(data).not.toHaveProperty("updatedBy");
      expect(data).not.toHaveProperty("revisionsCount");
    }
    // The terms row was stored dirty on purpose: the script and the
    // event handler must not survive the public read.
    const terms = await request(app).get("/api/policies/terms-of-use");
    const body = (terms.body.data as PolicyBody).bodyHtml;
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick");
    expect(body).toContain("<h2>Terms head</h2>");
    expect(body).toContain("Terms text.");
  });

  it("public read of an unknown slug is 404", async () => {
    const res = await request(app).get("/api/policies/cookie-policy");
    expect(res.status).toBe(404);
    const bad = await request(app).get("/api/policies/..%2Fsecret");
    expect(bad.status).toBe(404);
  });

  it("permission matrix: anonymous 401, Store Admin and Customer 403, MFA-incomplete Admin 403, Admin allowed", async () => {
    const anon = await request(app).get("/api/admin/policies");
    expect(anon.status).toBe(401);

    const adminRole = await makeRoleAgent(`policies-admin-${runId}@example.com`, "policies-admin-pass-2026", "ADMIN", true);
    state.admin = adminRole.agent;
    state.adminCsrf = adminRole.csrf;
    const storeRole = await makeRoleAgent(`policies-store-${runId}@example.com`, "policies-store-pass-2026", "STORE_ADMIN", true);
    const customer = await makeRoleAgent(`policies-customer-${runId}@example.com`, "policies-customer-pass-2026", "CUSTOMER", false);
    const noMfa = await makeRoleAgent(`policies-nomfa-${runId}@example.com`, "policies-nomfa-pass-2026", "ADMIN", false);

    const storeList = await storeRole.agent.get("/api/admin/policies");
    expect(storeList.status).toBe(403);
    const customerList = await customer.agent.get("/api/admin/policies");
    expect(customerList.status).toBe(403);
    const noMfaList = await noMfa.agent.get("/api/admin/policies");
    expect(noMfaList.status).toBe(403);

    const adminList = await state.admin!.get("/api/admin/policies");
    expect(adminList.status).toBe(200);
    const items = adminList.body.data as PolicyBody[];
    expect(items.map((i) => i.slug)).toEqual(["privacy-policy", "terms-of-use", "accessibility"]);
    expect(items[0]).toHaveProperty("updatedBy");
    expect(items[0]).toHaveProperty("revisionsCount");
  }, 120000);

  it("a write without a CSRF token is rejected", async () => {
    const res = await state.admin!
      .put("/api/admin/policies/privacy-policy")
      .send({ title: "Privacy Policy", bodyHtml: PRIVACY_V1, version: 1 });
    expect(res.status).toBe(403);
  });

  it("update publishes, bumps the version, snapshots the previous content and audits — atomically", async () => {
    const v2 = "<h2>Who we are</h2><p>Updated privacy text.</p>";
    const res = await state.admin!
      .put("/api/admin/policies/privacy-policy")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ title: "Privacy Policy", bodyHtml: v2, version: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data as PolicyBody;
    expect(data.version).toBe(2);
    expect(data.bodyHtml).toBe(v2);
    expect(data.revisionsCount).toBe(1);

    const p = pool();
    const [revRows] = await p.query(
      "SELECT title, body_html, version FROM site_policy_revisions WHERE slug = 'privacy-policy'",
    ) as unknown as [{ title: string; body_html: string; version: number }[]];
    const revs = revRows as unknown as { title: string; body_html: string; version: number }[];
    expect(revs).toHaveLength(1);
    expect(revs[0].body_html).toBe(PRIVACY_V1);
    expect(revs[0].version).toBe(1);

    const [auditRows] = await p.query(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'policy.update'",
    ) as unknown as [{ n: number }[]];
    expect(Number((auditRows as unknown as { n: number }[])[0].n)).toBeGreaterThanOrEqual(1);

    const pub = await request(app).get("/api/policies/privacy-policy");
    expect((pub.body.data as PolicyBody).bodyHtml).toBe(v2);
    expect((pub.body.data as PolicyBody).version).toBe(2);
  });

  it("a stale version is a 409 and writes nothing", async () => {
    const res = await state.admin!
      .put("/api/admin/policies/privacy-policy")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ title: "Privacy Policy", bodyHtml: "<p>stale overwrite attempt</p>", version: 1 });
    expect(res.status).toBe(409);
    const pub = await request(app).get("/api/policies/privacy-policy");
    expect((pub.body.data as PolicyBody).bodyHtml).not.toContain("stale overwrite");
    expect((pub.body.data as PolicyBody).version).toBe(2);
    const p = pool();
    const [revRows] = await p.query(
      "SELECT COUNT(*) AS n FROM site_policy_revisions WHERE slug = 'privacy-policy'",
    ) as unknown as [{ n: number }[]];
    expect(Number((revRows as unknown as { n: number }[])[0].n)).toBe(1);
  });

  it("update sanitizes on write: script and external images gone, media image kept", async () => {
    const dirty =
      '<h2>Access</h2><p onclick="x()">Text</p><script>alert(1)</script>' +
      '<img src="https://evil.example/x.png" alt="bad">' +
      '<img src="/api/media/9/file/master" alt="Hall">';
    const res = await state.admin!
      .put("/api/admin/policies/accessibility")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ title: "Accessibility", bodyHtml: dirty, version: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data as PolicyBody;
    expect(data.bodyHtml).not.toContain("<script");
    expect(data.bodyHtml).not.toContain("onclick");
    expect(data.bodyHtml).not.toContain("evil.example");
    expect(data.bodyHtml).toContain('<img src="/api/media/9/file/master" alt="Hall" />');
  });

  it("unknown body keys are rejected (strict schema)", async () => {
    const res = await state.admin!
      .put("/api/admin/policies/privacy-policy")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ title: "Privacy Policy", bodyHtml: "<p>x</p>", version: 2, updatedBy: 1 });
    expect(res.status).toBe(400);
  });

  it("revision history lists and reads back the replaced content", async () => {
    const list = await state.admin!.get("/api/admin/policies/privacy-policy/revisions");
    expect(list.status).toBe(200);
    const items = list.body.data as RevisionBody[];
    expect(items).toHaveLength(1);
    expect(items[0].version).toBe(1);
    const detail = await state.admin!.get(
      `/api/admin/policies/privacy-policy/revisions/${items[0].id}`,
    );
    expect(detail.status).toBe(200);
    expect((detail.body.data as RevisionBody).bodyHtml).toBe(PRIVACY_V1);
    const wrongSlug = await state.admin!.get(
      `/api/admin/policies/terms-of-use/revisions/${items[0].id}`,
    );
    expect(wrongSlug.status).toBe(404);
  });

  it("restore brings back the old content and snapshots the current one first", async () => {
    const list = await state.admin!.get("/api/admin/policies/privacy-policy/revisions");
    const rev = (list.body.data as RevisionBody[])[0];
    const res = await state.admin!
      .post("/api/admin/policies/privacy-policy/restore")
      .set("X-CSRF-Token", state.adminCsrf!)
      .send({ revisionId: rev.id, version: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data as PolicyBody;
    expect(data.version).toBe(3);
    expect(data.bodyHtml).toBe(PRIVACY_V1);
    expect(data.revisionsCount).toBe(2);

    // The restore is itself reversible: the newest revision is the
    // content that was live just before the restore.
    const list2 = await state.admin!.get("/api/admin/policies/privacy-policy/revisions");
    const items2 = list2.body.data as RevisionBody[];
    expect(items2).toHaveLength(2);
    expect(items2[0].version).toBe(2);
    const detail2 = await state.admin!.get(
      `/api/admin/policies/privacy-policy/revisions/${items2[0].id}`,
    );
    expect((detail2.body.data as RevisionBody).bodyHtml).toContain("Updated privacy text.");

    const p = pool();
    const [auditRows] = await p.query(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'policy.restore'",
    ) as unknown as [{ n: number }[]];
    expect(Number((auditRows as unknown as { n: number }[])[0].n)).toBe(1);
  });

  it("Super Admin can also edit (holds every permission)", async () => {
    const res = await state.root!
      .put("/api/admin/policies/terms-of-use")
      .set("X-CSRF-Token", state.rootCsrf!)
      .send({ title: "Terms of Use", bodyHtml: "<h2>Terms head</h2><p>Clean terms.</p>", version: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as PolicyBody).version).toBe(2);
  });

  it("REGRESSION (owner report 2026-11-20): Super Admin keeps policy + store-settings access even when the grant ROWS are missing", async () => {
    // Simulate Meena's local database: seeded BEFORE
    // store.settings.manage and policy.manage existed, then
    // migrated — migrations 0018 / 0020 granted ADMIN alone, so the
    // SUPER_ADMIN role_permissions rows for the new permissions do
    // not exist. Resolution must still grant the Super Admin the
    // full catalogue (PERMISSIONS.md §2/§5, enforced in
    // services/permissions.ts). On the pre-fix code both requests
    // below are 403.
    const p = pool();
    await p.query(
      `DELETE rp FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions perm ON perm.id = rp.permission_id
       WHERE r.code = 'SUPER_ADMIN' AND perm.code IN ('store.settings.manage', 'policy.manage')`,
    );
    const policies = await state.root!.get("/api/admin/policies");
    expect(policies.status, JSON.stringify(policies.body)).toBe(200);
    const settings = await state.root!.get("/api/admin/settings");
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    // The admin SPA builds its sidebar from GET /api/admin/roles —
    // that list must ALSO present SUPER_ADMIN with the full
    // catalogue, or the menu items stay hidden even though the API
    // itself would allow them (the owner's actual symptom).
    const rolesRes = await state.root!.get("/api/admin/roles");
    expect(rolesRes.status, JSON.stringify(rolesRes.body)).toBe(200);
    // NB: the roles route predates the response envelope — it
    // answers a bare { items } body.
    const roleViews = rolesRes.body.items as { code: string; permissions: string[] }[];
    const superRole = roleViews.find((r) => r.code === "SUPER_ADMIN");
    expect(superRole?.permissions).toContain("policy.manage");
    expect(superRole?.permissions).toContain("store.settings.manage");
    const storeRole = roleViews.find((r) => r.code === "STORE_ADMIN");
    expect(storeRole?.permissions).not.toContain("policy.manage");
  });

  it("boot catalogue parity check passes here, and names drift in both directions", async () => {
    // This suite's database was migrated + seeded from the compiled
    // catalogue, so parity holds (server.ts runs this before listen).
    const ok = await assertPermissionCatalogueMatchesDb(handle.db);
    expect(ok.count).toBeGreaterThan(0);
    expect(ok.hash).toHaveLength(12);
    const p = pool();
    // Direction 1: a permission row the compiled catalogue lacks —
    // the stale-build incident shape (2026-11-20). The boot must
    // refuse and name the code.
    await p.query(
      `INSERT INTO permissions (code, module, description) VALUES ('rogue.test', 'rogue', 'rogue')`,
    );
    await expect(
      assertPermissionCatalogueMatchesDb(handle.db),
    ).rejects.toThrow(/rogue\.test/);
    await p.query(`DELETE FROM permissions WHERE code = 'rogue.test'`);
    // Direction 2: a catalogue permission missing from the database —
    // the unmigrated-database shape. (Last test in the suite: the
    // row is not restored; the suite database is disposable.)
    await p.query(
      `DELETE rp FROM role_permissions rp
       JOIN permissions perm ON perm.id = rp.permission_id
       WHERE perm.code = 'policy.manage'`,
    );
    await p.query(`DELETE FROM permissions WHERE code = 'policy.manage'`);
    await expect(
      assertPermissionCatalogueMatchesDb(handle.db),
    ).rejects.toThrow(/policy\.manage/);
  });
});
