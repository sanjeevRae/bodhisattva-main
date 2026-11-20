import sanitizeHtml from "sanitize-html";

/**
 * The policy HTML sanitizer (legal pages feature, 2026-11-20).
 *
 * ONE function, used on write AND on read (ChatGPT review: a single
 * centralized sanitizer is what makes sanitize-twice a real defence
 * in depth instead of two drifting rule sets). It starts from the CMS
 * rich-text allowlist and tightens it for legal pages:
 *
 *  - `img` is allowed ONLY with a media-library source matching
 *    MEDIA_IMAGE_SRC exactly (anchored: no query, no fragment, no
 *    external or data: URLs, no protocol-relative). An img with any
 *    other source is removed ENTIRELY (exclusiveFilter), not left as
 *    a broken element. Uploads are raster-only at the media pipeline
 *    (jpeg/png/webp/gif/avif, sniffed), so no SVG can ever be served
 *    through these URLs.
 *  - Links: target is restricted to _blank/_self, and a _blank link
 *    always gets rel="noopener noreferrer" — the submitted rel is
 *    never trusted (transformTags enforces it deterministically, so
 *    sanitize ∘ sanitize = sanitize).
 *  - `span` is allowed WITHOUT its class attribute (the CMS
 *    allowlist permits classes; for legal pages arbitrary Tailwind
 *    classes could hide or overlay public content, and the editor
 *    emits no classed spans of its own).
 *  - No style attributes, no event handlers, no iframes/objects —
 *    same as the CMS baseline.
 */
export const MEDIA_IMAGE_SRC = /^\/api\/media\/[1-9]\d*\/file\/(?:master|original)$/;

const POLICY_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "a",
    "ul", "ol", "li", "blockquote", "h2", "h3", "h4",
    "span", "sub", "sup", "img",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => {
      const out = { ...attribs };
      if (out.target !== undefined && out.target !== "_blank" && out.target !== "_self") {
        delete out.target;
      }
      if (out.target === "_blank") {
        out.rel = "noopener noreferrer";
      }
      return { tagName: "a", attribs: out };
    },
  },
  exclusiveFilter: (frame) => {
    if (frame.tag !== "img") return false;
    const src = frame.attribs.src ?? "";
    return !MEDIA_IMAGE_SRC.test(src);
  },
};

/** Sanitise one policy body. Idempotent by construction. */
export function sanitizePolicyHtml(html: string): string {
  return sanitizeHtml(html, POLICY_SANITIZE_OPTIONS);
}
