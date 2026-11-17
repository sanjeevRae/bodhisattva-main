# Phase 8 — WYSIWYG rich-text editor (walkthrough notes)

The Phase 4 deferral is closed: every rich-text field in the admin page
builder now uses a TipTap editor whose output is confined to the server's
sanitize-html allowlist. Frontend only — no `server/` changes, no public-side
changes.

## What was built

- `src/admin/RichTextField.tsx` (new) — the editor component. It is loaded
  lazily (`React.lazy`) from `fields.tsx`, inside an error boundary: if the
  chunk fails to load or TipTap fails to initialise, the field falls back to
  the plain textarea with the identical value contract (an HTML string).
- `src/admin/fields.tsx` — the two rich-text field kinds from
  `field-specs.ts` now render the editor:
  - `kind: "richtext"` (single fields — e.g. rich_text `columns[].body`,
    image_text `paragraph`),
  - `kind: "richtextList"` items (e.g. rich_text / image_text `paragraphs[]`).
  Empty string still maps to "unset" for single fields, exactly as the old
  textarea behaved.
- Toolbar (compact, admin design language): Paragraph, Heading 2/3/4, Bold,
  Italic, Underline, Strikethrough, Subscript, Superscript, bullet list,
  numbered list, blockquote, add/edit link (inline URL bar), remove link,
  clear formatting, undo/redo, and an HTML source toggle (view/edit the raw
  HTML; closing source view re-parses it through the editor schema, and the
  server sanitizes on save regardless). A footer shows word/character counts
  and the note that formatting is limited to what the site can display.
- The editable area is styled like the site's body text (theme sans, relaxed
  leading) with the theme's heading sizes, list markers and blockquote
  styling applied inside the editor surface.

## Allowlist → toolbar mapping

Source of truth: `SANITIZE_OPTIONS` in `server/src/modules/cms/registry.ts`.

| Server allowlist | Editor |
| --- | --- |
| `p`, `br` | Paragraph button; Enter/Shift+Enter |
| `h2`, `h3`, `h4` | Heading 2/3/4 buttons (StarterKit restricted to levels 2–4; no H1) |
| `strong`/`b`, `em`/`i` | Bold, Italic buttons |
| `u` | Underline extension |
| `s` | Strikethrough button |
| `sub`, `sup` | Subscript / Superscript extensions |
| `ul`, `ol`, `li` | Bullet / numbered list buttons |
| `blockquote` | Quote button |
| `a[href,title,target,rel]`, schemes http/https/mailto/tel, no protocol-relative | Link button + URL bar; the URL is validated against the same scheme set (relative paths, anchors and queries also pass, as sanitize-html permits them). Toolbar-created links store **href only** (TipTap's default `target`/`rel` are suppressed) |
| `span[class]` | **No toolbar control** — producible via the HTML source view only (see limitations) |

Everything else is excluded by construction: StarterKit's code, code block
and horizontal rule are disabled; there are no image, table, text-align,
colour or font controls; no `style` attribute can be produced. Pasted or
source-entered markup outside the schema is dropped or unwrapped by
ProseMirror's parser on the way in, and the server sanitizes again on save —
defence in depth.

## Dependencies & bundle impact

Added to the root `package.json` (TipTap v3.34.0): `@tiptap/react`,
`@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-underline`,
`@tiptap/extension-subscript`, `@tiptap/extension-superscript`. Nothing else.

Production build (`npm run build`, green):

| Chunk | Before | After |
| --- | --- | --- |
| Public entry `index-*.js` | 451.43 kB (gzip 132.50) | **unchanged** |
| `AdminApp-*.js` (already lazy) | 321.19 kB | 322.22 kB (gzip 79.17) |
| `RichTextField-*.js` (**new, lazy**) | — | 425.02 kB (gzip 134.63) |

TipTap/ProseMirror download only when an admin opens a field that contains a
rich-text editor; the public site never loads it.

## Walkthrough (local stack: API :4000, preview :4173, headless Chrome)

Dev admin session via the real login + MFA flow. All content edits were
reverted afterwards (see "Restore" below).

1. **Museum page → "Overview" rich_text section, paragraph 1** (a
   `richtextList` item). Replaced the text using the toolbar: Heading 3, Bold
   on "sacred art", a bullet list, and a link on "visit". The autosaved draft
   stored exactly:

   ```html
   <h3>A Living Archive of Sacred Art</h3><p>The museum preserves <strong>sacred art</strong> for future generations.</p><ul><li><p>Thangka paintings</p></li><li><p>Bronze sculptures</p></li></ul><p>Plan your <a href="https://example.org/visit">visit</a> today.</p><p></p>
   ```

   Only allowlisted tags; the anchor carries `href` and nothing else. (The
   trailing `<p></p>` is an empty paragraph left by the list-exit keystrokes —
   valid allowlisted HTML, renders as slight extra space.)
2. **HTML source view** showed the same markup; toggling back to visual mode
   preserved it.
3. **Paste cleanup** — styled Word-like HTML was pasted into paragraph 2 via a
   synthetic `ClipboardEvent` carrying `text/html` (ProseMirror consumed and
   prevented it — the real paste pipeline). The payload contained inline
   styles everywhere, an H1, a styled span, `<font>`, a `<script>`, an
   `<img onerror>`, a table, a `javascript:` link and an https link. Stored
   after save (identical to the editor DOM — the server's sanitizer had
   nothing left to remove):

   ```html
   <p>Big <strong>Gallery</strong> Title</p><p>Styled <strong>bold</strong> and <em>italic</em> text with a script, a font tag and an image.</p><p>cell onecell two</p><ul><li><p>kept list item</p></li></ul><p>Read this bad link and <a href="https://example.org/good">this good link</a>.</p>
   ```

   H1 → paragraph, span's bold → `<strong>`, all `style` attributes gone,
   script element *and its contents* gone, font unwrapped, image dropped,
   table reduced to its cell text, the `javascript:` link unwrapped (text
   kept), the good link preserved.
4. **Publish + public render** — the section was published and the public
   /museum page rendered the heading, bold, list items and link
   (screenshot `public-museum-formatted.png`).
5. **About page → rich_text columns** (single `richtext` fields): selected
   "artistic heritage" in the Mission column body and bolded it via that
   editor's own toolbar. Stored:

   ```html
   <p>To collect, preserve, and interpret the <strong>artistic heritage</strong> of South Asian Buddhist and cultural traditions; …
   ```

   Note the plain-text seed value gained a `<p>` wrapper — the stored-value
   contract is an HTML string, and this is the correct normal form.

### Screenshots (`docs/phase-8/screenshots/`)

- `editor-overview.png` — Page Editor with the rich_text section selected.
- `wysiwyg-editor.png` — both paragraph editors; toolbar, formatted content,
  word/character footer; the live canvas below shows the same formatting.
- `wysiwyg-source.png` — HTML source view of paragraph 1.
- `wysiwyg-paste.png` — paragraph 2 after the paste cleanup.
- `public-museum-formatted.png` — the published formatting on the public page.
- `wysiwyg-single-field.png` — the About Mission column body editor with the
  bold applied.

## Restore

- **Museum**: published content rolled back to revision 2; the draft was then
  restored to the exact captured pre-walkthrough sections (6 sections,
  including the draft-only hidden "Virtual Tour" CTA) — verified deep-equal,
  and the public payload is the original.
- **About**: draft-only edit; the captured sections were written back.
  Everything is byte-identical except one escaping: the image_text paragraph
  now stores `&amp;` where the seed had a raw `&`. That change is produced by
  the server's own sanitize-on-save on *any* draft save (the same artifact
  already existed in Home's draft before this phase) and cannot be avoided
  through the API. The **published** About content is untouched and still
  carries the raw `&`; nothing public changed.
- **Home** was never edited (published rev 1 / draft rev 8, as found).

## Known limitations

- `span[class]` is allowlisted but has no toolbar control; it can only be
  authored via the HTML source view (and round-trips if present). Same for
  link `title`/`target`/`rel` — the link UI sets `href` only.
- **Renderer contract (pre-existing, not changed here):** `RichTextSection`
  renders each value inside a `<p>` wrapper. Inline formatting (bold, links,
  emphasis) renders exactly in the section's body style; block content
  (headings, lists, quotes) breaks out of the wrapper in the browser and
  renders in the theme's base typography. On the public page, list markers
  are also suppressed by the theme's Tailwind preflight (the rich_text
  section adds no list classes), while the editor shows disc/decimal
  markers — a fidelity gap in the pre-existing public styles.
- `image_text` fields use the editor too (their field-spec kind is richtext
  and the server sanitizes those paths), but the public image_text renderer
  prints paragraphs as plain text, so formatting stored there does not
  display publicly — pre-existing renderer behaviour; the editor is still
  the correct editor for the stored-HTML contract.
- A `javascript:` (or other disallowed-scheme) link typed into the *source*
  view can exist transiently in the editor document; the server sanitizer
  strips it on save. The toolbar link bar refuses such URLs up front, and
  pasted ones are unwrapped by the parser (observed in the walkthrough).
- Word/character counts describe the text content, not the HTML markup.
