/**
 * Destination frames for the image placement editor (docs/
 * IMAGE_PLACEMENT_EDITOR.md §2/§6). Keyed by section type + field path,
 * with aspect ratios taken from the actual public renderers in
 * src/app/components/PageRenderer.tsx — never guessed. Returns null
 * where placement does not apply (the image renders at natural ratio,
 * or is not rendered at all), and the editor button is not offered.
 *
 * Fluid containers (heroes) get representative aspects per device; the
 * placement model is focal-based, so the published result holds at any
 * real viewport size.
 */
export interface FrameSpec {
  /** Human label for the destination, shown in the editor. */
  label: string;
  /** [width, height] per device — ignored when `natural` is set. */
  desktop: [number, number];
  tablet: [number, number];
  mobile: [number, number];
  /** Frame follows the image's own aspect ratio (gallery cells). */
  natural?: boolean;
  /**
   * The composition the public renderer already applies when NO
   * placement is stored, when it differs from centred (the fullscreen
   * hero renders object-[center_22%]). The editor seeds and resets to
   * this, and saving it stores nothing — so opening the editor can
   * never silently re-anchor a designed composition.
   */
  defaultDevice?: { x: number; y: number; zoom: number };
  /** Height is viewport-relative (heroes): frames are representative. */
  fluid?: boolean;
}

function parseAspect(value: unknown, fallback: [number, number]): [number, number] {
  if (typeof value !== "string") return fallback;
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return fallback;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? [w, h] : fallback;
}

const same = (a: [number, number]): Pick<FrameSpec, "desktop" | "tablet" | "mobile"> => ({
  desktop: a,
  tablet: a,
  mobile: a,
});

export function frameForImageField(
  sectionType: string | undefined,
  fieldPath: string,
  sectionConfig: Record<string, any> | undefined,
): FrameSpec | null {
  const leaf = fieldPath.split(".").pop() ?? fieldPath;
  switch (sectionType) {
    case "hero": {
      if (leaf !== "backgroundImage") return null;
      if (sectionConfig?.variant === "fullscreen") {
        return {
          label: "Fullscreen hero (fills the screen)",
          desktop: [16, 9],
          tablet: [3, 4],
          mobile: [9, 16],
          // PageRenderer renders this variant object-[center_22%].
          defaultDevice: { x: 50, y: 22, zoom: 1 },
          fluid: true,
        };
      }
      return {
        label: "Page banner (62% of screen height)",
        desktop: [8, 3],
        tablet: [2, 1],
        mobile: [3, 4],
        fluid: true,
      };
    }
    case "image_text": {
      if (leaf === "image") {
        // The renderer picks the frame by variant, told apart by the
        // fields that define each variant (PageRenderer ImageTextSection):
        // quote → fixed aspect-video; callout → imageAspect ?? 4:5;
        // plain → imageAspect ?? 4:3.
        if (sectionConfig?.quote) {
          return { label: "Image & text — quote image (16:9)", ...same([16, 9]) };
        }
        const fallback: [number, number] = sectionConfig?.calloutBadge ? [4, 5] : [4, 3];
        const aspect = parseAspect(sectionConfig?.imageAspect, fallback);
        return { label: `Image & text — image (${aspect[0]}:${aspect[1]})`, ...same(aspect) };
      }
      if (leaf === "images") {
        return { label: "Image & text — collage image (3:4)", ...same([3, 4]) };
      }
      return null;
    }
    case "image_gallery": {
      if (leaf !== "images") return null;
      return {
        label: "Gallery cell (image's natural ratio)",
        desktop: [4, 3],
        tablet: [4, 3],
        mobile: [4, 3],
        natural: true,
      };
    }
    case "team_members": {
      if (leaf !== "photo") return null;
      return { label: "Team member photo (square)", ...same([1, 1]) };
    }
    default:
      // "image" sections render at natural ratio (no crop frame) and
      // partner_list logos are not rendered at all — no placement.
      return null;
  }
}
