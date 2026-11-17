# CMS CONTENT MAPPING — Bodhisattva Museum Website

**Project:** Dynamic Museum Website + Visual CMS + Ecommerce + Secure Administration
**Repository:** `sanjeevRae/bodhisattva-main` @ `e4981f37`
**Mapping date:** 17 November 2026
**Phase:** Phase 0 — Audit and Planning (Master Specification, Part 22)
**Deliverable:** CMS_CONTENT_MAPPING.md (Specification §1.3 item: "how each existing section will become a CMS-managed component")
**Companion document:** `PROJECT_AUDIT.md` — repository audit, defect register (D1–D21) and blocking decisions (BD-1–BD-3) referenced throughout

---

## 1. Purpose and method

Every visible block of the existing website was inventoried from source code and assigned:

1. a **current source** (file + how the content is hardcoded today);
2. a **target section type** from the controlled registry in Specification §5.3 (19 types), or a module-rendered component where the block is actually application functionality (shop, cart) rather than page content;
3. a **structured content schema** — the fields the visual builder's property inspector (§5.2, right panel) will expose for that block;
4. a **data ownership** decision: generic `page_sections` content, or a record in a museum/ecommerce module table (`collections`, `exhibitions`, `gallery_items`, `news_articles`, `foundation_programs`, `testimonials`, `products`, …) that the section merely *references and renders*;
5. **migration notes**, including data cleansing required (display strings → typed values, duplicated records → single source).

### 1.1 Conventions used in every schema

- Every section instance additionally carries the registry-common fields from Specification §5.3: `id`, `type`, `sortOrder`, `content` (the schema below), `design` (see §1.2), `visible`, `createdAt`, `updatedAt`. These are not repeated in each table.
- `mediaId` means a reference to a `media_assets` record (§5.6) — never a raw URL. All current Unsplash URLs are placeholders pending Blocking Decision BD-2 (see `PROJECT_AUDIT.md` §14).
- `link` means a structured link object: `{ kind: "page" | "url", pageId? , url?, label }` — never a hardcoded route string. Reserved routes (`/login`, `/account`, `/admin`, …) are protected per §5.1.
- `richText` means sanitised rich text per §5.3 (no arbitrary HTML, no embedded scripts).
- Nearly every existing section opens with the `SectionLabel` eyebrow + heading pattern (`src/app/components/shared.tsx`). Accordingly, `sectionLabel` (short uppercase eyebrow text) and `heading` are standard optional fields in almost every schema below and are listed once per section for completeness.

### 1.2 Common design configuration

The existing pages express design variation through background bands and layout choices, not free-form styling. The builder's `design` object for migrated sections should therefore be a small controlled vocabulary, sufficient to reproduce every current page exactly:

| Design field | Values seen in current site |
|---|---|
| `background` | `default` · `secondary` (cream band) · `dark` (ink band, `bg-foreground`) |
| `spacing` | `standard` (py-24) · `large` (py-28) · `compact` (py-14/16) |
| `container` | `wide` (max-w-screen-xl) · `narrow` (max-w-screen-lg, quote band) |

Per-type layout variants are noted in each section where the current design needs one.

### 1.3 Summary of the mapping

| Page | Blocks inventoried | Generic CMS sections | Module-rendered / module-data blocks |
|---|---|---|---|
| Home `/` | 8 | 4 | 4 (collections, exhibitions, foundation stats, news) |
| Museum `/museum` | 6 | 4 | 1 (collections grid) + 1 CTA link |
| Gallery `/gallery` | 3 | 1 (page header) | 1 (exhibition archive; filter bar is its configuration) |
| Gift Shop `/shop` | 4 | 1 (page header) | 3 (category tabs, product grid, quick view — ecommerce module) |
| News `/news` | 2 | 1 (page header) | 1 (article listing + search) |
| Foundation `/foundation` | 6 | 2 | 4 (statistics, programs, testimonials, partners) |
| About `/about` | 5 | 3 | 2 (contact info from `site_settings`; contact form → `contact_submissions`) |
| Global (Nav/Footer) | 2 | — | menus + `site_settings` (§2) |
| **Total** | **36** | **16** | **20** |

The single most important structural conclusion: **only a minority of blocks are free-standing page content.** Most of the site is *views over shared module records* — the same exhibition appears on Home, Gallery and in News; the same collections appear on Home and Museum; the same impact statistics appear on Home and Foundation. Migrating page-by-page with copy-pasted section content would recreate today's three-sources-of-truth problem inside the CMS. The seed migration must create module records first, then build pages as sections that reference them.

---

## 2. Global elements (all pages)

### 2.1 Header / Navigation — `src/app/components/Nav.tsx`

- **Current source:** hardcoded `items` array (7 label/page pairs), hardcoded logo text ("Bodhisattva / Museum & Art Gallery"), hardcoded "Plan Visit" button targeting Museum, cart icon button targeting Shop, dark-mode toggle.
- **Maps to:** CMS **navigation management** (§5.7) — `menus` + `menu_items`, *not* a page section.
- **Schema (menu item):** `label` (text), `link` (page ref or external URL), `sortOrder`, `visible`. Header behaviour fields stay as code-level design (transparent-over-hero on Home, scroll state) — they are presentation, not content.
- **Site settings:** logo text → `site_settings.siteName` + `site_settings.siteTagline`; "Plan Visit" → `site_settings.planVisitLink` (page ref + label).
- **Migration notes:** menu items must render as real `<a href>` links in the dynamic version (currently `<button onClick>`; see Audit §6.1). The cart button becomes store UI showing the server cart count for signed-in customers (Part 10), not a menu item. Dark-mode toggle remains a UI control; the preference should persist (currently it does not — Audit D14).

### 2.2 Footer — `src/app/components/Footer.tsx`

- **Current source:** hardcoded brand blurb (address line, hours line, phone), three hardcoded link columns (Visit / Engage / Connect), hardcoded copyright line, three inert legal spans (Privacy Policy / Terms of Use / Accessibility — Audit D17).
- **Maps to:** `menus` (one footer menu with three column groups) + `site_settings`.
- **Schema:** footer columns: `[{ title, items: [menuItem] }]`; brand block fields come from `site_settings`: `addressLine`, `openingHoursSummary`, `phone`, `copyrightText`.
- **Migration notes:** several current targets are approximations ("Membership" → About, "Events" → Museum, "Press Enquiries" → News) — the client should confirm real destinations when the menu is seeded; the legal items need real CMS pages (created via §5.1 page management) or removal. Footer hours text must be reconciled with the About page (contradiction, Audit D20) — after migration both render from the single `site_settings` source.

---

## 3. Home — `/` — `src/app/pages/HomePage.tsx`

### H1. Hero banner (lines 12–47)

- **Current source:** fully hardcoded JSX; background image `uimg("photo-1779949437853-…")` at 1920×1080; eyebrow line embeds statistics as free text ("Est. 2000 · Lalitpur, Nepal · 12,400+ Artifacts"); two CTA buttons (`Explore Museum` → Museum, `View Gallery` → Gallery); fade-in gated on image `onLoad`.
- **Maps to:** Section type **1 — Hero banner** (full-screen variant).
- **Content schema:**

  | Field | Type | Notes |
  |---|---|---|
  | `eyebrow` | text | The "Est. 2000 · …" line, kept as one text field to preserve the design |
  | `headingLine1` | text | "Where Heritage" |
  | `headingAccent` | text | Italic accent line, "Meets Eternity" — the design splits the heading into a roman + italic segment; the schema must preserve this two-part structure |
  | `subtext` | textarea | One paragraph |
  | `backgroundImage` | mediaId | With `alt` text field |
  | `primaryCta` / `secondaryCta` | link + style enum (`solid` / `outline`) | Two button slots, as designed |
  | `scrollHint` | text, optional | "Scroll to discover" vertical label |

- **Data ownership:** generic section content.
- **Migration notes:** the image fade-in behaviour and dark gradient overlay are renderer behaviour, not content. Do **not** split the eyebrow statistics into the statistics system — they are prose, and two of them duplicate module data only loosely.

### H2. Museum intro — "Our Purpose" (lines 50–82)

- **Current source:** hardcoded JSX; one image with a floating accent badge ("12,400+ / Artifacts Preserved"); CTA "Our Story" → About.
- **Maps to:** Section type **4 — Image and text** (image-right variant), with one schema extension (below).
- **Content schema:** `sectionLabel`, `headingLine1`, `headingAccent`, `paragraphs` (richText ×2), `cta` (link), `image` (mediaId + alt), `imageAspect` (enum; `4:5` here), **`calloutBadge` (optional object: `value`, `label`)** — extension required: the floating stat badge is part of this section's design and appears nowhere else; rather than inventing a new section type, add the optional badge to the Image-and-text schema.
- **Data ownership:** generic section content. The badge value ("12,400+") is display copy here, *not* linked to the statistics records — acceptable, but the client should know it can drift from F2/H6 statistics; optionally bind `calloutBadge.value` to a statistics record in a later phase.
- **Migration notes:** none beyond BD-2 imagery.

### H3. Featured Collections (lines 85–116)

- **Current source:** inline array of 3 objects `{ title, period, count, id (Unsplash), alt }`; cards navigate to Museum; "View All" → Museum.
- **Maps to:** Section type **6 — Collection grid**, **data from the `collections` module** (§6.1).
- **Section schema (configuration only):** `sectionLabel`, `heading`, `viewAllLink` (link), `selection` (enum: `featured` — records flagged featured, ordered by module sort order; limit 3), `columns` (3).
- **Record fields consumed (from `collections`):** `name`, `periodLabel` (text, e.g. "1st – 5th Century CE"), `worksCount` (integer — currently embedded in strings like `"1,240 manuscripts"`; note the unit varies: works vs manuscripts, so store `worksCount` + `worksCountUnit` or a free `countLabel`; recommendation: integer + unit enum), `coverImage` (mediaId + alt), `categoryId` (needed by M4 filtering).
- **Data ownership:** **module records** — these are the same collections as M4 with a `featured` flag; Home must not hold copies.
- **Migration notes:** the three Home entries and the six Museum entries overlap in name but not exactly in data ("Buddhist Manuscript Art" vs "Palm Leaf Manuscripts"; counts differ in format). Seed one canonical `collections` set (6 records from Museum, which is the fuller list) and mark 3 as featured.

### H4. Current Exhibitions (lines 119–152)

- **Current source:** one featured exhibition hardcoded in JSX ("Echoes of Enlightenment", Main Hall, "Until Nov 2026") + inline array of 3 `{ loc, title, desc }`; items navigate to Gallery.
- **Maps to:** Section type **7 — Exhibition grid**, **layout variant `featured-split`** (1 large + list), data from the `exhibitions` module (§6.2).
- **Section schema (configuration only):** `sectionLabel`, `selection` (enum: `current` — status = current/published, featured record first), `limit` (4), `viewAllLink` (link, "All Exhibitions").
- **Record fields consumed (from `exhibitions`):** `title`, `locationLabel` (wing/hall — currently fused with the end date into one string `"East Wing · Until Sep 2026"`; must be split), `startDate`, `endDate` (real dates; the "Until …" label is *derived* at render), `description`, `coverImage` (mediaId + alt), `status`, `featured`, `curator`, `categoryId`, `slug`.
- **Data ownership:** **module records**, shared with G3 (Gallery archive) — the Gallery's 9 records include all 4 of these titles.
- **Migration notes:** date-string splitting is manual cleansing work (Audit D19). "Echoes of Enlightenment" also appears as News article content (N2) — that remains an article *about* the exhibition; no merge needed, but the article should optionally link to the exhibition record (`relatedExhibitionId`, optional field on `news_articles`).

### H5. Curator quote band (lines 155–169)

- **Current source:** hardcoded blockquote + attribution ("Siddhartha Man Shakya · Chief Curator") on a dark band.
- **Maps to:** Section type **14 — Testimonials**, **display mode `single-featured`** (centred quote, no avatar).
- **Content schema:** `sectionLabel`, `testimonialId` (reference to a `testimonials` record) **or** embedded `{ quote, authorName, authorRole }`. Recommendation: reference a record — the same testimonials pool serves F5; mark this one with a `placement: curator-note` tag or select explicitly by ID in the section config.
- **Data ownership:** `testimonials` module records (§6.5 covers testimonials under Foundation, but the pool should be site-wide with a `context` field: `foundation` / `curator` / `visitor`).
- **Migration notes:** design config `background: dark`. No avatar in this variant — the schema's avatar field stays optional.

### H6. Foundation preview (lines 172–206)

- **Current source:** hardcoded JSX; two-image offset collage; heading/paragraph; inline statistics array `[["14","Active Programs"],["1,000+","Students Reached"],["Rs.10L","Artist Grants"]]`; CTA "Learn More" → Foundation.
- **Maps to:** Section type **4 — Image and text** (image-left, collage variant) **with an embedded statistics row** — second extension to the Image-and-text schema: optional `stats` (array of up to 3 references to statistics records, §F2) and `imageMode: single | collage2`.
- **Content schema:** `sectionLabel`, `headingLine1`, `headingAccent`, `paragraph` (textarea), `images` (mediaId[2] + alts), `stats` (record refs ×3), `cta` (link).
- **Data ownership:** text/images are generic section content; **statistics are module data shared with F2** — the same three values appear on the Foundation page (as a subset of its four). Single-source them as foundation impact-statistic records `{ value, label, sortOrder }` so both pages always agree.
- **Migration notes:** if the builder's composition rules prefer purity, this block can be decomposed into two adjacent sections (Image-and-text + Statistics) with a "grouped" wrapper — but the current design interleaves them in one grid, so the embedded-stats extension is the lower-risk mapping. Recorded as a registry extension in §11.

### H7. Latest News (lines 209–214 + list)

- **Current source:** inline array of 3 `{ outlet, date, title, type }` — literal duplicates of N2 records (same titles/dates), minus summaries.
- **Maps to:** Section type **9 — News listing**, **data from `news_articles`**.
- **Section schema (configuration only):** `sectionLabel`, `heading`, `selection` (`latest`), `limit` (3), `viewAllLink` (link).
- **Record fields consumed:** `title`, `sourceName` (outlet), `publishedDate` (date — currently `"12 Aug 2026"` strings), `categoryId` (the `type` values: News / Interview / Press Release / Feature / Review → `news_categories`).
- **Data ownership:** **module records** shared with N2. Seed from the News page's fuller 8-record set.
- **Migration notes:** none beyond date conversion (D19).

### H8. "Newsletter" section (final section)

- **Current source:** an **empty `<section>`** containing only whitespace — no heading, no input, no button (Audit D7). It renders as vertical padding only.
- **Maps to:** **no existing registry type** — proposed **new section type 20 — Newsletter signup** (§11.2).
- **Proposed schema:** `heading`, `text`, `emailPlaceholder`, `buttonLabel`, `successMessage`, `privacyNote` (optional).
- **Data ownership:** submissions need a store. The specification's table list has no subscribers table; options: (a) add a small `newsletter_subscribers` table (email, subscribedAt, status, source section/page), or (b) reuse `contact_submissions` with `subject = newsletter`. Recommendation: (a) — different consent and lifecycle semantics; flag for the database-design deliverable.
- **Migration notes:** because nothing is rendered today, there is no visual-preservation constraint — but also no evidence of intended design. **Client decision required:** implement to match the site's band patterns (recommend a `secondary`-background band consistent with H7/F6), or omit the section from the migrated Home page until designed.

---

## 4. Museum — `/museum` — `src/app/pages/MuseumPage.tsx`

### M1. Page hero (lines 20–28)

- **Current source:** hardcoded; image banner at 62vh with eyebrow ("The Collection") + H1 ("The Museum").
- **Maps to:** Section type **1 — Hero banner**, **layout variant `page-banner`** (reduced height, bottom-aligned title). This variant recurs at F1; the plain title-band variant recurs at G1/S1/N1/A1. The Hero registry entry needs a `variant` enum: `fullscreen` (H1) · `page-banner` (M1, F1) · `title-band` (G1, S1, N1, A1 — no image).
- **Content schema:** `eyebrow`, `heading`, `backgroundImage` (mediaId + alt; null for `title-band`).
- **Data ownership:** generic section content. (For CMS-created pages, this block is also the natural carrier of the page's H1, complementing the `pages.title` field.)

### M2. Overview + fact list (lines 31–57)

- **Current source:** hardcoded heading + 2 paragraphs (left) and a 6-row label/value list (right): Established 2000 · Total Area 28,000 sq.ft. · Artifacts 12,400+ · Annual Visitors 2.1 Million · Active Galleries 18 Rooms · Languages 8 Supported.
- **Maps to:** Section type **2 — Rich text** for the narrative column, combined with a fact list. No registry type models label/value facts; **Statistics (type 11)** is numeric-only in spirit. Mapping decision: implement as **one Rich-text section with an optional `facts` array** — extension to the Rich-text schema: `facts: [{ label, value }]` (both text), rendered in the existing two-column layout. (Alternative — a separate new "Fact list" type — is rejected: it occurs once, always beside narrative text; see §11.3.)
- **Content schema:** `sectionLabel`, `headingLine1`, `headingAccent`, `paragraphs` (richText ×2), `facts` (array of `{ label, value }`, max ~8).
- **Data ownership:** generic section content.
- **Migration notes:** several fact values duplicate other content (12,400+ artifacts also in H1 eyebrow and H2 badge; 18 galleries in M6 copy). They remain independent text values by design — flag as known drift points for the client's content governance, not a schema problem.

### M3. History timeline (lines 60–84)

- **Current source:** inline array of 5 `{ year, event }` (2000, 2003, 2009, 2015, 2022), horizontal timeline rendering.
- **Maps to:** Section type **12 — History timeline** — exact match.
- **Content schema:** `sectionLabel`, `heading`, `items: [{ yearLabel (text), text (textarea) }]` — `yearLabel` stays text (the design shows year only; if real dates are later wanted, add optional `date`).
- **Data ownership:** generic section content (page-local; the About history A2 is prose, not this timeline — no sharing).
- **Migration notes:** contains the "Civil Lines haveli" copy flagged in Audit D20.

### M4. Explore by Category — collections grid + filters (lines 87–114)

- **Current source:** inline array of 6 collections `{ name, count, id, alt }`; filter buttons for 7 labels (All, Sculpture, Painting, Manuscripts, Coins, Textiles, Contemporary) that **do not filter** (Audit D1) because records have no category.
- **Maps to:** Section type **6 — Collection grid**, **data from the `collections` module**, with taxonomy filtering enabled.
- **Section schema (configuration only):** `sectionLabel`, `heading`, `filterBy` (`collection_category`), `columns` (3), `selection` (`all published`).
- **Record fields consumed:** as H3, plus **`categoryId` is mandatory here** — the filter taxonomy becomes the `collections` category list. Mapping the current filter labels to the current records is *not* 1:1 (e.g. "Numismatic Collection" → Coins; "Palm Leaf Manuscripts" → Manuscripts; "Decorative Textiles" → Textiles; "Buddhist Paintings" → Painting; "Gandharan Sculpture" → Sculpture; "Contemporary Works" → Contemporary) — this inferred mapping must be confirmed when seeding, since the code never encoded it.
- **Data ownership:** **module records** (shared with H3).
- **Migration notes:** implementing the filter server-side (or client-side over fetched records) fixes D1 as a by-product of migration; the Phase 5 acceptance test "filter reduces grid" should be added explicitly.

### M5. Floor map / directory (lines 117–137)

- **Current source:** inline array of 3 `{ floor, rooms[4] }`; bordered three-column directory. Despite the heading "Interactive Floor Map", nothing is interactive and there is no map graphic.
- **Maps to:** **no existing registry type** — proposed **new section type 21 — Directory / floor guide** (§11.2).
- **Proposed schema:** `sectionLabel`, `heading`, `groups: [{ title, items: [text] }]` (here: floor name + room names).
- **Data ownership:** generic section content.
- **Migration notes:** if the museum later supplies real floor-plan images, this type can gain an optional `image` per group without a new type. The heading text ("Interactive Floor Map") is content, and the client may wish to correct it to match reality during migration — a content decision, not a code change.

### M6. Virtual Tour CTA band (lines 140–143)

- **Current source:** hardcoded dark band; "Begin Virtual Tour" button with **no handler and no URL** (Audit D6).
- **Maps to:** Section type **15 — CTA**.
- **Content schema:** `sectionLabel`, `heading`, `text`, `cta` (link — external URL to the tour platform, to be supplied by the client; until then the section can be hidden via `visible: false` rather than shipping a dead button).
- **Data ownership:** generic section content.
- **Migration notes:** none beyond the missing URL (client input).

---

## 5. Gallery — `/gallery` — `src/app/pages/GalleryPage.tsx`

### G1. Page title band (lines 27–34)

- **Current source:** hardcoded eyebrow ("Archive") + H1 ("Past Exhibitions") on a `secondary` band.
- **Maps to:** Section type **1 — Hero banner**, variant `title-band` (see M1).
- **Schema:** `eyebrow`, `heading`. Generic section content.

### G2. Filter bar (lines 36–59)

- **Current source:** sticky bar with two hardcoded option arrays (`years`, `cats`) driving working client-side filters.
- **Maps to:** **not a section** — it is the *configuration and chrome* of G3. In the builder it must not appear as a draggable section.
- **Configuration absorbed by G3:** `enableYearFilter: true`, `enableCategoryFilter: true`. The option lists are **derived from the data** (distinct years of published exhibitions; `exhibitions` categories), never stored as content.
- **Migration notes:** year is derived from `startDate` — the current records store `year` separately from the display range; after migration there is one source (dates), eliminating a whole class of inconsistency.

### G3. Exhibition archive — masonry grid (lines 61–83)

- **Current source:** inline array of 9 exhibition records `{ id, title, year, cat, date, curator, desc, imgId, tall }`; CSS-columns masonry; cards have no destination (Audit D5).
- **Maps to:** Section type **7 — Exhibition grid**, **layout variant `masonry`**, data from the `exhibitions` module.
- **Section schema (configuration only):** `selection` (`all published`, ordered by startDate desc), `enableYearFilter`, `enableCategoryFilter`, `columns` (3).
- **Record fields consumed:** full exhibition record (see H4), plus **`coverAspect` (enum: `tall` | `standard`)** — the current `tall` boolean is a *design property of the cover image in grid contexts*; store it on the exhibition's cover-image association (or as `gridAspect` on the record) so both G3 and H4 render consistently.
- **Data ownership:** **module records** — the canonical exhibitions set (9 records), of which H4 renders the current subset.
- **Migration notes:** `date` display strings ("Sep 2025 – Jan 2026") must be split into `startDate`/`endDate` manually (D19). `curator` is identical on all 9 records ("Siddhartha Man Shakya") — store as a normal field; do not hardcode a default in the renderer. Card click behaviour (none today) — Phase 5 may add exhibition detail pages via CMS page creation; the grid schema should include `cardLink: none | detail-page` from the start to avoid a later schema change.

---

## 6. Gift Shop — `/shop` — `src/app/pages/GiftShopPage.tsx`

This page is **ecommerce module surface, not CMS page content** (Specification Part 10). Only its header band is a CMS section. Treating the product grid as a generic section would violate §10's requirement for server-authoritative prices, stock and carts.

### S1. Shop header band (lines 31–44)

- **Current source:** hardcoded eyebrow ("Collection Shop") + H1 ("Museum Gift Shop") + cart-count badge bound to local state.
- **Maps to:** Section type **1 — Hero banner**, variant `title-band` (`eyebrow`, `heading`).
- **Migration notes:** the cart badge is application chrome driven by the cart module (Part 10) — for guests it should reflect the login-gated cart design in §10.3; it is not content and must not be editable as text.

### S2. Category tabs (lines 47–57)

- **Current source:** inline array of 6 `{ key, label }` (All, Books & Catalogs, Paintings, Ceramics, Jewelry, Souvenirs).
- **Maps to:** **`product_categories` module data** (§4.6) rendered by the store listing component.
- **Record fields:** `name`, `slug` (the current `key`), `sortOrder`, `visible`. "All" is a UI pseudo-category, not a record.

### S3. Product grid + cards (lines 59–91)

- **Current source:** inline array of 12 products `{ id, name, price (string), cat, detail, imgId }`; hover actions (wishlist, quick preview, add-to-cart) in component state.
- **Maps to:** the **store listing component** (Part 10.2). The related registry type **8 — Featured products** applies only when a *curated subset* is embedded on other pages (none exists today; the type remains available for future pages).
- **Product record fields required (target schema, §4.6/§10.1) vs current data:**

  | Target field | Current state |
  |---|---|
  | `name` | present |
  | `slug` | absent — generate from name |
  | `sku` | **absent — must be assigned at migration** |
  | `description` | only a one-line `detail` string ("A2 Archival Giclée, Limited to 200") — becomes `shortDetail`; a real long description does not exist and must be authored or left empty |
  | `price` (DECIMAL) | **display string `"Rs.4,500"` — parse to numeric; currency NPR from settings** |
  | `salePrice` | absent (no product is on sale today) |
  | `categoryId` | present as `cat` key → category record |
  | `images[]` | exactly 1 Unsplash image per product → `product_images` (media migration per BD-2) |
  | `stockQuantity` | **absent — no stock data exists anywhere; initial stock must be supplied by the client at Phase 6 seeding** |
  | `status` / `featured` | absent — default `active` / `false` |

- **Data ownership:** **ecommerce module records** (`products`, `product_categories`, `product_images`, inventory).
- **Migration notes:** wishlist/cart/preview interactions are re-implemented against the server cart (Part 10.3: login-gated add-to-cart with preserved intent) — the current toggle semantics (click again to remove) should be reviewed against §10.3's quantity-based cart; the visual card design is preserved.

### S4. Quick-preview modal (lines 93–113)

- **Current source:** modal bound to `preview` state, reusing the product record.
- **Maps to:** store module UI (product quick view), **not a section**. No schema; it renders the S3 record. In the dynamic build it should also be reachable by keyboard/touch (current entry is hover-only — Audit §7.4).

---

## 7. News — `/news` — `src/app/pages/NewsPage.tsx`

### N1. Header band + search (lines 26–39)

- **Current source:** hardcoded eyebrow ("Press Archive") + H1 ("News Clippings") + search input filtering the list client-side.
- **Maps to:** Section type **1 — Hero banner**, variant `title-band` (`eyebrow`, `heading`). The search box is N2's configuration (`enableSearch: true`), not content.

### N2. Article listing (lines 41–65)

- **Current source:** inline array of 8 articles `{ id, outlet, date, title, type, summary }`; type colour-coding map in code; dead "Download PDF" / "Read Article" buttons (Audit D4).
- **Maps to:** Section type **9 — News listing**, **layout variant `rows`**, data from `news_articles` (§6.4).
- **Section schema (configuration only):** `selection` (`all published`, date desc), `enableSearch`, `pageSize` (pagination per §6.4; today all 8 render at once).
- **Record fields (target `news_articles`):** `title`, `sourceName` (current `outlet`), `publishedDate` (DATE — convert `"12 Aug 2026"` strings, D19), `summary` (textarea), `categoryId` → `news_categories` (seed from the 5 current `type` values: News, Interview, Feature, Press Release, Review — including their display colours, currently a code map `typeColor`; store `colorToken` on the category), `externalUrl` (nullable — powers "Read Article"; **empty for all current records**), `attachmentMediaId` (nullable — powers "Download PDF"; **no PDFs exist today**), `imageMediaId` (nullable per §6.4; current design uses no article images — keep the field, leave empty), `relatedExhibitionId` (optional, see H4), `visible`.
- **Data ownership:** **module records** — the canonical news set; H7 renders its latest 3.
- **Migration notes:** until `externalUrl`/`attachmentMediaId` are populated, the dynamic renderer should hide the corresponding buttons rather than reproduce today's dead buttons.

---

## 8. Foundation — `/foundation` — `src/app/pages/FoundationPage.tsx`

### F1. Page hero (lines 8–16)

- As M1: Section type **1 — Hero banner**, variant `page-banner`. Schema: `eyebrow` ("Social Responsibility"), `heading` ("The Foundation"), `backgroundImage` (mediaId + alt). Generic section content.

### F2. Impact statistics band (lines 19–33)

- **Current source:** inline array of 4 `[value, label]` pairs (14 Active Programs · 1,000+ Students Reached · RS.10L Artist Grants Disbursed · 38 Partner Organizations).
- **Maps to:** Section type **11 — Statistics** — exact match.
- **Content schema:** `items: [{ value (text), label (text) }]` (values stay text — "Rs.10L" and "1,000+" are not pure numbers).
- **Data ownership:** **shared module data** — foundation impact statistics, single-sourced with H6 (which displays a 3-item subset with slightly different labels: "Artist Grants" vs "Artist Grants Disbursed" — reconcile wording at seeding; store one canonical label and let H6's subset reference the same records).
- **Migration notes:** implement statistics as small records (`foundation_stats` or a generic `site_statistics` group) referenced by both sections, per H6.

### F3. Mission — image and text (lines 36–55)

- **Current source:** hardcoded label/heading/2 paragraphs + one image.
- **Maps to:** Section type **4 — Image and text** (image-right, standard variant — no badge, no stats).
- **Schema:** `sectionLabel`, `headingLine1`, `headingAccent`, `paragraphs` (richText ×2), `image` (mediaId + alt), `imageAspect` (`4:3`).
- **Data ownership:** generic section content.

### F4. Programs & Initiatives (lines 58–84)

- **Current source:** inline array of 4 programs `{ name, cat, desc, impact, Icon }` where `Icon` is a **Lucide component reference stored in the data object**.
- **Maps to:** Section type **10 — Foundation programs**, data from `foundation_programs` (§6.5).
- **Record fields:** `name`, `categoryLabel` (current `cat`: Education / Artist Support / Access / Heritage — free text or a small taxonomy; recommend a `program_categories` list or plain text field, as no filtering UI exists), `description` (textarea), `impactMetric` (text, e.g. "6,200 students per year"), **`iconName` (enum of approved icon names)** — replaces the component reference; the renderer maps name → Lucide component from a controlled list, `imageMediaId` (optional per §6.5; current design uses icons only — leave empty), `sortOrder`, `visible`.
- **Data ownership:** **module records**.
- **Migration notes:** contains D20 copy issues ("across NCR") for client correction. The 2×2 bordered grid is the section's layout; no variant flag needed beyond `columns: 2`.

### F5. Testimonials — "Impact in Their Own Words" (lines 87–110)

- **Current source:** inline array of 3 `{ quote, name, role, imgId }` with circular avatar images.
- **Maps to:** Section type **14 — Testimonials**, display mode `grid` (contrast H5's `single-featured`).
- **Section schema (configuration only):** `sectionLabel`, `heading`, `selection` (records tagged `context: foundation`, or explicit ID list).
- **Record fields (`testimonials`):** `quote`, `authorName`, `authorRole`, `avatarImage` (mediaId), `context` (enum), `sortOrder`, `visible`.
- **Data ownership:** **module records** (shared pool with H5).
- **Migration notes:** one testimonial references "Govt. School, Varanasi" (D20) — client to confirm/replace.

### F6. Partner organisations strip (lines 113–116)

- **Current source:** hardcoded array of 8 organisation names rendered as styled text (no logos, no links).
- **Maps to:** **no exact registry type** — proposed **new section type 22 — Partner list** (§11.2). (Nearest existing types — Image, Rich text — both lose the structured name/logo/link triple.)
- **Proposed schema:** `heading` (the small centred label), `items: [{ name, logoImage (mediaId, optional), url (optional) }]`.
- **Data ownership:** generic section content (site-level reuse is plausible — partners could also appear on About — but no second usage exists today; keep section-embedded until a second consumer appears).
- **Migration notes:** names include external institutions (British Museum, UNESCO Nepal, Tata Trusts, …) — the client should confirm the partnership claims before they become CMS-published content; that is a content-governance note, not a schema issue.

---

## 9. About — `/about` — `src/app/pages/AboutPage.tsx`

### A1. Page title band (lines 19–26)

- As G1: Section type **1 — Hero banner**, variant `title-band`. Schema: `eyebrow` ("Who We Are"), `heading` ("About Us"). Generic section content.

### A2. History + founder quote (lines 29–56)

- **Current source:** hardcoded heading + 3 paragraphs (left); image above a dark quote card ("The Bodhisattva is the figure who postpones their own liberation…" — Siddhartha Man Shakya, Co-Founder) (right).
- **Maps to:** Section type **4 — Image and text** (image-right) with an optional **`quote` object** extension: `quote: { text, attribution }` rendered as the card beneath the image. (Same extension family as H2's `calloutBadge`: small optional attachments to Image-and-text rather than new types; see §11.3.)
- **Content schema:** `sectionLabel`, `headingLine1`, `headingAccent`, `paragraphs` (richText ×3), `image` (mediaId + alt), `quote` (optional object).
- **Data ownership:** generic section content.
- **Migration notes:** history copy contains "Civil Lines, Lalitpur" (D20) for client correction.

### A3. Vision / Mission band (lines 59–72)

- **Current source:** two hardcoded columns: "Our Vision" (large display text) and "Our Mission" (body text), divided layout on a `secondary` band.
- **Maps to:** Section type **2 — Rich text**, **layout variant `two-column statements`**.
- **Content schema:** `columns: [{ label, body, emphasis: display | body }]` (exactly 2) — the `emphasis` flag preserves the deliberate typographic asymmetry between the Vision and Mission columns.
- **Data ownership:** generic section content.

### A4. Team — "The Team" (lines 75–93)

- **Current source:** inline array of 8 `{ name, role, dept }`; **no photos** — the design renders an initials tile derived from the name; 7 of 8 names are identical placeholders (Audit D3, including the duplicate-React-key bug).
- **Maps to:** Section type **13 — Team members** — exact match.
- **Content schema:** `sectionLabel`, `heading`, `members: [{ name, role, department, photo (mediaId, optional), bio (optional, unused today) }]` — section-embedded records are sufficient (no other page consumes team data; no module table is proposed for people).
- **Data ownership:** generic section content (embedded list).
- **Migration notes:** **the current data cannot be migrated as-is** — real names/photos must be supplied by the client; seed with the structure and, at most, the one plausible entry (Co-Founder) pending confirmation. With DB/CMS IDs, the duplicate-key defect disappears. The initials-tile fallback should be preserved in the renderer for members without photos, since it is evidently the designed fallback.

### A5. Visit & Contact + message form (lines 96–133)

- **Current source:** dark band; left column lists 5 contact facts with icons (Address, Hours, Phone, Email, Web) from an inline array; right column is the site's only form (First/Last Name, Email, Subject select with 6 options, Message) whose submit discards data (Audit D8).
- **Maps to:** **two registry types side by side**, as the design already separates them:
  - Left: Section type **16 — Contact information**. **Data ownership: `site_settings`** (single source shared with the Footer): fields `address` (text), `openingHours` (structured: lines of text — current value is free text with an internal contradiction, D20; store as text lines until the client confirms a structured weekly schedule), `phone`, `email`, `website`. The icon per row is renderer-determined by field, not content.
  - Right: Section type **17 — Contact form**. **Schema:** `heading` ("Send a Message"), `fields` (fixed set for this form: firstName, lastName, email, subject, message — with `subjectOptions` as an editable list seeded with the current 6: General Enquiry, Exhibition Information, Foundation / CSR, Press & Media, Membership, Research & Loans), `submitLabel`, `successMessage`, `notifyEmail` (submission routing). Submissions persist to **`contact_submissions`** (§4.8) with the subject taxonomy above; the form must gain real labels, validation and success/error feedback in the dynamic build (all absent today).
- **Migration notes:** design config `background: dark`. This is the only section in the site that *writes* data in the target system — its Phase 3 implementation depends on the email/outbox and audit foundations, not just the CMS.

---

## 10. Cross-page record deduplication (seed order)

The seed migration (Phase 3) must create shared records **before** page sections, in this order:

| Step | Records created | Consumed by |
|---|---|---|
| 1 | `site_settings` (name, tagline, address, hours, phone, email, web, copyright) | Nav, Footer, A5 |
| 2 | `menus` + `menu_items` (header menu; footer columns) | Nav, Footer |
| 3 | `collections` (6 canonical records, categories assigned, 3 flagged featured) | H3, M4 |
| 4 | `exhibitions` (9 canonical records, dates split, current subset flagged) | H4, G3 |
| 5 | `news_categories` (5) + `news_articles` (8) | H7, N2 |
| 6 | Foundation statistics (4) + `foundation_programs` (4) + `testimonials` (4: 3 foundation + 1 curator) | F2, F4, F5, H5, H6 |
| 7 | `product_categories` (5) + `products` (12, prices parsed, SKUs assigned) | S2, S3 (Phase 6) |
| 8 | The 7 `pages` with their generic sections (H1, H2, H5-config, H6, H8, M1–M3, M5, M6, G1, F1, F3, A1–A5) referencing the records above | all routes |

Known data conflicts to resolve *during* seeding (from `PROJECT_AUDIT.md`): exhibition date strings (D19), collection naming/count formats (H3 vs M4), statistics label wording (H6 vs F2), opening hours (Footer vs A5, D20), India-context copy (D20), team identities (D3), product prices/SKUs/stock (D18, S3).

---

## 11. Section-type registry summary

### 11.1 The 19 specification types (§5.3) — usage after mapping

| # | Registry type | Used by | Status |
|---|---|---|---|
| 1 | Hero banner | H1, M1, F1, G1, S1, N1, A1 | Core type; needs `variant` enum: `fullscreen` / `page-banner` / `title-band` |
| 2 | Rich text | M2 (with `facts` extension), A3 (two-column variant) | Used |
| 3 | Image | — | **Unused by current pages.** Retain (needed for future pages; candidate carrier if F6 partners gain logos) |
| 4 | Image and text | H2, H6, F3, A2 | Core type; needs optional extensions: `calloutBadge` (H2), `stats` + collage mode (H6), `quote` (A2) |
| 5 | Image gallery | — | **Unused by current pages.** The Gallery page is an *exhibition* grid, not an image gallery. Retain for exhibition-detail/future use |
| 6 | Collection grid | H3, M4 | Module-backed (`collections`) |
| 7 | Exhibition grid | H4, G3 | Module-backed (`exhibitions`); variants `featured-split` / `masonry` |
| 8 | Featured products | — (S3 is the full store listing, not a section) | **Unused today.** Retain — first future use is embedding curated products on Home |
| 9 | News listing | H7, N2 | Module-backed (`news_articles`); variants `cards` / `rows` |
| 10 | Foundation programs | F4 | Module-backed (`foundation_programs`) |
| 11 | Statistics | F2 (+ embedded in H6) | Used; values are text, not pure numbers |
| 12 | History timeline | M3 | Used |
| 13 | Team members | A4 | Used (data must be replaced, D3) |
| 14 | Testimonials | H5 (`single-featured`), F5 (`grid`) | Module-backed (`testimonials`, site-wide pool) |
| 15 | CTA | M6 | Used |
| 16 | Contact information | A5 (left) | Data from `site_settings` |
| 17 | Contact form | A5 (right) | Writes to `contact_submissions` |
| 18 | Divider | — | **Unused.** Retain (zero-cost utility type) |
| 19 | Spacer | — | **Unused as a deliberate element.** Note: the empty H8 section currently *functions* as accidental spacing on Home; if H8 is not implemented as type 20, a Spacer is its honest replacement |

**Coverage: 15 of 19 types are exercised by the existing site; 4 (Image, Image gallery, Featured products, Divider, Spacer) are retained unused** — all five are standard builder utilities whose absence from the current design is not a reason to remove them from the registry.

### 11.2 New section types proposed (3)

| # | Proposed type | Needed by | Justification |
|---|---|---|---|
| 20 | **Newsletter signup** | H8 | The Home page reserves a (currently empty) slot for it; no registry type captures email capture with consent semantics. Schema in §H8. Requires a storage decision (`newsletter_subscribers` vs `contact_submissions`) in the database-design deliverable |
| 21 | **Directory / floor guide** | M5 | Structured group→list data (floors→rooms) recurs on museum/venue sites; forcing it into Rich text would make a trivially editable list into an HTML-editing task, against the spirit of §5.4. Schema in §M5 |
| 22 | **Partner list** | F6 | Name + optional logo + optional link triples are a distinct, recurring pattern; neither Image nor Rich text models it. Schema in §F6 |

### 11.3 Schema extensions proposed instead of new types (3)

To keep the registry controlled (§5.3), three one-off design features are modelled as **optional fields on existing types** rather than new types:

1. `Image and text.calloutBadge { value, label }` — H2's floating stat badge.
2. `Image and text.stats[]` + `imageMode: collage2` — H6's statistics row and two-image collage.
3. `Image and text.quote { text, attribution }` — A2's founder-quote card; and `Rich text.facts[]` — M2's label/value list.

Each extension is optional and ignored by renderers that do not support it, so the base types remain clean. If the Phase 4 builder team prefers strict composition, H6 can alternatively be decomposed into adjacent Image-and-text + Statistics sections — the mapping supports either; the decision belongs to the CMS architecture deliverable, not to content migration.

### 11.4 Types deliberately NOT proposed

- **Floor-plan/map type** — M5 has no map today; type 21 covers the real content.
- **Product grid section** — the shop listing is module surface (Part 10); type 8 covers embedding products in pages.
- **Quote type** — subsumed by Testimonials `single-featured` mode (H5) and the Image-and-text `quote` extension (A2).
- **Video/virtual-tour type** — M6 is a link CTA today; a future embed can extend CTA with an `embedUrl` rather than a new type.

---

## 12. Migration notes for Phase 3 (summary)

1. **Seed records before pages** — follow the order in §10; never paste display copies into section JSON where a record reference exists.
2. **Typed conversion is manual work** — exhibition/news date strings, product price strings and statistic values need human-verified conversion (D18/D19); budget it as content work, not a script-only task.
3. **Every current URL is preserved** — the 7 seeded `pages` take slugs ``, `museum`, `gallery`, `shop`, `news`, `foundation`, `about` (§1.2/§5.1), with `/shop` and the future `/login`, `/account`, `/admin` treated as reserved/module routes that the page manager must not overwrite.
4. **Section order = current visual order** — `sortOrder` follows the top-to-bottom order documented per page above; design config (§1.2) reproduces the band alternation exactly.
5. **Hide, don't fake** — where target functionality lacks data today (M6 tour URL, N2 article links/PDFs, S3 stock), seed the section with `visible: false` or omit the dead control, rather than migrating a broken affordance.
6. **Client content decisions gate the seed** — BD-2 (imagery), BD-3 (hours/copy), team identities (D3), product SKUs/stock (S3), newsletter go/no-go (H8). Code migration can proceed in parallel; the *published* seed cannot be finalised without them.

*End of CMS_CONTENT_MAPPING.md — Phase 0, Subagent 1 (Audit + CMS Mapping). Companion: PROJECT_AUDIT.md.*
