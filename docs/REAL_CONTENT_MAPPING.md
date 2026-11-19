# Real Content Mapping — Bodhisattva International (2026-11-19)

How the owner's real data was mapped into the platform, and every judgement
call made along the way. Delivered as **migration 0013_real_content**
(existing databases) + updated seed-data (fresh installs) + the
institution's own images committed under `public/images/`.

## Sources used (in priority order)
1. Owner's booklet *A Glimpse of Bodhisattva International* (Oct 2026) —
   all 40 pages read; exhibition dates/venues/curators/descriptions and
   images are taken from it.
2. Owner's documents: *About Bodhisattva International*, *What is Newa Art*.
3. Owner's exhibition lists (museum 4, gallery 15) and press-clipping
   archive (27 files). Count check: the owner's lists name 19
   exhibitions; the booklet adds two more with full documentation —
   *A Collector's Collection* (the Museum's inaugural exhibition) and
   *Nepal Art Now* — giving the 21 exhibition records below. The
   owner's foundation list (3) maps to Foundation programs, not
   exhibitions.
4. Published sources found by web research (Kathmandu Post, OnlineKhabar,
   Rising Nepal, MoNA, ECS, República…) — used only to fill gaps the
   owner's material leaves, never to override it.

## What was replaced
- **Exhibitions:** 9 invented design-stage records → **21 real** (2011–2026).
  The current retrospective is the only CURRENT + featured record.
- **Collections:** 6 invented → **4 real** (the four art forms named in the
  museum's own text: paubha, lost-wax bronze, repoussé, miniature art on
  precious/semi-precious stones).
- **Foundation programs:** 4 invented → **3 real** (Memorial Art Award,
  Humanitarian Support, Art Education/Talks/Workshops).
- **News clippings:** 8 invented articles (The Hindu/NDTV/Wire stories that
  never existed) → **20 real clippings** from the owner's archive.
- **Page copy:** invented Home/Museum/Foundation/About text (founded 2000,
  12,400 artifacts, 2.1M visitors, fake partners, fake stats, fake history)
  → real text from the owner's documents. The invented Museum floor
  directory is hidden until the owner supplies the real layout.
- **Settings:** address → House No. 91, Diamond Marg, Kupondole (booklet
  back cover); opening hours → Tue–Sun 12–6, closed Mondays (the
  institution's own posters), replacing the contradictory seed values.

## NOT touched (no real data supplied — owner's decisions)
- **Gift Shop:** all 12 products, prices and stock remain placeholder.
- **Testimonials:** the 4 placeholder quotes remain (Home quote band now
  shows a real, attributed Ted Riccardi line instead — see below).
- **Contact phone:** kept +977-9818882876 (current website). The booklet
  prints +977-9851081098 — owner to confirm which is primary.
- Users, orders, invoices, permissions, menus: untouched. Any record an
  admin created in the CMS is left untouched by the migration (deletes are
  by the fictional slugs only).

## Judgement calls
1. **Retrospective title/dates:** owner's title "10 Years of Celebrating
   Embodied Enlightenment" (press calls it "Embodied Enlightenment: A
   Decade Later" — noted in the description). Booklet prints Nov 15, 2026;
   press reports the opening on Nov 16 and the run to Dec 27, 2026 → used
   16 Nov – 27 Dec 2026.
2. **Small Wonders Great Devotion:** booklet caption says "Feb 29 –
   Nov 30, 2025" — Feb 29 does not exist in 2025; the poster says
   "Starting from 28th Feb 2025" → used 28 Feb – 30 Nov 2025, PAST. A
   Kathmandu Post article dated Feb 2026 covered it, so it may have
   reopened in 2026 — owner to confirm.
3. **Conflicts resolved for the owner's printed material:** Prakriti
   closes Aug 21, 2023 (booklet) not Aug 26 (web); Sacred Forms closes
   Jul 5, 2025 (poster) not Jun 1 (web); Babu Kaji closes Jul 31, 2026
   (poster) not Aug 2 (booklet caption).
4. **2016 Embodied Enlightenment:** booklet figures used (62+ works,
   6,000+ visitors in 11 days) over press variants (60/71 works, 5,300
   visitors).
5. **Memorial Award "established":** booklet says 2023 (p.4) and 2022
   (p.30, with inaugural winners in 2023) → used 2023.
6. **Hyatt Regency editions 2012–2018** are one series record (booklet
   treats them as one entry).
7. **Nepal Art Now (Weltmuseum Wien, 2019)** sits in the booklet's
   lectures/events section; included as an exhibition — it was one, with
   major loans from the collection.
8. Owner's list spellings corrected to the booklet's: "Scared Forms" →
   Sacred Forms; "Compassion and Healing with Taras" → Compassion &
   Healing Through Taras.
9. **Collections carry no artwork counts** — none are published anywhere;
   the cards simply show no count rather than an invented one.
10. **Exhibition filter categories** (buddhist / historical / thematic /
    contemporary) are the site's own filter taxonomy, assigned
    editorially — presentation, not fact claims.
11. **News:** 27 files → 20 records; duplicates merged (TNM feature ×4
    files, Kathmandu Post 2022 ×3, Fr!day preview ×2). **Excluded:** the
    Sotheby's "Nepali paubha fetches Rs 48m in NY" clipping — general art
    news, not about Bodhisattva. Five clippings print no date → left
    undated, never guessed. ECS Nepal's date (4 May 2011) is from the
    handwritten note on the scan. Full article text is included only for
    the Kathmandu Post 2022 feature (the one complete text supplied);
    other records carry the scan image + a summary.
12. **The nine "MOU"-named files are all 2011 Jewels of Newar Art press
    scans** — no MOU document exists in the set.
13. **Team:** Anjana Shakya (Co-Founder), Purna Man Shakya (Co-Founder,
    1962–2020), Prajwol Man Shakya (Director), Siddhartha Man Shakya
    (Curator & Exhibition Designer) — from the booklet and press.
14. **Partners strip:** invented names (British Museum, Smithsonian,
    Nalanda, Tata Trusts…) replaced with institutions the sources
    actually connect to Bodhisattva.
15. **Award winners** named in the Foundation program description are the
    1st-edition (2023) winners from the booklet; 2nd-edition (2024)
    winners are fully documented in the research notes if the owner
    wants an editions page later. The booklet's lecture list (13 talks,
    2013–2026) is represented inside the Education program description.
16. **Museum hero image:** the booklet's museum image is the 2023
    "A Collector's Collection" opening poster, whose baked-in text
    states the old hours (12–5) and the booklet phone number. The hero
    uses a crop of the poster's photograph only (a visitor's hand
    before the framed paubha) — no text. The full poster remains the
    cover of the A Collector's Collection exhibition record, where it
    belongs. The owner's material contains no other museum interior
    photograph; the Home hero uses the booklet's immersive-room photo.

## Verification
- Migration applied to a database seeded with the OLD placeholder content
  (the owner's path): 21 exhibitions / 4 collections / 3 programs / 20
  real articles; admin-created records untouched; API smoke checks pass
  (public endpoints return the real content, correct derived date labels).
- Fresh-database path (migrate → seed): identical real content, article
  categories resolve, shop/testimonials seed as before.
- Down migration exercised (rollback restores pre-0013 settings/sections;
  re-running migrate re-applies cleanly).
- Server typecheck clean; unit tests 121 passed; integration suites
  112/112 (the two suites that asserted the old placeholder seed —
  museum flows and the security probes' search control term — were
  updated to the real content).
- Frontend production build passes; all 49 images land in the build
  output. Visual pass over Home, Museum, Gallery, News, Foundation and
  About against the migrated database: real content renders throughout
  (posters, filters, stats, team, history).

## Editorial polish round (migration 0014, 2026-11-19)

Owner feedback after 0013: pages felt empty, the one full-text news
article rendered as a single unstructured block, and PDF downloads
carried the uploader's raw file name. Changes:

- **Kathmandu Post feature** (`into-the-exquisite-world-of-religious-art`):
  the stored raw PDF extraction (newspaper columns interleaved) was
  replaced by a verified reconstruction — columns read in order from the
  original page PDF and checked against the printed scan; wording exactly
  as printed (including the paper's own typo in the closing info line).
  Stored as editorial HTML: 20 paragraphs, four editorial subheadings,
  the paper's own pull quote as a blockquote, the exhibition title bolded
  at first mention. `content_plain` holds the clean plain text. The
  article page labels the block "Editorial transcription" and notes the
  subheadings were added. The article is now also flagged `is_featured`
  (it is the archive's only full transcription) so the News page's
  featured block renders with its real scan.
- **ECS Nepal summary:** an internal editorial note ("(Date from the
  handwritten note on the scan.)") removed from the public summary; the
  date itself stays in `published_on`.
- **Gorkhapatra summary:** "ran until Baisakh 3" gained its Gregorian
  equivalent "(16 April 2022)".
- **PDF download filenames:** the public download and inline-view
  responses now carry `Content-Disposition` filenames derived from the
  article — `bodhisattva-<slug>.pdf` — on both dispositions; the public
  article payload exposes `downloadName` and the page displays it. The
  uploaded file's original name remains stored for admin provenance.
  Bytes served are unchanged (verified identical). The owner's report
  of one PDF opening "whole black" could not be reproduced with any
  available file; diagnosis needs that specific file from the owner.
- **Presentation (frontend):** article body gained a lead paragraph with
  drop cap and a display pull-quote style; on articles with a
  transcription the readable text now leads and the original scan
  follows it under "The printed page" (scan-only clippings still lead
  with the scan); scroll reveals softened site-wide and honour
  `prefers-reduced-motion`; Home hero reframed on the projected artwork
  with a stronger scrim and a gradient-backed transparent nav; page
  banners gained the same contrast treatment; a single current
  exhibition now renders as a full editorial panel instead of beside an
  empty rail, its description split into two paragraphs (0014 also
  splits the stored description; wording unchanged); Home Latest News
  cards carry scan thumbnails; the Foundation split uses tall award
  posters; news rows tightened with 3-line summary clamps and
  top-anchored scan thumbnails.
- Seed parity: `museum-content.ts` carries the same content/summaries/
  featured flag; `NewsArticleSeed` gained `contentPlain` + `isFeatured`,
  wired in `seed.ts`. Migration round-trip (down restores the exact
  pre-0014 bytes) and the fresh-database path were both exercised.
  Server typecheck clean; unit 121/121; integration 112/112.
- Review-driven polish (same round, after external scoring): muted
  text darkened globally (#6B6254 → #5C5344) for small-text contrast;
  hero image given a slight midtone lift; News search widened with a
  clearer focus ring; transparent-nav gradient and hero/banner eyebrow
  contrast strengthened; drop-cap spacing loosened; the Foundation
  award posters staggered. External review: round 1 scored 5.2
  (Gemini) / 7.2 (ChatGPT) — note both scored a stale Museum
  screenshot; the hero was already the text-free crop from 0013.
  Round 2: 7.8 (Gemini) / 8.8 (ChatGPT). Round 3 (Gemini): 8.5.
  Final-round scores recorded in the delivery report to the owner.
