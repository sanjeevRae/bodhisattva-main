# Phase 8 — Backup + Restore Drill (local evidence)

Run: 2026-11-17 (Asia/Kathmandu), against the local MariaDB 10.11.14 tarball
install and the development dataset. This is a **local drill** — it proves the
backup/restore procedure and the application's behaviour on restored data. It
is not a production backup: production scheduling, off-host copies and
retention remain deployment work for when hosting is connected.

## What was backed up

| Artifact | Path | Size | SHA-256 |
|---|---|---|---|
| Database dump (all 47 tables, `bodhisattva_dev`) | `docs/phase-8/drill/bodhisattva_dev-20261117-130156.sql` | 160,330 bytes | `9bde6c7cd8bf530c8d47061bc4a4e288ec93d992b5b5ff3dff5e3d07240f14e8` |
| File storage tarball (`server/storage`: uploads + invoice PDFs) | `docs/phase-8/drill/server-storage-20261117-130156.tar.gz` | 2,371 bytes | `4a36ac792fb6ec508d7d728cecdd1bc006de561dcb7134d2b69322862735e1d6` |

Commands:

```bash
mariadb-dump -h127.0.0.1 -u<user> -p<pass> --single-transaction --skip-lock-tables bodhisattva_dev > bodhisattva_dev-<stamp>.sql
tar -czf server-storage-<stamp>.tar.gz -C server storage
```

The drill directory is **gitignored** (added to `.gitignore` in this phase):
a database dump contains password hashes and encrypted MFA secrets and must
never be committed. The configuration (including `TOTP_ENCRYPTION_KEY`) is a
third backup leg — without it, restored MFA secrets cannot be decrypted and
every admin must re-enrol (see `production-config.md`).

Timings: dump ≈ 2.3 s, tarball ≈ 0.02 s (dataset is small: DB ≈ 2.9 MB,
storage 12 KB / 1 file).

## Restore procedure (as executed)

1. Create the scratch database and grant the application user access:
   `bodhisattva_restore_drill` (utf8mb4 / utf8mb4_unicode_ci).
2. Import the dump: `mariadb < dump.sql` — **≈ 16.4 s** for 47 tables.
3. Extract the storage tarball to a scratch directory
   (`/tmp/restore-drill/storage`).
4. Boot a throwaway API instance against the restored data only:
   `PORT=4100`, `DATABASE_URL=mysql://…@127.0.0.1:3306/bodhisattva_restore_drill`,
   `UPLOAD_DIRECTORY=/tmp/restore-drill/storage/uploads`, all other settings
   from the normal server environment.
5. Smoke test (below), then stop the instance, drop the scratch database and
   delete the scratch storage. The dump files and this document are retained.

**Total measured restore time: ≈ 22 s** (dump 2.3 s + import 16.4 s + storage
extract < 1 s + API ready ≈ 3 s) for the development dataset. Production times
will scale with data volume; the import step dominates.

## Row counts — before vs after

| Table | `bodhisattva_dev` (source) | Restored |
|---|---|---|
| users | 2 | 2 |
| pages | 7 | 7 |
| products | 12 | 12 |
| orders | 1 | 1 |
| invoices | 1 | 1 |
| media_assets | 0 | 0 |

## Smoke tests on the restored instance — all passed

| Check | Result |
|---|---|
| `GET /health` | 200 |
| `GET /health/ready` | 200 — `{"status":"ready","database":"ok"}` |
| `GET /api/pages/home` (public page payload) | 200 — published home page with sections, served from restored rows |
| Admin login (`admin@example.com`, dev admin) | Password verified against the **restored** Argon2 hash → `authLevel: "mfa_pending"` |
| MFA verify (TOTP) | `authLevel: "full"` — code generated from the secret decrypted out of the **restored** `mfa_credentials` row using `TOTP_ENCRYPTION_KEY`, proving encrypted-at-rest data survives the round trip when the key is backed up |
| `GET /api/admin/invoices/1/download` (INV-2026-00001) | 200, 9,368 bytes, `%PDF-` header, SHA-256 `1642ede5eb9039628961fc502b0b485750fe9ca302f6669d04fcc4abcc3a6ec0` — **byte-identical** to the pre-backup file in `server/storage` |

## Steps that needed manual intervention / notes

- `/usr/bin/time` does not exist on this VM; timings were taken with shell
  timestamps. No effect on the procedure.
- Completing the MFA smoke test required reading the real schema
  (`mfa_credentials.secret_encrypted`) and the key-decoding rule in
  `server/src/modules/mfa/totp.ts` (64-char hex, else base64, must decode to
  exactly 32 bytes). Operational consequence: **back up `TOTP_ENCRYPTION_KEY`
  with the configuration** — a restore without it is still usable, but all
  admins must re-enrol MFA before they can sign in fully.
- The throwaway instance was booted from the `server/` directory, so
  `server/.env` was auto-loaded by dotenv and only the drill variables were
  overridden — intended here; see the dotenv note in `production-config.md`.

## Cleanup confirmation

Scratch database `bodhisattva_restore_drill` dropped; scratch storage under
`/tmp/restore-drill` deleted; throwaway API instance stopped. Remaining
databases are the dev and test databases only. Backup artifacts remain at the
paths in the table above (out of git).
