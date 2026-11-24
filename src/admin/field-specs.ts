/**
 * Inspector field specs — the client-side mirror of the server section
 * registry (server/src/modules/cms/registry.ts, the source of truth).
 *
 * One spec per section type drives the PageEditor property inspector.
 * Paths are dot paths into the section's `config` object; objectList item
 * fields use paths relative to the item. The server re-validates every
 * save against the real Zod schemas, so a spec mistake surfaces as a
 * truthful validation error, never as silently stored bad data.
 */

export type FieldSpec =
  | { kind: "text"; path: string; label: string; placeholder?: string }
  | { kind: "textarea"; path: string; label: string; rows?: number }
  | { kind: "richtext"; path: string; label: string; rows?: number }
  | { kind: "number"; path: string; label: string; min?: number; max?: number }
  | { kind: "select"; path: string; label: string; options: Array<{ value: string | number; label: string }>; allowUnset?: boolean }
  | { kind: "checkbox"; path: string; label: string }
  | { kind: "link"; path: string; label: string; withStyle?: boolean }
  | { kind: "image"; path: string; label: string }
  | { kind: "object"; path: string; label: string; fields: FieldSpec[] }
  | { kind: "stringList"; path: string; label: string; itemLabel: string }
  | { kind: "richtextList"; path: string; label: string; itemLabel: string }
  | { kind: "imageList"; path: string; label: string }
  | { kind: "objectList"; path: string; label: string; itemLabel: string; fields: FieldSpec[]; newItem: () => Record<string, any> }
  | { kind: "groups"; path: string; label: string };

export interface SectionSpec {
  type: string;
  name: string;
  description: string;
  fields: FieldSpec[];
  /** Shown above the form (module-reference types, site-settings data…). */
  note?: string;
  /** For module-backed sections: where the records themselves are edited. */
  moduleLink?: { to: string; label: string };
  defaultConfig: () => Record<string, any>;
}

const labelValueFields: FieldSpec[] = [
  { kind: "text", path: "label", label: "Label" },
  { kind: "text", path: "value", label: "Value" },
];

const moduleFields: FieldSpec[] = [
  { kind: "text", path: "sectionLabel", label: "Section label" },
  { kind: "text", path: "heading", label: "Heading" },
  { kind: "text", path: "selection", label: "Selection", placeholder: "e.g. featured, current, latest" },
  { kind: "number", path: "limit", label: "Limit", min: 1, max: 100 },
  { kind: "number", path: "columns", label: "Columns", min: 1, max: 12 },
  { kind: "text", path: "layout", label: "Layout variant" },
  { kind: "link", path: "viewAllLink", label: "View-all link" },
  { kind: "text", path: "filterBy", label: "Filter taxonomy" },
  { kind: "checkbox", path: "enableYearFilter", label: "Enable year filter" },
  { kind: "checkbox", path: "enableCategoryFilter", label: "Enable category filter" },
  { kind: "checkbox", path: "enableSearch", label: "Enable search" },
  { kind: "number", path: "pageSize", label: "Page size", min: 1, max: 100 },
  {
    kind: "select",
    path: "cardLink",
    label: "Card link",
    allowUnset: true,
    options: [
      { value: "none", label: "None" },
      { value: "detail-page", label: "Detail page" },
    ],
  },
];

const moduleNote =
  "This section selects records managed in its own module — only its presentation is edited here. The public page renders the module's current records.";

const moduleDefault = (label: string, heading: string) => () => ({
  sectionLabel: label,
  heading,
});

/** Placeholder image used for new image-bearing sections (same Unsplash
 * source the seeded content uses); replace it from the media library. */
export const PLACEHOLDER_IMAGE = {
  url: "https://images.unsplash.com/photo-1779949437853-d8b00aee936c?w=1600&h=1000&fit=crop&auto=format&q=80",
  alt: "",
};

export const SECTION_SPECS: Record<string, SectionSpec> = {
  hero: {
    type: "hero",
    name: "Hero banner",
    description: "Full-screen, page-banner or title-band header with headline and calls to action.",
    fields: [
      {
        kind: "select",
        path: "variant",
        label: "Variant",
        options: [
          { value: "fullscreen", label: "Fullscreen" },
          { value: "page-banner", label: "Page banner" },
          { value: "title-band", label: "Title band" },
        ],
      },
      { kind: "text", path: "eyebrow", label: "Eyebrow" },
      { kind: "text", path: "heading", label: "Heading (banner / title band)" },
      { kind: "text", path: "headingLine1", label: "Heading line 1 (fullscreen)" },
      { kind: "text", path: "headingAccent", label: "Heading accent (fullscreen)" },
      { kind: "textarea", path: "subtext", label: "Subtext", rows: 3 },
      { kind: "image", path: "backgroundImage", label: "Background image" },
      { kind: "link", path: "primaryCta", label: "Primary button", withStyle: true },
      { kind: "link", path: "secondaryCta", label: "Secondary button", withStyle: true },
      { kind: "text", path: "scrollHint", label: "Scroll hint" },
    ],
    defaultConfig: () => ({ variant: "title-band", eyebrow: "Eyebrow", heading: "New heading" }),
  },

  rich_text: {
    type: "rich_text",
    name: "Rich text",
    description: "Headings, paragraphs, an optional fact list, or two-column Vision/Mission statements.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "headingLine1", label: "Heading line 1" },
      { kind: "text", path: "headingAccent", label: "Heading accent" },
      {
        kind: "select",
        path: "layout",
        label: "Layout",
        allowUnset: true,
        options: [{ value: "two-column statements", label: "Two-column statements" }],
      },
      { kind: "richtextList", path: "paragraphs", label: "Paragraphs", itemLabel: "Paragraph" },
      {
        kind: "objectList",
        path: "facts",
        label: "Facts",
        itemLabel: "Fact",
        fields: labelValueFields,
        newItem: () => ({ label: "", value: "" }),
      },
      {
        kind: "objectList",
        path: "columns",
        label: "Statement columns",
        itemLabel: "Column",
        fields: [
          { kind: "text", path: "label", label: "Label" },
          { kind: "richtext", path: "body", label: "Body", rows: 4 },
          {
            kind: "select",
            path: "emphasis",
            label: "Emphasis",
            options: [
              { value: "display", label: "Display (large)" },
              { value: "body", label: "Body" },
            ],
          },
        ],
        newItem: () => ({ label: "", body: "", emphasis: "body" }),
      },
    ],
    defaultConfig: () => ({ sectionLabel: "Label", headingLine1: "Heading", paragraphs: ["New paragraph."] }),
  },

  image_text: {
    type: "image_text",
    name: "Image and text",
    description: "Image beside text, with optional badge, statistics, quote or call to action.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "headingLine1", label: "Heading line 1" },
      { kind: "text", path: "headingAccent", label: "Heading accent" },
      { kind: "richtextList", path: "paragraphs", label: "Paragraphs", itemLabel: "Paragraph" },
      { kind: "richtext", path: "paragraph", label: "Single paragraph", rows: 4 },
      { kind: "link", path: "cta", label: "Call to action" },
      { kind: "image", path: "image", label: "Image" },
      { kind: "imageList", path: "images", label: "Images (collage)" },
      {
        kind: "select",
        path: "imageMode",
        label: "Image mode",
        allowUnset: true,
        options: [
          { value: "single", label: "Single image" },
          { value: "collage2", label: "Two-image collage" },
        ],
      },
      { kind: "text", path: "imageAspect", label: "Image aspect", placeholder: "4:5, 4:3, 16:9…" },
      {
        kind: "object",
        path: "calloutBadge",
        label: "Callout badge",
        fields: labelValueFields,
      },
      {
        kind: "objectList",
        path: "stats",
        label: "Statistics row",
        itemLabel: "Statistic",
        fields: labelValueFields,
        newItem: () => ({ label: "", value: "" }),
      },
      {
        kind: "object",
        path: "quote",
        label: "Quote card",
        fields: [
          { kind: "textarea", path: "text", label: "Quote", rows: 3 },
          { kind: "text", path: "attribution", label: "Attribution" },
        ],
      },
    ],
    defaultConfig: () => ({
      sectionLabel: "Label",
      headingLine1: "Heading",
      headingAccent: "Accent",
      paragraphs: ["New paragraph."],
    }),
  },

  collection_grid: {
    type: "collection_grid",
    name: "Collection grid",
    description: "Grid of museum collections, selected from the collections module.",
    fields: moduleFields,
    note: moduleNote,
    moduleLink: { to: "/admin/collections", label: "Collections" },
    defaultConfig: moduleDefault("Collections", "Featured collections"),
  },

  exhibition_grid: {
    type: "exhibition_grid",
    name: "Exhibition grid",
    description: "Exhibitions from the exhibitions module, featured-split or masonry archive.",
    fields: moduleFields,
    note: moduleNote,
    moduleLink: { to: "/admin/exhibitions", label: "Exhibitions" },
    defaultConfig: moduleDefault("Exhibitions", "Current exhibitions"),
  },

  news_listing: {
    type: "news_listing",
    name: "News listing",
    description: "News articles from the news module, as cards or rows.",
    fields: moduleFields,
    note: moduleNote,
    moduleLink: { to: "/admin/news", label: "News Clippings" },
    defaultConfig: moduleDefault("News", "Latest news"),
  },

  foundation_programs: {
    type: "foundation_programs",
    name: "Foundation programs",
    description: "Foundation programs from the foundation module.",
    fields: moduleFields,
    note: moduleNote,
    moduleLink: { to: "/admin/foundation", label: "Foundation" },
    defaultConfig: moduleDefault("Foundation", "Programs & initiatives"),
  },

  featured_products: {
    type: "featured_products",
    name: "Featured products",
    description: "A curated set of shop products (records live in the ecommerce module).",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "text", path: "selection", label: "Selection", placeholder: "e.g. featured" },
      { kind: "number", path: "limit", label: "Limit", min: 1, max: 24 },
      { kind: "link", path: "viewAllLink", label: "View-all link" },
    ],
    note: moduleNote,
    moduleLink: { to: "/admin/products", label: "Products" },
    defaultConfig: () => ({ sectionLabel: "Shop", heading: "Featured products" }),
  },

  testimonials: {
    type: "testimonials",
    name: "Testimonials",
    description: "A single featured quote or a grid, from the testimonials pool.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      {
        kind: "select",
        path: "displayMode",
        label: "Display mode",
        options: [
          { value: "single-featured", label: "Single featured" },
          { value: "grid", label: "Grid" },
        ],
      },
      { kind: "text", path: "selection", label: "Selection (grid mode)" },
      {
        kind: "object",
        path: "testimonial",
        label: "Featured testimonial (single mode)",
        fields: [
          { kind: "textarea", path: "quote", label: "Quote", rows: 4 },
          { kind: "text", path: "authorName", label: "Author name" },
          { kind: "text", path: "authorRole", label: "Author role" },
        ],
      },
    ],
    defaultConfig: () => ({ sectionLabel: "Testimonials", displayMode: "grid" }),
  },

  image: {
    type: "image",
    name: "Image",
    description: "A single full-width image with optional caption and link.",
    fields: [
      { kind: "image", path: "image", label: "Image" },
      { kind: "text", path: "caption", label: "Caption" },
      { kind: "link", path: "link", label: "Link" },
    ],
    defaultConfig: () => ({ image: { ...PLACEHOLDER_IMAGE } }),
  },

  image_gallery: {
    type: "image_gallery",
    name: "Image gallery",
    description: "A grid of images in two, three or four columns.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "imageList", path: "images", label: "Images" },
      {
        kind: "select",
        path: "columns",
        label: "Columns",
        allowUnset: true,
        options: [
          { value: 2, label: "2" },
          { value: 3, label: "3" },
          { value: 4, label: "4" },
        ],
      },
    ],
    defaultConfig: () => ({ heading: "Gallery", images: [{ ...PLACEHOLDER_IMAGE }] }),
  },

  history_timeline: {
    type: "history_timeline",
    name: "History timeline",
    description: "A horizontal timeline of dated events.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      {
        kind: "objectList",
        path: "items",
        label: "Events",
        itemLabel: "Event",
        fields: [
          { kind: "text", path: "yearLabel", label: "Year label" },
          { kind: "textarea", path: "text", label: "Text", rows: 3 },
        ],
        newItem: () => ({ yearLabel: "2000", text: "" }),
      },
    ],
    defaultConfig: () => ({
      sectionLabel: "History",
      heading: "Our history",
      items: [{ yearLabel: "2000", text: "New event." }],
    }),
  },

  directory: {
    type: "directory",
    name: "Directory / floor guide",
    description: "Grouped lists, e.g. floors and their rooms.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "groups", path: "groups", label: "Groups" },
    ],
    defaultConfig: () => ({
      sectionLabel: "Directory",
      heading: "Directory",
      groups: [{ title: "Ground floor", items: ["Room 1"] }],
    }),
  },

  cta: {
    type: "cta",
    name: "Call to action",
    description: "A band with heading, text and one button.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "textarea", path: "text", label: "Text", rows: 3 },
      { kind: "link", path: "cta", label: "Button" },
    ],
    defaultConfig: () => ({
      sectionLabel: "Visit",
      heading: "Plan your visit",
      text: "New call to action.",
      cta: { kind: "page", label: "Learn more" },
    }),
  },

  statistics: {
    type: "statistics",
    name: "Statistics",
    description: "A row of value/label figures.",
    fields: [
      {
        kind: "objectList",
        path: "items",
        label: "Statistics",
        itemLabel: "Statistic",
        fields: labelValueFields,
        newItem: () => ({ label: "", value: "" }),
      },
    ],
    defaultConfig: () => ({ items: [{ label: "Visitors", value: "0" }] }),
  },

  partner_list: {
    type: "partner_list",
    name: "Partner list",
    description: "Partner organisations, as names with optional logo and link.",
    fields: [
      { kind: "text", path: "heading", label: "Heading" },
      {
        kind: "objectList",
        path: "items",
        label: "Partners",
        itemLabel: "Partner",
        fields: [
          { kind: "text", path: "name", label: "Name" },
          { kind: "text", path: "url", label: "Website URL" },
          { kind: "image", path: "logoImage", label: "Logo" },
        ],
        newItem: () => ({ name: "" }),
      },
    ],
    defaultConfig: () => ({ heading: "Our partners", items: [{ name: "Partner" }] }),
  },

  team_members: {
    type: "team_members",
    name: "Team members",
    description: "Team grid with initials tiles or photos.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      {
        kind: "objectList",
        path: "members",
        label: "Members",
        itemLabel: "Member",
        fields: [
          { kind: "text", path: "name", label: "Name" },
          { kind: "text", path: "role", label: "Role" },
          { kind: "text", path: "department", label: "Department" },
          { kind: "image", path: "photo", label: "Photo" },
          { kind: "textarea", path: "bio", label: "Bio", rows: 3 },
        ],
        newItem: () => ({ name: "", role: "", department: "" }),
      },
    ],
    defaultConfig: () => ({ sectionLabel: "Team", heading: "The team", members: [] }),
  },

  contact_information: {
    type: "contact_information",
    name: "Contact information",
    description: "Address, hours, phone and email — values come from Site Settings.",
    fields: [
      { kind: "text", path: "sectionLabel", label: "Section label" },
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "stringList", path: "fields", label: "Setting fields to show", itemLabel: "Field name" },
    ],
    note: "The values themselves live in Admin → Settings (this section only chooses which site-setting fields to display). The data source is fixed to site_settings.",
    defaultConfig: () => ({
      sectionLabel: "Visit",
      heading: "Visit us",
      source: "site_settings",
      fields: ["address"],
    }),
  },

  contact_form: {
    type: "contact_form",
    name: "Contact form",
    description: "The enquiry form rendered beside the contact information.",
    fields: [
      { kind: "text", path: "heading", label: "Heading" },
      {
        kind: "objectList",
        path: "fields",
        label: "Form fields",
        itemLabel: "Field",
        fields: [
          { kind: "text", path: "name", label: "Field name" },
          { kind: "text", path: "label", label: "Label" },
        ],
        newItem: () => ({ name: "", label: "" }),
      },
      { kind: "stringList", path: "subjectOptions", label: "Subject options", itemLabel: "Subject" },
      { kind: "text", path: "submitLabel", label: "Submit button label" },
      { kind: "textarea", path: "successMessage", label: "Success message", rows: 2 },
      { kind: "text", path: "notifyEmail", label: "Notification email" },
    ],
    defaultConfig: () => ({
      heading: "Send a message",
      fields: [{ name: "email", label: "Email" }],
      subjectOptions: [],
      submitLabel: "Send",
    }),
  },

  newsletter_signup: {
    type: "newsletter_signup",
    name: "Newsletter signup",
    description: "An email capture band (submissions store arrives in a later phase).",
    fields: [
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "textarea", path: "text", label: "Text", rows: 3 },
      { kind: "text", path: "emailPlaceholder", label: "Email placeholder" },
      { kind: "text", path: "buttonLabel", label: "Button label" },
      { kind: "textarea", path: "successMessage", label: "Success message", rows: 2 },
      { kind: "textarea", path: "privacyNote", label: "Privacy note", rows: 2 },
    ],
    defaultConfig: () => ({ heading: "Stay in touch", buttonLabel: "Subscribe" }),
  },

  spacer: {
    type: "spacer",
    name: "Spacer",
    description: "Vertical breathing room between sections.",
    fields: [],
    note: "A spacer has no content fields — use the Design group below to vary its band.",
    defaultConfig: () => ({}),
  },

  divider: {
    type: "divider",
    name: "Divider",
    description: "A horizontal rule separating sections.",
    fields: [],
    note: "A divider has no content fields — use the Design group below to vary its band.",
    defaultConfig: () => ({}),
  },

  under_construction: {
    type: "under_construction",
    name: "Under construction",
    description: "A centred 'site under construction' notice with the crane illustration — for pages that are not ready yet.",
    fields: [
      { kind: "text", path: "eyebrow", label: "Eyebrow" },
      { kind: "text", path: "heading", label: "Heading" },
      { kind: "textarea", path: "message", label: "Message", rows: 3 },
      { kind: "image", path: "image", label: "Illustration (optional — the crane animation is used when empty)" },
    ],
    defaultConfig: () => ({
      eyebrow: "Bodhisattva International",
      heading: "Site Under Construction",
      message: "We are building something beautiful. The full website is on its way.",
    }),
  },
};

/** The design vocabulary (registry designSchema) edited for every type. */
export const DESIGN_FIELDS: FieldSpec[] = [
  {
    kind: "select",
    path: "background",
    label: "Background",
    allowUnset: true,
    options: [
      { value: "default", label: "Default" },
      { value: "secondary", label: "Cream band" },
      { value: "dark", label: "Dark band" },
    ],
  },
  {
    kind: "select",
    path: "spacing",
    label: "Spacing",
    allowUnset: true,
    options: [
      { value: "standard", label: "Standard" },
      { value: "large", label: "Large" },
      { value: "compact", label: "Compact" },
    ],
  },
  {
    kind: "select",
    path: "container",
    label: "Container",
    allowUnset: true,
    options: [
      { value: "wide", label: "Wide" },
      { value: "narrow", label: "Narrow" },
    ],
  },
];

export const SECTION_TYPES = Object.keys(SECTION_SPECS);

/** Short human summary of a section for the navigator list. */
export function sectionSummary(config: Record<string, any>): string {
  const candidate =
    config.heading ??
    config.headingLine1 ??
    config.eyebrow ??
    config.sectionLabel ??
    config.items?.[0]?.name ??
    config.items?.[0]?.label ??
    "";
  return typeof candidate === "string" ? candidate : "";
}
