# Phase 3 — Visual diff: DB-backed rendering vs the pre-CMS site

Comparison of the Phase 3 frontend (all content served by the CMS API
from MariaDB, rendered through `PageRenderer`) against the Phase 0
reference screenshots of the hardcoded site.

- New screenshots: `docs/phase-3/screenshots/{home,museum,gallery,shop,news,foundation,about}-{desktop,mobile}.png`
  (1440×900 desktop, 390×844 mobile, top viewport, same capture method
  as Phase 0: local headless Chrome via `cdp_shot.py`, `vite preview`
  on :4173 proxying `/api` to the API server on :4000, dev database).
- Method: pixel-difference measurement (PIL, sampled every 2nd pixel,
  "strong" = channel-sum difference > 90) plus visual inspection of
  every route, including scrolled captures of every below-fold section
  (the Phase 0 references cover the top viewport only; below-fold
  sections were verified against the original components' markup, which
  the renderers reproduce verbatim).
- Environment note: in this sandbox's headless Chrome, Unsplash images
  do not load (broken-image alt text / empty image boxes) — this was
  equally true for the Phase 0 captures, so the comparison is
  like-for-like. Image URLs, dimensions and alt texts are unchanged.

## Results per route

| Route | Desktop strong-diff | Mobile strong-diff | Verdict |
|---|---|---|---|
| `/` Home | 0.28% | 0.60% | Identical except the hero eyebrow wrap (seeded data, D-1 below) |
| `/museum` | 0.15% | 0.00% | Identical in viewport; Virtual Tour band absent below the fold (seeded data, D-2) |
| `/gallery` | 0.15% | 0.00% | Identical |
| `/shop` | 0.15% | 0.00% | Identical |
| `/news` | 0.15% | 0.00% | Identical |
| `/foundation` | 0.15% | 0.00% | Identical |
| `/about` | 0.16% | 0.00% | Identical in viewport; team grid has 1 member instead of 8 below the fold (seeded data, D-3) |

The residual ~0.15% on every desktop route is confined to the header
nav band (y 17–47): sub-pixel text-rasterization differences between
the old `<button>` nav items and the new real `<a href>` anchors
(mapping §2.1). Cropped side-by-side inspection shows identical text,
positions and spacing — no layout difference.

## Differences found and fixed during the switch

None in the renderer: every markup/class drift found while extracting
the section renderers was corrected before capture (the renderers copy
the original components' JSX verbatim, including per-instance quirks
such as the Home hero's amber CTA palette, the Foundation statistics
band's divider layout, and the Museum facts list's `items-end` rows).

## Remaining differences — all caused by seeded data, reported not fixed

- **D-1 · Home hero eyebrow wraps differently (mobile).** The original
  JSX renders `Est. 2000 &nbsp;·&nbsp; Lalitpur, Nepal &nbsp;·&nbsp;
  12,400+ Artifacts` (space + non-breaking space around each dot),
  which forces a two-line wrap at 390 px. The seed transcribed the
  eyebrow with plain ` · ` separators, so it fits on one line and the
  hero text block sits ~14 px higher on mobile. Desktop is unaffected
  except the eyebrow is a few px narrower. Same normalization applies
  to the testimonial attribution (H5), the About quote attribution
  (A2) and the Home featured-exhibition location line (H4) — all
  sub-pixel at desktop sizes. Fix belongs in the seed data (store the
  `&nbsp;` characters), not the renderer.
- **D-2 · Museum "Take a Virtual Tour" CTA band is missing.** The
  section was seeded `isVisible: false` (mapping §M6/§12.5: the button
  is dead — no tour URL exists) and the public API filters invisible
  sections, so the page now ends after the floor-map directory. The
  `cta` renderer is implemented and reproduces the band exactly; it
  will appear the moment the section is published with a real URL.
- **D-3 · About team grid shows 1 of 8 members.** Seven of the eight
  hardcoded entries are the same placeholder name with different roles
  (Audit D3); the seed deliberately migrated only the plausible
  Co-Founder entry. The grid renders that one card correctly. Real
  team data is a client input (Phase 0 blocker B4).

## Contract gaps found (renderer needed something the API/seed lacks)

- **G-1 · Section config links carry `pageId` only.** A CTA such as the
  Home hero's "Explore Museum" arrives as `{ kind: "page", pageId: 2 }`
  with no slug or path. The frontend resolves ids by joining against
  `GET /api/menus/primary` (whose items carry slug + path) — workable
  for the seven system pages, but fragile for future pages that are not
  in the primary menu. Recommend the public page payload resolve config
  links to `{ pageId, slug, path }` server-side, as the menus endpoint
  already does.
- **G-2 · `page-banner` hero has no size field.** Museum's banner is
  `h-[62vh] min-h-[460px]`, Foundation's is `h-[56vh] min-h-[400px]`,
  yet both seed identical `variant` + `design` (`{container:"wide"}`).
  The renderer cannot distinguish them from config; FoundationPage
  passes its height as a page-level override. Recommend a `size`
  (`standard`/`compact`) field on the hero config or design vocabulary.
- **G-3 · News search placeholder is not in any config.** The listing
  config carries `enableSearch: true` only; the placeholder text
  ("Search by title, outlet, or type…") remains hardcoded chrome in
  NewsPage. Minor; add `searchPlaceholder` to the news_listing schema
  if editors should own it.

## Behaviour preserved

- Gallery year/category filters and News search operate on the
  temporary module data exactly as before (including the Gallery
  filter options being derived from the records, mapping §G2).
- Museum collection filter buttons set state but do not filter the
  grid — the current site's behaviour (Audit D1), preserved
  deliberately; the working filter arrives with the Phase 5 taxonomy.
- Shop tabs, wishlist, cart and quick-preview modal are unchanged
  (in-component state, module surface per mapping §6).
- Contact form renders from config; submission remains a no-op
  `preventDefault`, as on the current site.
- Nav/Footer render their previous hardcoded values first, then swap
  in menu/settings data when the API resolves — no layout shift; menu
  items are now real anchors. Footer legal spans unchanged.
- `useWebsiteProtection` and dark mode untouched; no styles, fonts or
  `src/styles` files changed.
