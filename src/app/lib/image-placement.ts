import type { CSSProperties } from "react";

/**
 * Image placement — per-usage focal point, zoom and fit for a CMS image
 * (docs/IMAGE_PLACEMENT_EDITOR.md). Placement belongs to the image usage
 * (inside the section config, next to url/alt), never to the media
 * asset: the same asset used in two sections keeps two placements.
 *
 * x/y are focal-point percentages (0–100): the point of the image that
 * sits at the same percentage of the frame. zoom scales around that
 * point. Missing device entries inherit mobile → tablet → desktop →
 * centred default.
 */
export interface DevicePlacement {
  x: number;
  y: number;
  zoom: number;
}

export interface ImagePlacement {
  fit?: "cover" | "contain";
  desktop: DevicePlacement;
  tablet?: DevicePlacement;
  mobile?: DevicePlacement;
}

export type PlacementDevice = "desktop" | "tablet" | "mobile";

export const CENTERED_DEVICE: DevicePlacement = { x: 50, y: 50, zoom: 1 };

export function effectiveDevicePlacement(
  placement: ImagePlacement | null | undefined,
  device: PlacementDevice,
): DevicePlacement {
  if (!placement) return CENTERED_DEVICE;
  if (device === "desktop") return placement.desktop ?? CENTERED_DEVICE;
  if (device === "tablet") return placement.tablet ?? placement.desktop ?? CENTERED_DEVICE;
  return placement.mobile ?? placement.tablet ?? placement.desktop ?? CENTERED_DEVICE;
}

/** True when the placement changes anything versus the centred default. */
export function isDefaultPlacement(placement: ImagePlacement | null | undefined): boolean {
  if (!placement) return true;
  const d = (v?: DevicePlacement) =>
    !v || (v.x === 50 && v.y === 50 && v.zoom === 1);
  return (placement.fit ?? "cover") === "cover" && d(placement.desktop) && d(placement.tablet) && d(placement.mobile);
}

const clampNum = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

/**
 * CSS variables consumed by the `.placed-img` rules in theme.css.
 * Tablet/mobile variables are emitted only when explicitly set — the
 * stylesheet's var() fallback chains implement the inheritance.
 *
 * Values are clamped defensively at render time: the server schema is
 * the authoritative gate, but a config written outside it (seed, direct
 * DB write) must still not be able to break the page visually — for
 * cover, zoom below 1 would open empty edges, so it is lifted to 1.
 */
export function placementVars(placement: ImagePlacement): CSSProperties {
  const vars: Record<string, string> = {};
  const minZoom = placement.fit === "contain" ? 0.5 : 1;
  const set = (prefix: string, d?: DevicePlacement) => {
    if (!d) return;
    vars[`--i${prefix}x`] = `${clampNum(d.x, 0, 100)}%`;
    vars[`--i${prefix}y`] = `${clampNum(d.y, 0, 100)}%`;
    vars[`--i${prefix}z`] = String(clampNum(d.zoom, minZoom, 3));
  };
  set("p", placement.desktop);
  set("t", placement.tablet);
  set("m", placement.mobile);
  return vars as CSSProperties;
}

/**
 * Per-axis rendered-size ratio k = R/F (rendered image size ÷ frame
 * size along that axis) under object-fit. Cover overflows (k ≥ 1) on
 * the cropped axis and matches (k = 1) on the fitted axis; contain is
 * the mirror image (k ≤ 1). Single source of truth for the geometry
 * below and for the editor's drag gain.
 */
export function axisFitK(
  imgAspect: number,
  frameAspect: number,
  fit: "cover" | "contain",
  axis: "x" | "y",
): number {
  const ratio = axis === "x" ? imgAspect / frameAspect : frameAspect / imgAspect;
  return fit === "cover" ? Math.max(1, ratio) : Math.min(1, ratio);
}

/**
 * Drag gain for the placement editor: how many placement percentage
 * points a pointer movement of `deltaPx` (of a `framePx`-sized frame)
 * must produce so the grabbed content tracks the pointer exactly.
 *
 * Derivation (per axis): with object-position p (fraction) and a
 * scale-z transform whose origin is the p point of the element box,
 * the screen position of source point σ is p·F + z·R·(σ − p), where R
 * is the object-fit rendered size and F the frame size. Content tracks
 * the pointer when Δp = Δpx / (F − z·R); with k = R/F that is
 * −100·(Δpx/F) / (z·k − 1) in percentage points. When z·k ≈ 1 the axis
 * has no visible movement (no overflow, or contain at zoom 1) and the
 * delta is 0 — the position value has no effect there.
 */
export function dragDeltaPercent(
  deltaPx: number,
  framePx: number,
  imgAspect: number,
  frameAspect: number,
  zoom: number,
  fit: "cover" | "contain",
  axis: "x" | "y",
): number {
  if (framePx <= 0 || imgAspect <= 0 || frameAspect <= 0) return 0;
  const denom = zoom * axisFitK(imgAspect, frameAspect, fit, axis) - 1;
  if (Math.abs(denom) < 0.02) return 0;
  return (-100 * (deltaPx / framePx)) / denom;
}

/**
 * Visible region of the source image, in percentages of the source
 * dimensions — used by the admin editor's source thumbnail to show
 * which part of the image the frame keeps. Exact under the rendering
 * model (object-position alignment + zoom about that point): the
 * visible fraction per axis is min(1, 1/(zoom · k)) and the window is
 * positioned so the focal point keeps its relative place inside it.
 */
export function visibleRegion(
  naturalWidth: number,
  naturalHeight: number,
  frameWidth: number,
  frameHeight: number,
  device: DevicePlacement,
  fit: "cover" | "contain",
): { x: number; y: number; width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  const imgAspect = naturalWidth / naturalHeight;
  const frameAspect = frameWidth / frameHeight;
  // Visible fraction per axis = min(1, 1/(zoom · k)) with k the
  // rendered-size ratio from axisFitK — one formula for both fits:
  // cover crops the overflowing axis; contain keeps the whole image
  // until zoom overflows the rendered size on that axis.
  const widthFrac = Math.min(1, 1 / (device.zoom * axisFitK(imgAspect, frameAspect, fit, "x")));
  const heightFrac = Math.min(1, 1 / (device.zoom * axisFitK(imgAspect, frameAspect, fit, "y")));
  const width = widthFrac * 100;
  const height = heightFrac * 100;
  const x = Math.min(Math.max(device.x * (1 - widthFrac), 0), 100 - width);
  const y = Math.min(Math.max(device.y * (1 - heightFrac), 0), 100 - height);
  return { x, y, width, height };
}
