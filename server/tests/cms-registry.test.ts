/**
 * CMS section registry contract (Phase 3).
 *
 * The registry is the publish gate: every section stored in a draft — and
 * again every section at publish — passes through `validateSection`. The
 * centrepiece test validates EVERY section of the Phase 3 content
 * migration (`seed-data/cms-content.ts`) against the registry: if the
 * seed data and the registry drift apart, this suite fails.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { describe, expect, it } from "vitest";
import { CMS_PAGES } from "../src/database/seed-data/cms-content.js";
import {
  SECTION_TYPES,
  sanitizeRichText,
  validateSection,
} from "../src/modules/cms/registry.js";

describe("cms section registry", () => {
  it("accepts every section of the content-migration seed data", () => {
    let count = 0;
    for (const page of CMS_PAGES) {
      for (const section of page.sections) {
        const result = validateSection(
          section.type,
          section.config,
          section.design,
        );
        expect(result.config).toBeTypeOf("object");
        count += 1;
      }
    }
    // The migration seeds 31 sections across the seven system pages.
    expect(count).toBe(31);
  });

  it("covers every section type exercised by the seed data", () => {
    const used = new Set(
      CMS_PAGES.flatMap((page) => page.sections.map((s) => s.type)),
    );
    for (const type of used) {
      expect(SECTION_TYPES).toContain(type);
    }
    expect(used.size).toBe(17);
  });

  it("rejects an unknown section type", () => {
    expect(() => validateSection("hologram", {})).toThrowError(AppError);
    try {
      validateSection("hologram", {});
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VALIDATION_FAILED");
      expect((err as AppError).details?.[0]?.field).toBe("type");
    }
  });

  it("rejects a config missing a required field", () => {
    // hero requires `eyebrow`.
    expect(() =>
      validateSection("hero", { variant: "fullscreen" }),
    ).toThrowError(AppError);
    try {
      validateSection("hero", { variant: "fullscreen" });
    } catch (err) {
      expect((err as AppError).code).toBe("VALIDATION_FAILED");
      expect(
        (err as AppError).details?.some((d) => d.field === "config.eyebrow"),
      ).toBe(true);
    }
  });

  it("rejects an out-of-vocabulary design value", () => {
    expect(() =>
      validateSection(
        "hero",
        { variant: "title-band", eyebrow: "Archive" },
        { background: "rainbow" },
      ),
    ).toThrowError(AppError);
  });

  it("strips a script payload from rich text at save time", () => {
    const result = validateSection("rich_text", {
      paragraphs: [
        '<p>Hello</p><script>alert("xss")</script><img src=x onerror=alert(1)>',
      ],
    });
    const paragraphs = result.config.paragraphs as string[];
    expect(paragraphs[0]).toContain("<p>Hello</p>");
    expect(paragraphs[0]).not.toContain("<script");
    expect(paragraphs[0]).not.toContain("onerror");
    expect(paragraphs[0]).not.toContain("<img");
  });

  it("sanitises image_text rich text (paragraphs + single paragraph) at save time", () => {
    // Regression guard for the 2026-11-23 bug: image_text rich fields
    // hold TipTap HTML; the sanitizer must keep the formatting (the
    // public RichHtml renderer injects it as HTML) while stripping
    // active payloads — exactly like rich_text.
    const result = validateSection("image_text", {
      sectionLabel: "About",
      headingLine1: "Of Sacred",
      headingAccent: "Civilization",
      paragraphs: [
        '<p>We believe that art is <strong>lived</strong>.</p><script>alert("xss")</script>',
        "<p>Second</p><img src=x onerror=alert(1)>",
      ],
      paragraph:
        '<p>Single <em>paragraph</em></p><a href="javascript:alert(1)">bad</a>',
    });
    const paragraphs = result.config.paragraphs as string[];
    expect(paragraphs[0]).toContain(
      "<p>We believe that art is <strong>lived</strong>.</p>",
    );
    expect(paragraphs[0]).not.toContain("<script");
    expect(paragraphs[1]).toContain("<p>Second</p>");
    expect(paragraphs[1]).not.toContain("onerror");
    expect(paragraphs[1]).not.toContain("<img");
    const single = result.config.paragraph as string;
    expect(single).toContain("<p>Single <em>paragraph</em></p>");
    expect(single).not.toContain("javascript:");
  });

  it("forces rel=noopener noreferrer on target=_blank rich-text links", () => {
    const cleaned = sanitizeRichText(
      '<a href="https://example.com" target="_blank">visit</a>',
    );
    expect(cleaned).toContain('rel="noopener noreferrer"');
    const plain = sanitizeRichText('<a href="https://example.com">visit</a>');
    expect(plain).not.toContain("noopener");
  });

  it("strips javascript: URLs and event handlers from *Html fields", () => {
    const cleaned = sanitizeRichText(
      '<a href="javascript:alert(1)" onclick="alert(2)">click</a>',
    );
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).not.toContain("onclick");
  });

  it("registers the five Phase 4 library types", () => {
    // The full library: 19 specification types (§11.1) + the 3 proposed
    // additions (§11.2). The seed data exercises 17 of the 22.
    for (const type of [
      "image",
      "image_gallery",
      "featured_products",
      "divider",
      "newsletter_signup",
    ]) {
      expect(SECTION_TYPES).toContain(type);
    }
    expect(SECTION_TYPES).toHaveLength(22);
  });

  it("accepts a valid image section", () => {
    const result = validateSection("image", {
      image: { url: "https://example.com/hall.jpg", alt: "Main hall" },
      caption: "The main hall, north wing.",
      link: { kind: "url", url: "https://example.com", label: "More" },
    });
    expect(result.config.caption).toBe("The main hall, north wing.");
  });

  it("accepts and retains image placement (positioning editor)", () => {
    const placement = {
      fit: "cover" as const,
      desktop: { x: 65, y: 40, zoom: 1.15 },
      mobile: { x: 70, y: 35, zoom: 1.3 },
    };
    const result = validateSection("hero", {
      variant: "page-banner",
      eyebrow: "The Museum",
      backgroundImage: {
        url: "https://example.com/shrine.jpg",
        alt: "Illuminated shrine",
        placement,
      },
    });
    const image = (result.config as any).backgroundImage;
    // The parsed config is what gets persisted — placement must survive
    // validation verbatim (zod strips unknown keys by default).
    expect(image.placement).toEqual(placement);
  });

  it("retains placement on gallery list images", () => {
    const result = validateSection("image_gallery", {
      images: [
        {
          url: "https://example.com/a.jpg",
          alt: "A",
          placement: { desktop: { x: 20, y: 80, zoom: 2 } },
        },
        { url: "https://example.com/b.jpg", alt: "B" },
      ],
    });
    const images = (result.config as any).images;
    expect(images[0].placement).toEqual({ desktop: { x: 20, y: 80, zoom: 2 } });
    expect(images[1].placement).toBeUndefined();
  });

  it("retains placement on image_text list images and team photos", () => {
    const placement = { desktop: { x: 30, y: 60, zoom: 1.5 } };
    const collage = validateSection("image_text", {
      sectionLabel: "Visit",
      headingLine1: "Inside",
      headingAccent: "the museum",
      images: [
        { url: "https://example.com/c1.jpg", alt: "C1", placement },
        { url: "https://example.com/c2.jpg", alt: "C2" },
      ],
    });
    const images = (collage.config as any).images;
    expect(images[0].placement).toEqual(placement);
    expect(images[1].placement).toBeUndefined();

    const team = validateSection("team_members", {
      sectionLabel: "People",
      heading: "The team",
      members: [
        {
          name: "Anjana Shakya",
          role: "Director",
          department: "Gallery",
          photo: { url: "https://example.com/p.jpg", alt: "Portrait", placement },
        },
      ],
    });
    expect((team.config as any).members[0].photo.placement).toEqual(placement);
  });

  it("rejects out-of-range placement values", () => {
    const bad = (placement: unknown) => () =>
      validateSection("image", {
        image: { url: "https://example.com/x.jpg", alt: "X", placement },
      });
    expect(bad({ desktop: { x: 101, y: 50, zoom: 1 } })).toThrowError(AppError);
    expect(bad({ desktop: { x: 50, y: -1, zoom: 1 } })).toThrowError(AppError);
    expect(bad({ desktop: { x: 50, y: 50, zoom: 3.5 } })).toThrowError(AppError);
    expect(bad({ desktop: { x: 50, y: 50, zoom: 0.2 } })).toThrowError(AppError);
    expect(bad({ fit: "fill", desktop: { x: 50, y: 50, zoom: 1 } })).toThrowError(AppError);
    expect(bad({ tablet: { x: 50, y: 50, zoom: 1 } })).toThrowError(AppError);
  });

  it("rejects an image section without an image", () => {
    expect(() =>
      validateSection("image", { caption: "No image here." }),
    ).toThrowError(AppError);
    try {
      validateSection("image", { caption: "No image here." });
    } catch (err) {
      expect((err as AppError).code).toBe("VALIDATION_FAILED");
      expect(
        (err as AppError).details?.some((d) => d.field === "config.image"),
      ).toBe(true);
    }
  });

  it("accepts a valid image_gallery section", () => {
    const result = validateSection("image_gallery", {
      sectionLabel: "Gallery",
      heading: "Selected Works",
      images: [
        { url: "https://example.com/a.jpg", alt: "Work A" },
        { url: "https://example.com/b.jpg", alt: "Work B" },
      ],
      columns: 4,
    });
    expect(result.config.columns).toBe(4);
    expect(result.config.images).toHaveLength(2);
  });

  it("rejects an image_gallery with no images", () => {
    expect(() => validateSection("image_gallery", { images: [] })).toThrowError(
      AppError,
    );
    try {
      validateSection("image_gallery", { images: [] });
    } catch (err) {
      expect(
        (err as AppError).details?.some((d) => d.field === "config.images"),
      ).toBe(true);
    }
  });

  it("accepts a valid featured_products section", () => {
    const result = validateSection("featured_products", {
      sectionLabel: "Gift Shop",
      heading: "Featured Products",
      selection: "featured",
      limit: 8,
      viewAllLink: { kind: "page", pageSlug: "shop", label: "View all" },
    });
    expect(result.config.limit).toBe(8);
  });

  it("rejects featured_products with a limit above the curated cap", () => {
    expect(() =>
      validateSection("featured_products", { limit: 25 }),
    ).toThrowError(AppError);
    try {
      validateSection("featured_products", { limit: 25 });
    } catch (err) {
      expect(
        (err as AppError).details?.some((d) => d.field === "config.limit"),
      ).toBe(true);
    }
  });

  it("accepts an empty divider config", () => {
    const result = validateSection("divider", {});
    expect(result.config).toEqual({});
  });

  it("rejects a divider with an out-of-vocabulary design value", () => {
    expect(() =>
      validateSection("divider", {}, { background: "rainbow" }),
    ).toThrowError(AppError);
  });

  it("accepts a valid newsletter_signup section", () => {
    const result = validateSection("newsletter_signup", {
      heading: "Stay in touch",
      text: "Exhibition openings and programme news, once a month.",
      emailPlaceholder: "Email address",
      buttonLabel: "Subscribe",
      successMessage: "Thank you — please check your inbox.",
      privacyNote: "We never share your address.",
    });
    expect(result.config.buttonLabel).toBe("Subscribe");
  });

  it("rejects a newsletter_signup without a button label", () => {
    expect(() =>
      validateSection("newsletter_signup", { heading: "Stay in touch" }),
    ).toThrowError(AppError);
    try {
      validateSection("newsletter_signup", { heading: "Stay in touch" });
    } catch (err) {
      expect(
        (err as AppError).details?.some(
          (d) => d.field === "config.buttonLabel",
        ),
      ).toBe(true);
    }
  });

  it("sanitises declared rich-text paths (columns body)", () => {
    const withColumns = validateSection("rich_text", {
      layout: "two-column statements",
      columns: [
        {
          label: "Vision",
          body: 'Text <script>alert(1)</script><strong>bold</strong>',
          emphasis: "display",
        },
      ],
    });
    const columns = withColumns.config.columns as { body: string }[];
    expect(columns[0]?.body).toBe("Text <strong>bold</strong>");
  });
});
