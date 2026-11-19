/**
 * CMS content seed data — the Phase 3 content migration (CMS_CONTENT_MAPPING.md).
 *
 * Every visible block of the seven existing pages, transcribed VERBATIM from
 * the current components (`src/app/pages/*.tsx`, `src/app/components/Nav.tsx`,
 * `src/app/components/Footer.tsx`) into the section/menu/settings shapes the
 * mapping defines. The lead wires these exports into a seed step; this file
 * is data only.
 *
 * Conventions (per CMS_CONTENT_MAPPING.md §1.1–§1.2 and DATABASE_DESIGN §7):
 *  - Section `type` values are the registry keys of DATABASE_DESIGN §7.4
 *    (`hero | rich_text | image_text | collection_grid | …`), extended with
 *    the three types the mapping proposes in §11.2 (`newsletter_signup`,
 *    `directory`, `partner_list`) — of which only `directory` and
 *    `partner_list` are exercised here.
 *  - `sortOrder` is 0-based, in current top-to-bottom visual order.
 *  - Links are structured objects (§1.1). Because database page ids do not
 *    exist at seed time, page links carry `pageSlug` where the runtime shape
 *    carries `pageId`; the seed step resolves slug → id. Menu items follow
 *    the same rule (`pageSlug` instead of `page_id`).
 *  - Images: the mapping models image fields as `mediaId` references, but
 *    media migration is a later decision (PROJECT_AUDIT BD-2), so image
 *    fields here are `{ url, alt }` objects holding the current Unsplash
 *    URLs — built with the exact dimensions each component requests via
 *    `uimg(id, w, h)` — ready to be swapped for media references later.
 *  - Module-backed sections (collection/exhibition/news grids, foundation
 *    programs, testimonial grids) carry CONFIGURATION ONLY, exactly as the
 *    mapping's schemas specify — the records themselves are seeded from the
 *    museum/foundation module data, never copied into section JSON (§10).
 *  - `design` uses the mapping §1.2 controlled vocabulary, read from the
 *    current Tailwind classes: `bg-secondary` → background "secondary",
 *    `bg-foreground` → "dark", py-24 → spacing "standard", py-28 → "large",
 *    py-14/16 → "compact", max-w-screen-xl → container "wide",
 *    max-w-screen-lg → "narrow". Classes with no vocabulary equivalent
 *    (e.g. py-20 bands, the h-screen hero) leave that field unset.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Structured link (§1.1). `pageSlug` is resolved to a page id at seed time. */
export interface CmsLink {
  kind: "page" | "url";
  pageSlug?: string;
  url?: string;
  label: string;
}

/** A link used as a call-to-action button, with its visual style. */
export interface CmsCtaLink extends CmsLink {
  style: "solid" | "outline";
}

/** An image reference: current Unsplash URL + alt text (see header note). */
export interface CmsImage {
  url: string;
  alt: string;
  /** Per-usage placement (docs/IMAGE_PLACEMENT_EDITOR.md) — mirrors the
   * registry placementSchema; validated again at save time. */
  placement?: {
    fit?: "cover" | "contain";
    desktop: { x: number; y: number; zoom: number };
    tablet?: { x: number; y: number; zoom: number };
    mobile?: { x: number; y: number; zoom: number };
  };
}

/** The mapping §1.2 design vocabulary. */
export interface CmsSectionDesign {
  background?: "default" | "secondary" | "dark";
  spacing?: "standard" | "large" | "compact";
  container?: "wide" | "narrow";
}

// ---------------------------------------------------------------------------
// Section config shapes (one per registry type used by the current site)
// ---------------------------------------------------------------------------

/** Type 1 — Hero banner. Variant per mapping §M1: fullscreen / page-banner / title-band. */
export interface HeroConfig {
  variant: "fullscreen" | "page-banner" | "title-band";
  eyebrow: string;
  /** Single-line heading (page-banner / title-band variants). */
  heading?: string;
  /** Two-part heading (fullscreen variant): roman line + italic accent line. */
  headingLine1?: string;
  headingAccent?: string;
  subtext?: string;
  backgroundImage?: CmsImage;
  primaryCta?: CmsCtaLink;
  secondaryCta?: CmsCtaLink;
  scrollHint?: string;
}

/** Type 2 — Rich text, incl. the `facts` extension (§M2) and two-column variant (§A3). */
export interface RichTextConfig {
  sectionLabel?: string;
  headingLine1?: string;
  headingAccent?: string;
  paragraphs?: string[];
  facts?: { label: string; value: string }[];
  layout?: "two-column statements";
  columns?: { label: string; body: string; emphasis: "display" | "body" }[];
}

/** Type 4 — Image and text, incl. calloutBadge (§H2), stats + collage (§H6), quote (§A2) extensions. */
export interface ImageTextConfig {
  sectionLabel: string;
  headingLine1: string;
  headingAccent: string;
  /** Multi-paragraph body (H2, F3, A2). */
  paragraphs?: string[];
  /** Single-paragraph body (H6, per mapping schema). */
  paragraph?: string;
  cta?: CmsLink;
  image?: CmsImage;
  images?: CmsImage[];
  imageAspect?: string;
  imageMode?: "single" | "collage2";
  calloutBadge?: { value: string; label: string };
  /** H6 only: the three foundation statistics this section displays (§F2). */
  stats?: { value: string; label: string }[];
  quote?: { text: string; attribution: string };
}

/** Type 12 — History timeline (§M3). */
export interface HistoryTimelineConfig {
  sectionLabel: string;
  heading: string;
  items: { yearLabel: string; text: string }[];
}

/** Type 21 — Directory / floor guide (§M5, proposed in mapping §11.2). */
export interface DirectoryConfig {
  sectionLabel: string;
  heading: string;
  groups: { title: string; items: string[] }[];
}

/** Type 15 — CTA (§M6). */
export interface CtaConfig {
  sectionLabel: string;
  heading: string;
  text: string;
  cta: CmsLink;
}

/** Type 11 — Statistics (§F2). Values stay text ("Rs.10L", "1,000+"). */
export interface StatisticsConfig {
  items: { value: string; label: string }[];
}

/** Type 22 — Partner list (§F6, proposed in mapping §11.2). */
export interface PartnerListConfig {
  heading: string;
  items: { name: string; logoImage?: CmsImage; url?: string }[];
}

/** Type 13 — Team members (§A4). `department` is the mapping's field name (component: `dept`). */
export interface TeamMembersConfig {
  sectionLabel: string;
  heading: string;
  members: {
    name: string;
    role: string;
    department: string;
    photo?: CmsImage;
    bio?: string;
  }[];
}

/** Type 14 — Testimonials (§H5 single-featured embedded form; §F5 grid selection). */
export interface TestimonialsConfig {
  sectionLabel: string;
  heading?: string;
  displayMode: "single-featured" | "grid";
  /** Embedded form (schema-sanctioned alternative to a record reference). */
  testimonial?: { quote: string; authorName: string; authorRole: string };
  /** Grid form: which records of the site-wide testimonials pool to render. */
  selection?: string;
}

/**
 * Module-reference configuration for the record-backed grid/listing types
 * (6 Collection grid, 7 Exhibition grid, 9 News listing, 10 Foundation
 * programs). Fields present only where the mapping's per-section schema
 * names them; the records live in the module tables, not here.
 */
export interface ModuleSectionConfig {
  sectionLabel?: string;
  heading?: string;
  selection?: string;
  limit?: number;
  columns?: number;
  layout?: string;
  viewAllLink?: CmsLink;
  filterBy?: string;
  enableYearFilter?: boolean;
  enableCategoryFilter?: boolean;
  enableSearch?: boolean;
  pageSize?: number;
  cardLink?: "none" | "detail-page";
}

/** Type 16 — Contact information (§A5 left). Field values live in site_settings. */
export interface ContactInformationConfig {
  sectionLabel: string;
  heading: string;
  /** The settings group the rows are read from. */
  source: "site_settings";
  /** Ordered settings fields, as rendered: address, openingHours, phone, email, website. */
  fields: string[];
}

/** Type 17 — Contact form (§A5 right). Submissions persist to contact_submissions. */
export interface ContactFormConfig {
  heading: string;
  fields: { name: string; label: string }[];
  subjectOptions: string[];
  submitLabel: string;
}

/** Type 19 — Spacer. Stands in for the empty H8 section (mapping §11.1 note). */
export interface SpacerConfig {
  // Intentionally empty: the current H8 section renders vertical padding only.
}

export type CmsSectionConfig =
  | HeroConfig
  | RichTextConfig
  | ImageTextConfig
  | HistoryTimelineConfig
  | DirectoryConfig
  | CtaConfig
  | StatisticsConfig
  | PartnerListConfig
  | TeamMembersConfig
  | TestimonialsConfig
  | ModuleSectionConfig
  | ContactInformationConfig
  | ContactFormConfig
  | SpacerConfig;

export interface CmsSectionSeed {
  type: string;
  sortOrder: number;
  isVisible: boolean;
  config: CmsSectionConfig;
  design?: CmsSectionDesign;
}

export interface CmsPageSeed {
  slug: string;
  title: string;
  isSystem: true;
  seoTitle?: string;
  metaDescription?: string;
  sections: CmsSectionSeed[];
}

export interface CmsMenuItemSeed {
  label: string;
  linkType: "PAGE" | "EXTERNAL" | "ANCHOR";
  pageSlug?: string;
  url?: string;
  sortOrder: number;
  isVisible: boolean;
}

export interface CmsMenuSeed {
  code: string;
  name: string;
  items: CmsMenuItemSeed[];
}

export interface CmsSettingSeed {
  key: string;
  value: string | string[] | CmsLink;
  isPublic: boolean;
}

// ---------------------------------------------------------------------------
// Site settings — from the site chrome (Nav, Footer) and the A5 contact rows
// (mapping §2, §10 step 1). Only values actually present in the current site.
// (The original design carried no social links; the institution's Instagram
// and Facebook profiles were added as settings in migration 0015.)
// ---------------------------------------------------------------------------

export const CMS_SETTINGS: readonly CmsSettingSeed[] = [
  // Logo text (Nav.tsx): line 1 + tagline line 2 (mapping §2.1).
  { key: "site_name", value: "Bodhisattva", isPublic: true },
  { key: "site_tagline", value: "Museum & Art Gallery", isPublic: true },
  // "Plan Visit" header button → Museum (mapping §2.1).
  {
    key: "plan_visit_link",
    value: { kind: "page", pageSlug: "museum", label: "Plan Visit" },
    isPublic: true,
  },
  // Footer brand block + About A5 rows (identical in both places).
  { key: "contact_address", value: "House No. 91, Diamond Marg, Kupondole, Lalitpur, Nepal", isPublic: true },
  { key: "contact_phone", value: "+977-9818882876", isPublic: true },
  // About A5 only (the footer shows no email).
  { key: "contact_email", value: "info@bodhisattvainternational.com", isPublic: true },
  // Social profiles (added 2026-11-19, migration 0015): the institution's
  // own channels, linked discreetly from the footer. social_youtube is
  // intentionally unset until the official channel URL is confirmed —
  // the footer renders only the profiles that are set.
  { key: "social_instagram", value: "https://www.instagram.com/bodhisattvagallery/", isPublic: true },
  { key: "social_facebook", value: "https://www.facebook.com/BodhisattvaGallery/", isPublic: true },
  { key: "website", value: "www.bodhisattvainternational.com", isPublic: true },
  // Opening hours — real schedule (2026-11-19, migration 0013): the
  // institution's own exhibition posters state gallery/museum hours
  // 12–6, closed Mondays. This replaces the design-stage values, whose
  // two sources contradicted each other (Audit D20).
  { key: "opening_hours_summary", value: "Tue–Sun 12:00pm to 6:00pm", isPublic: true },
  {
    key: "opening_hours",
    value: ["Tue – Sun: 12:00 PM – 6:00 PM", "Monday: Closed"],
    isPublic: true,
  },
  // Footer copyright line, verbatim.
  {
    key: "copyright_text",
    value: "© 2026 Bodhisattva Museum & Art Gallery. All rights reserved.",
    isPublic: true,
  },
];

// ---------------------------------------------------------------------------
// Menus — header navigation + the three footer columns (mapping §2).
// The mobile menu renders the same item list as `primary` in the current
// Nav component, and the mapping defines no separate mobile content, so no
// `mobile` menu is seeded (DATABASE_DESIGN §7.5 reserves the code).
// The footer's three legal spans (Privacy Policy / Terms of Use /
// Accessibility) are inert — they have no link target anywhere in the
// current site — so they are not menu items (mapping §2.2: they need real
// CMS pages or removal).
// ---------------------------------------------------------------------------

export const CMS_MENUS: readonly CmsMenuSeed[] = [
  {
    code: "primary",
    name: "Primary",
    items: [
      { label: "Home", linkType: "PAGE", pageSlug: "home", sortOrder: 0, isVisible: true },
      { label: "Museum", linkType: "PAGE", pageSlug: "museum", sortOrder: 1, isVisible: true },
      { label: "Gallery", linkType: "PAGE", pageSlug: "gallery", sortOrder: 2, isVisible: true },
      { label: "Gift Shop", linkType: "PAGE", pageSlug: "shop", sortOrder: 3, isVisible: true },
      { label: "News Clippings", linkType: "PAGE", pageSlug: "news", sortOrder: 4, isVisible: true },
      { label: "Foundation", linkType: "PAGE", pageSlug: "foundation", sortOrder: 5, isVisible: true },
      { label: "About Us", linkType: "PAGE", pageSlug: "about", sortOrder: 6, isVisible: true },
    ],
  },
  {
    code: "footer_visit",
    name: "Visit",
    items: [
      { label: "Home", linkType: "PAGE", pageSlug: "home", sortOrder: 0, isVisible: true },
      { label: "Museum", linkType: "PAGE", pageSlug: "museum", sortOrder: 1, isVisible: true },
      { label: "Gallery", linkType: "PAGE", pageSlug: "gallery", sortOrder: 2, isVisible: true },
      { label: "Gift Shop", linkType: "PAGE", pageSlug: "shop", sortOrder: 3, isVisible: true },
    ],
  },
  {
    code: "footer_engage",
    name: "Engage",
    items: [
      { label: "Foundation", linkType: "PAGE", pageSlug: "foundation", sortOrder: 0, isVisible: true },
      { label: "News Clippings", linkType: "PAGE", pageSlug: "news", sortOrder: 1, isVisible: true },
      { label: "Membership", linkType: "PAGE", pageSlug: "about", sortOrder: 2, isVisible: true },
      { label: "Events", linkType: "PAGE", pageSlug: "museum", sortOrder: 3, isVisible: true },
    ],
  },
  {
    code: "footer_connect",
    name: "Connect",
    items: [
      { label: "About Us", linkType: "PAGE", pageSlug: "about", sortOrder: 0, isVisible: true },
      { label: "Press Enquiries", linkType: "PAGE", pageSlug: "news", sortOrder: 1, isVisible: true },
      { label: "Research & Loans", linkType: "PAGE", pageSlug: "about", sortOrder: 2, isVisible: true },
      { label: "Contact", linkType: "PAGE", pageSlug: "about", sortOrder: 3, isVisible: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pages — the seven system pages with their sections in visual order.
// Page titles use the navigation labels (the site's canonical page names).
// No seoTitle/metaDescription is seeded: the current site has no per-page
// SEO fields — index.html carries only a design-export title and a generic
// description, which are not per-page content.
// ---------------------------------------------------------------------------

export const CMS_PAGES: readonly CmsPageSeed[] = [
  // -------------------------------------------------------------- Home `/`
  {
    slug: "home",
    title: "Home",
    isSystem: true,
    sections: [
      // H1 — Hero banner (fullscreen).
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "fullscreen",
          eyebrow: "Est. 1980s · Kupondole, Lalitpur · Newa Art",
          headingLine1: "Where Heritage",
          headingAccent: "Meets Eternity",
          subtext:
            "Preserving, elevating and reimagining the sacred artistic traditions of the Kathmandu Valley — paubha, sculpture and repoussé by the masters of Newa art.",
          backgroundImage: {
            url: "/images/pages/home-hero.jpg",
            alt: "A visitor meditating before a monumental deity painting at Purna Museum of Newa Art",
          },
          primaryCta: { kind: "page", pageSlug: "museum", label: "Explore Museum", style: "solid" },
          secondaryCta: { kind: "page", pageSlug: "gallery", label: "View Gallery", style: "outline" },
          scrollHint: "Scroll to discover",
        },
        design: { container: "wide" },
      },
      // H2 — Museum intro ("Our Purpose"), Image and text + calloutBadge.
      {
        type: "image_text",
        sortOrder: 1,
        isVisible: true,
        config: {
          sectionLabel: "Our Purpose",
          headingLine1: "A Living Archive of",
          headingAccent: "Sacred Civilization",
          paragraphs: [
            "Bodhisattva International is a cultural institution in Kupondole, Lalitpur, dedicated to preserving, elevating, and reimagining the sacred artistic traditions of Nepal. Founded in the 1980s by Anjana Shakya and the late Purna Man Shakya, it unites the Purna Museum of Newa Art, Bodhisattva Gallery, the Bodhisattva Foundation, and the Bodhisattva Gift Shop.",
            "We believe that art is not only to be preserved, but lived; not only to be admired, but experienced; and not only to represent culture, but to sustain it.",
          ],
          cta: { kind: "page", pageSlug: "about", label: "Our Story" },
          image: {
            url: "/images/pages/home-intro.jpg",
            alt: "Paubha painting of a goddess by Udaya Charan Shrestha",
          },
          imageAspect: "4:5",
          calloutBadge: { value: "24+", label: "Major Exhibitions" },
        },
        design: { background: "default", spacing: "large", container: "wide" },
      },
      // H3 — Featured Collections: configuration only; records come from
      // the collections module (3 flagged featured, §10 step 3).
      {
        type: "collection_grid",
        sortOrder: 2,
        isVisible: true,
        config: {
          sectionLabel: "Permanent Collection",
          heading: "Featured Collections",
          selection: "featured",
          limit: 3,
          columns: 3,
          viewAllLink: { kind: "page", pageSlug: "museum", label: "View All" },
        },
        design: { background: "secondary", spacing: "standard", container: "wide" },
      },
      // H4 — Current Exhibitions: configuration only; records come from
      // the exhibitions module (current subset, featured first).
      {
        type: "exhibition_grid",
        sortOrder: 3,
        isVisible: true,
        config: {
          sectionLabel: "On View Now",
          selection: "current",
          limit: 4,
          layout: "featured-split",
          viewAllLink: { kind: "page", pageSlug: "gallery", label: "All Exhibitions" },
        },
        design: { background: "default", spacing: "large", container: "wide" },
      },
      // H5 — Curator quote band: Testimonials, single-featured. The mapping
      // recommends referencing a testimonials record; the embedded form
      // below is the schema's sanctioned alternative (the record pool is
      // seeded with the museum module data, §10 step 6).
      {
        type: "testimonials",
        sortOrder: 4,
        isVisible: true,
        config: {
          sectionLabel: "The Valley of Kathmandu",
          displayMode: "single-featured",
          testimonial: {
            quote:
              "No other people on earth has produced such intricate beauty in as small a space as the Valley of Kathmandu.",
            authorName: "Ted Riccardi",
            authorRole: "The Oriental Casebook of Sherlock Holmes (2003)",
          },
        },
        design: { background: "dark", spacing: "standard", container: "narrow" },
      },
      // H6 — Foundation preview: Image and text, collage + embedded stats.
      // The three stats below are a subset of F2's statistics (mapping
      // §H6/§F2), carrying the real Memorial Art Award figures.
      {
        type: "image_text",
        sortOrder: 5,
        isVisible: true,
        config: {
          sectionLabel: "Foundation & CSR",
          headingLine1: "Art as an Act",
          headingAccent: "of Responsibility",
          paragraph:
            "The Bodhisattva Foundation extends the founders' legacy into society — humanitarian work, education, and the nurturing of emerging artists, crowned by the Purna Man Shakya Memorial Art Award.",
          images: [
            {
              url: "/images/pages/home-foundation-1.jpg",
              alt: "Purna Man Shakya Memorial Art Award poster",
            },
            {
              url: "/images/pages/home-foundation-2.jpg",
              alt: "Purna Man Shakya Memorial Art Award poster with the founder's portrait",
            },
          ],
          imageMode: "collage2",
          stats: [
            { value: "3", label: "Award Editions" },
            { value: "Rs.50,000", label: "First Prize" },
            { value: "2023", label: "Award First Presented" },
          ],
          cta: { kind: "page", pageSlug: "foundation", label: "Learn More" },
        },
        design: { background: "default", spacing: "large", container: "wide" },
      },
      // H7 — Latest News: configuration only; records come from the
      // news_articles module (latest 3, §10 step 5).
      {
        type: "news_listing",
        sortOrder: 6,
        isVisible: true,
        config: {
          sectionLabel: "Press & Media",
          heading: "Latest News",
          selection: "latest",
          limit: 3,
          layout: "cards",
          viewAllLink: { kind: "page", pageSlug: "news", label: "All Clippings" },
        },
        design: { background: "secondary", spacing: "standard", container: "wide" },
      },
      // H8 — the current "Newsletter" section is an EMPTY <section> (Audit
      // D7): no heading, input or button exists to migrate, and the
      // proposed Newsletter signup type (mapping §11.2) needs a client
      // decision. A Spacer preserves the rendered page exactly (mapping
      // §11.1, type 19 note).
      {
        type: "spacer",
        sortOrder: 7,
        isVisible: true,
        config: {},
        design: { spacing: "standard", container: "wide" },
      },
    ],
  },

  // ---------------------------------------------------------- Museum `/museum`
  {
    slug: "museum",
    title: "Museum",
    isSystem: true,
    sections: [
      // M1 — Page hero (page-banner variant).
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "page-banner",
          eyebrow: "The Collection",
          heading: "The Museum",
          backgroundImage: {
            url: "/images/pages/museum-banner.jpg",
            alt: "An illuminated paubha deity glowing in the dark shrine room of Purna Museum of Newa Art",
          },
        },
        design: { container: "wide" },
      },
      // M2 — Overview + fact list: Rich text with the `facts` extension.
      {
        type: "rich_text",
        sortOrder: 1,
        isVisible: true,
        config: {
          sectionLabel: "Overview",
          headingLine1: "A Living Archive",
          headingAccent: "of Devotion.",
          paragraphs: [
            "Opened in 2023 with the inaugural exhibition A Collector's Collection, the Purna Museum of Newa Art is a landmark institution and the world's largest private collection dedicated to contemporary traditional Newa art. It was officially inaugurated by Minister of Education, Science and Technology Ashok Rai, UNESCO Representative to Nepal Michael Croft, and Co-Founder of Bodhisattva International Anjana Shakya.",
            "The museum houses the permanent collection of Anjana Shakya and the late Purna Man Shakya, fulfilling his vision of a space where people could experience the finest Newa art in Nepal, without having to travel abroad to see their own heritage. Its collection spans paubha, lost-wax bronze sculpture, repoussé, and miniature art on precious and semi-precious stones.",
          ],
          facts: [
            { label: "Established", value: "2023" },
            { label: "Collection", value: "Anjana & Purna Man Shakya" },
            { label: "Art Forms", value: "Paubha · Bronze · Repoussé · Miniature" },
            { label: "Location", value: "Kupondole, Lalitpur" },
            { label: "Opening Hours", value: "12 PM – 6 PM" },
            { label: "Closed", value: "Mondays" },
          ],
        },
        design: { background: "default", spacing: "standard", container: "wide" },
      },
      // M3 — History timeline.
      {
        type: "history_timeline",
        sortOrder: 2,
        isVisible: true,
        config: {
          sectionLabel: "History",
          heading: "A History of Collecting",
          items: [
            { yearLabel: "1986", text: "Purna Man Shakya begins collecting Newa art — the beginnings of Bodhisattva." },
            { yearLabel: "2011", text: "Jewels of Newar Art at Siddhartha Art Gallery presents the collection to wide acclaim; the Jewels of Newar Art book is launched." },
            { yearLabel: "2019", text: "Bodhisattva Gallery opens its permanent home in Pulchowk, Lalitpur; works from the collection travel to Nepal Art Now at the Weltmuseum Wien." },
            { yearLabel: "2023", text: "Purna Museum of Newa Art opens with A Collector's Collection; the Bodhisattva Foundation establishes the Purna Man Shakya Memorial Art Award." },
            { yearLabel: "2026", text: "10 Years of Celebrating Embodied Enlightenment revisits Samundra Man Singh Shrestha's landmark 2016 retrospective." },
          ],
        },
        design: { background: "secondary", spacing: "standard", container: "wide" },
      },
      // M4 — Explore by Category: configuration only; records + category
      // taxonomy come from the collections module (§10 step 3). The filter
      // buttons are this section's chrome (filterBy), not separate content.
      {
        type: "collection_grid",
        sortOrder: 3,
        isVisible: true,
        config: {
          sectionLabel: "Permanent Collection",
          heading: "Explore by Category",
          selection: "all published",
          filterBy: "collection_category",
          columns: 3,
        },
        design: { background: "default", spacing: "standard", container: "wide" },
      },
      // M5 — Floor directory: Directory type (mapping §11.2). The room
      // names are design-stage inventions; seeded HIDDEN (2026-11-19,
      // migration 0013) until the owner supplies the real floor layout.
      {
        type: "directory",
        sortOrder: 4,
        isVisible: false,
        config: {
          sectionLabel: "Navigation",
          heading: "Interactive Floor Map",
          groups: [
            { title: "Ground Floor", items: ["Entrance Hall", "Gandharan Gallery", "Gift Shop", "Café & Reading Room"] },
            { title: "First Floor", items: ["Buddhist Paintings", "Manuscripts & Textiles", "Numismatics", "Education Centre"] },
            { title: "Second Floor", items: ["Contemporary Wing", "Special Exhibitions", "Research Library", "Rooftop Terrace"] },
          ],
        },
        design: { container: "wide" },
      },
      // M6 — Virtual Tour CTA band. The current button is dead (Audit D6):
      // no tour URL exists anywhere in the site. Per mapping §M6/§12.5 the
      // section is seeded hidden until the client supplies the URL, rather
      // than migrating a broken affordance.
      {
        type: "cta",
        sortOrder: 5,
        isVisible: false,
        config: {
          sectionLabel: "Digital Experience",
          heading: "Take a Virtual Tour",
          text: "Explore all 18 galleries from anywhere in the world. Immersive 360° experience available in 8 languages.",
          cta: { kind: "url", label: "Begin Virtual Tour" },
        },
        design: { background: "dark", container: "wide" },
      },
    ],
  },

  // -------------------------------------------------------- Gallery `/gallery`
  {
    slug: "gallery",
    title: "Gallery",
    isSystem: true,
    sections: [
      // G1 — Page title band.
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "title-band",
          eyebrow: "Archive",
          heading: "Past Exhibitions",
        },
        design: { background: "secondary", container: "wide" },
      },
      // G3 — Exhibition archive: configuration only; records come from the
      // exhibitions module (9 canonical records, §10 step 4). The G2 filter
      // bar is this section's configuration, not a section (mapping §G2);
      // its year/category options are derived from the data at render.
      {
        type: "exhibition_grid",
        sortOrder: 1,
        isVisible: true,
        config: {
          selection: "all published",
          layout: "masonry",
          enableYearFilter: true,
          enableCategoryFilter: true,
          columns: 3,
          cardLink: "none",
        },
        design: { background: "default", spacing: "compact", container: "wide" },
      },
    ],
  },

  // ------------------------------------------------------------ Shop `/shop`
  {
    slug: "shop",
    title: "Gift Shop",
    isSystem: true,
    sections: [
      // S1 — Shop header band. This is the page's ONLY CMS section: the
      // category tabs (S2), product grid (S3) and quick-preview modal (S4)
      // are ecommerce module surface, not page sections (mapping §6). The
      // cart-count badge in the band is cart-module chrome, not content.
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "title-band",
          eyebrow: "Collection Shop",
          heading: "Museum Gift Shop",
        },
        design: { background: "secondary", container: "wide" },
      },
    ],
  },

  // ------------------------------------------------------------ News `/news`
  {
    slug: "news",
    title: "News Clippings",
    isSystem: true,
    sections: [
      // N1 — Header band. The search box rendered inside this band in the
      // component is N2's configuration (enableSearch), not content (§N1).
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "title-band",
          eyebrow: "Press Archive",
          heading: "News Clippings",
        },
        design: { background: "secondary", container: "wide" },
      },
      // N2 — Article listing: configuration only; records come from the
      // news_articles module (8 canonical records, §10 step 5). pageSize 8
      // reproduces the current behaviour of rendering every article at
      // once (mapping §N2).
      {
        type: "news_listing",
        sortOrder: 1,
        isVisible: true,
        config: {
          selection: "all published",
          layout: "rows",
          enableSearch: true,
          pageSize: 8,
        },
        design: { background: "default", container: "wide" },
      },
    ],
  },

  // ------------------------------------------------ Foundation `/foundation`
  {
    slug: "foundation",
    title: "Foundation",
    isSystem: true,
    sections: [
      // F1 — Page hero (page-banner variant).
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "page-banner",
          eyebrow: "Social Responsibility",
          heading: "The Foundation",
          backgroundImage: {
            url: "/images/pages/foundation-banner.jpg",
            alt: "Portrait of Purna Man Shakya, founder of Bodhisattva Gallery, against a dark gold ground",
          },
        },
        design: { container: "wide" },
      },
      // F2 — Impact statistics band: real Memorial Art Award figures
      // (2026-11-19, migration 0013); H6 carries a three-item subset.
      {
        type: "statistics",
        sortOrder: 1,
        isVisible: true,
        config: {
          items: [
            { value: "3", label: "Award Editions Held" },
            { value: "Rs.50,000", label: "First Prize in Each Category" },
            { value: "2", label: "Award Categories — Paubha & Sculpture" },
            { value: "2023", label: "Memorial Award First Presented" },
          ],
        },
        design: { background: "secondary", spacing: "compact", container: "wide" },
      },
      // F3 — Mission: Image and text, standard variant (no badge/stats).
      {
        type: "image_text",
        sortOrder: 2,
        isVisible: true,
        config: {
          sectionLabel: "Our Mission",
          headingLine1: "Art as an Act",
          headingAccent: "of Responsibility",
          paragraphs: [
            "Beyond the realm of art, the Bodhisattva Foundation extends the founders' legacy into society. It is dedicated to humanitarian work, education, and the nurturing of emerging artists. Its most significant initiative is the Purna Man Shakya Memorial Art Award, which honours the founders' philosophy of artistic excellence for both senior and emerging artists.",
            "Beyond his role as a cultural visionary, the late Purna Man Shakya was deeply committed to humanitarian values — supporting children's education, funding medical treatment for those in need, and offering protection and support to individuals during Nepal's periods of political conflict. Today those values live on through the Foundation.",
            "In July 2026, marking the sixth anniversary of Purna Man Shakya's passing, the Bodhisattva family donated NPR 400,005 towards the restoration of Hiranya Varna Mahavihar — the Golden Temple — in Patan.",
          ],
          image: {
            url: "/images/pages/foundation-mission.jpg",
            alt: "Third Purna Man Shakya Memorial Art Award 2025 poster",
          },
          imageAspect: "4:3",
        },
        design: { background: "default", spacing: "standard", container: "wide" },
      },
      // F4 — Programs & Initiatives: configuration only; records come
      // from the foundation_programs module (§10 step 6).
      {
        type: "foundation_programs",
        sortOrder: 3,
        isVisible: true,
        config: {
          sectionLabel: "Our Work",
          heading: "Programs & Initiatives",
          selection: "all published",
          columns: 2,
        },
        design: { background: "secondary", spacing: "standard", container: "wide" },
      },
      // F5 — Testimonials grid: configuration only; records come from the
      // site-wide testimonials pool, tagged context "foundation" (§F5).
      {
        type: "testimonials",
        sortOrder: 4,
        isVisible: true,
        config: {
          sectionLabel: "Voices",
          heading: "Impact in Their Own Words",
          displayMode: "grid",
          selection: "context:foundation",
        },
        design: { background: "default", spacing: "standard", container: "wide" },
      },
      // F6 — Partner organisations strip: Partner list type (§11.2). The
      // current site renders names only — no logos, no links.
      {
        type: "partner_list",
        sortOrder: 5,
        isVisible: true,
        config: {
          heading: "Partner Organizations",
          items: [
            { name: "Weltmuseum Wien" },
            { name: "UNESCO Nepal" },
            { name: "Siddhartha Art Gallery" },
            { name: "Hyatt Regency Kathmandu" },
            { name: "Nepal Art Council" },
            { name: "Embassy of Nepal in China" },
            { name: "Silk Road Cities Alliance" },
            { name: "Lan Gallery, Beijing" },
          ],
        },
        design: { background: "secondary", spacing: "compact", container: "wide" },
      },
    ],
  },

  // ---------------------------------------------------------- About `/about`
  {
    slug: "about",
    title: "About Us",
    isSystem: true,
    sections: [
      // A1 — Page title band.
      {
        type: "hero",
        sortOrder: 0,
        isVisible: true,
        config: {
          variant: "title-band",
          eyebrow: "Who We Are",
          heading: "About Us",
        },
        design: { background: "secondary", container: "wide" },
      },
      // A2 — History + founder quote: Image and text with the `quote`
      // extension. The component renders the image at 16:9 (aspect-video).
      {
        type: "image_text",
        sortOrder: 1,
        isVisible: true,
        config: {
          sectionLabel: "History",
          headingLine1: "Founded in Conviction.",
          headingAccent: "Grown in Purpose.",
          paragraphs: [
            "Bodhisattva International was founded in the 1980s by Anjana Shakya and her late husband Purna Man Shakya, guided by a philosophy they called 'The Art of Living'. What began as a commitment to commissioning and collecting the finest Newa art grew into a family mission: to build a renaissance of contemporary traditional Newa art, made to museum quality rather than for mass production. Purna Man Shakya's collecting had begun in 1986, after he saw treasured Newa works quietly leaving the country.",
            "Through Bodhisattva Gallery, the family has presented more than 24 major exhibitions in Nepal and abroad — from Jewels of Newar Art in Kathmandu to Nepal Art Now at the Weltmuseum Wien — and contributed works to international museum collections. In 2023 the Purna Museum of Newa Art opened in Kupondole, Lalitpur, housing the couple's permanent collection: the world's largest private collection dedicated to contemporary traditional Newa art.",
            "Today Bodhisattva International unites four arms — the Purna Museum of Newa Art, Bodhisattva Gallery, the Bodhisattva Foundation, and the Bodhisattva Gift Shop — preserving sacred knowledge, nurturing artists, and building bridges across generations and geographies.",
            "In December 2025, Director Prajwol Man Shakya was featured in WOW Magazine's 'Collectors with Vision', recognising the family's place among Nepal's new generation of collectors.",
          ],
          image: {
            url: "/images/pages/about-history.jpg",
            alt: "Painted Lakhey mask from the Nepal Art Now exhibition at Weltmuseum Wien",
          },
          imageAspect: "16:9",
          quote: {
            text: "Art is not only to be preserved, but lived; not only to be admired, but experienced; and not only to represent culture, but to sustain it.",
            attribution: "Bodhisattva International",
          },
        },
        design: { background: "default", spacing: "standard", container: "wide" },
      },
      // A3 — Vision / Mission band: Rich text, two-column statements variant.
      {
        type: "rich_text",
        sortOrder: 2,
        isVisible: true,
        config: {
          layout: "two-column statements",
          columns: [
            {
              label: "Our Vision",
              body: "A living civilization, not a static heritage — Newa art that remains active, relevant and deeply rooted in its spiritual origins while engaging with contemporary global culture.",
              emphasis: "display",
            },
            {
              label: "Our Mission",
              body: "To preserve, elevate and reimagine the sacred artistic traditions of the Kathmandu Valley — sustaining art, supporting artists, educating communities, and sharing Nepal's spiritual visual heritage on a global stage.",
              emphasis: "body",
            },
          ],
        },
        design: { background: "secondary", spacing: "compact", container: "wide" },
      },
      // A4 — Team. Real team (2026-11-19, migration 0013): the founders
      // and their sons, from the owner's booklet and documents. (The
      // design-stage component carried placeholder entries — Audit D3.)
      {
        type: "team_members",
        sortOrder: 3,
        isVisible: true,
        config: {
          sectionLabel: "Leadership",
          heading: "The Team",
          members: [
            { name: "Anjana Shakya", role: "Co-Founder", department: "Leadership" },
            { name: "Purna Man Shakya (1962–2020)", role: "Co-Founder", department: "Leadership" },
            { name: "Prajwol Man Shakya", role: "Director", department: "Leadership" },
            { name: "Siddhartha Man Shakya", role: "Curator & Exhibition Designer", department: "Leadership" },
          ],
        },
        design: { background: "default", spacing: "standard", container: "wide" },
      },
      // A5 (left) — Contact information: values are read from
      // site_settings at render (single source shared with the footer,
      // mapping §A5); the section carries only the label/heading and the
      // ordered field list as displayed.
      {
        type: "contact_information",
        sortOrder: 4,
        isVisible: true,
        config: {
          sectionLabel: "Visit & Contact",
          heading: "Get in Touch",
          source: "site_settings",
          fields: ["address", "openingHours", "phone", "email", "website"],
        },
        design: { background: "dark", spacing: "standard", container: "wide" },
      },
      // A5 (right) — Contact form. Field labels are the current input
      // placeholders, verbatim. The mapping schema's successMessage and
      // notifyEmail have no source in the current site (the form discards
      // submissions, Audit D8), so they are deliberately unset here.
      {
        type: "contact_form",
        sortOrder: 5,
        isVisible: true,
        config: {
          heading: "Send a Message",
          fields: [
            { name: "firstName", label: "First Name" },
            { name: "lastName", label: "Last Name" },
            { name: "email", label: "Email Address" },
            { name: "subject", label: "Subject — Select one" },
            { name: "message", label: "Your message…" },
          ],
          subjectOptions: [
            "General Enquiry",
            "Exhibition Information",
            "Foundation / CSR",
            "Press & Media",
            "Membership",
            "Research & Loans",
          ],
          submitLabel: "Send Message",
        },
        design: { background: "dark", spacing: "standard", container: "wide" },
      },
    ],
  },
];
