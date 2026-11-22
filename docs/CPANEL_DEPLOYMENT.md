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

## 2. Install + build (cPanel → Terminal)

```bash
cd ~/www.bodhisattvainternational.com
npm install --include=dev   # frontend tooling (Vite) — the app env is
                            # NODE_ENV=production, which skips devDeps
npm run build               # builds the website into dist/
cd shared
npm install                 # shared's own deps (zod) — REQUIRED: the
                            # server build compiles shared in place and
                            # Node resolves zod from shared/node_modules
cd ../server
npm install --include=dev   # server deps (argon2/sharp fetch prebuilt binaries)
npm run build               # builds shared + compiles server into server/dist/
```

Run these ONE command at a time — the cPanel web terminal garbles
multi-line pastes (commands land in the wrong folder). Check `pwd`
before each install.

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

## 4. Database migrations 0012–0023

The cPanel DB already has 0001–0011 + seed (done 2026-11-18). The
newer migrations (contact form, partner links, store settings,
policy texts) must be applied or those features will error:

```bash
cd ~/www.bodhisattvainternational.com/server
npm run db:migrate        # loads server/.env itself; applies 0012–0023
npm run db:status         # verify: nothing pending
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
