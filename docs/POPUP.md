# Site Announcement — home-page popup (2026-11-20)

Owner feature: an admin-controlled popup on the home page — an
advertisement or welcome message — shown **once per visitor**, fully
managed from the admin dashboard (image, heading, message, button
link; show / hide / delete). Plan reviewed before building:
**ChatGPT 9/10, Gemini 8.5/10**; their convergent amendments were all
adopted (below).

## How it behaves

- **One live popup at a time.** Several popups can exist (drafts,
  past announcements), but at most one is active. Activating one
  deactivates the others in the same transaction, and the database
  itself enforces the rule: migration 0019 adds a generated
  `active_slot` column (1 when active, NULL otherwise) with a UNIQUE
  index, so even two admins activating different popups at the same
  moment cannot produce two live popups.
- **Shown once.** The browser stores `popup-seen:{id}:{version}` in
  localStorage when the visitor *closes* the popup (×, backdrop,
  Esc, or the button) — never merely because it appeared. Storage
  access is try/catch-wrapped; if storage is unavailable, an
  in-memory flag still limits it to once per visit. Old markers are
  pruned (newest 5 kept). No visitor data is collected or sent.
- **Edits re-show once; hide/show does not.** `version` increments
  ONLY when visitor-facing content changes (heading, message, image,
  button label, link URL). Hide → show of unchanged content keeps the
  version, so visitors who already saw it are not bothered again.
- **Home page only**, appearing ~700 ms after load (never blocking
  first paint). If the fetch fails for any reason, the site simply
  opens without a popup — the feature can never break the site.

## Admin

- Sidebar → **Site Announcement** (permission `popup.manage`: Super
  Admin + Admin; Store Admin deliberately excluded — marketing
  content, not shop operations). Permission count 49 → **50**
  (shared catalogue + PERMISSIONS.md + seed data + migration grant).
- The editor has a live visitor preview, a media-library image
  picker, and a note when an edit will bump the version.
- Every create / update / activate / deactivate / delete is
  audit-logged (`popup.*` actions).

## API

| Route | Who | Notes |
|---|---|---|
| `GET /api/popup` | public | The single ACTIVE popup or `data: null`; `Cache-Control: no-store, private`. Inactive popups are never exposed; there is no by-id public route. |
| `GET/POST /api/admin/popups` | popup.manage | List (newest first) / create (starts inactive, version 1). |
| `PATCH/DELETE /api/admin/popups/:id` | popup.manage | Edit (version rules above) / delete. |
| `POST /api/admin/popups/:id/activate` · `/deactivate` | popup.manage | Transactional exclusivity / hide. |

Swagger: +5 paths / +7 operations (174 ops / 127 paths total).

## Security

- **No stored-XSS surface:** heading/message render as React text,
  never HTML — in the popup, the admin list, and the preview.
- **Link URL validation** (`isValidPopupLinkUrl`, unit-tested with a
  bypass catalogue): only `http:`/`https:` URLs with a hostname, or
  site-relative paths with exactly one leading slash. Rejected:
  other schemes in any case, protocol-relative `//host`, backslashes,
  whitespace/control characters anywhere, untrimmed input, >500
  chars. External links render with `rel="noopener noreferrer"`.
- **Images only from the media library** (an existing, non-deleted
  asset id, validated on write); the public payload resolves the URL
  through the media pipeline and omits the image if the asset is
  gone — no arbitrary remote URLs, no internal storage paths.
- Admin writes sit behind the platform's session + MFA + permission
  stack, like every other module.
- **Mount-order note (bug found by the integration suite):** the
  public router is mounted with the other public routers in
  `app.ts`, BEFORE the customer routers — those guard every
  fall-through `/api` path with a session check and returned 401 to
  anonymous visitors when the popup router sat behind them.

## Data

Migration **0019_site_popups**: `site_popups` table + the
`active_slot` generated column + unique index + the `popup.manage`
permission row and ADMIN grant (idempotent). Down migration removes
the grant, the permission, and the table.

## Tests

- Unit `tests/popup-url.test.ts` — 32 cases: accepted shapes, the
  bypass catalogue, schema pair rule (link requires a button label),
  length caps.
- Integration `tests/popups.integration.test.ts` (own database
  `bodhisattva_test_popups`) — 8 cases: bootstrap/MFA, public null +
  no-store, permission matrix (anonymous 401; Store Admin + Customer
  403), create validation, inactive-at-v1 creation, activation
  exclusivity in API + table, version semantics, delete + audit.

## Deliberately out of v1 (reviewer-endorsed)

Scheduling (start/end dates), multiple simultaneous popups,
site-wide placement, visitor analytics, frequency caps. The schema
leaves room for a `placement` field later if the museum ever wants
an urgent site-wide notice — the reviewers' suggested pattern for
that is a thin top bar, not a modal.
