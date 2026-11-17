# Bodhisattva Museum — Dynamic Website Platform

The Bodhisattva Museum website, rebuilt from the original Figma design
bundle ("Bodhisattva Museum Website Design",
https://www.figma.com/design/gPGaW3HhgC3m24fk684y4l/Bodhisattva-Museum-Website-Design)
into a fully dynamic platform: a database-driven CMS with a visual page
builder, museum content modules (collections, exhibitions, news,
foundation), a Gift Shop with login-gated cart and cash-on-delivery
checkout, a staff order/invoice workflow, and a permission-based admin
with TOTP MFA — while keeping the seven original pages visually
recognisable and every original URL intact.

**Status (2026-11-17):** Phases 0–8 are implemented, tested and
verified locally. **Nothing is deployed yet** — production deployment
to the owner's cPanel hosting is pending the owner's hosting
connection and explicit deployment approval (see
`DEPLOYMENT_GUIDE.md`).

## Stack

| Layer | Technology |
|---|---|
| Public site + admin SPA | React 18, Vite 6, Tailwind CSS 4, React Router, shadcn/ui components, dnd-kit (builder), TipTap (rich text) |
| API | Express 5 + TypeScript (`server/`), Zod validation, pino logging |
| Database | MariaDB / MySQL via Drizzle ORM + mysql2; migrations in `server/drizzle/migrations/` |
| Shared contracts | `shared/` — error catalogue, 49 permissions, money (integer paisa), pagination, ids |
| Security | Argon2id passwords, server-side sessions, TOTP MFA, sanitize-html, Sharp image pipeline, PDFKit invoices |

## Repository layout

```
src/            Public site (7 CMS pages + shop/account pages) and the
                admin SPA (src/admin/) — one Vite app, admin is a lazy chunk
server/         Express + TypeScript API, Drizzle schema + migrations,
                seed data, CLIs (bootstrap, outbox drain, media sweep,
                inventory reconcile), unit + integration tests
shared/         @bodhisattva/shared — contracts used by both sides
docs/           Per-phase evidence (screenshots, walkthroughs, drills)
*.md (root)     Design + governance documents (below)
```

## Quickstart

Full local setup (database creation, three installs, env file,
migrations, seed, running both processes, tests) is in
**[SETUP.md](SETUP.md)**. The short version:

```bash
npm install                      # frontend
npm --prefix shared install && npm --prefix shared run build
npm --prefix server install
cp server/.env.example server/.env   # then set DB credentials + secrets
npm run db:migrate && npm run db:seed
npm run server:dev               # API on :4000
npm run dev                      # site on :5173 (proxies /api to :4000)
```

## Documentation index

| Document | Contents |
|---|---|
| [SETUP.md](SETUP.md) | Local development setup, per-phase additions, test suites |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Every API route group: method, path, auth/permission, envelope + error catalogue |
| [CMS_GUIDE.md](CMS_GUIDE.md) | Editor's guide: pages, drafts, publish/rollback, the visual builder, menus, settings, media, museum modules |
| [ECOMMERCE_GUIDE.md](ECOMMERCE_GUIDE.md) | Store staff guide: products, inventory ledger, order workflow, invoices, credit notes, email statuses, audit log |
| [SECURITY_GUIDE.md](SECURITY_GUIDE.md) | The security model as built + the Phase 8 security-suite results |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | cPanel production runbook — **not yet executed** |
| [BACKUP_RESTORE.md](BACKUP_RESTORE.md) | Backup + restore procedure, with the Phase 8 drill evidence |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Every known limitation and placeholder, consolidated |
| [CHANGELOG.md](CHANGELOG.md) | One entry per phase, with commit hashes |
| [PROJECT_AUDIT.md](PROJECT_AUDIT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE_DESIGN.md](DATABASE_DESIGN.md) · [PERMISSIONS.md](PERMISSIONS.md) · [CMS_CONTENT_MAPPING.md](CMS_CONTENT_MAPPING.md) · [SECURITY_THREAT_MODEL.md](SECURITY_THREAT_MODEL.md) · [DEPLOYMENT_REQUIREMENTS.md](DEPLOYMENT_REQUIREMENTS.md) · [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Phase 0 design set (maintained) |
| `PHASE0_REVIEW.md` … `PHASE7_REVIEW.md` | Independent ChatGPT + Gemini review syntheses per phase, with dispositions |
