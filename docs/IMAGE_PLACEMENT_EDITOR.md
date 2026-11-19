# Visual Image Positioning & Cropping Editor — audit, plan, implementation notes

Feature spec supplied by the owner (2026-11-19). This document records the
Phase 0 audit, the design decisions, and what was actually built.

## 1. Root cause (why images "display wrong" today)

Every public image renders with `object-fit: cover` and the default
`object-position: 50% 50%` (two exceptions: the fullscreen hero uses
`object-[center_22%]`, news cards use `object-top`). The CMS stores only
`{ url, alt }` per image (registry `imageSchema`, server/src/modules/cms/
registry.ts). There is no placement metadata anywhere, so any image whose
subject is off-centre is cropped by the browser's blind centre crop —
exactly the failure seen with the Museum/Foundation banners on
2026-11-19, which had to be fixed by hand-cropping files. The fix is
per-usage placement metadata, edited visually against the real frame.

A second, quieter root cause: `validateSection` persists the zod-parsed
config, and zod strips unknown keys — so placement data could not have
been saved even if the admin had sent it. The registry schema had to be
extended first.

## 2. Component mapping (audited, not guessed)

Public renderers — all in src/app/components/PageRenderer.tsx unless noted.
Every one is `object-cover` + centre position today.

| Usage | Container | Notes |
|---|---|---|
| Hero, fullscreen variant | `h-screen min-h-[640px]` | object-[center_22%], fade-in, brightness 1.07 |
| Hero, page-banner variant | `h-[62vh] min-h-[460px]` (Foundation shorter via bannerClass) | absolute inset-0 |
| rich_text side image | `aspect-video` (16:9) | |
| image_text, single | aspect from config.imageAspect: 4:5 (default), 4:3, 16:9, 3:4, 1:1 | hover scale |
| image_text, collage2 | two `aspect-[3/4]`, second staggered | |
| image_text, alt layout | aspect from imageAspect, default 4:3 | |
| image (full-width section) | natural width, caption below | fit n/a — placement zoom still applies |
| image_gallery | grid 2/3/4 cols, no fixed cell aspect | images show at natural ratio |
| team_members photo | `aspect-square` | |
| partner_list logoImage | in the schema but NOT rendered (the section renders names only) | out of scope |

Module-record images (exhibition/collection cards 4:3 or 3:4, news cards
16:10 object-top, featured 16:10, product cards 3:4, testimonial avatars)
come from museum/store records keyed by media id — they have no
per-usage JSON config to carry placement. They are mapped here for
completeness and are the documented extension point (§8); this build
covers CMS page-section images, which is where the page editor lives.

Admin: one universal control, `ImageEditor` in src/admin/fields.tsx
(kinds `image` / `imageList`, also nested in object/objectList fields):
preview thumb, URL field, alt field, media-library picker, remove.
Section context reaches it via `FieldContext` (extended by this build
with the section type + config).

Media: assets carry width/height (media table); CMS image values carry
only url+alt (media-id modelling is BD-2, still deferred), so the editor
reads natural dimensions in the browser from the image itself.

## 3. Data model (no database migration)

Placement belongs to the image *usage*, not the media asset — the same
asset used in two sections keeps two independent placements. It therefore
lives inside the existing section config JSON, next to url/alt:

```jsonc
"backgroundImage": {
  "url": "…", "alt": "…",
  "placement": {
    "fit": "cover",                    // "cover" | "contain"
    "desktop": { "x": 50, "y": 40, "zoom": 1 },
    "tablet":  { "x": 55, "y": 45, "zoom": 1 },   // optional
    "mobile":  { "x": 65, "y": 40, "zoom": 1.15 } // optional
  }
}
```

x/y are focal-point percentages (0–100); zoom ≥ 1 for cover (the editor
enforces it; the renderer clamps), 0.5–3 for contain. Missing device
entries inherit: mobile → tablet → desktop → centred default. Existing
records without placement render exactly as before.

Validation: `placementSchema` added to the registry `imageSchema`
(x/y 0–100, zoom 0.5–3, fit enum, all device entries optional except
desktop). Invalid values are rejected at save with field errors.

## 4. Rendering — one shared component

`PlacedImage` (src/app/lib/PlacedImage.tsx) renders the `<img>` with CSS
variables for the three devices and a small stylesheet block in
theme.css:

- `object-position: var(--ipx) var(--ipy)`, `transform: scale(var(--iz))`,
  `transform-origin` at the same focal point; tablet/mobile media
  queries (max-width 1023px / 767px — the app's lg/md breakpoints) swap
  in their variables, with var() fallback chains implementing the
  inheritance (mobile falls back to tablet, then desktop).
- No placement → the img renders byte-identically to before.

Because the admin editor previews with this very component inside the
real frame classes, the preview cannot drift from the published result.

## 5. Why not react-easy-crop

Evaluated per the spec. react-easy-crop (a) implements its own crop-rect
model whose output (croppedAreaPercentages) does not map 1:1 onto the
site's object-position rendering — the editor would preview one model
and the site would render another; (b) adds a dependency for drag/zoom
mechanics that are ~100 lines against the shared component. Building the
editor directly on `PlacedImage` guarantees Phase 5's requirement —
the preview IS the public renderer — with zero new dependencies.
Rotation is not offered: with cover/contain focal rendering, rotation
cannot be represented without empty corners; recorded as a known
limitation (§8).

## 6. Editor design (admin)

"Edit position" button in `ImageEditor` (shown when a URL is set) opens
`ImagePlacementEditor` (src/admin/ImagePlacementEditor.tsx):

- Frame with the destination aspect per device tab (Desktop / Tablet /
  Mobile), resolved from section type + field + config (§2 table;
  fluid heroes use representative aspects: fullscreen 16:9 / 4:3 / 3:4,
  page-banner 8:3 / 2:1 / 5:6 — placement is focal-based, so the public
  result holds at any real viewport).
- The frame renders `PlacedImage` with the draft placement: drag to
  reposition (pointer events, zoom-aware), wheel to zoom, focal
  crosshair marker, rule-of-thirds guides toggle.
- Controls: fit select (cover/contain), X/Y sliders + number inputs,
  zoom slider + reset, 3×3 quick-position grid, per-device "inherit"
  state with explicit override + "reset this device to inherit",
  source thumbnail with the approximate visible-region outline,
  original dimensions + ratios, Reset (clears placement), Cancel,
  Save placement. Alt text stays in the existing field.
- Picking a different image in the media picker clears placement
  (a new image starts centred); manual URL edits keep it.

## 7. Testing plan

- Server unit: registry accepts + retains valid placement; rejects
  out-of-range values and bad fit; placement survives validateSection
  round-trip per section type.
- Integration: save a draft section with placement via the CMS API,
  publish, confirm the public payload carries it verbatim; confirm a
  second section using the same URL is unaffected.
- Pure-math unit tests for the visible-region calculation.
- Full suites + both builds; screenshot pass: admin editor (desktop +
  mobile tabs), a public hero with an off-centre placement vs before.
- Manual checks from the spec's list that automation cannot cover are
  reported as such, not claimed.

## 8. Implementation results (2026-11-19)

Built as planned: `placementSchema` in the registry; `PlacedImage` +
`image-placement.ts` (types, inheritance, CSS vars, visible-region
math); `.placed-img` rules (unlayered) in theme.css; PageRenderer
wiring for hero (both variants), rich_text image, image_text (single,
plain, collage), image_gallery and team photos; admin `FieldContext`
section context, `image-frames.ts` resolver, `ImagePlacementEditor`
modal, and the Edit position button in `ImageEditor` (media re-pick
clears placement; a "Custom position set" note marks placed fields).

Verified:
- Server typecheck + build; frontend build; ad-hoc strict tsc over the
  app graph (no errors in the touched files).
- Unit: 143/143 (registry +10 cases incl. placement retain/reject;
  placement math 7/7).
- Integration: the new cms-flows case passes — placement survives
  draft save → publish → public payload verbatim, invalid placement is
  refused (400), rollback restores the un-placed original.
- End-to-end in the real admin UI (headless Chrome): set desktop
  25/30/1.5 + mobile 68/38/1.15 on the Museum banner, saved the draft,
  published; the public page rendered the two different compositions
  at desktop and mobile widths (screenshots taken); rolled back.

Review round (4 subagents + ChatGPT 8.0/10 + Gemini 6.5/10) — verified
findings fixed before shipping:
- Drag gain was a frame-fraction approximation; replaced by the exact
  object-position geometry (`dragDeltaPercent`: screen(σ) = pF +
  zR(σ−p), so Δp = Δpx/(F − zR); a 3:2 photo in a 16:9 frame dragged
  ~5× too slowly before). Unit-tested incl. zero-overflow and contain
  sign cases.
- `visibleRegion` used one fraction for contain; now per-axis via
  `axisFitK` (contain at zoom 2 can crop one axis only). Unit-tested.
- `placementVars` now clamps at render time (cover zoom lifted to ≥1),
  so §3's "the renderer clamps" is literally true even for configs
  written outside the validation gate.
- image_text frames were variant-blind: the quote variant renders
  aspect-video and the plain variant defaults 4:3 — frames now follow
  the renderer's variant rules; pinned by unit tests
  (tests/image-frames.test.ts) together with the CSS inheritance-chain
  guard (tests read theme.css) and a portrait visible-region case.
- Fullscreen-hero fidelity: that variant renders object-[center_22%],
  so its frame carries defaultDevice {50, 22, 1} — the editor seeds,
  resets and "saves nothing" against it; opening the editor can no
  longer silently re-anchor the hero to 50%.
- The integration test now proves per-usage isolation (same banner URL
  placed differently in the Foundation page; museum hero unaffected).
- Editor UX: tablet/mobile fork on first edit (the Separate checkbox
  now only removes an override); number inputs no longer snap while
  typing; natural dimensions come from the preview's load event (no
  stale probe); drag is left-button only and rAF-throttled; device
  switcher and quick positions use aria-pressed; fluid hero frames are
  labelled representative.
Accepted without change (documented): per-device fit (fit stays
placement-wide in v1); unknown keys inside placement are stripped,
consistent with every other registry schema; gallery frames use the
natural ratio while public cells can stretch to the row height (zoom
still applies; position is approximate there); the media picker clears
placement on ANY re-pick, including re-selecting the same image.

Pre-existing issues observed during testing (NOT introduced here,
verified by re-running on the pristine tree / with pre-existing UI):
- `super-admin-cap.integration.test.ts` case (d) failed
  (VALIDATION_FAILED vs CONFLICT) on the unmodified tree as well —
  FIXED after this round (test-only fix, no service change): the
  mailbox in /tmp/mailbox persists across runs, so the helper picked
  the oldest mailed token for cap-invite-d@example.com, whose
  invitation row had been wiped by beforeAll. The test now snapshots
  the mailbox before creating the invitation and only accepts a mail
  that arrives after; the suite passes 4/4 on consecutive runs.
- In the PageEditor, canvas hero text can paint over shared-Modal
  dialogs (the same happens with the pre-existing Media Library modal):
  a stacking quirk of the editor canvas; hit-testing is unaffected
  (elementFromPoint resolves to the dialog).

## 9. Scope / known limitations

- Module-record images (exhibitions, news, products, testimonials) do
  not carry placement in this build — they need a home for per-record
  placement (a column or a media-usage table), a separate decision.
  `PlacedImage` + the placement type are ready to adopt there.
- No rotation (see §5). No server-side cropped derivatives — rendering
  is CSS-only and non-destructive by construction; originals are never
  touched.
- Fluid containers (heroes) vary with the visitor's viewport; the
  editor's frames are representative aspects, and the focal model keeps
  the subject framed at every real size.
