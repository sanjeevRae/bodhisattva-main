import {
  axisFitK,
  effectiveDevicePlacement,
  type ImagePlacement,
} from "./image-placement";

/**
 * Magnifier geometry for the product page (0025) — pure functions,
 * asserted by the QA geometry script against known coordinates.
 *
 * The frame→source map is derived from the PlacedImage rendering
 * model (object-fit + focal object-position + scale-z transform about
 * the focal point). Per axis, with c = axisFitK (the rendered content
 * size as a fraction of the frame, ≥ 1 cropped under cover, ≤ 1
 * letterboxed under contain), focal p and placement zoom z, a source
 * point σ renders at frame fraction
 *
 *     f(σ) = p·(1 − z·c) + σ·z·c
 *
 * so the inverse map is σ(f) = (f − p·(1 − z·c)) / (z·c). Where the
 * placement zoom overflows the frame (z·c ≥ 1) this is exactly the
 * affine map of visibleRegion(); under contain it additionally
 * reports letterboxed frame points as outside [0, 1] (`inside:
 * false`) — the magnifier must not respond over empty space.
 *
 * Panel tracking follows Amazon: the lens stays centred on the
 * cursor (clamped at the frame edges) and the source point under the
 * cursor is held at the panel's centre (clamped so the panel never
 * shows outside the source).
 */

export interface SourcePoint {
  /** Source coordinates as fractions of the source dimensions. */
  sx: number;
  sy: number;
  /** False when the frame point is not over rendered image content. */
  inside: boolean;
}

function axisMap(
  naturalWidth: number,
  naturalHeight: number,
  frameWidth: number,
  frameHeight: number,
  placement: ImagePlacement | null | undefined,
) {
  const device = effectiveDevicePlacement(placement ?? null, "desktop");
  const fit = placement?.fit ?? "cover";
  const imgAspect = naturalWidth / naturalHeight;
  const frameAspect = frameWidth / frameHeight;
  return {
    device,
    cx: axisFitK(imgAspect, frameAspect, fit, "x"),
    cy: axisFitK(imgAspect, frameAspect, fit, "y"),
  };
}

const toSource = (f: number, p: number, z: number, c: number) =>
  (f - (p / 100) * (1 - z * c)) / (z * c);

export function framePointToSourcePoint(
  fx: number,
  fy: number,
  naturalWidth: number,
  naturalHeight: number,
  frameWidth: number,
  frameHeight: number,
  placement: ImagePlacement | null | undefined,
): SourcePoint {
  const { device, cx, cy } = axisMap(naturalWidth, naturalHeight, frameWidth, frameHeight, placement);
  const sx = toSource(fx, device.x, device.zoom, cx);
  const sy = toSource(fy, device.y, device.zoom, cy);
  return { sx, sy, inside: sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1 };
}

export interface MagnifierGeometry {
  /** Size of the magnified image element inside the panel (px). */
  imgWidth: number;
  imgHeight: number;
  /** Offset of the magnified image within the panel (px, ≤ 0). */
  imgLeft: number;
  imgTop: number;
  /** Lens rectangle within the frame (px). */
  lensLeft: number;
  lensTop: number;
  lensWidth: number;
  lensHeight: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Full magnifier geometry for a cursor at frame fractions (fx, fy):
 * the panel shows the source at `zoom` × the frame's own rendering.
 * Returns null when the cursor is not over image content.
 */
export function magnifierGeometry(args: {
  fx: number;
  fy: number;
  frameWidth: number;
  frameHeight: number;
  panelWidth: number;
  panelHeight: number;
  zoom: number;
  naturalWidth: number;
  naturalHeight: number;
  placement: ImagePlacement | null | undefined;
}): MagnifierGeometry | null {
  const {
    fx,
    fy,
    frameWidth,
    frameHeight,
    panelWidth,
    panelHeight,
    zoom,
    naturalWidth,
    naturalHeight,
    placement,
  } = args;
  if (naturalWidth <= 0 || naturalHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return null;
  }
  const { device, cx, cy } = axisMap(naturalWidth, naturalHeight, frameWidth, frameHeight, placement);
  const sx = toSource(fx, device.x, device.zoom, cx);
  const sy = toSource(fy, device.y, device.zoom, cy);
  if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return null;

  // The full source rendered in the panel at zoom × the frame's
  // rendering: on screen in the frame the source spans z·c × frame
  // px per axis, so in the panel it spans zoom × that.
  const imgWidth = zoom * device.zoom * cx * frameWidth;
  const imgHeight = zoom * device.zoom * cy * frameHeight;
  // Hold the cursor's source point at the panel centre; when the
  // magnified image is smaller than the panel on an axis (contain,
  // unzoomed), centre it instead of clamping against an empty range.
  const imgLeft =
    imgWidth > panelWidth
      ? clamp(panelWidth / 2 - sx * imgWidth, panelWidth - imgWidth, 0)
      : (panelWidth - imgWidth) / 2;
  const imgTop =
    imgHeight > panelHeight
      ? clamp(panelHeight / 2 - sy * imgHeight, panelHeight - imgHeight, 0)
      : (panelHeight - imgHeight) / 2;

  // The lens outlines exactly the frame region the panel displays:
  // the panel's source span (panelSize / imgSize) expressed in frame
  // px (z·c frame px per source fraction), centred on the cursor and
  // clamped inside the frame.
  const lensWidth = (panelWidth / imgWidth) * device.zoom * cx * frameWidth;
  const lensHeight = (panelHeight / imgHeight) * device.zoom * cy * frameHeight;
  const lensLeft = clamp(fx * frameWidth - lensWidth / 2, 0, Math.max(0, frameWidth - lensWidth));
  const lensTop = clamp(fy * frameHeight - lensHeight / 2, 0, Math.max(0, frameHeight - lensHeight));

  return { imgWidth, imgHeight, imgLeft, imgTop, lensLeft, lensTop, lensWidth, lensHeight };
}
