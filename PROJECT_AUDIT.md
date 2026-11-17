# PROJECT AUDIT — Bodhisattva Museum Website

**Project:** Dynamic Museum Website + Visual CMS + Ecommerce + Secure Administration
**Repository:** `sanjeevRae/bodhisattva-main` (local clone: `~/workspace/bodhisattva-main`)
**Commit audited:** `e4981f37` — "Split single-page app into routed pages (React Router)"
**Audit date:** 17 November 2026
**Phase:** Phase 0 — Audit and Planning (Master Specification, Part 22)
**Deliverable:** PROJECT_AUDIT.md (Specification §1.3 and Phase 0 deliverables list)
**Companion document:** `CMS_CONTENT_MAPPING.md` — section-by-section CMS migration mapping

---

## 1. Audit method and evidence basis

This audit is based on a complete read of the repository source at commit `e4981f37`, not on assumptions about the original Figma export. The following were read in full:

- `package.json`, `vite.config.ts`, `index.html`, `postcss.config.mjs`, `pnpm-workspace.yaml`, `.gitignore`, `README.md`
- `src/main.tsx`, `src/vite-env.d.ts`
- `src/app/App.tsx`
- All seven page components in `src/app/pages/` (Home, Museum, Gallery, GiftShop, News, Foundation, About)
- `src/app/components/Nav.tsx`, `src/app/components/Footer.tsx`, `src/app/components/shared.tsx`
- `src/app/components/figma/ImageWithFallback.tsx`
- All five stylesheets in `src/styles/` (`index.css`, `fonts.css`, `tailwind.css`, `theme.css`, `globals.css`)
- The `src/app/components/ui/` library (48 files, inventoried)

Dependency usage was verified mechanically: every runtime dependency in `package.json` was searched for import statements across `src/` (application code and the `ui/` library counted separately). Claims about dead buttons, unused state and missing handlers were verified by searching for `onClick`, `fetch(`, `axios`, `/api/`, `localStorage` and `sessionStorage` across the source tree. Where a statement in this document is a verified fact, the file path is cited. Where it is a proposal or a risk assessment, it is labelled as such.

**Screenshots.** Desktop and mobile captures of all seven routes (14 files) were taken on 2026-11-17 from the production build and are stored in `docs/phase-0/screenshots/`:

| Route | Desktop | Mobile |
|---|---|---|
| `/` | `home-desktop.png` | `home-mobile.png` |
| `/museum` | `museum-desktop.png` | `museum-mobile.png` |
| `/gallery` | `gallery-desktop.png` | `gallery-mobile.png` |
| `/shop` | `shop-desktop.png` | `shop-mobile.png` |
| `/news` | `news-desktop.png` | `news-mobile.png` |
| `/foundation` | `foundation-desktop.png` | `foundation-mobile.png` |
| `/about` | `about-desktop.png` | `about-mobile.png` |

Honest limitation: in some captures, individual Unsplash images appear as blank/placeholder areas. All imagery on this site is hot-linked from `images.unsplash.com` (see §8), and the sandbox used for capture has intermittent network timing with that CDN. This is a capture-environment artefact, not a defect in the pages; the same routes render fully in a normal browser. The captures are reliable evidence for layout, typography, section order and responsive behaviour.

---

## 2. Executive summary

The existing application is a **purely static, front-end-only React SPA**. It is visually complete and well organised for its current purpose, but it contains **no backend, no API calls, no database layer, no environment configuration and no persistence of any kind** (verified: zero occurrences of `fetch(`, `axios`, `XMLHttpRequest` or `/api/` in `src/`; no `server/` directory; no `.env` files). Every word, price, date and image on all seven pages is a compile-time constant inside a page component.

Key findings:

1. **The visual design is a genuine asset.** Seven complete, coherent pages (~1,190 lines of application code) with a consistent design system (Tailwind v4 theme tokens, light/dark palettes, three font roles). The specification's instruction to preserve it is fully achievable: the pages decompose cleanly into the CMS section types defined in Specification §5.3 (see `CMS_CONTENT_MAPPING.md`).
2. **The dependency list is heavily inflated.** Of 57 runtime dependencies, only a handful are imported by application code (`react`, `react-dom`, `react-router`, `motion`, `lucide-react`, plus Tailwind tooling). Material UI, Emotion and Popper are imported **nowhere at all**. The entire 48-file shadcn/ui library in `src/app/components/ui/` is imported by **no application file** — it is dormant code (valuable later for the admin UI, but currently dead weight in the repository).
3. **Several visible features do not work.** The Museum page's category filter never filters; the News page's "Download PDF" and "Read Article" buttons have no handlers anywhere in the file; the Museum "Begin Virtual Tour" button is inert; the Home page's final "Newsletter" section is an empty element that renders nothing; the About page contact form discards every submission.
4. **All interactivity is volatile.** Cart, wishlist, dark-mode preference and form input live in component `useState`. Nothing is written to `localStorage`/`sessionStorage` anywhere in the codebase (verified). The shop cart is lost on page reload and even on navigating away from `/shop`, because the state lives inside `GiftShopPage`, which unmounts on route change.
5. **The content-protection system is a first-order architectural conflict.** `useWebsiteProtection` in `src/app/components/shared.tsx`, together with global CSS in `src/styles/theme.css`, disables the context menu, copy/cut, text selection, drag, developer-tool shortcuts and printing across the whole site, and blurs the entire page whenever the browser window loses focus. This is fundamentally incompatible with the Phase 4 visual editor (which needs click-to-edit, copy/paste and drag-and-drop), with normal administrator workflows, and with accessibility. It must be scoped or removed by decision before Phase 4 design begins (see §11).
6. **There is no local asset base.** The site has no `public/` directory, no local images, no favicon and a text-only logo. All 42 image references resolve to 17 distinct Unsplash CDN photos via the `uimg()` helper. A media-library migration (Specification §5.6) therefore starts from zero local files, and the current imagery is third-party stock that may not be licensed for the museum's production use — a content decision the client must make during migration.
7. **Data is stored in display formats.** Prices are strings (`"Rs.4,500"`), dates are strings (`"12 Aug 2026"`, `"Mar – Nov 2026"`), and the About page team array contains eight entries of which seven carry the identical name "Siddhartha Man Shakya" (also producing duplicate React keys). Migration to structured records requires data cleansing, not just data copying.

None of these findings blocks the programme. They do mean Phase 1–3 planning must treat the frontend as a *visual source of truth* (per Specification §1.1) rather than as a data source of truth.

---

## 3. Repository structure inventory

Verified at commit `e4981f37` (83 tracked files):

```
bodhisattva-main/
├── index.html                  # SPA entry; static <title>/meta; robots noindex
├── package.json                # 57 runtime deps + 4 devDeps (see §5)
├── package-lock.json           # npm lockfile
├── pnpm-workspace.yaml         # pnpm workspace file ALSO present (see §13, D13)
├── vite.config.ts              # React + Tailwind v4 plugins; figma:asset resolver
├── postcss.config.mjs          # Empty plugin list (documented as intentional)
├── default_shadcn_theme.css    # shadcn default theme — NOT imported anywhere
├── README.md                   # Figma bundle readme (npm i / npm run dev)
├── .gitignore                  # node_modules, dist, .vercel
├── .history/                   # 7 editor "local history" snapshots — TRACKED in git (D12)
├── docs/phase-0/screenshots/   # 14 audit screenshots (untracked at audit date)
├── dist/                       # Local production build output (gitignored, present on disk)
└── src/
    ├── main.tsx                # React root; imports ./styles/index.css
    ├── vite-env.d.ts
    ├── styles/
    │   ├── index.css           # Imports fonts.css, tailwind.css, theme.css
    │   ├── fonts.css           # Google Fonts import (Bebas Neue, Montserrat)
    │   ├── tailwind.css        # Tailwind v4 entry + tw-animate-css
    │   ├── theme.css           # Design tokens, dark palette, protection CSS, base typography
    │   └── globals.css         # 0 bytes, NOT imported anywhere (dead file)
    └── app/
        ├── App.tsx             # Router shell, dark-mode state, protection hook mount
        ├── pages/              # 7 page components (882 lines total)
        │   ├── HomePage.tsx        (219 lines)
        │   ├── MuseumPage.tsx      (144 lines)
        │   ├── GalleryPage.tsx     (85 lines)
        │   ├── GiftShopPage.tsx    (115 lines)
        │   ├── NewsPage.tsx        (67 lines)
        │   ├── FoundationPage.tsx  (117 lines)
        │   └── AboutPage.tsx       (135 lines)
        └── components/
            ├── Nav.tsx             # Header/navigation (hardcoded menu)
            ├── Footer.tsx          # Footer (hardcoded columns/links)
            ├── shared.tsx          # Page type, route map, uimg(), SectionLabel, protection hook
            ├── figma/
            │   └── ImageWithFallback.tsx   # Never imported anywhere (dead code)
            └── ui/                 # 48 shadcn/ui components — imported by NO app file
```

**Not present (verified):** `public/`, `src/assets/`, `server/`, any `*.test.*`/`*.spec.*` file, `tsconfig.json`, any `.env*` file, any CI configuration.

Notable structural facts:

- **No `tsconfig.json` exists**, and the `build` script is only `vite build` — no `tsc` step. TypeScript type errors therefore cannot fail the build; type safety is currently unenforced (Defect D11).
- `vite.config.ts` registers a `figmaAssetResolver` plugin that maps `figma:asset/*` imports to `src/assets/` — a directory that does not exist. No source file imports a `figma:asset/` path. The plugin is inert Figma-export residue.
- A production build exists on disk (`dist/`, built 2026-11-17): a **single** JS chunk of 380,643 bytes and one CSS file of 114,452 bytes. There is no route-level code splitting; every visitor downloads all seven pages plus the animation library up front.

---

## 4. Technology stack and configuration

| Layer | Technology (verified from `package.json` / config) | Notes |
|---|---|---|
| Runtime target | Node `24.x` (`engines` field) | Declared only; hosting verification is covered by the deployment-requirements deliverable |
| Framework | React 18.3.1 + React DOM 18.3.1 | — |
| Build | Vite 6.3.5, `@vitejs/plugin-react` 4.7.0 | `dev` and `build` scripts only; no `preview`, `test` or `lint` script |
| Routing | `react-router` 7.13.0 (`BrowserRouter`) | See §6 |
| Styling | Tailwind CSS 4.1.12 via `@tailwindcss/vite`; `tw-animate-css` | CSS-first config in `src/styles/theme.css`; no `tailwind.config.js` (correct for v4) |
| Animation | `motion` 12.23.24 (`motion/react`) | Used on all pages for reveal animations |
| Icons | `lucide-react` 0.487.0 | The only icon library actually used |
| Fonts | Google Fonts CSS import: Bebas Neue (display), Montserrat (sans + mono fallback) | See §9 |

Configuration observations:

- `index.html` carries a **static** title ("Bodhisattva Museum Website Design" — the Figma file name, not the institution's name), one static meta description, **no favicon**, no Open Graph tags, and `<meta name="robots" content="noindex, nofollow">` — appropriate for a design bundle, wrong for a production museum website (Defect D10). Per-page SEO (Specification §5.1) does not exist in any form.
- `postcss.config.mjs` exports an empty plugin object with a comment explaining Tailwind v4 handles it — intentional, not a defect.
- Both `package-lock.json` and `pnpm-workspace.yaml` are present, and `package.json` contains a `pnpm.overrides` block pinning Vite, while the README instructs `npm i`. The package-manager story is ambiguous (Defect D13) and should be settled in Phase 1 before server dependencies are added.

---

## 5. Dependency audit

57 runtime dependencies and 4 devDependencies are declared. Mechanical import analysis across `src/` gives three groups:

### 5.1 Used by application code (keep)

| Package | Used in |
|---|---|
| `react`, `react-dom` | everywhere |
| `react-router` | `App.tsx`, `Nav.tsx`, `shared.tsx` |
| `motion` | all 7 pages |
| `lucide-react` | all 7 pages, `Nav.tsx`, and 18 files inside `ui/` |
| `tailwindcss`, `@tailwindcss/vite`, `@vitejs/plugin-react`, `vite` (devDeps) | build |
| `tw-animate-css` | imported by `src/styles/tailwind.css` |

### 5.2 Imported only inside the unused `ui/` library (dormant — retain deliberately or remove)

The 48 files in `src/app/components/ui/` are a stock shadcn/ui set. **No application file imports any of them** (verified: zero `components/ui` imports in `App.tsx`, `pages/`, `Nav.tsx`, `Footer.tsx`, `shared.tsx`, `main.tsx`). The following packages are referenced *only* from within that dormant library: all 26 `@radix-ui/*` packages, `cmdk`, `embla-carousel-react`, `input-otp`, `next-themes`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `recharts`, `sonner`, `vaul`, `class-variance-authority`, `clsx`, `tailwind-merge`.

Assessment (proposal): this library is not a liability to delete reflexively — Specification Part 18 requires dialogs, tables, toasts, form controls and skeletons for the admin UI, and this set already matches the site's theme tokens. The Phase 1 architecture decision should be explicit: **adopt `ui/` as the admin component kit** (and accept its dependency subtree) or remove it. What is not acceptable is the current ambiguity, in which ~35 packages are installed for code that never ships.

### 5.3 Imported nowhere in the repository (remove candidates)

Verified zero imports in all of `src/`, including `ui/`:

| Package | Notes |
|---|---|
| `@mui/material` 7.3.5 | Full Material UI library — unused |
| `@mui/icons-material` 7.3.5 | MUI icon set — unused (Lucide is used instead) |
| `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1 | MUI's styling engine — unused |
| `@popperjs/core` 2.11.8 | MUI/Radix transitive need, declared directly — unused |
| `react-dnd` 16.0.1 + `react-dnd-html5-backend` 16.0.1 | Drag-and-drop — unused. Note: Specification §2.1/§2.4 prefers **dnd-kit**, which is *not* installed; react-dnd should not be carried into Phase 4 by inertia |
| `react-slick` 0.31.0 | Carousel — unused (no carousel exists on any page) |
| `react-responsive-masonry` 2.7.1 | Unused — the Gallery masonry is CSS `columns-*` |
| `react-popper` 2.3.0 | Unused |
| `canvas-confetti` 1.9.4 | Unused |
| `date-fns` 3.6.0 | Unused in app code (only referenced by the dormant `ui/calendar.tsx` chain via `react-day-picker` peer expectations — no direct import exists) |

### 5.4 Packages the specification requires that are absent

Verified absent from `package.json`: `zod`, `@dnd-kit/*`, `express`, `drizzle-orm`, `mysql2`, `argon2`, `nodemailer`, `pdfkit`, `sharp`, `vitest`, `playwright`. This is expected — there is no backend — but it confirms Phase 1 starts the server stack from a clean slate with no legacy constraints.

---

## 6. Routing audit

Routing is implemented in `src/app/App.tsx` with `BrowserRouter` from `react-router` 7.13.0:

| Path | Component | File |
|---|---|---|
| `/` | `HomePage` | `src/app/pages/HomePage.tsx` |
| `/museum` | `MuseumPage` | `src/app/pages/MuseumPage.tsx` |
| `/gallery` | `GalleryPage` | `src/app/pages/GalleryPage.tsx` |
| `/shop` | `GiftShopPage` | `src/app/pages/GiftShopPage.tsx` |
| `/news` | `NewsPage` | `src/app/pages/NewsPage.tsx` |
| `/foundation` | `FoundationPage` | `src/app/pages/FoundationPage.tsx` |
| `/about` | `AboutPage` | `src/app/pages/AboutPage.tsx` |
| `*` (anything else) | `<Navigate to="/" replace />` | silent redirect home — **no 404 page exists** |

Supporting mechanics in `src/app/components/shared.tsx`: a `Page` union type, a `pagePaths` record, `pageFromPath()` (used by `Nav` to highlight the active item) and a `useGo()` hook wrapping `useNavigate()`. `App.tsx` adds `ScrollToTop` on path change and a `motion.div` page-transition wrapper keyed by pathname. Shell state: dark mode (`useState`, §10.1) and the protection hook (§11) are mounted once in `Shell`, so they persist across client-side route changes but not across reloads.

Routing observations relevant to later phases:

1. **Navigation is button-based, not link-based.** `Nav`, `Footer` and in-page CTAs are `<button onClick>` elements calling `useNavigate()`. There is not a single `<Link>` or `<a href>` to an internal route in the application. Consequences: no crawlable hrefs (SEO), no open-in-new-tab, no URL preview on hover, and assistive technology announces buttons rather than links. The CMS phase should convert navigation rendering to real anchors while preserving appearance.
2. **`BrowserRouter` requires server rewrite support.** On static/cPanel hosting, direct requests to `/museum` etc. return 404 unless the host rewrites non-file paths to `index.html`. This must be part of the deployment configuration (Specification §19.3) and verified in the hosting feasibility work.
3. **The route set is closed.** CMS-created pages (Specification §5.1) cannot be served by this static `<Routes>` table; Phase 3 must introduce a dynamic route (e.g. a slug-based catch route rendering published CMS pages) while protecting the reserved system routes the specification lists.
4. **The catch-all redirect hides errors.** Any mistyped or stale URL silently lands on Home. A CMS-driven site needs a deliberate 404 decision.

---

## 7. Page-by-page audit

Section-level detail, data shapes and CMS mapping for every block are in `CMS_CONTENT_MAPPING.md`. This section records what each page *is*, its verified behaviour, and its notable issues.

### 7.1 Home — `/` — `HomePage.tsx` (219 lines)

Eight blocks: full-screen hero; "Our Purpose" image-and-text intro with a floating stat badge; Featured Collections (3 cards, inline data array); Current Exhibitions (1 featured + 3 list items, inline data); Curator quote band; Foundation preview (2-image collage + 3 statistics + CTA); Latest News (3 articles, inline data duplicating `NewsPage` content); and a final **empty** `<section>` commented "Newsletter" that renders nothing but vertical padding (Defect D7).

Behaviour: hero image fades in on load (`loaded` state); scroll-reveal animations via `motion`; all CTAs navigate correctly via `useGo()`. The featured-collections and exhibition data are *second copies* of records that also live on the Museum/Gallery/News pages — three sources of truth for the same exhibitions already exist in the codebase (Home list, Gallery archive, News article #3 all describe "Echoes of Enlightenment" with different date strings).

### 7.2 Museum — `/museum` — `MuseumPage.tsx` (144 lines)

Six blocks: image page-hero; overview text with a label/value fact list (Established 2000, 28,000 sq.ft., 12,400+ artifacts, 2.1M visitors, 18 rooms, 8 languages); history timeline (5 entries, 2000–2022); "Explore by Category" collection grid (6 collections, inline array); floor-map directory (3 floors × 4 rooms); Virtual Tour CTA band.

**Verified defect (D1): the category filter does not filter.** The filter buttons set `activeFilter` state, but the grid renders the `collections` array unconditionally, and the collection records have **no category field at all** — there is nothing to filter by. Clicking "Painting" or "Coins" changes only the button highlight. Additionally (D2): `onNav` is initialised but never called in this file, and the collection cards carry `cursor-pointer` styling with **no click handler**; the "Begin Virtual Tour" button (D6) also has no handler. The imported `Leaf` icon is never used (D9).

### 7.3 Gallery — `/gallery` — `GalleryPage.tsx` (85 lines)

Three blocks: title band ("Past Exhibitions"); a sticky filter bar (year × category); a CSS-columns masonry grid of 9 exhibition records (inline array with `id, title, year, cat, date, curator, desc, imgId, tall`).

Behaviour: unlike the Museum filter, these filters **work** — `filtered` is computed from both state values, with an empty-state message. Exhibition cards are `cursor-pointer` but have **no click handler and no detail view exists** (D5). Dates are stored twice: a `year` string used for filtering and a free-text `date` range used for display (`"Mar – Nov 2026"`), which must be reconciled into real start/end dates at migration.

### 7.4 Gift Shop — `/shop` — `GiftShopPage.tsx` (115 lines)

Four blocks: header band with a live cart-count badge; category tab bar (6 tabs, inline); product grid (12 products, inline array); quick-preview modal.

The product record is `{ id, name, price, cat, detail, imgId }` where **`price` is a display string** (`"Rs.4,500"`) — there is no numeric price, no SKU, no stock quantity, no sale price, no product description beyond a one-line `detail`, and exactly one image per product (Defect D18; Specification §4 requires fixed-precision decimal money and §10.1 requires SKU/stock/variants).

Interactions (all component-local `useState`): category tabs filter correctly; wishlist is a toggle list of product IDs; "Add to Cart" toggles an ID in/out of a cart list — there are **no quantities, no cart page/drawer, no totals and no checkout**; the header cart badge counts distinct product IDs. Cart and wishlist are destroyed on route change or reload (see §2, finding 4). The hover-revealed action buttons (wishlist/preview/add) are mouse-only affordances — on touch devices the reveal pattern does not exist, an existing responsive-behaviour gap worth recording for Phase 6 redesign-within-preservation.

### 7.5 News — `/news` — `NewsPage.tsx` (67 lines)

Two blocks: header band with search input; article list (8 articles, inline array: `id, outlet, date, title, type, summary`).

Behaviour: search **works** (case-insensitive match across title/outlet/type) with a no-results message. Article type is colour-coded via a `typeColor` map (News/Interview/Feature/Press Release/Review — an embryonic `news_categories` taxonomy). **Verified defect (D4): the file contains no `onClick` handler at all** — "Download PDF" and "Read Article" buttons are decorative; no PDF files and no article URLs exist anywhere in the repository. Dates are display strings (`"12 Aug 2026"`, D19). Articles have no images in the current design, although Specification §6.4 expects an image field.

### 7.6 Foundation — `/foundation` — `FoundationPage.tsx` (117 lines)

Six blocks: image page-hero; impact statistics band (4 stats); mission image-and-text; Programs & Initiatives grid (4 programs, inline array with `name, cat, desc, impact` and a **Lucide icon component stored in the data** — an implementation detail that cannot survive serialisation to a database and must become an icon-name enum); testimonials (3 records with avatar images); partner-organisations name strip (8 names, text only, no logos).

Content-quality flag (D20): testimonial and program copy contains leftover India-context references inconsistent with a Nepali institution — "Teacher, Govt. School, **Varanasi**", "underserved neighbourhoods across **NCR**", "Kalamkari, Bidri metalwork" — alongside correct Nepal references (Humla, Dolpa, Manang). The About/Museum history text similarly places the founding in "Civil Lines, Lalitpur" (Civil Lines is a Delhi locality). These are placeholder-copy artefacts of the design bundle; they must be resolved with the client during content migration, not migrated verbatim into the CMS.

### 7.7 About — `/about` — `AboutPage.tsx` (135 lines)

Five blocks: title band; history (3 paragraphs) beside an image and a founder-quote card; Vision/Mission two-column band; Team grid (8 members); dark "Visit & Contact" band combining a contact-information list (address, hours, phone, email, web) with the site's only form.

**Verified defect (D3): the team data is placeholder data.** The `team` array has 8 entries; 7 are named exactly "Siddhartha Man Shakya" and the eighth is "Siddhartha Man Shakya Sharma", differentiated only by role/department. Because the grid uses `key={member.name}`, seven rows share an identical React key — a real rendering-correctness bug (React duplicate-key warning; reconciliation can mismatch rows), independent of the content problem. There are no team photos; the design renders two-letter initials derived from the (duplicated) names.

**Contact form (D8):** fields are First Name, Last Name, Email, Subject (a `<select>` with 6 enquiry types) and Message. `onSubmit` is `(e) => e.preventDefault()` — submissions are silently discarded; there is no validation, no success/error feedback, no `name` attributes, no `<label>` elements (placeholder-only labelling — an accessibility failure), and no backend endpoint to receive anything. The subject enum is, however, a useful ready-made taxonomy for the `contact_submissions` table (Specification §4.8).

**Hours inconsistency (D20):** the About page states "Sun – Fri: 10:00 AM – 5:00 PM / Monday: Closed" — internally contradictory, since Monday falls inside Sun–Fri; the Footer states "Sun-Fri 10:00am to 5:00pm" with no Monday closure. One of these is wrong; the CMS migration to a single `site_settings` source will force the client to decide.

---

## 8. Assets and media audit

- **Local assets: none.** There is no `public/` directory and no `src/assets/` directory. The repository contains no image, logo, font or video files at all (verified by full file inventory).
- **All imagery is remote.** Every `<img>` on every page is built by the `uimg()` helper in `src/app/components/shared.tsx`:

  ```ts
  export const uimg = (id: string, w = 1200, h = 800) =>
    `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&auto=format&q=80`;
  ```

  There are **42 image references** across the source, resolving to **17 distinct Unsplash photo IDs**, reused across pages at different crop sizes (e.g. `photo-1775212253782-d223fe035ddc` serves as a Home collection card, a Museum collection card, a Gallery exhibition cover and a Shop product image simultaneously). One stock photo currently represents a sculpture collection, an exhibition *and* a purchasable product — acceptable in a design mock, not in production content.
- **No favicon** is referenced in `index.html`; browsers fall back to `/favicon.ico`, which does not exist.
- **The logo is typography, not an asset**: "Bodhisattva / Museum & Art Gallery" set in the display/mono fonts in `Nav.tsx` and `Footer.tsx`. There is no logo file to migrate; if the institution has a real logo, it enters via the media library in Phase 3/5.
- `ImageWithFallback.tsx` (a Figma-export utility that swaps in an inline SVG placeholder on image error) is **never imported** — pages use raw `<img>` tags, so a failed Unsplash request currently shows a broken/empty frame (visible in some audit screenshots).
- **Licensing/provenance risk (assessment):** Unsplash hot-links are third-party stock with no recorded licence or attribution in the repo, and availability depends on Unsplash's CDN at runtime. The media migration (Specification §5.6) should treat all 17 photos as placeholders to be replaced or explicitly approved by the client, and must download/self-host any that are retained — the CMS cannot be built on `uimg()` URLs.

---

## 9. Typography and design system

- **Fonts** load from Google Fonts via a CSS `@import` in `src/styles/fonts.css`: **Bebas Neue** (`--font-display`) and **Montserrat** (`--font-sans`). `--font-mono` declares `'Pier Sans'` first — a commercial typeface that is **not loaded anywhere** (the fonts.css comment acknowledges this), so all mono-styled labels actually render in Montserrat. Any CMS/builder work must preserve this three-role system; the "mono" labels are a visual signature of the design.
- **Theme tokens** live in `src/styles/theme.css` as CSS custom properties with full light and dark palettes (background `#F7F3EC` / foreground `#1C1A16` / accent gold `#9A6F2A` in light mode; `#0F0D0A` / `#F0EBE0` / `#C4952E` in dark), exposed to Tailwind via `@theme inline`. The dark variant is class-based (`@custom-variant dark (&:is(.dark *))`), toggled by `App.tsx`.
- **Brand constants worth protecting during migration:** `--radius: 0.125rem` (near-square corners), the gold accent, the cream/ink palette, Bebas Neue display headings, and the small tracked uppercase mono-style labels produced by the `SectionLabel` component in `shared.tsx` (used on nearly every section of every page — it should become a standard field pair, `sectionLabel` + `heading`, in every CMS section schema; see `CMS_CONTENT_MAPPING.md`).
- `src/styles/globals.css` is an empty file that nothing imports, and `default_shadcn_theme.css` at the repo root is the *stock* shadcn theme (different palette) that nothing imports. Both are dead files that could confuse future theming work; the audit recommends deleting or clearly quarantining them in Phase 1.

---

## 10. Forms and interactions inventory

Complete inventory of every interactive behaviour in the application (all verified in code):

| # | Interaction | Location | Works? | Persistence / notes |
|---|---|---|---|---|
| 1 | Client-side routing + active-nav highlighting | `App.tsx`, `Nav.tsx` | Yes | Button-driven (see §6.1) |
| 2 | Dark mode toggle | `App.tsx` state → `Nav.tsx` button | Yes | **Not persisted** — resets on reload; `next-themes` is installed but unused by app code |
| 3 | Mobile menu (hamburger) | `Nav.tsx` | Yes | — |
| 4 | Scroll-aware header (transparent over Home hero) | `Nav.tsx` scroll listener | Yes | — |
| 5 | Page transition + scroll-to-top | `App.tsx` (`motion.div`, `ScrollToTop`) | Yes | — |
| 6 | Scroll-reveal animations | all pages (`motion`) | Yes | `whileInView` throughout |
| 7 | Museum category filter | `MuseumPage.tsx` | **No — D1** | Sets state; grid never filtered; data has no category field |
| 8 | Gallery year/category filters | `GalleryPage.tsx` | Yes | Client-side over 9 inline records |
| 9 | Shop category tabs | `GiftShopPage.tsx` | Yes | Client-side over 12 inline records |
| 10 | Shop wishlist toggle | `GiftShopPage.tsx` | Partially | ID list only; no wishlist view; lost on unmount/reload |
| 11 | Shop add-to-cart toggle + header count | `GiftShopPage.tsx` | Partially | No quantities, totals, cart view or checkout; lost on unmount/reload |
| 12 | Shop quick-preview modal | `GiftShopPage.tsx` | Yes | Mouse-hover entry point only (touch gap, §7.4) |
| 13 | News search | `NewsPage.tsx` | Yes | Client-side substring match |
| 14 | News "Download PDF" / "Read Article" | `NewsPage.tsx` | **No — D4** | No handlers exist in the file |
| 15 | "Begin Virtual Tour" | `MuseumPage.tsx` | **No — D6** | No handler |
| 16 | Contact form submit | `AboutPage.tsx` | **No — D8** | `preventDefault()` only; data discarded; no validation/feedback |
| 17 | Newsletter signup | `HomePage.tsx` | **No — D7** | Section is empty; no UI exists |
| 18 | Footer Privacy/Terms/Accessibility | `Footer.tsx` | No | Inert `<span>` elements |
| 19 | Content protection (context-menu block, copy block, blur-on-blur, print blackout) | `shared.tsx` + `theme.css` | Yes (as designed) | See §11 — major forward conflict |

**Forms summary:** exactly one form exists in the entire application (About contact form), and it is non-functional. There are no login, registration, checkout, search-engine or newsletter forms. Every form required by the specification (Parts 7, 10, 12) is greenfield work; the About form's field set and subject taxonomy are the only reusable artefacts.

---

## 11. The content-protection system — detailed finding

This subsystem deserves its own section because it touches every future phase.

**What exists (verified):**

- `useWebsiteProtection()` in `src/app/components/shared.tsx`, mounted unconditionally in `App.tsx`'s `Shell`, registers document-level listeners that:
  - `preventDefault()` on **all** `contextmenu` and `dragstart` events;
  - block `copy`/`cut` everywhere except inside input/textarea/select/contenteditable elements;
  - intercept F12, Ctrl/Cmd+Shift+I/J/C, Ctrl/Cmd+U and Cmd+Shift+S, and on detection **blur the entire page for 1.4 s** (`contentObscured` state → `.is-obscured` CSS: `filter: blur(18px); opacity: 0.18`);
  - obscure content on `PrintScreen`;
  - obscure content whenever `document.hidden` becomes true **and whenever the window loses focus** (`window blur` listener), restoring on focus.
- `src/styles/theme.css` adds: `user-select: none` on `body` and `.protected-content`; `-webkit-user-drag: none` on all images/video; a fixed black `.privacy-screen` overlay while obscured; and a `@media print` rule that hides all content and paints the printed page black.

**Conflicts and risks (assessment):**

1. **Phase 4 visual editor (blocking conflict).** Click-to-edit, inline text editing, drag-and-drop section reordering, copy/paste of sections and right-click/contextual controls are the editor's core mechanics (Specification §5.2–§5.4). The protection hook disables or fights every one of them: drag is prevented at document level (this would also break dnd-kit), copy/cut are blocked outside form fields, and any focus shift to a properties panel in a separate window, a colour picker, or the browser's own UI risks triggering blur-obscuring mid-edit.
2. **Administrator workflows.** Admin users legitimately copy text, open devtools, switch windows to email/WhatsApp, and print invoices (Part 12 requires PDF invoice handling and downloads). The hook obscures the app on *every* window blur — including clicking a desktop notification — making sustained admin work hostile. Invoice printing from the browser is directly sabotaged by the print-blackout rule.
3. **Accessibility (Specification §1.2 requires maintaining accessibility).** Global `user-select: none` prevents text selection by switch/voice users and read-aloud tools; context-menu suppression removes browser accessibility features; focus-loss blurring punishes users who tab between windows or use a password manager. Several of these patterns are also at odds with the accessibility commitments in Part 23's acceptance tests.
4. **It provides no real security.** Client-side key blocking does not protect content (images are direct Unsplash URLs; page source is a public JS bundle). It is presentation-layer friction only, and it must not be cited as a security control in the Phase 0 threat model.
5. **Customer-facing harm.** On the public site it blocks legitimate behaviour the new platform will *require*: copying an address, selecting order details, printing an invoice, right-clicking to open a product in a new tab.

**Recommendation (proposal, decision required before Phase 4):** remove the hook and its CSS from the application entirely, or — if the client insists on retaining some deterrent on public pages — scope it strictly to public routes, exclude all `/admin`, `/account` and invoice routes, and drop the window-blur obscuring and print blackout. This is recorded as **Blocking Decision BD-1** in §14.

---

## 12. Backend, API and database — confirmation of absence

Verified by exhaustive search of the repository:

- No `server/` directory, no Express or any server framework in `package.json`, no API route files.
- Zero network calls in application code: no `fetch(`, `axios`, `XMLHttpRequest`, `WebSocket`, or `/api/` string anywhere in `src/`.
- No database driver, ORM, migration, schema or SQL file anywhere in the repository.
- No `.env` or `.env.example`; no configuration is read from the environment at runtime (the only `process.env`-style surface is Vite's build-time handling, unused for app config — `VITE_API_BASE_URL` from Specification §19.2 does not exist yet).
- No authentication or session code of any kind; no cookies are set by the application.
- No tests, no test runner, no CI.

**Conclusion:** the dynamic platform (Parts 2–19 of the specification) is entirely greenfield behind the existing visual layer. There are no legacy API contracts to preserve and no existing user data to migrate. The only "data migration" in the programme is the one-time conversion of the hardcoded content inventoried in §13 and mapped in `CMS_CONTENT_MAPPING.md` into seeded database records.

---

## 13. Consolidated defect register

All defects below were verified directly in the cited code. Severity is assessed against the *target* platform, not the current demo use.

| ID | Defect | Evidence | Severity for target platform |
|---|---|---|---|
| D1 | Museum category filter never filters the grid; collection data has no category field | `MuseumPage.tsx` — `activeFilter` set but `collections.map` unfiltered | Medium — must be fixed when collections become module records (category becomes a real field) |
| D2 | Museum `onNav` unused; collection cards `cursor-pointer` with no handler | `MuseumPage.tsx` (grep: no `onNav(` call) | Low |
| D3 | About team array: 7 of 8 members share the identical name; duplicate React `key={member.name}` values | `AboutPage.tsx` `team` array | Medium — content must be replaced with real data before migration; key bug disappears with DB IDs |
| D4 | News "Download PDF" / "Read Article" buttons have no handlers; no PDFs/URLs exist | `NewsPage.tsx` (grep: zero `onClick` in file) | Medium — becomes real `externalUrl` / media-attachment fields in `news_articles` |
| D5 | Gallery exhibition cards are clickable-styled but open nothing | `GalleryPage.tsx` | Low — exhibition detail is out of current scope; note for Phase 5 |
| D6 | "Begin Virtual Tour" button inert | `MuseumPage.tsx` | Low — becomes a CTA link field |
| D7 | Home "Newsletter" section is an empty `<section>` (renders padding only) | `HomePage.tsx` final section | Medium — an intended feature that was never built; needs a product decision (see mapping doc, new section type proposal) |
| D8 | About contact form discards submissions; no validation, labels or feedback | `AboutPage.tsx` `onSubmit={e => e.preventDefault()}` | High for launch — becomes `contact_submissions` flow in Phase 3/5 |
| D9 | Unused imports (`Leaf` in MuseumPage; `Sun` in AboutPage) | cited files, line 2–3 | Trivial — symptomatic of no lint/typecheck gate |
| D10 | `index.html`: robots `noindex, nofollow`; title is the Figma design name; no favicon/OG tags | `index.html` | High for production launch — replaced by CMS-driven SEO in Phase 3 |
| D11 | No `tsconfig.json`; build runs no type checking | repo inventory; `package.json` scripts | Medium — Phase 1 must add `tsc` gate for the shared-types contract |
| D12 | `.history/` editor snapshots (7 files) tracked in git | `git ls-files` | Low — repository hygiene; remove and ignore |
| D13 | Dual package-manager signals (npm lockfile + pnpm workspace + pnpm overrides) | repo root | Medium — settle one manager in Phase 1 |
| D14 | Dark-mode preference not persisted | no `localStorage` anywhere in `src/` | Low |
| D15 | Cart/wishlist state destroyed on route change/reload | state local to `GiftShopPage.tsx` | High for ecommerce — resolved by server cart (Part 10), but note the *current* demo overstates shop readiness |
| D16 | Global `user-select: none`, context-menu suppression, print blackout (accessibility) | `theme.css`, `shared.tsx` | High — see §11 / BD-1 |
| D17 | Footer link targets are approximate ("Membership"→About, "Events"→Museum, "Press Enquiries"→News); Privacy/Terms/Accessibility inert | `Footer.tsx` | Low — resolved by menu management (§5.7) |
| D18 | Prices are display strings; no numeric money values anywhere | `GiftShopPage.tsx` product array | High for ecommerce — Phase 6 schema uses DECIMAL per §4 |
| D19 | Dates are display strings, duplicated in inconsistent formats across pages ("Until Nov 2026" vs "Mar – Nov 2026") | Home/Gallery/News pages | Medium — real DATE fields at migration |
| D20 | Placeholder copy inconsistencies: Varanasi/NCR references; "Civil Lines, Lalitpur"; contradictory opening hours (Footer vs About) | `FoundationPage.tsx`, `AboutPage.tsx`, `Footer.tsx` | Medium — client content decisions required during migration |
| D21 | Single-chunk bundle (380.6 kB JS) with no code splitting; dormant `ui/` library inflates install size and confusion, though not the shipped bundle | `dist/` inventory | Low |

---

## 14. Conflicts and risks for the proposed platform

| # | Planned capability (spec) | Conflict / risk from current code | Required decision or mitigation |
|---|---|---|---|
| R1 | Visual page builder with drag-and-drop, inline editing (§5.2–5.4) | Content-protection hook blocks drag, copy, context menu; obscures on focus loss (§11) | **BD-1 (blocking):** remove or strictly scope protection before Phase 4 design |
| R2 | CMS-driven pages with slugs (§5.1) | Static `<Routes>` table; `Page` union type hardcodes 7 pages; catch-all redirects unknown URLs home | Phase 3 adds a dynamic slug route + reserved-route protection; 404 behaviour decided |
| R3 | Menu/footer management (§5.7) | Nav and Footer menus are hardcoded arrays with approximate targets (D17) | Migrate to `menus`/`menu_items`; convert buttons to real links (§6.1) |
| R4 | Media library (§5.6) | Zero local media; all imagery is Unsplash hot-links with no licence record (§8) | Client decision per image: replace with owned photography or approve stock; self-host retained images |
| R5 | Ecommerce (§10) | Product data lacks SKU, stock, numeric price, variants, multiple images (D18); cart is volatile local state (D15) | Phase 6 data model per §4.6; current product list is seed *content* only, not a schema |
| R6 | Customer accounts & sessions (Part 7) | No persistence layer, no cookies, no auth code exists | Greenfield; no conflict, but note dark-mode/cart patterns set a precedent of "state in useState" that must not be repeated for auth |
| R7 | Admin UI (Part 18) | 48-file shadcn/ui kit is present but unadopted and unthemed against actual usage; stock `default_shadcn_theme.css` at root is a *different* palette from `theme.css` | Phase 1 decision: adopt `ui/` + `theme.css` tokens as the single kit; delete/quarantine the stock theme file |
| R8 | SEO (§5.1) | `noindex` meta, static title, button-based navigation, SPA rendering | CMS SEO fields + link-based nav in Phase 3; hosting rewrite rules for `BrowserRouter` (§6.2) |
| R9 | Accessibility (§1.2, Part 23) | Protection CSS, placeholder-only form labels, hover-only shop actions, button navigation | Accessibility pass is a Phase 3/4 work item, not a final-phase afterthought |
| R10 | Shared TypeScript contracts (Part 20) | No `tsconfig.json`, no typecheck in build (D11) | Phase 1 foundation adds tsconfig + `tsc --noEmit` gate before contracts are written |
| R11 | Testing (Part 23) | No test runner or tests exist; several "working" features are actually broken (D1, D4, D7, D8) | Phase 0/1: adopt Vitest + Playwright per §2.4; the defect register above is the first regression-test list |
| R12 | Deployment on cPanel (Part 19) | SPA deep links need rewrites; production build is a single bundle; Node 24 declared in `engines` | Covered by DEPLOYMENT_REQUIREMENTS.md / hosting feasibility; not resolvable from this repo alone |

### Blocking decisions arising from this audit

- **BD-1 — Content protection (§11):** remove entirely, or scope to public routes only with blur/print behaviours dropped. *Blocks Phase 4 editor design.*
- **BD-2 — Imagery (R4):** are the 17 Unsplash photos approved production content, or placeholders to be replaced by the museum's own photography before launch? *Blocks Phase 3 seed content and Phase 5 media migration.*
- **BD-3 — Opening hours & placeholder copy (D20):** client to confirm correct hours and replace India-context copy. *Blocks seed content accuracy, not code.*

---

## 15. What can be preserved as-is (Specification §1.2 compliance)

The following existing elements are sound and should be carried into the dynamic platform unchanged in appearance:

- All seven page layouts, section order, spacing rhythm and responsive breakpoints.
- The `theme.css` token system (light + dark) and the three-role font system.
- The `SectionLabel` visual pattern (promoted to a standard schema field pair).
- `Nav`/`Footer` visual design (implementation changes: CMS-driven items, real anchors).
- `motion` reveal-animation patterns on sections and cards.
- The dormant shadcn/ui kit, *if* adopted by explicit Phase 1 decision (R7).
- The About form's field set and subject taxonomy (as the `contact_submissions` schema seed).
- The Gallery filter behaviour and News search behaviour as the interaction specification for their Phase 5 module equivalents.

---

## 16. Appendix — key file metrics

| File | Lines | Role |
|---|---|---|
| `src/app/pages/HomePage.tsx` | 219 | Home page, 8 blocks (1 empty) |
| `src/app/pages/MuseumPage.tsx` | 144 | Museum page, 6 blocks |
| `src/app/pages/AboutPage.tsx` | 135 | About page, 5 blocks + only form |
| `src/app/pages/FoundationPage.tsx` | 117 | Foundation page, 6 blocks |
| `src/app/pages/GiftShopPage.tsx` | 115 | Shop page, 12 products, local cart/wishlist |
| `src/app/components/shared.tsx` | 110 | Route map, `uimg()`, `SectionLabel`, protection hook |
| `src/app/components/Nav.tsx` | 100 | Header, hardcoded menu, dark toggle |
| `src/app/pages/GalleryPage.tsx` | 85 | Gallery page, 9 exhibitions, working filters |
| `src/app/pages/NewsPage.tsx` | 67 | News page, 8 articles, working search |
| `src/app/components/Footer.tsx` | 47 | Footer, hardcoded columns |
| `src/app/App.tsx` | 67 | Router shell |
| `src/styles/theme.css` | 240 | Tokens, protection CSS, base typography |
| Application code total | ≈1,190 | Excluding the 48 dormant `ui/` files |

*End of PROJECT_AUDIT.md — Phase 0, Subagent 1 (Audit + CMS Mapping). Companion: CMS_CONTENT_MAPPING.md.*
