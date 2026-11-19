/**
 * Image placement math (docs/IMAGE_PLACEMENT_EDITOR.md). The module
 * under test is the frontend's src/app/lib/image-placement.ts — pure
 * functions with type-only React imports, imported here directly so the
 * exact code the browser runs is what is tested.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dragDeltaPercent,
  effectiveDevicePlacement,
  isDefaultPlacement,
  placementVars,
  visibleRegion,
  type ImagePlacement,
} from "../../src/app/lib/image-placement";

const placement: ImagePlacement = {
  fit: "cover",
  desktop: { x: 60, y: 40, zoom: 1.2 },
  mobile: { x: 70, y: 30, zoom: 1.4 },
};

describe("image placement", () => {
  it("resolves device inheritance mobile → tablet → desktop → centre", () => {
    expect(effectiveDevicePlacement(placement, "desktop")).toEqual({ x: 60, y: 40, zoom: 1.2 });
    // No tablet entry: inherits desktop.
    expect(effectiveDevicePlacement(placement, "tablet")).toEqual({ x: 60, y: 40, zoom: 1.2 });
    expect(effectiveDevicePlacement(placement, "mobile")).toEqual({ x: 70, y: 30, zoom: 1.4 });
    expect(effectiveDevicePlacement(undefined, "mobile")).toEqual({ x: 50, y: 50, zoom: 1 });
    const withTablet: ImagePlacement = {
      ...placement,
      tablet: { x: 55, y: 45, zoom: 1.1 },
    };
    expect(effectiveDevicePlacement(withTablet, "tablet")).toEqual({ x: 55, y: 45, zoom: 1.1 });
    // Mobile still uses its own entry, not the tablet one.
    expect(effectiveDevicePlacement(withTablet, "mobile")).toEqual({ x: 70, y: 30, zoom: 1.4 });
  });

  it("detects the centred default", () => {
    expect(isDefaultPlacement(undefined)).toBe(true);
    expect(isDefaultPlacement({ desktop: { x: 50, y: 50, zoom: 1 } })).toBe(true);
    expect(isDefaultPlacement(placement)).toBe(false);
    expect(
      isDefaultPlacement({ fit: "contain", desktop: { x: 50, y: 50, zoom: 1 } }),
    ).toBe(false);
  });

  it("emits CSS variables only for explicitly set devices", () => {
    const vars = placementVars(placement) as Record<string, string>;
    expect(vars["--ipx"]).toBe("60%");
    expect(vars["--ipy"]).toBe("40%");
    expect(vars["--ipz"]).toBe("1.2");
    expect(vars["--imx"]).toBe("70%");
    expect(vars["--itx"]).toBeUndefined();
  });

  it("computes the visible region for a square image in a 16:9 frame", () => {
    const region = visibleRegion(1000, 1000, 1600, 900, { x: 50, y: 50, zoom: 1 }, "cover");
    expect(region.width).toBeCloseTo(100);
    expect(region.height).toBeCloseTo(56.25);
    expect(region.x).toBeCloseTo(0);
    expect(region.y).toBeCloseTo(21.875);
  });

  it("zoom shrinks the visible region around the focal point", () => {
    const region = visibleRegion(1000, 1000, 1600, 900, { x: 50, y: 50, zoom: 2 }, "cover");
    expect(region.width).toBeCloseTo(50);
    expect(region.height).toBeCloseTo(28.125);
    expect(region.x).toBeCloseTo(25);
    expect(region.y).toBeCloseTo(35.9375);
  });

  it("clamps the region inside the source at the edges", () => {
    const region = visibleRegion(2000, 1000, 1000, 1000, { x: 100, y: 100, zoom: 1 }, "cover");
    expect(region.x + region.width).toBeLessThanOrEqual(100.001);
    expect(region.y + region.height).toBeLessThanOrEqual(100.001);
    expect(region.x).toBeGreaterThanOrEqual(0);
    expect(region.y).toBeGreaterThanOrEqual(0);
  });

  it("contain shows the whole image at zoom 1", () => {
    const region = visibleRegion(2000, 1000, 1000, 1000, { x: 50, y: 50, zoom: 1 }, "contain");
    expect(region).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("contain crops per axis once zoom overflows the rendered size", () => {
    // 16:9 image in a 600×900 (2:3) frame, contain: rendered 600×337.5.
    // Zoom 2 → screen content 1200×675: width clips to 50%, height
    // still fits entirely. (The old single-fraction formula said 50/50.)
    const region = visibleRegion(1600, 900, 600, 900, { x: 50, y: 50, zoom: 2 }, "contain");
    expect(region.width).toBeCloseTo(50);
    expect(region.height).toBeCloseTo(100);
    expect(region.x).toBeCloseTo(25);
    expect(region.y).toBeCloseTo(0);
  });

  it("computes the visible region for a portrait image in a landscape frame", () => {
    const region = visibleRegion(1000, 2000, 1600, 900, { x: 50, y: 50, zoom: 1 }, "cover");
    expect(region.width).toBeCloseTo(100);
    expect(region.height).toBeCloseTo(28.125);
    expect(region.y).toBeCloseTo(35.9375);
  });

  it("clamps out-of-range values at render time", () => {
    const cover = placementVars({
      fit: "cover",
      desktop: { x: 140, y: -5, zoom: 0.5 },
    }) as Record<string, string>;
    expect(cover["--ipx"]).toBe("100%");
    expect(cover["--ipy"]).toBe("0%");
    // Cover zoom below 1 would open empty edges — lifted to 1.
    expect(cover["--ipz"]).toBe("1");
    const contain = placementVars({
      fit: "contain",
      desktop: { x: 50, y: 50, zoom: 0.5 },
    }) as Record<string, string>;
    expect(contain["--ipz"]).toBe("0.5");
  });

  it("drag gain follows the exact object-position geometry", () => {
    // 3:2 photo in a 16:9 frame, vertical drag at zoom 1: the visible
    // height fraction is 0.84375, so the gain is ≈5.4× the naive
    // frame-fraction (a 10px drag on a 500px frame = 2% → ≈10.8 points).
    const dy = dragDeltaPercent(10, 500, 1.5, 16 / 9, 1, "cover", "y");
    expect(dy).toBeCloseTo(-10.8, 1);
    // Same setup horizontally: no overflow at zoom 1 → no movement.
    expect(dragDeltaPercent(10, 500, 1.5, 16 / 9, 1, "cover", "x")).toBe(0);
    // Matched aspects at zoom 1: position has no effect at all.
    expect(dragDeltaPercent(10, 500, 16 / 9, 16 / 9, 1, "cover", "y")).toBe(0);
    // Contain: increasing position moves content WITH the pointer
    // (letterbox offset), so the sign flips versus cover.
    const cy = dragDeltaPercent(10, 500, 16 / 9, 2 / 3, 1, "contain", "y");
    expect(cy).toBeCloseTo(3.2, 1);
    // Dragging left/up (negative delta) increases the position.
    expect(dragDeltaPercent(-10, 500, 1.5, 16 / 9, 1, "cover", "y")).toBeCloseTo(10.8, 1);
  });

  it("theme.css fallback chains implement the same inheritance", () => {
    // The visitor-visible responsive behaviour lives in these var()
    // chains; guard them against typos the TS twin cannot catch.
    const css = readFileSync(
      new URL("../../src/styles/theme.css", import.meta.url),
      "utf8",
    );
    const tablet = css.slice(css.indexOf("@media (max-width: 1023px)"));
    expect(tablet).toContain("var(--itx, var(--ipx, 50%))");
    expect(tablet).toContain("var(--itz, var(--ipz, 1))");
    const mobile = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(mobile).toContain("var(--imx, var(--itx, var(--ipx, 50%)))");
    expect(mobile).toContain("var(--imz, var(--itz, var(--ipz, 1)))");
  });
});
