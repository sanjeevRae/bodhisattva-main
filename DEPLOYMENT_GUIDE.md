# Deployment Guide — cPanel Production Runbook

> **STATUS: NOT YET EXECUTED.** This runbook is written and ready, but
> **no step in it has been performed on a production host.** Deployment
> is pending (a) the owner connecting the cPanel hosting account,
> (b) the hosting proof-of-concept gate below, and (c) the owner's
> explicit deployment approval. No DNS or production configuration has
> been modified. Hosting facts marked UNVERIFIED come from
> `DEPLOYMENT_REQUIREMENTS.md`, where every capability is still
> unverified against the target account.

## 0. Pre-flight gate (do not skip)

Before deploying, verify on the actual hosting account (the Phase 0
checklist, `DEPLOYMENT_REQUIREMENTS.md` §4 — all items UNVERIFIED
today):

1. **Setup Node.js App** exists and can create an application; record
   every Node.js version offered (need a current LTS; the local
   toolchain is Node 24).
2. Node apps are served via **Passenger**; note pool/idle limits.
3. **Native modules load on the host**: run the Phase 1 smoke test
   (SETUP.md §7) — Argon2id hash+verify and a Sharp resize — under the
   host's Node. If either fails, stop: the fallbacks in
   `DEPLOYMENT_REQUIREMENTS.md` §5 must be decided first.
4. MySQL/MariaDB version (MariaDB 10.6+ / MySQL 8.0+), InnoDB +
   utf8mb4 available; cron available (note the finest interval);
   outbound SMTP + hourly quota; SSL (AutoSSL/Let's Encrypt) issuable
   for the domain; disk/inode headroom for media growth.
5. The **domain decision** is made (`APP_URL` depends on it) and the
   **SMTP identity** is decided (sending domain with SPF/DKIM).

If Node.js is unavailable on the account, do not improvise: the
fallback architectures (VPS, or split hosting with the API elsewhere)
are documented in `DEPLOYMENT_REQUIREMENTS.md` §5 and need the owner's
decision.

## 1. Production layout

```
/home/<CPANEL_USER>/
  apps/
    museum-api/            # Node.js application root (outside public_html)
      app.js               # Passenger startup file (see §3)
      dist/                # compiled API (server/dist)
      node_modules/        # production dependencies
      package.json
      tmp/restart.txt      # Passenger restart trigger
  private-storage/         # UPLOAD_DIRECTORY — never web-accessible
    uploads/               # media shards + invoices/ (the app's layout)
    cache/last-good/       # created by the app (last-good payloads)
    backups/               # local backup staging (copies go off-site)
  public_html/             # static frontend ONLY
    index.html, assets/    # Vite build output
    .htaccess              # SPA fallback; must exclude /api
```

Rules: only the static frontend lives in `public_html` — **no `.env`,
no server code, no uploads, no invoice PDFs, no backups in any
web-accessible directory.** Uploads and invoice PDFs are served only
through the API's authorised endpoints.

## 2. Build (on the build machine, not the host)

```bash
npm ci                        # repo root (frontend)
npm --prefix shared ci && npm --prefix shared run build
npm --prefix server ci
npm run build                 # frontend → dist/
npm run server:build          # shared + API → server/dist/
npm --prefix server test      # unit suite must be green before shipping
```

Ship: the frontend `dist/` contents, and for the API the `server/`
tree's `dist/`, `package.json`, `package-lock.json` and
`drizzle/migrations/` (migrations run from source via tsx in dev; in
production run them with the same CLI from the deployed tree — see
§5). Do **not** ship `server/.env`, `node_modules` (install on the
host), `server/storage`, or any test database dumps.

## 3. cPanel Node.js application

In **cPanel → Software → Setup Node.js App → Create Application**:

| Setting | Value |
|---|---|
| Node.js version | The newest LTS offered (record what was chosen) |
| Application mode | Production |
| Application root | `apps/museum-api` |
| Application URL | The site domain, path `/api` (Passenger serves the app under `/api`; the SPA fallback must exclude `/api`) |
| Startup file | `app.js` |
| Environment variables | See §4 — set them **here**, in the app configuration |

`app.js` (Passenger startup file, in the application root):

```js
// Loads the compiled API. server/dist/server.js boots on import.
require("./dist/server.js");
```

Then, via the app's terminal/SSH (or the Node.js App UI's "Run npm
install"):

```bash
cd ~/apps/museum-api
npm ci --omit=dev
```

## 4. Environment configuration

Set every variable in the **Node.js app configuration UI** — never in
a `.env` file inside the app directory (dotenv would silently fill
missing values from it and weaken the boot-time fail-fast checks; see
SECURITY_GUIDE.md and `docs/phase-8/production-config.md`).

**Required — the API refuses to boot without them:**

| Variable | Rule |
|---|---|
| `SESSION_SECRET` | ≥32 chars, unique to production |
| `OTP_HMAC_SECRET` | ≥32 chars, **different** from the other two |
| `TOTP_ENCRYPTION_KEY` | Decodes to exactly 32 bytes (64 hex chars); **back this up with the config backup** — losing it forces every admin to re-enrol MFA |
| `DB_PASSWORD` | Unless `DATABASE_URL` is set instead |

All three secrets must be pairwise distinct and contain no placeholder
text; the boot validation rejects violations with a named error
(verified locally against five broken environments).

**Set explicitly for production:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (enables `__Host-` secure cookies, placeholder rejection) |
| `APP_URL` | Canonical site URL, e.g. `https://<domain>` — used in email links and invoice rendering |
| `CORS_ORIGINS` | The site origin (defaults to `APP_URL` when unset) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` | The cPanel database (name/user carry the account prefix) — or one `DATABASE_URL` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | The decided sending identity; port 465 = implicit TLS |
| `UPLOAD_DIRECTORY` | Absolute path of the uploads directory itself, e.g. `/home/<CPANEL_USER>/private-storage/uploads` (the dev value is `server/storage/uploads`). Media shards and the `invoices/` subtree live directly under it; the last-good cache is written to its sibling `../cache/last-good/` |

> Layout note (see KNOWN_LIMITATIONS): the Phase 0 design named the
> storage subtrees `cms-media/`, `product-images/`, `invoices/`; the
> implementation stores media under `<UPLOAD_DIRECTORY>/<2-char
> shard>/` and invoice PDFs under `<UPLOAD_DIRECTORY>/invoices/`.
> The runbook follows the **implementation**.

Optional tuning: `DB_POOL_LIMIT` (default 5 — keep low on shared
hosting; Passenger may run several workers), `LOG_LEVEL`, the
`OTP_POLICY_*` / `RATE_LIMIT_*` knobs.

## 5. Database creation + migrations

1. cPanel → **MySQL Databases**: create the database (utf8mb4) and a
   user with ALL privileges on **that database only**; set
   `DB_PASSWORD` in §4.
2. Apply migrations and seed, from the deployed tree with the
   production environment exported (the `db:*` scripts read
   `DATABASE_URL` from the environment):

```bash
export DATABASE_URL="mysql://<user>:<password>@localhost:3306/<db>"
npm run db:status     # expect: all migrations pending on a fresh DB
npm run db:migrate    # applies 0000…0010 in order
npm run db:seed       # roles/permissions, CMS content, museum + store
                      # seed data, invoice template (idempotent)
```

3. Create the first Super Admin (the platform allows at most 3 Super
   Admin accounts; the CLI refuses to run once 3 active Super Admins
   exist):

```bash
BOOTSTRAP_SUPER_ADMIN_EMAIL=<owner email> \
BOOTSTRAP_SUPER_ADMIN_NAME="<name>" \
BOOTSTRAP_SUPER_ADMIN_PASSWORD=<12+ chars> \
npm --prefix server run bootstrap:super-admin
```

The bootstrap account must enrol MFA at first login before it can do
anything else. **Which email is the real bootstrap account is an owner
decision** — local work used placeholder accounts only.

## 6. Static frontend

Upload the frontend `dist/` contents into `public_html/`. The
`.htaccess` must route everything that isn't a real file to
`index.html` (SPA fallback) **except** `/api`, which belongs to the
Node app. Verify `/api` reaches the API (§8) and that a deep link
like `/museum` serves the SPA.

## 7. SSL + SMTP checks

- Issue/confirm the SSL certificate for the domain (AutoSSL or Let's
  Encrypt) and force HTTPS — production session cookies are
  Secure/`__Host-` and will not work over plain HTTP.
- Confirm SPF/DKIM for the sending domain before the first real
  email; shared-hosting SMTP quotas make the outbox's backoff normal,
  not exceptional.

## 8. Cron jobs

In **cPanel → Advanced → Cron Jobs** (commands use the app root;
adjust the Node binary path to the app's virtual environment — the
Node.js App UI shows it):

| Job | Schedule | Command |
|---|---|---|
| Email outbox drain (the reliable delivery path) | Every minute if permitted, else the finest interval | `cd ~/apps/museum-api && node dist/cli/drain-outbox.js` — claims due rows under lease, sends, backs off failures, dead-letters after 5 attempts; safe to overlap |
| Inventory reconciliation | Daily | `cd ~/apps/museum-api && node dist/cli/reconcile-inventory.js` — report-only; alert on exit code 1 |
| Media sweep (report) | Weekly | `cd ~/apps/museum-api && node dist/cli/sweep-media.js` — dry run by default; review orphans before ever running with `--delete` |
| Backup | Daily, off-peak | See BACKUP_RESTORE.md |

> Not yet built: the Phase 0 plan's **session/token cleanup job**
> (expired sessions, codes, reset tokens, rate-limit rows) has no CLI
> yet — expired rows are inert (every check re-validates expiry), so
> this is table hygiene, not a security gap; it's recorded in
> KNOWN_LIMITATIONS. Add the CLI before table growth matters.

## 9. Smoke test (production, in order)

From the Phase 8 exit gate — every item must pass on the real host:

- [ ] Frontend build served at the domain; all 7 public routes load
- [ ] `GET /health` 200; `GET /health/ready` reports database ok
- [ ] One migration cycle proven (`db:status` clean; a no-op re-run
      changes nothing)
- [ ] SSL valid; HTTP redirects to HTTPS
- [ ] Public page payload comes from the production DB (edit a draft,
      publish, see it live)
- [ ] Super Admin login + MFA enrolment completes; admin loads
- [ ] One real email delivered end-to-end (registration verification
      or a test invoice) via the production SMTP identity
- [ ] A test order placed → approved → invoice PDF downloads; the
      invoice email arrives (cron drain observed running)
- [ ] Media upload works (Sharp on the host) and the file serves
- [ ] Backup taken and the restore procedure spot-checked
      (BACKUP_RESTORE.md)

## 10. Rollback

- **Code rollback** (no data change): redeploy the previous build's
  `dist/` (frontend and/or API), `touch ~/apps/museum-api/tmp/restart.txt`,
  re-run the §9 smoke checks. Keep the previous build artifact for
  every release.
- **Data rollback**: migrations ship with reviewed down-files, but
  production policy is **forward-only + restore-from-backup** for
  anything beyond a trivially reversible change: restore the pre-deploy
  backup per BACKUP_RESTORE.md, then redeploy the matching code build.
- A failed migration mid-deploy: stop, do not re-run blindly — check
  `db:status`, restore the backup if the schema is in an unknown
  state, and only then retry.
