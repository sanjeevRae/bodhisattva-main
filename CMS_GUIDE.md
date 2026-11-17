# CMS Guide — for the Museum's Editors

How to run the website's content day to day. Everything below is done
in the admin at **`/admin`** after signing in. Admin accounts must
complete TOTP MFA (authenticator app) at sign-in; some sensitive
actions ask for a fresh MFA code in a pop-up ("step-up") — that's
normal.

Your access depends on your role's permissions: if a screen or button
isn't visible, your role doesn't include it — ask a Super Admin rather
than working around it.

## Pages and the publish workflow

Content is never edited "live". Every page has **revisions**:

1. **Open a page** (Pages screen) — the editor loads the current
   **draft**. If you haven't edited since the last publish, the draft
   starts as a copy of what's published.
2. **Edit the draft** in the builder (below). Changes autosave after
   ~2 seconds; you can also save manually. The version indicator shows
   when everything is saved.
3. **Preview** the draft before publishing (Preview button) — the
   preview link is private and expires after 30 minutes.
4. **Publish** when ready. Publishing re-checks every section and
   swaps the live page in one step; if anything is invalid, nothing
   goes live and the previous version stays up.
5. **Rollback** (Revisions drawer): if a publish was a mistake, point
   the page back at any earlier revision. Your draft is refreshed from
   it, and the bad revision is kept in history — nothing is lost.

Two safety behaviours to know:

- If a colleague saves the same page while you edit, you'll get a
  **conflict banner** instead of silently overwriting them. Reload to
  pick up their version (your unpublished edits to that draft are
  replaced — coordinate before reloading if you had work in it).
- The seven original pages (Home, Museum, Gallery, Gift Shop, News,
  Foundation, About) are **system pages**: they can't be deleted and
  their web addresses (slugs) can't change. New pages can be created
  freely, except for reserved addresses (login, shop plumbing, etc.).

## The visual page builder

Three panels:

- **Left — section navigator.** The page as a list of sections. Drag
  to reorder; the eye toggles a section's visibility; duplicate and
  delete live here too. **+ Add** offers all 22 section types (hero,
  title band, rich text, image + text, image gallery, stats, cards,
  news rows, module-driven lists for collections / exhibitions /
  testimonials / featured products, contact blocks, forms, divider,
  spacer, newsletter signup…).
- **Centre — live canvas.** The real public page rendering of your
  draft, switchable between desktop / tablet (768 px) / phone
  (390 px) widths. Click a section in the canvas or the navigator to
  select it.
- **Right — inspector.** The selected section's fields, plus the page
  metadata panel (title, slug, SEO image, visibility).

Undo/redo works with Ctrl+Z / Ctrl+Shift+Z (typing is grouped, so one
undo doesn't eat a whole sentence). Leaving the editor with unsaved
changes asks first.

### Rich text fields — the WYSIWYG editor

Rich-text fields (section body copy, paragraphs) use a formatting
editor, not raw code:

- Toolbar: paragraph, Heading 2/3/4, bold, italic, underline,
  strikethrough, subscript, superscript, bullet and numbered lists,
  blockquote, links, clear formatting, undo/redo.
- The toolbar only offers what the website can actually display — the
  same allowlist the server enforces when saving (headings 2–4 only,
  links to http/https/mailto/tel or site-relative addresses). Pasted
  content from Word or a browser is cleaned to that set automatically:
  fonts, colours, inline styles, tables and scripts are stripped;
  structure (headings, bold, lists, links) survives.
- **HTML source view** (the `</>` toggle) shows/edits the raw HTML for
  the rare cases the toolbar can't express — e.g. a `<span class="…">`
  hook. Saving still passes through the server sanitizer, so anything
  outside the allowlist is removed on save.
- If the editor ever fails to load, the field falls back to a plain
  text area holding the same HTML — you can keep working.

## Menus

Menus screen: the site's navigation (primary, the three footer
columns, mobile). Items can link to a page, an external URL, or an
anchor. Changes are saved per menu and take effect immediately on the
public site.

## Site settings

Settings screen: site-wide values (contact details, opening hours,
social links, and — for store staff — the `store.*` shop settings).
Only public settings are exposed on the website. Every change is
audited with its old and new value. Secrets are never settings — they
live in server configuration, not here.

> Known content flags inherited from the original site (see
> KNOWN_LIMITATIONS): the footer and the About page state different
> opening hours; both were preserved as separate settings
> (`opening_hours_summary` vs `opening_hours`) for the client to
> reconcile.

## Media library

- **Upload**: drag files in or use the upload button. Images only
  (JPEG/PNG/WebP/GIF/AVIF), max 10 MB. The server re-encodes every
  image (metadata/EXIF stripped) and generates thumbnail + medium
  sizes automatically; files get random storage names, so renaming
  the display name never breaks a link.
- **Folders** organise the library; moving a folder into itself or its
  own subfolder is blocked.
- **Alt text matters** — fill it in; it's what screen readers and
  search engines use.
- **Deleting is blocked** while any content references the image (a
  page's social image, a section, a collection/exhibition cover, a
  product image) — the error tells you it's in use; remove the
  reference first. Deletion is a soft delete.
- In the page builder and module editors, pick images with the media
  picker rather than pasting URLs.

## Museum modules

Separate screens manage the structured records the pages render:

- **Collections** — the museum's collections (name, category, period,
  item count, cover image, description). Reorder sets the display
  order. The public Museum page's category filter works off each
  record's category.
- **Exhibitions** — exhibitions with dates, gallery, and status; each
  exhibition has its own **gallery items** managed inside its edit
  form. The public Gallery page is driven by these records.
- **News** — categories (with a colour token chosen from the site's
  palette) and articles. Public ordering is newest first; the public
  search covers headlines and body text.
- **Foundation** — programs and testimonials, with reorder.

Records are edited **live**: saving a record changes the public site
immediately (there is no draft/publish step for records, unlike
pages). Every save is validated server-side and written to the audit
log, and deletes are soft — but double-check before saving, and see
KNOWN_LIMITATIONS for the draft/live discussion.

Record images can come from the media library (`cover`) — records
migrated from the old site may still point at their original external
image URL until the client decides on migrating them into the library
(the media version wins whenever both exist).
