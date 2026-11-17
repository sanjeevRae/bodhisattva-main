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
// (mapping §2, §10 step 1). Only values actually present in the current site:
// there are NO social links anywhere in the current site, so no social_*
// settings are seeded.
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
  { key: "contact_address", value: "Kupondole, Lalitpur, Nepal", isPublic: true },
  { key: "contact_phone", value: "+977-9818882876", isPublic: true },
  // About A5 only (the footer shows no email).
  { key: "contact_email", value: "info@bodhisattvainternational.com", isPublic: true },
  { key: "website", value: "www.bodhisattvainternational.com", isPublic: true },
  // Opening hours — the two current sources CONTRADICT each other (Audit
  // D20): the footer line implies closed on Saturday only, while the About
  // page says closed on Monday. Both are preserved verbatim in their own
  // keys until the client confirms the real schedule (mapping §2.2, §A5).
  { key: "opening_hours_summary", value: "Sun-Fri 10:00am to 5:00pm", isPublic: true },
  {
    key: "opening_hours",
    value: ["Sun – Fri: 10:00 AM – 5:00 PM", "Monday: Closed"],
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
          eyebrow: "Est. 2000 · Lalitpur, Nepal · 12,400+ Artifacts",
          headingLine1: "Where Heritage",
          headingAccent: "Meets Eternity",
          subtext:
            "Dedicated to preserving and presenting the finest expressions of South Asian art, Buddhist heritage, and contemporary cultural dialogue.",
          backgroundImage: {
            url: "https://images.unsplash.com/photo-1779949437853-d8b00aee936c?w=1920&h=1080&fit=crop&auto=format&q=80",
            alt: "Ancient Buddhist statue in museum gallery",
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
            "Bodhisattva Museum & Art Gallery stands as Nepal's premier institution dedicated to Buddhist art and South Asian cultural heritage. Founded in 2000, we house over 12,000 artifacts spanning three millennia of artistic expression.",
            "We believe that art is not merely an object to be observed, but a living conversation between civilizations — a bridge between the ancient and the contemporary.",
          ],
          cta: { kind: "page", pageSlug: "about", label: "Our Story" },
          image: {
            url: "https://images.unsplash.com/photo-1772617616268-a2f27d194fce?w=800&h=1000&fit=crop&auto=format&q=80",
            alt: "Sculptures in museum gallery with paintings",
          },
          imageAspect: "4:5",
          calloutBadge: { value: "12,400+", label: "Artifacts Preserved" },
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
          sectionLabel: "Curator's Note",
          displayMode: "single-featured",
          testimonial: {
            quote:
              "Every sculpture here is a question the ancient world poses to our present — and an invitation to answer.",
            authorName: "Siddhartha Man Shakya",
            authorRole: "Chief Curator",
          },
        },
        design: { background: "dark", spacing: "standard", container: "narrow" },
      },
      // H6 — Foundation preview: Image and text, collage + embedded stats.
      // The three stats below duplicate F2's statistics (mapping §H6/§F2:
      // single-source them as records at seed time — note the label drift,
      // "Artist Grants" here vs "Artist Grants Disbursed" on Foundation).
      {
        type: "image_text",
        sortOrder: 5,
        isVisible: true,
        config: {
          sectionLabel: "Foundation & CSR",
          headingLine1: "Art as an Act",
          headingAccent: "of Responsibility",
          paragraph:
            "The Bodhisattva Foundation runs 14 active programs across Nepal, nurturing young artists, preserving endangered crafts, and bringing museum access to underserved communities.",
          images: [
            {
              url: "https://images.unsplash.com/photo-1708795921259-263a5e973acb?w=500&h=500&fit=crop&auto=format&q=80",
              alt: "Child painting on canvas",
            },
            {
              url: "https://images.unsplash.com/photo-1756694915450-50c9796fb96d?w=500&h=500&fit=crop&auto=format&q=80",
              alt: "Children painting together outdoors",
            },
          ],
          imageMode: "collage2",
          stats: [
            { value: "14", label: "Active Programs" },
            { value: "1,000+", label: "Students Reached" },
            { value: "Rs.10L", label: "Artist Grants" },
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
            url: "https://images.unsplash.com/photo-1765470129726-3689336ff549?w=1920&h=900&fit=crop&auto=format&q=80",
            alt: "Interior of a grand museum hall",
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
          headingLine1: "Three Floors. Three Millennia.",
          headingAccent: "One Continuous Story.",
          paragraphs: [
            "Spread across 28,000 sq. ft. in the heart of Lalitpur, Bodhisattva Museum houses the subcontinent's most comprehensive permanent collection of Buddhist art. Our galleries trace iconographic development from the pre-Asokan period through the Pala, Gupta, and Vijayanagara empires to the contemporary moment.",
            "The museum is organized around a principle of living dialogue: ancient works are displayed in conversation with contemporary artistic responses, encouraging visitors to see tradition not as a fixed archive but as a generative force.",
          ],
          facts: [
            { label: "Established", value: "2000" },
            { label: "Total Area", value: "28,000 sq.ft." },
            { label: "Artifacts", value: "12,400+" },
            { label: "Annual Visitors", value: "2.1 Million" },
            { label: "Active Galleries", value: "18 Rooms" },
            { label: "Languages", value: "8 Supported" },
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
            { yearLabel: "2000", text: "Founded by Siddhartha Man Shakya with 200 core artifacts in a converted Civil Lines haveli." },
            { yearLabel: "2003", text: "East Wing expansion; landmark Gandharan sculpture collection acquired." },
            { yearLabel: "2009", text: "International partnerships with the British Museum and Freer Gallery established." },
            { yearLabel: "2015", text: "Digital archive and virtual tour platform launched; 5,000 works digitized." },
            { yearLabel: "2022", text: "Contemporary Dialogues wing inaugurated. Foundation reaches 5,000 students." },
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
      // M5 — Floor directory: Directory type (mapping §11.2).
      {
        type: "directory",
        sortOrder: 4,
        isVisible: true,
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
            url: "https://images.unsplash.com/photo-1756694915450-50c9796fb96d?w=1920&h=900&fit=crop&auto=format&q=80",
            alt: "Children painting together in community art program",
          },
        },
        design: { container: "wide" },
      },
      // F2 — Impact statistics band: the canonical four statistics, shared
      // with H6's three-item subset (mapping §F2 — single-source at seed).
      // Verbatim note: the component renders the third value as "RS.10L"
      // (uppercase) here, against "Rs.10L" on Home.
      {
        type: "statistics",
        sortOrder: 1,
        isVisible: true,
        config: {
          items: [
            { value: "14", label: "Active Programs" },
            { value: "1,000+", label: "Students Reached" },
            { value: "RS.10L", label: "Artist Grants Disbursed" },
            { value: "38", label: "Partner Organizations" },
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
            "The Bodhisattva Foundation was established in 2012 as the museum's social responsibility arm. We believe that cultural institutions carry an obligation not only to preserve the past, but to actively shape a more equitable cultural future.",
            "Our work spans four interconnected domains: education, artist support, community access, and cultural preservation — each reflecting the Bodhisattva ideal of compassionate action in the world.",
          ],
          image: {
            url: "https://images.unsplash.com/photo-1708795921259-263a5e973acb?w=800&h=600&fit=crop&auto=format&q=80",
            alt: "Child painting in art education program",
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
            { name: "British Museum" },
            { name: "Freer Gallery — Smithsonian" },
            { name: "Nalanda University" },
            { name: "IGNCA" },
            { name: "UNESCO Nepal" },
            { name: "Nepal Foundation for the Arts" },
            { name: "Aga Khan Trust for Culture" },
            { name: "Tata Trusts" },
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
            "Bodhisattva Museum & Art Gallery was founded in 2000 by Siddhartha Man Shakya, a collector, scholar, and educator who believed Nepal's Buddhist artistic heritage was being underserved by existing cultural institutions. What began with 200 carefully selected objects in a converted haveli in Civil Lines, Lalitpur, has grown into one of Asia's foremost institutions of its kind.",
            "Over nearly three decades, the museum has built deep partnerships with institutions across South and Southeast Asia, Japan, the UK, and the United States — establishing scholarly exchange programs, jointly curated exhibitions, and shared digitization initiatives that have set new standards for the field.",
            "In 2012, the Bodhisattva Foundation was established as the museum's social responsibility arm, extending its mandate from collecting to community-building.",
          ],
          image: {
            url: "https://images.unsplash.com/photo-1765470129726-3689336ff549?w=800&h=450&fit=crop&auto=format&q=80",
            alt: "Grand museum interior",
          },
          imageAspect: "16:9",
          quote: {
            text: "The Bodhisattva is the figure who postpones their own liberation to remain in the world, to serve. Our museum aspires to that same ethic.",
            attribution: "Siddhartha Man Shakya · Co-Founder",
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
              body: "A world where art from every civilization is preserved, understood, and felt as a living inheritance by all people.",
              emphasis: "display",
            },
            {
              label: "Our Mission",
              body: "To collect, preserve, and interpret the artistic heritage of South Asian Buddhist and cultural traditions; to present that heritage through world-class exhibitions and scholarship; and to make art accessible to all communities through education, outreach, and open digital access.",
              emphasis: "body",
            },
          ],
        },
        design: { background: "secondary", spacing: "compact", container: "wide" },
      },
      // A4 — Team. DATA WARNING (Audit D3, mapping §A4): the component's
      // eight entries are placeholders — seven are the same name with
      // different roles — and the mapping directs that they NOT be migrated
      // as-is. Only the one plausible entry (the Co-Founder) is seeded,
      // verbatim; the client must supply the real team before this section
      // is finalised. The seven omitted entries are listed in the Phase 3
      // migration report.
      {
        type: "team_members",
        sortOrder: 3,
        isVisible: true,
        config: {
          sectionLabel: "Leadership",
          heading: "The Team",
          members: [
            { name: "Siddhartha Man Shakya Sharma", role: "Co-Founder", department: "Leadership" },
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
