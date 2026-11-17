# Phase 4 — Admin SPA walkthrough (2026-11-17)

End-to-end run of the admin SPA against the **dev database**
(`bodhisattva_dev`), driven by local headless Chrome (CDP) against
`vite preview` on :4173 with the API on :4000.

## Setup

- API started with process env
  `CORS_ORIGINS=http://localhost:5173,http://localhost:4173` (the
  committed `server/.env` only allows the dev origin :5173; dotenv does
  not override an already-set process variable).
- Local-only super admin bootstrapped via the CLI:
  `BOOTSTRAP_SUPER_ADMIN_EMAIL=admin@example.com`,
  name "Dev Admin", throwaway dev password (reported to the task
  owner, never written into the repo). This account exists only in the
  local dev database.
- TOTP codes were computed with a one-shot node script using the
  server's own `otplib` (same parameters as
  `server/src/modules/mfa/totp.ts`).

## Flow exercised (all steps passed)

1. `/admin/login` renders the sign-in screen. → `screenshots/login.png`
2. Credentials accepted → **MFA enrolment** screen (secret shown as
   text with copy button + otpauth URL; no QR — the repo has no qrcode
   package and none was added). → `screenshots/mfa-enrolment.png`
3. Enrolment confirmed with a computed TOTP code → **recovery codes**
   shown once. → `screenshots/mfa-recovery-codes.png`
4. Acknowledgement → **Dashboard** with live counts.
   → `screenshots/dashboard.png`
5. **Page editor** for Home (page id 1): navigator (8 sections), live
   canvas rendering the real hero, inspector with the hero field spec.
   → `screenshots/editor.png`
6. **Persistence check**: hero "Heading line 1" changed from
   `Where Heritage` to `Where Heritage EDITED` in the inspector →
   autosave reported **Saved** → editor reloaded → the input showed
   `Where Heritage EDITED` (edit persisted in the draft).
   → `screenshots/editor-after-reload.png`
7. Edit **reverted** to `Where Heritage` and saved again. Verified at
   the data level afterwards: both the draft and the published hero
   sections read `Where Heritage` — published content was never touched
   by the draft edit.
8. **Media library** (empty state — the dev DB has no uploaded assets
   yet; folder sidebar + upload present). → `screenshots/media-library.png`
9. **Menus** screen (primary menu items with page dropdowns and
   visibility switches). → `screenshots/menus.png`

## Hygiene after the run

- The walkthrough's MFA credential and recovery codes were deleted
  from the dev DB and its sessions revoked, so the TOTP secret visible
  in `mfa-enrolment.png` is **dead** — it protects nothing. The dev
  admin account remains (`ACTIVE`, no MFA) and will go through
  enrolment again on its next login.
- The API and preview processes were stopped after the run.
- Note: MariaDB (local tarball install) stopped once during the
  session (likely memory pressure from Chrome + builds); it was
  restarted with the standard recipe and all data was intact.
