/**
 * Rich-text rendering guard (2026-11-23).
 *
 * The bug: the image_text section renderer printed stored rich text as
 * a plain React child, so TipTap HTML showed on the public page as
 * literal "<p>…</p>" text. The contract (see RICH_TEXT_PATHS in
 * src/modules/cms/registry.ts and src/app/components/RichHtml.tsx) is
 * that declared rich-text fields hold server-sanitized HTML and are
 * rendered ONLY through the RichHtml component.
 *
 * This source-scan test keeps that true: dangerouslySetInnerHTML may
 * appear in the public app only inside RichHtml and the three other
 * surfaces whose values have their own server sanitizers (news body,
 * policy body) or are not content at all (chart CSS). A new section
 * renderer that injects HTML directly — or a RichHtml usage count in
 * PageRenderer dropping below the six known rich render sites — fails
 * here instead of failing on the live page.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const appDir = path.join(repoRoot, "src", "app");

/** Files allowed to contain dangerouslySetInnerHTML (paths under src/app). */
const ALLOWED = new Set([
  "components/RichHtml.tsx",
  "pages/NewsArticlePage.tsx",
  "pages/PolicyPage.tsx",
  "components/ui/chart.tsx",
]);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("rich-text rendering guard", () => {
  it("dangerouslySetInnerHTML appears only in sanctioned files", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(appDir)) {
      const rel = path.relative(appDir, file).split(path.sep).join("/");
      if (
        readFileSync(file, "utf8").includes("dangerouslySetInnerHTML") &&
        !ALLOWED.has(rel)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("PageRenderer routes section rich text through RichHtml (six sites)", () => {
    const src = readFileSync(
      path.join(appDir, "components", "PageRenderer.tsx"),
      "utf8",
    );
    const uses = src.match(/<RichHtml[\s>]/g) ?? [];
    // image_text: collage2 paragraph, quote paragraphs, calloutBadge
    // paragraphs, plain paragraphs; rich_text: columns body (one ternary
    // with two uses), paragraphs.
    expect(uses.length).toBeGreaterThanOrEqual(6);
  });
});
