/**
 * Unit tests for the SPA share-metadata helpers (src/spa.ts): the
 * escaping, description cleaning, image acceptance and template
 * injection that stand between CMS content and raw HTML served to
 * social crawlers. Pure functions — no database, no server.
 */
import { describe, expect, it } from "vitest";
import {
  buildMetaBlock,
  cleanDescription,
  escapeHtml,
  renderSpaHtml,
  resolveShareImage,
  type SpaMeta,
} from "../src/spa.js";

const ORIGIN = "https://bodhisattvainternational.com";

const TEMPLATE = [
  "<!DOCTYPE html><html><head>",
  "<title>Default Title</title>",
  '<meta name="description" content="Default description." />',
  "<!--OG_START-->",
  '<meta property="og:title" content="Default" />',
  "<!--OG_END-->",
  "</head><body></body></html>",
].join("\n");

describe("escapeHtml", () => {
  it("escapes all five attribute-significant characters", () => {
    expect(escapeHtml(`a & b <c> "d" 'e'`)).toBe(
      "a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;",
    );
  });

  it("strips newlines so a value can never break out of its tag", () => {
    expect(escapeHtml("line one\r\nline two")).toBe("line one line two");
  });
});

describe("cleanDescription", () => {
  it("strips markup and collapses whitespace", () => {
    expect(cleanDescription("<p>Hello <strong>wide</strong></p>\n world")).toBe(
      "Hello wide world",
    );
  });

  it("falls back to the site description when empty", () => {
    expect(cleanDescription("")).toContain("Bodhisattva International");
    expect(cleanDescription(null)).toContain("Bodhisattva International");
  });

  it("truncates long text on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(80).trim();
    const out = cleanDescription(long);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });
});

describe("resolveShareImage", () => {
  it("passes site-relative paths through", () => {
    expect(resolveShareImage("/images/news/x.jpg", ORIGIN)).toBe(
      "/images/news/x.jpg",
    );
  });

  it("accepts absolute URLs on the configured origin only", () => {
    expect(
      resolveShareImage(`${ORIGIN}/images/news/x.jpg`, ORIGIN),
    ).toBe("/images/news/x.jpg");
    expect(
      resolveShareImage("https://evil.example.com/x.jpg", ORIGIN),
    ).toBe("/og-share.jpg");
  });

  it("rejects protocol-relative, javascript: and empty values", () => {
    expect(resolveShareImage("//evil.example.com/x.jpg", ORIGIN)).toBe(
      "/og-share.jpg",
    );
    expect(resolveShareImage("javascript:alert(1)", ORIGIN)).toBe(
      "/og-share.jpg",
    );
    expect(resolveShareImage(null, ORIGIN)).toBe("/og-share.jpg");
    expect(resolveShareImage(undefined, ORIGIN)).toBe("/og-share.jpg");
  });
});

describe("renderSpaHtml", () => {
  const meta: SpaMeta = {
    title: 'Exhibition "Priced at $100" & <Friends>',
    description: "A summary with $& and $1 tokens",
    image: "/images/news/scan.jpg",
    path: "/news/priced-exhibition",
    type: "article",
  };

  it("injects the article's tags with attribute escaping", () => {
    const html = renderSpaHtml(TEMPLATE, meta, ORIGIN);
    expect(html).toContain(
      '<meta property="og:title" content="Exhibition &quot;Priced at $100&quot; &amp; &lt;Friends&gt;" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://bodhisattvainternational.com/images/news/scan.jpg" />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://bodhisattvainternational.com/news/priced-exhibition" />',
    );
    expect(html).toContain(
      "<title>Exhibition &quot;Priced at $100&quot; &amp; &lt;Friends&gt;</title>",
    );
  });

  it("never lets $-replacement tokens corrupt the output", () => {
    const html = renderSpaHtml(TEMPLATE, meta, ORIGIN);
    // The description's literal "$&" and "$1" survive as text (with &
    // escaped), and the template around the injection stays intact.
    expect(html).toContain("A summary with $&amp; and $1 tokens");
    expect(html).toContain("</head><body></body></html>");
    expect(html).not.toContain("<!--OG_START-->");
  });

  it("contains no unescaped script-breaking markup from the title", () => {
    const hostile: SpaMeta = {
      ...meta,
      title: '"><script>alert(1)</script>',
    };
    const html = renderSpaHtml(TEMPLATE, hostile, ORIGIN);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("buildMetaBlock", () => {
  it("adds dimensions only for the default 1200x630 share image", () => {
    const withDefault = buildMetaBlock(
      {
        title: "T",
        description: "D",
        image: "/og-share.jpg",
        path: "/",
        type: "website",
      },
      ORIGIN,
    );
    expect(withDefault).toContain('og:image:width" content="1200"');
    const withArticle = buildMetaBlock(
      {
        title: "T",
        description: "D",
        image: "/images/news/x.jpg",
        path: "/news/x",
        type: "article",
      },
      ORIGIN,
    );
    expect(withArticle).not.toContain("og:image:width");
  });
});
