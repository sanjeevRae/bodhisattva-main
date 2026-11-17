/**
 * CMS section registry (DATABASE_DESIGN.md §7.4, CMS_CONTENT_MAPPING.md
 * §1.1–§1.3, spec §5.3).
 *
 * One Zod schema per section type, for `config` AND for the shared `design`
 * vocabulary (mapping §1.2). `validateSection` is the single gate used on
 * every draft save and again at publish (defence in depth, §7.4): an
 * unknown type or a config that fails its schema can never be stored as a
 * draft, let alone published.
 *
 * Rich text: fields that carry markup are sanitised with sanitize-html at
 * SAVE time (i.e. inside `validateSection`, whose result is what the
 * service persists). Two classes of field are sanitised:
 *  - the declared rich-text paths per type (rich_text paragraphs/columns,
 *    image_text paragraphs/paragraph — the mapping's `richText` fields);
 *  - any string value anywhere in the config whose key ends in `Html`
 *    (the mapping's `bodyHtml` convention), found by a deep walk.
 * The allowlist is formatting-only: no scripts, no event handlers, no
 * `javascript:` URLs, no iframes/embeds.
 *
 * The schemas mirror the shapes in `database/seed-data/cms-content.ts`
 * (the Phase 3 content migration) — the registry contract test validates
 * every seeded section, so drift between the two fails the suite.
 */
import { AppError, type FieldIssue } from "@bodhisattva/shared/errors";
import sanitizeHtml from "sanitize-html";
import { z, type ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// Shared building blocks (mapping §1.1–§1.2)
// ---------------------------------------------------------------------------

/** Structured link (§1.1). Runtime links carry `pageId`; seed data carries
 * `pageSlug` (resolved to an id by the seed step) — both are accepted. */
const linkSchema = z.object({
  kind: z.enum(["page", "url"]),
  pageId: z.number().int().positive().optional(),
  pageSlug: z.string().min(1).optional(),
  url: z.string().max(2000).optional(),
  label: z.string().min(1).max(200),
});

const ctaLinkSchema = linkSchema.extend({
  style: z.enum(["solid", "outline"]),
});

const imageSchema = z.object({
  url: z.string().min(1).max(2000),
  alt: z.string().max(500),
});

const labelValueSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
});

/** The mapping §1.2 design vocabulary — the only design object any section
 * may carry. All fields optional; the object itself is optional. */
export const designSchema = z.object({
  background: z.enum(["default", "secondary", "dark"]).optional(),
  spacing: z.enum(["standard", "large", "compact"]).optional(),
  container: z.enum(["wide", "narrow"]).optional(),
});

// ---------------------------------------------------------------------------
// Per-type config schemas
// ---------------------------------------------------------------------------

const heroConfig = z.object({
  variant: z.enum(["fullscreen", "page-banner", "title-band"]),
  eyebrow: z.string().min(1).max(300),
  heading: z.string().min(1).max(300).optional(),
  headingLine1: z.string().min(1).max(300).optional(),
  headingAccent: z.string().min(1).max(300).optional(),
  subtext: z.string().max(2000).optional(),
  backgroundImage: imageSchema.optional(),
  primaryCta: ctaLinkSchema.optional(),
  secondaryCta: ctaLinkSchema.optional(),
  scrollHint: z.string().max(200).optional(),
});

const richTextConfig = z.object({
  sectionLabel: z.string().min(1).max(200).optional(),
  headingLine1: z.string().min(1).max(300).optional(),
  headingAccent: z.string().min(1).max(300).optional(),
  paragraphs: z.array(z.string().min(1)).max(50).optional(),
  facts: z.array(labelValueSchema).max(50).optional(),
  layout: z.literal("two-column statements").optional(),
  columns: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        body: z.string().min(1),
        emphasis: z.enum(["display", "body"]),
      }),
    )
    .max(10)
    .optional(),
});

const imageTextConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  headingLine1: z.string().min(1).max(300),
  headingAccent: z.string().min(1).max(300),
  paragraphs: z.array(z.string().min(1)).max(50).optional(),
  paragraph: z.string().min(1).optional(),
  cta: linkSchema.optional(),
  image: imageSchema.optional(),
  images: z.array(imageSchema).max(20).optional(),
  imageAspect: z.string().max(50).optional(),
  imageMode: z.enum(["single", "collage2"]).optional(),
  calloutBadge: labelValueSchema.optional(),
  stats: z.array(labelValueSchema).max(20).optional(),
  quote: z
    .object({
      text: z.string().min(1),
      attribution: z.string().min(1).max(300),
    })
    .optional(),
});

/** Configuration-only schema for the module-reference types (mapping §1.3):
 * the records live in the module tables; the section only selects them. */
const moduleSectionConfig = z.object({
  sectionLabel: z.string().min(1).max(200).optional(),
  heading: z.string().min(1).max(300).optional(),
  selection: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(100).optional(),
  columns: z.number().int().positive().max(12).optional(),
  layout: z.string().min(1).max(100).optional(),
  viewAllLink: linkSchema.optional(),
  filterBy: z.string().min(1).max(100).optional(),
  enableYearFilter: z.boolean().optional(),
  enableCategoryFilter: z.boolean().optional(),
  enableSearch: z.boolean().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  cardLink: z.enum(["none", "detail-page"]).optional(),
});

const testimonialsConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  heading: z.string().min(1).max(300).optional(),
  displayMode: z.enum(["single-featured", "grid"]),
  testimonial: z
    .object({
      quote: z.string().min(1),
      authorName: z.string().min(1).max(200),
      authorRole: z.string().min(1).max(200),
    })
    .optional(),
  selection: z.string().min(1).max(200).optional(),
});

const spacerConfig = z.object({});

const historyTimelineConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  heading: z.string().min(1).max(300),
  items: z
    .array(
      z.object({
        yearLabel: z.string().min(1).max(100),
        text: z.string().min(1),
      }),
    )
    .min(1)
    .max(100),
});

const directoryConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  heading: z.string().min(1).max(300),
  groups: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        items: z.array(z.string().min(1).max(300)).min(1).max(100),
      }),
    )
    .min(1)
    .max(50),
});

const ctaConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  heading: z.string().min(1).max(300),
  text: z.string().min(1),
  cta: linkSchema,
});

const statisticsConfig = z.object({
  items: z.array(labelValueSchema).min(1).max(50),
});

const partnerListConfig = z.object({
  heading: z.string().min(1).max(300),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        logoImage: imageSchema.optional(),
        url: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const teamMembersConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  heading: z.string().min(1).max(300),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        role: z.string().min(1).max(200),
        department: z.string().min(1).max(200),
        photo: imageSchema.optional(),
        bio: z.string().max(5000).optional(),
      }),
    )
    .max(200),
});

const contactInformationConfig = z.object({
  sectionLabel: z.string().min(1).max(200),
  heading: z.string().min(1).max(300),
  source: z.literal("site_settings"),
  fields: z.array(z.string().min(1).max(100)).min(1).max(20),
});

const contactFormConfig = z.object({
  heading: z.string().min(1).max(300),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        label: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(30),
  subjectOptions: z.array(z.string().min(1).max(200)).max(50),
  submitLabel: z.string().min(1).max(100),
  successMessage: z.string().max(1000).optional(),
  notifyEmail: z.string().email().max(320).optional(),
});

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "a",
    "ul", "ol", "li", "blockquote", "h2", "h3", "h4",
    "span", "sub", "sup",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    span: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
};

/** Sanitise one rich-text string. Exported for tests. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-walk: sanitise every string whose key ends in `Html` (any depth). */
function sanitizeHtmlKeyedFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeHtmlKeyedFields);
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] =
        typeof child === "string" && /html$/i.test(key)
          ? sanitizeRichText(child)
          : sanitizeHtmlKeyedFields(child);
    }
    return out;
  }
  return value;
}

/** Declared rich-text paths per type (dot paths; `[]` = every array item). */
const RICH_TEXT_PATHS: Record<string, readonly string[]> = {
  rich_text: ["paragraphs[]", "columns[].body"],
  image_text: ["paragraphs[]", "paragraph"],
};

function sanitizeAtPath(
  root: Record<string, unknown>,
  path: string,
): void {
  const segments = path.split(".");
  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || node === undefined) return node;
    const segment = segments[depth];
    const isLast = depth === segments.length - 1;
    if (segment.endsWith("[]")) {
      const key = segment.slice(0, -2);
      if (!isPlainRecord(node)) return node;
      const arr = node[key];
      if (!Array.isArray(arr)) return node;
      node[key] = arr.map((item) =>
        isLast
          ? typeof item === "string"
            ? sanitizeRichText(item)
            : item
          : walk(item, depth + 1),
      );
      return node;
    }
    if (isLast) {
      if (isPlainRecord(node) && typeof node[segment] === "string") {
        node[segment] = sanitizeRichText(node[segment] as string);
      }
      return node;
    }
    if (isPlainRecord(node)) walk(node[segment], depth + 1);
    return node;
  };
  walk(root, 0);
}

/** Sanitise the rich-text fields of a raw config for `type`. */
function sanitizeConfig(
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const copy = sanitizeHtmlKeyedFields(structuredClone(config)) as Record<
    string,
    unknown
  >;
  for (const path of RICH_TEXT_PATHS[type] ?? []) {
    sanitizeAtPath(copy, path);
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Registry + validation entry point
// ---------------------------------------------------------------------------

export const SECTION_SCHEMAS = {
  hero: heroConfig,
  rich_text: richTextConfig,
  image_text: imageTextConfig,
  collection_grid: moduleSectionConfig,
  exhibition_grid: moduleSectionConfig,
  news_listing: moduleSectionConfig,
  foundation_programs: moduleSectionConfig,
  testimonials: testimonialsConfig,
  spacer: spacerConfig,
  history_timeline: historyTimelineConfig,
  directory: directoryConfig,
  cta: ctaConfig,
  statistics: statisticsConfig,
  partner_list: partnerListConfig,
  team_members: teamMembersConfig,
  contact_information: contactInformationConfig,
  contact_form: contactFormConfig,
} as const;

export type SectionType = keyof typeof SECTION_SCHEMAS;

export const SECTION_TYPES = Object.keys(SECTION_SCHEMAS) as SectionType[];

export function isSectionType(value: string): value is SectionType {
  return Object.prototype.hasOwnProperty.call(SECTION_SCHEMAS, value);
}

export interface ValidatedSection {
  config: Record<string, unknown>;
  design: Record<string, unknown> | null;
}

function issuesToFieldIssues(
  prefix: string,
  issues: readonly ZodIssue[],
): FieldIssue[] {
  return issues.map((issue) => ({
    field: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    issue: issue.message,
  }));
}

/**
 * Validate (and sanitise) one section's config + design against the
 * registry. Returns the values to persist — the parsed config with rich
 * text sanitised. Throws AppError VALIDATION_FAILED with per-field details
 * for an unknown type or any schema failure.
 */
export function validateSection(
  type: string,
  config: unknown,
  design?: unknown,
): ValidatedSection {
  if (!isSectionType(type)) {
    throw AppError.validation(
      [{ field: "type", issue: `Unknown section type '${type}'.` }],
      "The submitted data is invalid.",
    );
  }
  if (!isPlainRecord(config)) {
    throw AppError.validation(
      [{ field: "config", issue: "Section config must be an object." }],
      "The submitted data is invalid.",
    );
  }

  const sanitized = sanitizeConfig(type, config);
  const parsedConfig = SECTION_SCHEMAS[type].safeParse(sanitized);
  if (!parsedConfig.success) {
    throw AppError.validation(
      issuesToFieldIssues("config", parsedConfig.error.issues),
      "The submitted data is invalid.",
    );
  }

  let parsedDesign: Record<string, unknown> | null = null;
  if (design !== undefined && design !== null) {
    const parsed = designSchema.safeParse(design);
    if (!parsed.success) {
      throw AppError.validation(
        issuesToFieldIssues("design", parsed.error.issues),
        "The submitted data is invalid.",
      );
    }
    parsedDesign = parsed.data as Record<string, unknown>;
  }

  return {
    config: parsedConfig.data as Record<string, unknown>,
    design: parsedDesign,
  };
}
