# Policy Pages — Privacy Policy, Terms of Use, Accessibility

Owner feature, 2026-11-20. The three footer links used to be plain
text; they are now real pages whose content the client edits in the
admin. Plan reviewed by ChatGPT (thinking mode) before building:
**8/10, 9.5/10 with its amendments** — the amendments adopted are
marked † below.

## What exists

| Page | Public URL | API |
| --- | --- | --- |
| Privacy Policy | `/privacy-policy` | `GET /api/policies/privacy-policy` |
| Terms of Use | `/terms-of-use` | `GET /api/policies/terms-of-use` |
| Accessibility | `/accessibility` | `GET /api/policies/accessibility` |

Exactly three pages exist — enforced three ways †: the API slug
allowlist, a database `CHECK` constraint (`chk_policies_slug`), and
the absence of create/delete endpoints. Admin screen: **Policy
Pages** in the sidebar (permission `policy.manage`, Super Admin +
Admin; catalogue 50 → 51).

## Editing (admin)

- Title + the shared rich text editor (headings, bold/italic,
  lists, quotes, links) with one addition: an **Insert image**
  button that picks from the media library.
- Saving **publishes immediately** — a confirmation dialog says so,
  because there is no draft state for legal pages.
- Every save is one database transaction †: the previous content is
  snapshotted into `site_policy_revisions`, the page is updated,
  and the audit row is written (`policy.update` / `policy.restore`).
  The audit write uses the platform's standard writer on the same
  transaction handle; per that platform-wide design an audit failure
  is logged, never silently treated as success.
- **History**: each page lists its replaced versions (newest
  first). Any version can be viewed and **restored**; a restore
  first snapshots the live version, so a restore is itself
  reversible.
- **Optimistic concurrency** †: a save must name the version the
  editor loaded. If someone else saved first, the save is refused
  with **409** and the screen offers "Reload the latest version"
  instead of silently overwriting their work.

## Security

- Admin routes sit behind a full (MFA-completed) session +
  `policy.manage`; the platform's global CSRF + origin checks apply
  to every write, as everywhere else. Store Admins and Customers
  get 403; an admin who has not completed MFA enrolment gets 403.
- Bodies are strict (unknown keys rejected) and capped at 500 KB.
- **Dedicated sanitizer** (`server/src/modules/policies/sanitize.ts`),
  deliberately NOT the CMS one: it is the CMS allowlist tightened —
  `span` loses its `class`, and `img` is allowed **only** with an
  exact media-library source (`/api/media/<id>/file/master|original`,
  anchored — no query, fragment, external, data: or
  protocol-relative URLs); an image with any other source is removed
  whole. Links keep http/https/mailto/tel; a `target=_blank` link
  always gains `rel="noopener noreferrer"`. Media uploads are
  raster-only at the pipeline, so no SVG can ever be served through
  these URLs. The same function sanitizes on write AND on read, and
  it is idempotent (unit-tested).
- The public response carries no editor metadata (no `updatedBy`),
  and is sent `Cache-Control: no-store` so edits show at once.

## The public page

- Title, "Last updated" date, then the body in the site's reading
  typography (`.policy-body`).
- **Sticky table of contents** (desktop; collapsible on mobile),
  built after render from the body's h2/h3/h4 headings. Heading ids
  are generated from heading **text only** (shared slug helpers:
  lowercase ASCII, `policy-section-` prefix, duplicates suffixed
  -2/-3) and assigned as DOM properties — heading text never
  becomes markup. A scrollspy highlights the section at the reading
  line, marks it `aria-current="location"`, treats the page bottom
  as the last section, and honours `prefers-reduced-motion` for
  TOC jumps. A page with no headings renders single-column.
- Verified live (headless Chrome, 2026-11-20): TOC counts match the
  headings (9/10/4 on the starter pages), the current marker is the
  first section at the top and the last at the bottom, and a TOC
  click lands its heading at 104 px — clear of the fixed header.

## Starter content — read this

Migration 0020 seeds the three pages with starter text written
strictly from what this website actually does today (accounts,
cash-on-delivery orders — no card data is ever collected — contact
form, essential cookies only, no analytics trackers). It makes **no
WCAG conformance claim** on the Accessibility page. It is a draft
for the client's legal review, and the admin editor shows a notice
saying so. Seeding uses `INSERT IGNORE`: re-running the migration
never overwrites an admin's edits (integration-tested).

## Data

- Migration `0020_site_policies` (+ `_down`): `site_policies`
  (slug PK, title, body_html, version, updated_by → users
  ON DELETE SET NULL †), `site_policy_revisions` (snapshot rows),
  the `policy.manage` permission + ADMIN grant, the seeded pages.
- Swagger: +7 operations across +6 paths (181 operations /
  133 paths in total).

## Tests

- Unit (`tests/policies.test.ts`, 11 tests): sanitizer battery
  (script/iframe/object/style/event handlers stripped; bad link
  schemes stripped; `_blank` rel enforced; the image-source
  catalogue — external/data/query/fragment/wrong-variant all
  removed whole, media images kept; span classes dropped;
  idempotency) and the slug helpers (slugify + dedupe).
- Integration (`tests/policies.integration.test.ts`, own database
  `bodhisattva_test_policies`, 15 tests): seeded pages, CHECK
  constraint, INSERT IGNORE idempotency, public reads (no-store,
  sanitized-on-read, no internal fields, 404s), the permission
  matrix incl. MFA-incomplete, CSRF rejection, atomic
  update+revision+audit, 409 on stale version (nothing written),
  write-time sanitization, strict bodies, revision view + restore
  reversibility, Super Admin edit.

## Known limitation / future work

- **Terms acceptance versioning** †: the site has no flow where a
  customer accepts the Terms (registration and checkout do not
  present them), so v1 does not record which version a customer
  accepted. If an acceptance step is ever added (e.g. a required
  checkbox at registration), record `policy slug + version +
  timestamp` against the account at that moment — the version
  counter this feature maintains is what makes that possible.
- Revision history is capped at the newest 50 per page in the API
  list; nothing prunes old revisions from the table.
