# Backup & Restore

What to back up, how, and how to restore it — with the evidence from
the Phase 8 restore drill. **Status:** the procedure is written and
drill-proven locally; production scheduling is deployment work (the
platform is not deployed yet — see DEPLOYMENT_GUIDE.md).

## The three backup legs

A restore is only complete with **all three**:

| Leg | Contents | Method |
|---|---|---|
| 1. Database | Everything: content, accounts, orders, invoices, audit | `mariadb-dump` / `mysqldump`, `--single-transaction --skip-lock-tables` (consistent InnoDB snapshot) |
| 2. File storage | The whole `UPLOAD_DIRECTORY` tree: media shards, generated invoice + credit-note PDFs | Tarball of the storage directory |
| 3. Configuration | The environment-variable set — **including `TOTP_ENCRYPTION_KEY`** | Exported securely into a password manager / sealed record, never into the repo or the backup directory |

> **The configuration leg is the one everyone forgets.** MFA secrets
> are stored encrypted under `TOTP_ENCRYPTION_KEY`. Restore a database
> without that key and the data is fine but **no admin can complete
> MFA sign-in** — every admin must re-enrol. The drill proved the
> positive case: with the key restored, a TOTP generated from the
> restored (decrypted) secret verified successfully.

## Backup procedure

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
mariadb-dump -h127.0.0.1 -u<user> -p<pass> \
  --single-transaction --skip-lock-tables \
  <database> > backup-$STAMP.sql
tar -czf storage-$STAMP.tar.gz -C <parent-of-UPLOAD_DIRECTORY> uploads
sha256sum backup-$STAMP.sql storage-$STAMP.tar.gz > checksums-$STAMP.txt
```

Rules (from `DEPLOYMENT_REQUIREMENTS.md` §9):

- **Never store backups in a publicly downloadable directory.**
  Stage under `private-storage/backups/` (outside `public_html`).
- **At least one copy must leave the hosting account** (cloud storage
  or a controlled machine) — an account compromise or termination
  otherwise destroys the site and its backups together.
- Suggested retention (owner to confirm): daily × 14, weekly × 8.
  Invoice PDFs are financial records — consider longer retention.
- A database dump contains password hashes and encrypted MFA secrets:
  treat the files as secrets (the drill artifacts are gitignored for
  exactly this reason).

Production scheduling: a daily off-peak cron running the commands
above (DEPLOYMENT_GUIDE.md §8).

## Restore procedure

1. Create the target database (utf8mb4 / utf8mb4_unicode_ci) and grant
   the application user access.
2. Import the dump: `mariadb <database> < backup-<stamp>.sql`.
3. Extract the storage tarball so `UPLOAD_DIRECTORY` points at the
   restored `uploads/` tree.
4. Restore the configuration (the exact env set from leg 3 — same
   secrets, above all the same `TOTP_ENCRYPTION_KEY`).
5. Boot the API against the restored data and run the smoke checks:
   - `GET /health` 200, `GET /health/ready` database ok
   - a public page payload (`GET /api/pages/home`) serves restored rows
   - an admin can log in **and complete MFA** (this is the check that
     proves leg 3 was restored correctly)
   - an invoice PDF downloads and matches its pre-backup checksum
6. Check migration state: `npm run db:status` — the restored database
   should report all migrations applied; if the code being deployed is
   newer than the backup, run `npm run db:migrate` after the smoke
   checks pass.

## Drill evidence (Phase 8, local)

Executed 2026-11-17 against the local MariaDB 10.11.14 and the
development dataset — full record in `docs/phase-8/backup-restore.md`:

| Step | Result |
|---|---|
| Backup | Dump of all 47 tables (160,330 bytes, ≈2.3 s) + storage tarball (2,371 bytes), SHA-256 recorded |
| Restore | Import ≈16.4 s; **total measured restore ≈22 s** end-to-end for the dev dataset (production times scale with data volume; import dominates) |
| Row counts | Identical before/after (users 2, pages 7, products 12, orders 1, invoices 1) |
| Smoke tests | Health + readiness 200; home page payload from restored rows; admin login verified against the restored Argon2 hash; MFA completed with a TOTP from the restored secret; invoice INV-2026-00001 PDF download **byte-identical** (SHA-256 `1642ede5…`) to the pre-backup file |
| Cleanup | Scratch database dropped, scratch storage deleted, throwaway instance stopped |

An untested backup does not count as a control: re-run this drill
periodically in production (and after any migration that changes
table structure), not just once.
