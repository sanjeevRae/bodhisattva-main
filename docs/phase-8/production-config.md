# Phase 8 — Production Configuration Pass

Source of truth: `server/src/config/env.ts` (Zod schema, validated at boot via
`loadConfig()` in `server/src/server.ts`) and `server/.env.example`.
Verified 2026-11-17 by booting the compiled server (`dist/server.js`) with
deliberately broken environments.

## Variables that must be set for production

| Variable | Rule (enforced at boot) |
|---|---|
| `SESSION_SECRET` | Required, ≥ 32 characters |
| `OTP_HMAC_SECRET` | Required, ≥ 32 characters |
| `TOTP_ENCRYPTION_KEY` | Required, ≥ 32 characters **and** must decode to exactly 32 bytes (64 hex chars, or base64 of 32 bytes) — it is the AES-256-GCM key for MFA secrets at rest |
| All three secrets | Must be **pairwise distinct** — one secret per purpose; reuse is rejected |
| All three secrets (production only) | Must not contain the placeholder markers `change-me`, `placeholder`, or `example-secret` (case-insensitive) |
| `DB_PASSWORD` | Required **unless** `DATABASE_URL` is set (either form of DB configuration is accepted) |

Everything else has a built-in default (`PORT` 4000, `APP_URL`, `DB_HOST` /
`DB_PORT` / `DB_NAME` / `DB_USER`, `DB_POOL_LIMIT` 5, `SMTP_*`,
`UPLOAD_DIRECTORY` `../private-storage`, the OTP policy and rate-limit policy
knobs). Defaults exist so local development works; production should still set
`APP_URL` / `CORS_ORIGINS`, `SMTP_*` and `UPLOAD_DIRECTORY` explicitly for the
host. There are no other hidden required variables: no secret exists in code.

## Fail-fast boot tests (all confirmed)

Each boot was run from a directory **without** a `.env` file (see the dotenv
note below), with `NODE_ENV=production`. Every broken environment exited with
code 1 before listening, printing `Invalid environment configuration:` and one
line per problem naming the variable and the reason:

| # | Broken input | Result |
|---|---|---|
| 1 | `SESSION_SECRET` missing | exit 1 — `SESSION_SECRET: SESSION_SECRET is required` |
| 2 | `SESSION_SECRET` = the `.env.example` placeholder (`change-me-…`) | exit 1 — `SESSION_SECRET: SESSION_SECRET still contains a placeholder value; generate a unique secret for production` |
| 3 | `OTP_HMAC_SECRET` identical to `SESSION_SECRET` | exit 1 — `OTP_HMAC_SECRET: OTP_HMAC_SECRET must differ from SESSION_SECRET — one secret per purpose` |
| 4 | Neither `DATABASE_URL` nor `DB_PASSWORD` | exit 1 — `DB_PASSWORD: DB_PASSWORD is required when DATABASE_URL is not set` |
| 5 | `TOTP_ENCRYPTION_KEY` = a 33-char string that decodes to ≠ 32 bytes | exit 1 — `TOTP_ENCRYPTION_KEY: TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters or base64 of 32 bytes) for AES-256` |

Control: a complete, valid production environment (three distinct generated
secrets, 64-hex TOTP key, `DATABASE_URL` set) booted normally —
`Bodhisattva API listening` with `nodeEnv: "production"`, `GET /health` 200,
`GET /health/ready` → `{"status":"ready","database":"ok"}`,
`GET /api/pages/home` 200.

## Operational note — dotenv masks missing variables (by design, locally)

`server/src/server.ts` calls `dotenv.config()` before validation, so when the
process is started from the `server/` directory, any variable present in a
local `server/.env` silently fills in for a missing process variable — the
first boot test above appeared to "hang" (the server booted and listened)
until it was re-run from a clean directory. This is the intended local-dev
behaviour and matches `DEPLOYMENT_REQUIREMENTS.md` §7.2 (production values
come from the cPanel Node.js app configuration, never from a file in the
repo). **Deployment rule: do not ship a `.env` file inside the deployed app
directory** — if one is present, the fail-fast guarantee only covers variables
that are absent from that file too.
