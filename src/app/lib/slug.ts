/**
 * Heading-slug helpers for the policy pages' table of contents.
 *
 * The public PolicyPage renders server-sanitized HTML, then walks
 * its h2/h3/h4 elements, reads each heading's textContent (never
 * innerHTML), and assigns ids built by these helpers. The output
 * alphabet is restricted to lowercase ASCII letters, digits and
 * hyphens, so a generated id can never break out into markup,
 * selectors or script — heading TEXT is data, never code.
 */

/** Slugify heading text: lowercase ASCII words joined by hyphens. */
export function slugifyHeading(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug === "" ? "section" : slug;
}

/**
 * Build the unique element id for each heading text, in order:
 * `${prefix}${slug}`, with duplicates suffixed -2, -3, … The prefix
 * keeps generated ids out of the application's own id space.
 */
export function buildHeadingIds(texts: string[], prefix: string): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = `${prefix}${slugifyHeading(text)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}
