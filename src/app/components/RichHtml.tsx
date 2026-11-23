/**
 * RichHtml — THE public renderer for stored rich text. Every section
 * field the CMS declares as rich text must be rendered through this
 * component, never as a plain React text child (which escapes the HTML
 * and prints literal tags like "<p>" on the page — the bug of
 * 2026-11-23) and never via a bare dangerouslySetInnerHTML elsewhere.
 *
 * CONTRACT: `html` must already be server-sanitized. The CMS registry
 * (server/src/modules/cms/registry.ts, RICH_TEXT_PATHS) re-sanitises
 * every declared rich-text path on save with an allowlist sanitizer;
 * news bodies and policy bodies have their own server sanitizers.
 * Never pass arbitrary or user-supplied strings here.
 *
 * WHY A <div>: the stored value is block HTML (TipTap emits
 * "<p>…</p>", lists, headings). Wrapping it in a styled <p> produced
 * invalid "<p><p>…</p></p>" nesting — browsers auto-close the outer
 * <p>, the wrapper ends up empty and the text loses its classes. A
 * <div> nests any block content validly, and the paragraph classes
 * (font, size, colour, leading) inherit into the children.
 *
 * The inner-element spacing below mirrors the admin editor's prose
 * styles (RichTextField PROSE_CLS) so what the editor shows is what
 * the page renders: paragraphs get a small gap, the last one none,
 * lists/blockquotes/links look the same on both sides.
 */
const INNER_SPACING =
  "[&_p]:mb-2 [&_p:last-of-type]:mb-0 " +
  "[&_h2]:mb-1.5 [&_h2:mt-3 [&_h2:text-xl [&_h2:font-medium [&_h2:leading-snug " +
  "[&_h3]:mb-1 [&_h3:mt-3 [&_h3:text-lg [&_h3:font-medium [&_h3:leading-snug " +
  "[&_h4]:mb-1 [&_h4:mt-2 [&_h4:text-base [&_h4:font-medium " +
  "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mb-0.5 [&_li>p]:mb-0 " +
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:italic " +
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2";

export default function RichHtml({
  html,
  className,
}: {
  /** Server-sanitized HTML (see the contract above). */
  html: string;
  /** Paragraph classes for the wrapper (font/size/colour/margins). */
  className?: string;
}) {
  return (
    <div
      className={className ? `${INNER_SPACING} ${className}` : INNER_SPACING}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
