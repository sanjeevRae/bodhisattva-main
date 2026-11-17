# Phase 5 — Visual diff: module-API rendering vs the Phase 3 temporary-data rendering

Comparison of the Phase 5 frontend (module sections — collection_grid,
exhibition_grid, news_listing, foundation_programs, testimonials —
rendered from the museum module APIs) against the Phase 3 screenshots
(same sections rendered from `temporary-module-data.ts`, now deleted).

- New screenshots: `docs/phase-5/screenshots/{home,museum,gallery,shop,news,foundation,about}-{desktop,mobile}.png`
  (1440×900 desktop, 390×844 mobile, top viewport, same capture method
  as Phases 0/3: local headless Chrome via `cdp_shot.py`, `vite preview`
  on :4173 proxying `/api` to the API server on :4000, dev database),
  plus scrolled captures of every module section
  (`home-desktop-collections.png`, `home-desktop-news.png`,
  `museum-desktop-grid.png`, `foundation-desktop-programs.png`,
  `foundation-desktop-testimonials.png`) and the admin screens
  (`admin-collections.png`, `admin-exhibitions.png`, `admin-news.png`,
  `admin-foundation.png`, `admin-exhibition-edit.png`,
  `admin-editor-canvas.png`).
- Method: pixel-difference measurement (PIL, sampled every 2nd pixel,
  "strong" = channel-sum difference > 90 — the Phase 3 metric) on the
  top viewports, visual inspection of the scrolled module-section
  captures, and scripted functional checks in the same headless Chrome
  (Museum filter clicks, News search typing, Gallery filter presence,
  admin reorder round-trip).
- Environment note: as in Phases 0/3, Unsplash images do not load in
  this sandbox's headless Chrome (broken-image alt text / empty image
  boxes), equally for the Phase 3 references — the comparison is
  like-for-like. Where a record's image *URL* changed the crop the
  server delivers, that is called out explicitly below (D-5) because it
  will be visible on a real network even though it is invisible here.

## Results per route (top viewport)

| Route | Desktop strong-diff | Mobile strong-diff | Verdict |
|---|---|---|---|
| `/` Home | 0.00% | 0.00% | Identical in viewport; module sections below the fold per D-1…D-3 |
| `/museum` | 0.00% | 0.00% | Identical; filter now functional (D-4) |
| `/gallery` | 0.00% | 0.00% | Identical (9 records, years 2026–2023 derived from startsOn) |
| `/shop` | 0.00% | 0.00% | Identical (no module sections switched; Phase 6 surface) |
| `/news` | 0.00% | 0.00% | Identical after the colour-token fix (F-1); search now server-side (D-6) |
| `/foundation` | 0.00% | 0.00% | Identical (programs + testimonials verified below the fold) |
| `/about` | 0.00% | 0.00% | Identical (no module sections on this page) |

Phase 3's residual ~0.15% nav-rasterization diff does not appear here
because the baseline is Phase 3 itself, not the pre-CMS site.

## Expected differences — the dedupe corrections (all below the fold)

These follow from rendering the canonical module records (Phase 5a
seed) instead of the per-page temporary copies. Each was verified in
the scrolled captures / DOM text, not assumed.

- **D-1 · Home "Featured Collections" cards follow the canonical
  records.** Card 1 unchanged (Gandharan Sculpture, "1st – 5th Century
  CE", 487 works). Card 2 is now **Buddhist Paintings** — the record
  that owns the paintings image, previously captioned "Contemporary
  Dialogues" on Home: count 890 works → **1,240 works**, and the
  **period line is gone** (the canonical record's periodLabel is null;
  "1960 – Present" described contemporary art, not this record — G2
  conflict note). Card 3 is now **Palm Leaf Manuscripts** (previously
  "Buddhist Manuscript Art"): period unchanged ("8th – 16th Century"),
  count "1,240 manuscripts" → **890 works**. Card order follows the
  records' sort order, so cards 2 and 3 swap images relative to
  Phase 3. Alt texts are now the canonical Museum alts ("Ancient
  statues in contemplation", "Gallery wall with paintings", "Ancient
  manuscript display") — non-visual.
- **D-2 · Home "On View Now" descriptions are the canonical Gallery
  texts.** The Silk Road Chronicles: "…from Gandhara to **Tang China**"
  (Phase 3 Home copy: "Tang Dynasty China"). Feminine Divine:
  "Goddess iconography across **Buddhist, Jain, and Hindu traditions**"
  (was "…Hindu artistic traditions"). Living Crafts of Nepal: the
  description loses ", photographed in their workshops" (the Home-only
  extension). The featured record is Echoes of Enlightenment with
  "Main Hall · Until Nov 2026" derived from its dates — identical text
  to Phase 3.
- **D-3 · Living Crafts "Until" line reads May 2025.** Its loc line is
  derived from the record's own endsOn (2025-05-31), so the side list
  shows "Terrace Gallery · **Until May 2025**" where Phase 3's Home
  copy said "Until Dec 2026". This is the record's flagged date/status
  conflict from the Phase 5a seed (status `current`, dates Jan–May
  2025) surfacing honestly; no date was invented to match the old
  copy. It remains in the "current" list because its stored status is
  CURRENT.
- **D-4 · Home "Latest News" cards use the canonical News titles.**
  The interview card loses " in Nepal" ("Siddhartha Man Shakya on the
  Future of Buddhist Art Scholarship"); the Echoes card reads "…in
  **Opening Month**" (Phase 3 Home copy: "First Month"). Dates render
  from the ISO publishedDate in the same "05 Aug 2026" format.
- **D-5 · Image crops served for two Home frames differ (real-network
  only).** Record image URLs are the seed's fixed crops: collection
  images are 600×450 (the Home cards' 3:4 portrait frames previously
  requested a 600×800 crop) and the featured exhibition's image is its
  700×933 tall crop (the 16:10 featured frame previously requested
  1200×800). With `object-cover` the browser centre-crops the served
  image, so on a network where Unsplash loads, those two frames will
  show a different crop of the same photograph. Frame geometry,
  markup and alt text are unchanged; the fix, if wanted, belongs in
  the seed/media data (per-context crops), not the renderer.
  Testimonial avatars likewise use the records' 500×500 crops instead
  of the previously requested 80×80 — indistinguishable at the 40 px
  display size.
- **D-6 · Behaviour changes (not visual).** (a) The **Museum filter
  now filters** (Audit D1 fixed): buttons derive from the records'
  categories (All, Sculpture, Painting, Manuscripts, Coins, Textiles,
  Contemporary — same labels/order as Phase 3); verified by scripted
  clicks — Painting → 1 card (Buddhist Paintings), Coins → 1 card
  (Numismatic Collection), All → 6 cards. With "All" selected the page
  is visually identical. (b) **News search is server-side**
  (`GET /api/news?search=`, ~300 ms debounce): "Mathura" → 1 row, a
  nonsense term → 0 rows + the same "No results for …" line. Category
  colours come from each record's `colorToken`. (c) The News rows'
  Download PDF / Read Article buttons keep their Phase 3 inert
  rendering unless the record carries a document/external URL (none of
  the seeded records do), in which case they open it.

## Defects found and fixed during the switch

- **F-1 · News category colours disappeared (found by this diff).**
  The first Phase 5 capture showed the News rows' category labels in
  the default text colour (0.03% strong-diff band) instead of their
  type colours: the `colorToken` class names now arrive from the API
  at runtime, so Tailwind's source scan never generated them (only
  `text-amber-700` survived, via an admin placeholder string). Fix:
  the five design-vocabulary tokens (mapping §N2) are generated
  explicitly via `@source inline(...)` in `src/styles/tailwind.css`,
  with a comment recording that a future admin-invented token needs a
  matching entry. After the fix the News diff is 0.00% on both
  viewports and the compiled CSS contains all five tokens.
- **F-2 · News admin screen crashed on load.** `GET
  /api/admin/news/categories` is the one unpaginated museum endpoint
  and returns `data: { items }`, unlike the `sendList` endpoints
  (`data: [...]` + `meta`); the admin client's generic list unwrap
  handed the screen an object where an array was expected
  (`s.find is not a function`, blank screen). Fix: `newsApi.
  listCategories` unwraps that endpoint's shape explicitly. The
  screen now renders all 8 articles and the categories manager.

## Admin verification evidence

- All four new screens render the live records (screenshots above):
  Collections (6 records, featured/published badges, order buttons),
  Exhibitions (9 records with status + date ranges), News (8 articles
  with category names resolved, categories manager below), Foundation
  (4 programs + 4 testimonials including the context=curator record).
- Reorder round-trip through the real Collections order buttons:
  Gandharan Sculpture moved down (order swapped with Buddhist
  Paintings), then back up — final order identical to the start, so
  the dev data was left untouched.
- The Exhibition edit form opens fully populated (Echoes of
  Enlightenment) with the gallery-items manager below it
  (`admin-exhibition-edit.png`).
- The page editor canvas renders real module records for the Home
  page (Featured Collections cards and the On View Now split) —
  `admin-editor-canvas.png`. The draft-preview modal receives the
  same `moduleData`.
- The dev admin account (`admin@example.com`, local DB only) had to
  re-enrol MFA for this walkthrough (its Phase 4 credentials were
  wiped after that phase's walkthrough); enrolment + TOTP confirm
  were done against the real API, leaving the account with active
  MFA as Phase 4 left it.

## Notes / limitations

- When module data is absent or a list is empty, sections render
  their chrome with no cards — there is deliberately no temporary-data
  fallback (`temporary-module-data.ts` is deleted).
- NewsRows' empty state now shows "No results for …" only when a
  query is present; with the temporary data the unfiltered list could
  never be empty, so this guard is new but unreachable in the seeded
  state.
- Gallery items have no public consumer yet (no exhibition detail
  pages exist); they are managed in the exhibition editor only, as
  scoped in Phase 5b.
