/**
 * Museum-module seed data — Phase 5 (CMS_CONTENT_MAPPING.md §3–§8, §10).
 *
 * The canonical record sets for the museum/foundation modules:
 * `collections`, `exhibitions`, `news_categories`, `news_articles`,
 * `foundation_programs` and `testimonials`. Transcribed VERBATIM from the
 * current page components (`src/app/pages/*.tsx` at the pre-CMS commit,
 * via `src/app/components/temporary-module-data.ts`, which SA-E extracted
 * from those components for the Phase 3 rendering switch). No copy has
 * been edited, corrected or "improved" — known content issues are flagged
 * in comments and preserved, per the mapping's client-decision rule (§12.6).
 *
 * Dedupe rule (§1.3, §10): ONE canonical set per module. Home renders
 * subsets of these sets (featured collections, current exhibitions,
 * latest news, the curator testimonial) — it never holds copies. Where
 * Home's inline data disagrees with the canonical set's page (different
 * titles, counts or descriptions for the same record), the fuller page's
 * version wins and the disagreement is flagged inline.
 *
 * Conventions:
 *  - `sortOrder` is 0-based, in the on-site order of the canonical page
 *    (Museum for collections, Gallery for exhibitions, News for articles,
 *    Foundation for programs and testimonials).
 *  - `slug` values are kebab-case, generated from the record name/title.
 *  - Images are `{ url, alt }` objects holding the current Unsplash URLs,
 *    built with the exact dimensions the canonical component requests via
 *    `uimg(id, w, h)` (media migration is a later decision, PROJECT_AUDIT
 *    BD-2 — same precedent as `cms-content.ts`).
 *  - Exhibition/news display dates have been split/converted into ISO
 *    dates (Audit D19); the original exhibition display string is kept
 *    in `dateLabel` for exact rendering.
 *
 * ------------------------------------------------------------------------
 * COUNT CHECK — records exported here vs CMS_CONTENT_MAPPING.md §10
 * ------------------------------------------------------------------------
 *  collections          6   (§10 step 3: "6 canonical records")        ✓
 *  exhibitions          9   (§10 step 4: "9 canonical records")        ✓
 *  news_categories      5   (§10 step 5: "news_categories (5)")        ✓
 *  news_articles        8   (§10 step 5: "news_articles (8)")          ✓
 *  foundation_programs  4   (§10 step 6: "foundation_programs (4)")    ✓
 *  testimonials         4   (§10 step 6: "3 foundation + 1 curator")   ✓
 * Out of scope for this file: foundation statistics (4) are statistics
 * *section* content, seeded with the pages in `cms-content.ts`;
 * `product_categories` (5) + `products` (12) are Phase 6 (§10 step 7).
 * ------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** An image reference: current Unsplash URL + alt text (see header note). */
export interface MuseumImage {
  url: string;
  alt: string;
}

// ---------------------------------------------------------------------------
// Collections (§3 H3, §4 M4) — canonical set: Museum "Explore by Category".
// Home "Featured Collections" renders the `isFeatured` subset.
//
// ⚠ DATA CONFLICT (mapping §H3/§10 — client confirmation needed): Home's
// three cards reuse these records' IMAGES under different names and
// counts — "Buddhist Manuscript Art" (1,240 manuscripts) sits on Palm
// Leaf Manuscripts' image, and "Contemporary Dialogues" (890 works) sits
// on Buddhist Paintings' image, while the counts 1,240 and 890 belong to
// Buddhist Paintings and Palm Leaf Manuscripts respectively in Museum's
// data. Following the mapping's recommendation, the canonical records
// below are Museum's (name, count, image, alt); `isFeatured` and
// `periodLabel` are matched to Home BY IMAGE ID, the only stable join
// key. Home-only names ("Buddhist Manuscript Art", "Contemporary
// Dialogues") and Home's alt variants are NOT carried over.
// `worksCountLabel` is the display string as rendered on Museum:
// `{count.toLocaleString()} works`.
// ---------------------------------------------------------------------------

export interface CollectionSeed {
  slug: string;
  name: string;
  /** Period line shown on Home cards; null where no source page states one. */
  periodLabel: string | null;
  /** Display count string as rendered on site, e.g. "1,240 works". */
  worksCountLabel: string;
  category: "Sculpture" | "Painting" | "Manuscripts" | "Coins" | "Textiles" | "Contemporary";
  image: MuseumImage;
  isFeatured: boolean;
  sortOrder: number;
}

export const COLLECTIONS: CollectionSeed[] = [
  {
    slug: "gandharan-sculpture",
    name: "Gandharan Sculpture",
    // Home card of the same name and image: "1st – 5th Century CE".
    periodLabel: "1st – 5th Century CE",
    worksCountLabel: "487 works",
    // INFERRED category (mapping §M4): the code never encoded the
    // record→filter mapping; assigned from the Museum filter labels and
    // flagged for client confirmation at seeding.
    category: "Sculpture",
    image: {
      url: "https://images.unsplash.com/photo-1775212253782-d223fe035ddc?w=600&h=450&fit=crop&auto=format&q=80",
      alt: "Ancient statues in contemplation",
    },
    isFeatured: true,
    sortOrder: 0,
  },
  {
    slug: "buddhist-paintings",
    name: "Buddhist Paintings",
    // No period is stated for this record on either page. (Home's card
    // using this image — titled "Contemporary Dialogues" — carried
    // "1960 – Present", a period that describes contemporary art, not
    // this record; deliberately not attached. See conflict note above.)
    periodLabel: null,
    worksCountLabel: "1,240 works",
    // INFERRED category (mapping §M4) — see note on sortOrder 0.
    category: "Painting",
    image: {
      url: "https://images.unsplash.com/photo-1605429523419-d828acb941d9?w=600&h=450&fit=crop&auto=format&q=80",
      alt: "Gallery wall with paintings",
    },
    // Featured because this record's image is one of the three shown on
    // Home (under the Home-only title "Contemporary Dialogues").
    isFeatured: true,
    sortOrder: 1,
  },
  {
    slug: "palm-leaf-manuscripts",
    name: "Palm Leaf Manuscripts",
    // Home's card using this image — titled "Buddhist Manuscript Art" —
    // carried "8th – 16th Century"; attached here by image match.
    periodLabel: "8th – 16th Century",
    // Museum's count for this record is 890. Home's card on this image
    // read "1,240 manuscripts" — that count is Buddhist Paintings' in
    // Museum's data (see conflict note above); not carried over.
    worksCountLabel: "890 works",
    // INFERRED category (mapping §M4) — see note on sortOrder 0.
    category: "Manuscripts",
    image: {
      url: "https://images.unsplash.com/photo-1765127959724-631190c32e8a?w=600&h=450&fit=crop&auto=format&q=80",
      alt: "Ancient manuscript display",
    },
    isFeatured: true,
    sortOrder: 2,
  },
  {
    slug: "numismatic-collection",
    name: "Numismatic Collection",
    periodLabel: null,
    worksCountLabel: "3,200 works",
    // INFERRED category (mapping §M4) — see note on sortOrder 0.
    category: "Coins",
    image: {
      url: "https://images.unsplash.com/photo-1768481498978-25ac2b210b35?w=600&h=450&fit=crop&auto=format&q=80",
      alt: "Museum visitors at exhibit",
    },
    isFeatured: false,
    sortOrder: 3,
  },
  {
    slug: "decorative-textiles",
    name: "Decorative Textiles",
    periodLabel: null,
    worksCountLabel: "560 works",
    // INFERRED category (mapping §M4) — see note on sortOrder 0.
    category: "Textiles",
    image: {
      url: "https://images.unsplash.com/photo-1772617616268-a2f27d194fce?w=600&h=450&fit=crop&auto=format&q=80",
      alt: "Gallery sculptures and displays",
    },
    isFeatured: false,
    sortOrder: 4,
  },
  {
    slug: "contemporary-works",
    name: "Contemporary Works",
    periodLabel: null,
    worksCountLabel: "724 works",
    // INFERRED category (mapping §M4) — see note on sortOrder 0.
    category: "Contemporary",
    image: {
      // Same Unsplash image as the "Echoes of Enlightenment" exhibition
      // cover — the current site reuses it; preserved as-is.
      url: "https://images.unsplash.com/photo-1569783721854-33a99b4c0bae?w=600&h=450&fit=crop&auto=format&q=80",
      alt: "Contemporary gallery visitors",
    },
    isFeatured: false,
    sortOrder: 5,
  },
];

// ---------------------------------------------------------------------------
// Exhibitions (§3 H4, §5 G3) — canonical set: Gallery archive (9 records).
// Home "Current Exhibitions" renders the featured record + the other
// `status: "current"` records.
//
// Dates (Audit D19): `dateLabel` is the verbatim Gallery display string;
// `startsOn`/`endsOn` are split from it by the convention start = first
// day of the start month, end = last day of the end month. The strings
// give month precision only, so the day components are conventional,
// not sourced — flagged here once for all nine records. No individual
// conversion was otherwise ambiguous: the two string shapes are
// "Mon – Mon YYYY" (same year) and "Mon YYYY – Mon YYYY" (cross-year).
//
// Status derivation: per the site's framing, the four exhibitions shown
// on Home as current (Echoes of Enlightenment + the three list entries)
// are "current"; the remaining five are "past".
// ⚠ DATA CONFLICT: "Living Crafts of Nepal" is "current" by that rule
// (Home: "Terrace Gallery · Until Dec 2026"), but its Gallery dates are
// Jan – May 2025 — already past. Both facts are preserved verbatim; the
// status follows Home's framing as instructed by the mapping (§H4
// selection "current"), and the conflict is the client's to resolve.
//
// Descriptions: Gallery's versions are canonical. Home's list entries
// carry slightly different descriptions for the three shared records
// (e.g. Silk Road: "…Tang Dynasty China." on Home vs "…Tang China." in
// Gallery; Feminine Divine: "…artistic traditions." vs "…traditions.";
// Living Crafts: Home adds "…, photographed in their workshops.") —
// Home's variants are NOT carried over (§10 dedupe).
//
// `locationLabel` is split from Home's fused "Location · Until …"
// strings (§H4); records never shown on Home have no location source
// and carry null. Alt text follows the Gallery component, which renders
// `alt={ex.title}` — ⚠ Home's featured card instead uses the alt
// "Visitors observing paintings in gallery" for Echoes of Enlightenment;
// the Gallery convention is kept for the canonical record.
// `category` is the Gallery `cat` key, verbatim (the component renders
// it raw, uppercased by CSS; the filter list is all|buddhist|historical|
// thematic|contemporary).
// ---------------------------------------------------------------------------

export interface ExhibitionSeed {
  slug: string;
  title: string;
  locationLabel: string | null;
  /** ISO date (yyyy-mm-dd), split from `dateLabel` — see header note. */
  startsOn: string;
  /** ISO date (yyyy-mm-dd), split from `dateLabel` — see header note. */
  endsOn: string;
  /** Original display string, kept verbatim for exact rendering. */
  dateLabel: string;
  description: string;
  curator: string;
  category: string;
  status: "current" | "past";
  isFeatured: boolean;
  coverAspect: "tall" | "standard";
  image: MuseumImage;
  sortOrder: number;
}

export const EXHIBITIONS: ExhibitionSeed[] = [
  {
    slug: "echoes-of-enlightenment",
    title: "Echoes of Enlightenment",
    locationLabel: "Main Hall",
    startsOn: "2026-03-01",
    endsOn: "2026-11-30",
    dateLabel: "Mar – Nov 2026",
    // D20 flag (preserved verbatim, client to confirm): the description
    // tours Indian sites (Amaravati, Sanchi) for a Nepal museum.
    description: "An immersive journey through Pali Buddhist iconography from Amaravati to Sanchi.",
    curator: "Siddhartha Man Shakya",
    category: "buddhist",
    status: "current",
    isFeatured: true,
    coverAspect: "tall",
    image: {
      url: "https://images.unsplash.com/photo-1569783721854-33a99b4c0bae?w=700&h=933&fit=crop&auto=format&q=80",
      alt: "Echoes of Enlightenment",
    },
    sortOrder: 0,
  },
  {
    slug: "the-silk-road-chronicles",
    title: "The Silk Road Chronicles",
    locationLabel: "East Wing",
    startsOn: "2026-01-01",
    endsOn: "2026-09-30",
    dateLabel: "Jan – Sep 2026",
    description: "Tracing Buddhist iconography along ancient trade routes from Gandhara to Tang China.",
    curator: "Siddhartha Man Shakya",
    category: "historical",
    status: "current",
    isFeatured: false,
    coverAspect: "standard",
    image: {
      url: "https://images.unsplash.com/photo-1775212253782-d223fe035ddc?w=700&h=525&fit=crop&auto=format&q=80",
      alt: "The Silk Road Chronicles",
    },
    sortOrder: 1,
  },
  {
    slug: "feminine-divine",
    title: "Feminine Divine",
    locationLabel: "North Gallery",
    startsOn: "2026-06-01",
    endsOn: "2026-10-31",
    dateLabel: "Jun – Oct 2026",
    description: "Goddess iconography across Buddhist, Jain, and Hindu traditions.",
    curator: "Siddhartha Man Shakya",
    category: "thematic",
    status: "current",
    isFeatured: false,
    coverAspect: "tall",
    image: {
      url: "https://images.unsplash.com/photo-1563000215-e31a8ddcb2d0?w=700&h=933&fit=crop&auto=format&q=80",
      alt: "Feminine Divine",
    },
    sortOrder: 2,
  },
  {
    slug: "sacred-geometries",
    title: "Sacred Geometries",
    locationLabel: null,
    startsOn: "2025-09-01",
    endsOn: "2026-01-31",
    dateLabel: "Sep 2025 – Jan 2026",
    description: "Mandala and yantra traditions across South and Southeast Asia.",
    curator: "Siddhartha Man Shakya",
    category: "thematic",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: {
      url: "https://images.unsplash.com/photo-1735605917461-4c1b77a6616f?w=700&h=525&fit=crop&auto=format&q=80",
      alt: "Sacred Geometries",
    },
    sortOrder: 3,
  },
  {
    slug: "ink-devotion",
    title: "Ink & Devotion",
    locationLabel: null,
    startsOn: "2025-04-01",
    endsOn: "2025-08-31",
    dateLabel: "Apr – Aug 2025",
    description: "Sanskrit manuscript painting from the Pala workshops of Bengal.",
    curator: "Siddhartha Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: {
      url: "https://images.unsplash.com/photo-1765127959724-631190c32e8a?w=700&h=525&fit=crop&auto=format&q=80",
      alt: "Ink & Devotion",
    },
    sortOrder: 4,
  },
  {
    slug: "living-crafts-of-nepal",
    title: "Living Crafts of Nepal",
    locationLabel: "Terrace Gallery",
    startsOn: "2025-01-01",
    endsOn: "2025-05-31",
    dateLabel: "Jan – May 2025",
    description: "Contemporary craftspeople working within inherited regional traditions.",
    curator: "Siddhartha Man Shakya",
    category: "contemporary",
    // ⚠ "current" per Home's framing ("Until Dec 2026") despite the
    // Gallery dates above being in 2025 — see the section header note.
    status: "current",
    isFeatured: false,
    coverAspect: "tall",
    image: {
      url: "https://images.unsplash.com/photo-1605429523419-d828acb941d9?w=700&h=933&fit=crop&auto=format&q=80",
      alt: "Living Crafts of Nepal",
    },
    sortOrder: 5,
  },
  {
    slug: "conversations-in-bronze",
    title: "Conversations in Bronze",
    locationLabel: null,
    startsOn: "2024-10-01",
    endsOn: "2025-02-28",
    dateLabel: "Oct 2024 – Feb 2025",
    description: "Chola bronzes and their twentieth-century resonances.",
    curator: "Siddhartha Man Shakya",
    category: "historical",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: {
      url: "https://images.unsplash.com/photo-1772617616268-a2f27d194fce?w=700&h=525&fit=crop&auto=format&q=80",
      alt: "Conversations in Bronze",
    },
    sortOrder: 6,
  },
  {
    slug: "the-enlightened-eye",
    title: "The Enlightened Eye",
    locationLabel: null,
    startsOn: "2024-03-01",
    endsOn: "2024-07-31",
    dateLabel: "Mar – Jul 2024",
    description: "Contemporary artists responding to Buddhist philosophies of seeing.",
    curator: "Siddhartha Man Shakya",
    category: "contemporary",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: {
      url: "https://images.unsplash.com/photo-1761334859641-139cffff4a47?w=700&h=525&fit=crop&auto=format&q=80",
      alt: "The Enlightened Eye",
    },
    sortOrder: 7,
  },
  {
    slug: "pillars-of-dharma",
    title: "Pillars of Dharma",
    locationLabel: null,
    startsOn: "2023-06-01",
    endsOn: "2023-12-31",
    dateLabel: "Jun – Dec 2023",
    description: "Monumental Buddhist architecture and its rich symbolic language.",
    curator: "Siddhartha Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: {
      url: "https://images.unsplash.com/photo-1759296456443-1cf1a93d173f?w=700&h=933&fit=crop&auto=format&q=80",
      alt: "Pillars of Dharma",
    },
    sortOrder: 8,
  },
];

// ---------------------------------------------------------------------------
// News categories (§7 N2) — seeded from the five `type` values of the
// News page, with their display colours from the component's `typeColor`
// map (mapping §N2: the colours move to `news_categories.colorToken`).
// ---------------------------------------------------------------------------

export interface NewsCategorySeed {
  slug: string;
  name: string;
  /** Tailwind class pair from NewsPage's `typeColor` map, verbatim. */
  colorToken: string;
}

export const NEWS_CATEGORIES: NewsCategorySeed[] = [
  { slug: "news", name: "News", colorToken: "text-amber-700 dark:text-amber-400" },
  { slug: "interview", name: "Interview", colorToken: "text-emerald-700 dark:text-emerald-400" },
  { slug: "feature", name: "Feature", colorToken: "text-blue-700 dark:text-blue-400" },
  { slug: "press-release", name: "Press Release", colorToken: "text-purple-700 dark:text-purple-400" },
  { slug: "review", name: "Review", colorToken: "text-rose-700 dark:text-rose-400" },
];

// ---------------------------------------------------------------------------
// News articles (§3 H7, §7 N2) — canonical set: News page (8 records).
// Home "Latest News" renders the latest three of these.
// `publishedDate` is converted from the display strings ("12 Aug 2026",
// Audit D19) — all eight are full day-month-year strings, so every
// conversion is exact and unambiguous.
// ⚠ Home's copies of articles 2 and 3 carry different titles
// ("…Buddhist Art Scholarship in Nepal"; "…Visitors in First Month") —
// the News page titles below are canonical (§H7: seed from the News
// page's fuller set); Home's variants are NOT carried over.
// `externalUrl` and `image` are null for all current records (§N2: no
// article links or PDFs exist today; the renderer hides those controls
// until the fields are populated).
// ---------------------------------------------------------------------------

export interface NewsArticleSeed {
  slug: string;
  title: string;
  sourceName: string;
  /** ISO date (yyyy-mm-dd), converted from the display string. */
  publishedDate: string;
  summary: string;
  categorySlug: string;
  externalUrl: string | null;
  image: MuseumImage | null;
}

export const NEWS_ARTICLES: NewsArticleSeed[] = [
  {
    slug: "bodhisattva-museum-acquires-rare-3rd-century-mathura-sculpture",
    title: "Bodhisattva Museum Acquires Rare 3rd Century Mathura Sculpture",
    sourceName: "The Hindu",
    publishedDate: "2026-08-12",
    summary: "The museum announced the acquisition of a polished red sandstone Buddha figure from the estate of late collector Shri P.N. Lal — considered one of the finest Mathura school pieces in private hands.",
    categorySlug: "news",
    externalUrl: null,
    image: null,
  },
  {
    slug: "siddhartha-man-shakya-on-the-future-of-buddhist-art-scholarship",
    title: "Siddhartha Man Shakya on the Future of Buddhist Art Scholarship",
    sourceName: "Art Nepal Magazine",
    publishedDate: "2026-08-05",
    summary: "In conversation with our editor, the chief curator discusses how digital technology is democratizing access to ancient art, and why the next decade will be a golden age for South Asian museum scholarship.",
    categorySlug: "interview",
    externalUrl: null,
    image: null,
  },
  {
    slug: "echoes-of-enlightenment-draws-record-40000-visitors-in-opening-month",
    title: "'Echoes of Enlightenment' Draws Record 40,000 Visitors in Opening Month",
    sourceName: "Times of Nepal",
    publishedDate: "2026-07-28",
    summary: "The museum's flagship 2026 exhibition has exceeded attendance projections, prompting an extension through November. Weekend slots are fully booked through September.",
    categorySlug: "press-release",
    externalUrl: null,
    image: null,
  },
  {
    slug: "can-museums-keep-buddhist-art-sacred-a-national-debate",
    title: "Can Museums Keep Buddhist Art Sacred? A National Debate",
    sourceName: "The Wire",
    publishedDate: "2026-07-14",
    summary: "A longform examination of the ethics of displaying sacred objects, drawing on commentary from Bodhisattva Museum's curatorial team and scholars across Nepal and Sri Lanka.",
    categorySlug: "feature",
    externalUrl: null,
    image: null,
  },
  {
    slug: "inside-the-museum-that-believes-art-should-be-free",
    title: "Inside the Museum That Believes Art Should Be Free",
    sourceName: "Mint Lounge",
    publishedDate: "2026-06-02",
    summary: "How the Bodhisattva Foundation's free-entry Sunday policy has transformed who visits Nepal's art institutions — and what other museums could learn.",
    categorySlug: "feature",
    externalUrl: null,
    image: null,
  },
  {
    slug: "bodhisattva-museum-signs-mou-with-nalanda-university",
    title: "Bodhisattva Museum Signs MOU with Nalanda University",
    sourceName: "Hindustan Times",
    publishedDate: "2026-05-20",
    summary: "A landmark research partnership enabling co-curated exhibitions and joint publication of scholarly catalogs on early Buddhist art history.",
    categorySlug: "news",
    externalUrl: null,
    image: null,
  },
  {
    slug: "review-the-silk-road-chronicles-four-stars",
    title: "Review: The Silk Road Chronicles — Four Stars",
    sourceName: "Outlook",
    publishedDate: "2026-04-11",
    summary: "\"A rare exhibition that succeeds in making scholarship viscerally felt. The material culture of faith, compressed across three millennia and two continents, emerges startlingly coherent.\"",
    categorySlug: "review",
    externalUrl: null,
    image: null,
  },
  {
    slug: "museum-launches-free-digital-archive-of-5000-artifacts",
    title: "Museum Launches Free Digital Archive of 5,000 Artifacts",
    sourceName: "NDTV",
    publishedDate: "2026-03-15",
    summary: "All artifact photography and curatorial notes from the permanent collection are now freely available at the museum's new open-access digital library, supporting researchers worldwide.",
    categorySlug: "press-release",
    externalUrl: null,
    image: null,
  },
];

// ---------------------------------------------------------------------------
// Foundation programs (§8 F4) — canonical set: Foundation page.
// `iconName` is the Lucide component name used in the component, as a
// string (mapping §F4); the renderer maps name → component from a
// controlled list.
// ---------------------------------------------------------------------------

export interface FoundationProgramSeed {
  slug: string;
  name: string;
  categoryLabel: string;
  description: string;
  impactMetric: string;
  iconName: string;
  sortOrder: number;
}

export const FOUNDATION_PROGRAMS: FoundationProgramSeed[] = [
  {
    slug: "artreach-schools",
    name: "ArtReach Schools",
    categoryLabel: "Education",
    description: "Bringing art history and studio practice to 200+ government schools across Humla, Dolpa and Manang. We train teachers, supply materials, and run monthly artist residencies.",
    impactMetric: "6,200 students per year",
    iconName: "BookOpen",
    sortOrder: 0,
  },
  {
    slug: "living-craft-fellowship",
    name: "Living Craft Fellowship",
    categoryLabel: "Artist Support",
    description: "Annual grants of Rs.1-4 lakhs to master craftspeople working in endangered traditional forms — Kalamkari, Bidri metalwork, and Thangka painting among them.",
    impactMetric: "42 fellowships awarded",
    iconName: "Award",
    sortOrder: 1,
  },
  {
    slug: "community-museum-visits",
    name: "Community Museum Visits",
    categoryLabel: "Access",
    // D20 flag (preserved verbatim, client to correct): "across NCR" is
    // India-context copy on a Nepal museum's site (mapping §F4).
    description: "Free-of-charge museum access, transportation, and guided tours for schools, NGOs, and community groups from underserved neighbourhoods across NCR.",
    impactMetric: "18,000 visitors facilitated",
    iconName: "Users",
    sortOrder: 2,
  },
  {
    slug: "cultural-preservation-archive",
    name: "Cultural Preservation Archive",
    categoryLabel: "Heritage",
    description: "Documentation and digitization of endangered folk art traditions. Our archive holds 40,000+ high-resolution records, freely accessible to researchers worldwide.",
    impactMetric: "40,000+ records preserved",
    iconName: "Leaf",
    sortOrder: 3,
  },
];

// ---------------------------------------------------------------------------
// Testimonials (§3 H5, §8 F5) — one site-wide pool (mapping §H5): the
// three Foundation grid records (`context: "foundation"`) plus the Home
// curator quote band (`context: "curator"`, display mode
// `single-featured`). Foundation records come first, in on-site order;
// the curator record is appended (it lives on Home, not Foundation).
// Avatar alt text follows the Foundation component, which renders
// `alt={name}`. The curator quote is stored without the typographic
// quotation marks the Home component wraps it in (&ldquo;/&rdquo; are
// presentation, added by the renderer — same convention as the
// foundation quotes, which are stored bare).
// ---------------------------------------------------------------------------

export interface TestimonialSeed {
  quote: string;
  authorName: string;
  authorRole: string;
  context: "foundation" | "curator";
  image: MuseumImage | null;
  sortOrder: number;
}

export const TESTIMONIALS: TestimonialSeed[] = [
  {
    quote: "The fellowship gave me two years to focus solely on Bidri metalwork. My daughter is now learning alongside me — for the first time in four generations, we believe this will continue.",
    authorName: "Meena Gurung",
    authorRole: "Living Craft Fellow, 2024",
    context: "foundation",
    image: {
      url: "https://images.unsplash.com/photo-1592060036126-1b6d5139dea4?w=80&h=80&fit=crop&auto=format&q=80",
      alt: "Meena Gurung",
    },
    sortOrder: 0,
  },
  {
    // D20 flag (preserved verbatim, client to confirm/replace):
    // "Govt. School, Varanasi" is India-context copy (mapping §F5).
    quote: "Before ArtReach, our school had no art teacher and no materials. Now we have a dedicated studio and six students who have applied to arts colleges.",
    authorName: "Sunita Lama",
    authorRole: "Teacher, Govt. School, Varanasi",
    context: "foundation",
    image: {
      url: "https://images.unsplash.com/photo-1708795921259-263a5e973acb?w=80&h=80&fit=crop&auto=format&q=80",
      alt: "Sunita Lama",
    },
    sortOrder: 1,
  },
  {
    quote: "Bringing 80 students to the museum changed something. They saw themselves in the art — the faces, the stories. One girl said, 'This is my history too.'",
    authorName: "Arjun Singh",
    authorRole: "NGO Coordinator, Asha Foundation",
    context: "foundation",
    image: {
      url: "https://images.unsplash.com/photo-1756694915450-50c9796fb96d?w=80&h=80&fit=crop&auto=format&q=80",
      alt: "Arjun Singh",
    },
    sortOrder: 2,
  },
  {
    quote: "Every sculpture here is a question the ancient world poses to our present — and an invitation to answer.",
    authorName: "Siddhartha Man Shakya",
    authorRole: "Chief Curator",
    context: "curator",
    image: null,
    sortOrder: 3,
  },
];
