/**
 * Policy pages unit tests (legal pages feature, 2026-11-20):
 *  - sanitizePolicyHtml: the dedicated policy sanitizer — stricter
 *    than the CMS one (no span classes, media-only images removed
 *    whole when the source is wrong, _blank links always gain
 *    noopener noreferrer), and idempotent.
 *  - slug helpers: the public page's TOC ids are built from heading
 *    TEXT only, restricted alphabet, duplicates deduped.
 */
import { describe, expect, it } from "vitest";
import { sanitizePolicyHtml } from "../src/modules/policies/sanitize.js";
import { buildHeadingIds, slugifyHeading } from "../../src/app/lib/slug.js";

describe("sanitizePolicyHtml", () => {
  it("keeps ordinary policy markup", () => {
    const html =
      '<h2>Who we are</h2><p>We <strong>collect</strong> <em>some</em> data.</p><ul><li>One</li><li>Two</li></ul><blockquote><p>Note</p></blockquote>';
    expect(sanitizePolicyHtml(html)).toBe(html);
  });

  it("strips script, iframe, object, style elements and event handlers", () => {
    const dirty =
      '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://evil.example"></iframe><object data="x"></object><style>body{display:none}</style><p onmouseover="x()">Yo</p>';
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<object");
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onmouseover");
    expect(clean).toContain("<p>Hi</p>");
    expect(clean).toContain("<p>Yo</p>");
  });

  it("strips javascript:, data: and protocol-relative link targets", () => {
    const clean = sanitizePolicyHtml(
      '<a href="javascript:alert(1)">a</a><a href="data:text/html;base64,AAAA">b</a><a href="//evil.example/x">c</a><a href="https://example.com/ok">d</a><a href="/museum">e</a><a href="mailto:info@example.com">f</a>',
    );
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("data:text");
    expect(clean).not.toContain("//evil.example");
    expect(clean).toContain('href="https://example.com/ok"');
    expect(clean).toContain('href="/museum"');
    expect(clean).toContain('href="mailto:info@example.com"');
  });

  it("forces rel=noopener noreferrer on target=_blank links and drops odd targets", () => {
    const clean = sanitizePolicyHtml(
      '<a href="https://example.com" target="_blank" rel="opener">x</a><a href="https://example.com" target="popup">y</a>',
    );
    expect(clean).toContain('target="_blank" rel="noopener noreferrer"');
    expect(clean).not.toContain('rel="opener"');
    expect(clean).not.toContain('target="popup"');
  });

  it("removes images whose source is not an exact media-library URL", () => {
    const bad = [
      '<img src="https://evil.example/x.png" alt="x">',
      '<img src="data:image/png;base64,AAAA" alt="x">',
      '<img src="//cdn.example/x.png" alt="x">',
      '<img src="/api/media/4/file/master?dl=1" alt="x">',
      '<img src="/api/media/4/file/master#frag" alt="x">',
      '<img src="/api/media/4/file/thumb" alt="x">',
      '<img src="/api/media/0/file/master" alt="x">',
      '<img src="/other/path.png" alt="x">',
      '<img alt="no source">',
    ];
    for (const html of bad) {
      expect(sanitizePolicyHtml(`<p>a</p>${html}<p>b</p>`), html).not.toContain("<img");
    }
  });

  it("keeps media-library images with their alt text", () => {
    // sanitize-html serialises void elements self-closed; the src and
    // alt survive untouched.
    const clean = sanitizePolicyHtml(
      '<p>a</p><img src="/api/media/12/file/master" alt="Gallery hall"><p>b</p>',
    );
    expect(clean).toContain('<img src="/api/media/12/file/master" alt="Gallery hall" />');
    const original = sanitizePolicyHtml('<img src="/api/media/3/file/original" alt="Scan">');
    expect(original).toContain('<img src="/api/media/3/file/original" alt="Scan" />');
  });

  it("drops span classes (allowed by the CMS sanitizer, not here)", () => {
    const clean = sanitizePolicyHtml('<p><span class="fixed inset-0">text</span></p>');
    expect(clean).toBe("<p><span>text</span></p>");
  });

  it("strips style attributes everywhere", () => {
    const clean = sanitizePolicyHtml('<p style="position:fixed;inset:0">x</p>');
    expect(clean).toBe("<p>x</p>");
  });

  it("is idempotent: sanitize(sanitize(x)) === sanitize(x)", () => {
    const dirty =
      '<h2 onclick="x()">Head</h2><p><a href="https://example.com" target="_blank">l</a><img src="https://evil.example/a.png"><img src="/api/media/7/file/master" alt="ok"><span class="c">s</span></p><script>bad</script>';
    const once = sanitizePolicyHtml(dirty);
    expect(sanitizePolicyHtml(once)).toBe(once);
  });
});

describe("slug helpers", () => {
  it("slugifies heading text to a restricted alphabet", () => {
    expect(slugifyHeading("Information We Collect")).toBe("information-we-collect");
    expect(slugifyHeading("Prices & Payment!")).toBe("prices-payment");
    expect(slugifyHeading("  Café — déjà vu  ")).toBe("cafe-deja-vu");
    expect(slugifyHeading("")).toBe("section");
    expect(slugifyHeading("!!!")).toBe("section");
  });

  it("builds prefixed, deduped ids in order", () => {
    expect(
      buildHeadingIds(["Overview", "Details", "Overview", "Overview"], "policy-section-"),
    ).toEqual([
      "policy-section-overview",
      "policy-section-details",
      "policy-section-overview-2",
      "policy-section-overview-3",
    ]);
  });
});
