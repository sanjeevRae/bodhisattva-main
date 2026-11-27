# cPanel deployment checklist (Nest Nepal, yalawears account)

The platform was designed for this host: one cPanel Node.js App
(Phusion Passenger) runs `server/dist/server.js`, and with
`SERVE_SPA=true` the same process serves the API, the public website
and the admin — one app, one domain, no separate static hosting.

Suggested order: deploy to a **staging subdomain first** (e.g.
`new.bodhisattvainternational.com`), verify everything, then point
the main domain at the app. Pointing the app at the main domain
replaces whatever the domain serves today.

Current state (2026-11-20): the main domain's document root is the
folder `/home/yalawears/www.bodhisattvainternational.com`, which holds the OLD live site.
Owner decision (2026-11-20): deploy INTO that folder. Sequence:
first move the old site's files out to a sibling backup folder
(`bodhisattvainternational-oldsite`, File Manager → Show Hidden
Files → select all → move) — the domain serves nothing from the
moment it's emptied until the Node app starts, so move through the
following steps promptly. Then clone the repo into the emptied
`www.bodhisattvainternational.com` folder; application root is
`www.bodhisattvainternational.com/server`. Safeguard for the in-docroot
layout: after the app is up, verify
`https://bodhisattvainternational.com/server/.env` returns 404 (the
app must never serve it); restoring the old site = remove the Node
app and move the backup files back.

## 1. Get the code onto the server

- [ ] cPanel → **Git™ Version Control** → Create → clone
      `git@github.com:sanjeevRae/bodhisattva-main.git` (or the HTTPS
      URL) into the (emptied) `www.bodhisattvainternational.com` folder — see the owner-decision note above
      in the home directory. (Alternative: upload a zip via File
      Manager and extract it there.)
- [ ] Future updates: Git → Manage → Update/Pull, then rebuild
      (step 2) and restart the app (step 6).

## 1b. Document root — MUST be a clean folder (learned live 2026-11-22)

The domain's document root must NOT be the repo folder. Apache
serves any file that exists in the document root directly, before
Passenger sees the request — with the repo as docroot, `/` served
the Vite SOURCE index.html (blank page; browsers cannot run
/src/main.tsx) and the source tree was web-readable. The working
layout:

- Document root: `~/bodhisattvainternational-web/` — an otherwise
  EMPTY folder containing only `.htaccess` with the CloudLinux
  Passenger block (PassengerAppRoot …/server, PassengerBaseURI /,
  PassengerNodejs …/nodevenv/…/22/bin/node, PassengerAppType
  node, PassengerStartupFile dist/server.js).
- The repo lives in `~/www.bodhisattvainternational.com/` (app
  root `…/server`); the old pre-platform site remains untouched in
  `~/bodhisattvainternational/` as the backup.
- With no static files to serve, every request falls through to
  the app, which serves the built SPA from dist/ (SERVE_SPA) plus
  the API. Verified 2026-11-22: `/` → built bundle
  /assets/index-*.js 200; /src/main.tsx → app 404; /api/health →
  401 JSON; /server/.env → 403; /shop, /admin → 200.

Two related traps from the same day:

- When the Node app is first registered, cPanel writes a
  PLACEHOLDER dist/server.js (`var http = require('http');` …)
  if the startup file does not exist yet. It crashes instantly
  under "type": "module" (require is not defined). After any
  fresh app registration: stop the app, `npm run build`, verify
  `head -3 dist/server.js` shows the "API entry point" comment,
  then start.
- The db:* scripts historically required DATABASE_URL; since
  91bf9901 they also accept the discrete DB_* set. On this host
  the .env carries BOTH (DATABASE_URL with localhost) — harmless.

## 1c. Post-live fixes (2026-11-22, both verified live)

- **UPLOAD_DIRECTORY must be ABSOLUTE in production.** The
  relative `../private-storage` resolves against the Passenger
  process's working directory, which is NOT the app root on this
  host — every uploaded image 404'd while the files sat in the
  correct folder. Production value:
  `UPLOAD_DIRECTORY=/home/yalawears/www.bodhisattvainternational.com/private-storage`.
  (Uploads made earlier through a local dev server against the
  same database live only on that machine's disk — copy the local
  storage contents into private-storage preserving the 2-char
  shard folders.)
- **www origin must be allowed or redirected.** The site serves
  on both apex and www, but the Origin allowlist held only the
  apex, so every form post from www (login included) failed with
  "Request origin is not allowed." Production CORS_ORIGINS now
  lists BOTH `https://bodhisattvainternational.com` and
  `https://www.bodhisattvainternational.com`. Preferred tidy-up:
  a 301 www→apex RewriteRule at the top of the webroot
  `.htaccess`, above the Passenger block.

## 1d. ZIP-deploy route — build on PC, upload dist (learned live 2026-11-26)

This is the route actually used for the fe259de3 deploy (2026-11-26).
The GitHub zip / dist zips carry **no `server/package.json`**, and
cPanel has **no `tsx`** — so the deploy sequence differs from §2/§4
in three ways that each caused a 503 that day. Correct order on
cPanel Terminal (venv active, in `server/`):

```bash
# 1. NEW DEPENDENCY BY NAME — the uploaded dist has no package.json
#    to install from, so a dependency added in this round must be
#    installed explicitly (2026-11-26: compression):
npm install compression@1.8.2

# 2. SHARED PACKAGE COPY — LAST, after every npm install.
#    Any npm install rebuilds node_modules/@bodhisattva/shared back
#    into a dangling symlink, which crashes the boot with
#    "Cannot find package '@bodhisattva/shared'". Remove the link
#    first — plain `cp -r` fails on it ("cannot overwrite
#    non-directory") — then copy, then verify:
rm node_modules/@bodhisattva/shared
cp -r ../shared node_modules/@bodhisattva/shared
ls node_modules/@bodhisattva/shared/dist   # must list index.js etc.

# 3. MIGRATE with plain node — `npm run db:migrate` fails on cPanel
#    (tsx: command not found). Expect 27 total / 27 applied:
node dist/database/migrate.js

# 4. RESTART — equivalent to the Restart button on the Node.js App page:
touch tmp/restart.txt
```

Local rule from the same day: a server build fails if a newly added
dependency was never installed on that machine — run `npm install`
in `server/` BEFORE building, on the PC and on cPanel. Rule for
every future deploy: **installs first, shared-package copy last,
restart after that** — never the other way round.

Verify live after the restart: homepage returns 200, and the
response carries exactly one `Content-Encoding: gzip` (no
double-compression by Apache/Passenger).

## 2. Install + build (cPanel → Terminal) — VERIFIED 2026-11-22

Host quirks learned live on this server (all confirmed by terminal
output, 2026-11-22):

- Plain `npm install` IGNORES the current folder and always acts on
  the Node app's root (server). Always use `npm install --prefix
  <dir>` for the frontend and shared folders.
- The app venv exports NODE_ENV=production, so installs need
  `--include=dev` or the build tools (vite, tsc) are skipped.
- npm resolves the server's `file:../shared` dependency relative to
  the nodevenv tree (`~/nodevenv/.../server/22/shared`) — a path
  that does not exist. Symlink mode silently produces a broken
  link; `--install-links` fails with ENOENT on that path. The
  durable fix on this host: after installing, COPY the built
  shared package into `server/node_modules/@bodhisattva/shared`
  (package.json + dist). Redo the copy after any later server
  `npm install` (installs recreate the broken link).
- The cPanel web terminal garbles long pastes — a wrapped `cp`
  command once split silently in half. Run ONE short command at a
  time and verify with `ls`.

Sequence (activate the venv first; all commands from `server/`):

```bash
source ~/nodevenv/www.bodhisattvainternational.com/server/*/bin/activate

# frontend (root folder)
npm install --prefix .. --include=dev
# if vite build then fails on a missing *.linux-x64-gnu.node binary
# (Windows-made lockfile), restore the four native packages once:
npm install --prefix .. --no-save --include=dev lightningcss-linux-x64-gnu@1.30.1 @tailwindcss/oxide-linux-x64-gnu@4.1.12 @rollup/rollup-linux-x64-gnu@4.62.4 @esbuild/linux-x64@0.25.12
npm --prefix .. run build            # -> dist/  ✓ verified

# shared
npm install --prefix ../shared --include=dev
npm --prefix ../shared run build

# server
npm install --include=dev
rm -rf node_modules/@bodhisattva/shared
mkdir -p node_modules/@bodhisattva/shared
cp ../shared/package.json node_modules/@bodhisattva/shared/
cp -r ../shared/dist node_modules/@bodhisattva/shared/
npm run build                        # -> server/dist/  ✓ verified
```

Runtime resolution check (must print ALL MODULES LOADED OK):

```bash
node --input-type=module -e "for (const m of ['@bodhisattva/shared','@bodhisattva/shared/errors','@bodhisattva/shared/permissions','@bodhisattva/shared/pagination','@bodhisattva/shared/money','@bodhisattva/shared/ids']) { console.log(m,'->',import.meta.resolve(m)); await import(m); } console.log('ALL MODULES LOADED OK')"
```

- [ ] Both builds finish without errors. If `npm install` fails on
      argon2/sharp, note the exact error — there is a fallback
      (build locally, upload `dist/` folders).
- [ ] If the server is too memory-tight for the frontend build, build
      the frontend locally instead and upload only `dist/`.

## 3. Production env (server/.env on the server — never commit it)

Create `~/www.bodhisattvainternational.com/server/.env` (permissions 600) with the
production values. Copy `SESSION_SECRET`, `OTP_HMAC_SECRET` and
`TOTP_ENCRYPTION_KEY` **unchanged from the existing local .env** — the
cPanel database was seeded with them, and the MFA encryption key must
match the data. Required keys:

- `NODE_ENV=production`
- `DB_HOST=localhost`, `DB_NAME=yalawears_bodhisattvainternational`,
  `DB_USER=yalawears_bodhisattva`, `DB_PASSWORD=…`
- `SESSION_SECRET`, `OTP_HMAC_SECRET`, `TOTP_ENCRYPTION_KEY` (as above)
- `SMTP_HOST=localhost` (same server's mail), `SMTP_PORT=465`,
  `SMTP_USER=alerts@bodhisattvainternational.com`, `SMTP_PASSWORD=…`,
  `SMTP_FROM=Bodhisattva Museum <alerts@bodhisattvainternational.com>`
- `APP_URL=https://bodhisattvainternational.com` (the real domain —
  password-reset and invitation links are built from it)
- `SERVE_SPA=true`, `SPA_DIST_DIR=/home/yalawears/www.bodhisattvainternational.com/dist`
- `API_DOCS_ENABLED` — leave unset (Swagger stays off in production)
- `TURNSTILE_SECRET_KEY` + site key — optional; without them the
  contact form runs on rate limits + honeypot only (server logs a
  warning at boot).

Do NOT set `PORT` — cPanel/Passenger assigns it and the app reads it.

## 4. Database migrations

The cPanel DB was seeded with 0001–0011 (done 2026-11-18); every
later migration must be applied or the features behind it will
error. Current head: **0026** (Admin order permissions, 2026-11-26;
0025 product image placement, 0024 cover placement). Total: **27
migrations**. For any update: pull, build, then migrate
BEFORE restarting the app — new server code selects new columns
immediately.

On your PC (tsx is available there):

```bash
cd ~/www.bodhisattvainternational.com/server
npm run db:migrate        # loads server/.env itself; applies all pending
npm run db:status         # verify: nothing pending
```

On cPanel, `npm run db:migrate` FAILS (`tsx: command not found` —
verified 2026-11-26). Use the compiled migrator instead, from
`server/` with the venv active (see §1d for the full order):

```bash
node dist/database/migrate.js   # expect: 27 total / 27 applied
```

## 5. Create the Node.js App

cPanel → **Setup Node.js App** → Create Application:

- Node.js version: highest available ≥ 20
- Application mode: **Production**
- Application root: `www.bodhisattvainternational.com/server`
- Application URL: the (sub)domain chosen for launch
- Application startup file: `dist/server.js`
- Environment variables: the same values as the .env in step 3
  (cPanel vars take precedence; the .env file is what the CLI tools
  in steps 4 and 7 read).

- [ ] Create the folder `~/www.bodhisattvainternational.com/private-storage` (the
      default UPLOAD_DIRECTORY, `../private-storage` relative to the
      server folder) — uploaded media lives there, outside the web
      root.

## 6. SSL + start

- [ ] cPanel → **SSL/TLS Status** → run AutoSSL for the domain.
- [ ] Node.js App page → **Restart**.
- [ ] Open the site: homepage loads, `/shop` lists products,
      `/admin` shows the login screen.

## 7. Outbox cron (email backstop)

Order/invoice emails send immediately via the in-app drain; this
cron retries anything that failed and clears the backlog if the app
was down. cPanel → **Cron Jobs**, every 5 minutes — take the
"enter the virtual environment" command shown on the Node.js App
page and append the drain:

```bash
source /home/yalawears/nodevenv/www.bodhisattvainternational.com/server/<version>/bin/activate && cd /home/yalawears/www.bodhisattvainternational.com/server && node dist/cli/drain-outbox.js
```

(exact venv path is shown on the app page — copy it from there.)

## 8. Go-live verification

- [ ] Register a test customer (OTP email arrives from alerts@).
- [ ] Place a test order → customer confirmation arrives AND the
      Admin / Super Admin / Store Admin accounts get the new-order
      notification.
- [ ] Approve the order in admin → invoice email with PDF arrives.
- [ ] Submit the contact form → message lands at info@.
- [ ] Admin login + MFA enrolment works for the real Super Admin.

## Known state at deployment time

- Shop products and testimonials are still placeholder data — enter
  the real products in the admin before announcing the shop.
- Shipping fee / VAT rate are Rs 0 / 0% until set in
  Admin → Settings → Store settings.
- The Super Admin `super@admin.com` is a testing placeholder: invite
  the real email as Super Admin, then demote it (standing security
  item — its password was once shared in chat, as was the DB
  password; rotate both to distinct values).
