/**
 * ImagePlacementEditor — visual positioning/cropping for one CMS image
 * usage (docs/IMAGE_PLACEMENT_EDITOR.md §6). The preview frame carries
 * the destination section's real aspect ratio and renders the shared
 * PlacedImage component with the draft placement, so what the admin
 * sees is the published rendering. Per-device values (desktop /
 * tablet / mobile) edit independently; unset devices inherit.
 */
import { useEffect, useRef, useState } from "react";
import { Crosshair, RotateCcw, Trash2 } from "lucide-react";
import { PlacedImage } from "../app/lib/PlacedImage";
import {
  CENTERED_DEVICE,
  dragDeltaPercent,
  effectiveDevicePlacement,
  visibleRegion,
  type DevicePlacement,
  type ImagePlacement,
  type PlacementDevice,
} from "../app/lib/image-placement";
import type { FrameSpec } from "./image-frames";
import { Btn, Field, Modal, cx, inputCls } from "./ui";

interface DraftState {
  fit: "cover" | "contain";
  desktop: DevicePlacement;
  tablet?: DevicePlacement;
  mobile?: DevicePlacement;
}

const DEVICES: Array<{ id: PlacementDevice; label: string }> = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" },
];

const QUICK_POSITIONS: Array<{ label: string; x: number; y: number }> = [
  { label: "Top left", x: 0, y: 0 },
  { label: "Top centre", x: 50, y: 0 },
  { label: "Top right", x: 100, y: 0 },
  { label: "Centre left", x: 0, y: 50 },
  { label: "Centre", x: 50, y: 50 },
  { label: "Centre right", x: 100, y: 50 },
  { label: "Bottom left", x: 0, y: 100 },
  { label: "Bottom centre", x: 50, y: 100 },
  { label: "Bottom right", x: 100, y: 100 },
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

function toDraft(placement: ImagePlacement | null | undefined, base: DevicePlacement): DraftState {
  return {
    fit: placement?.fit ?? "cover",
    desktop: placement?.desktop ?? { ...base },
    tablet: placement?.tablet,
    mobile: placement?.mobile,
  };
}

/**
 * Number input that lets the user clear and retype freely: the text is
 * local while editing and only valid numbers are committed, instead of
 * snapping back to 0/the minimum on every keystroke.
 */
function NumInput({
  value,
  min,
  max,
  step,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setText(null)}
      className="w-16 rounded-sm border border-border bg-input-background px-1.5 py-0.5 text-right text-xs"
      aria-label={ariaLabel}
    />
  );
}

export default function ImagePlacementEditor({
  open,
  image,
  frame,
  onClose,
  onSave,
}: {
  open: boolean;
  image: { url: string; alt?: string; placement?: ImagePlacement | null };
  frame: FrameSpec;
  onClose: () => void;
  onSave: (placement: ImagePlacement | undefined) => void;
}) {
  // The composition the renderer already applies without a placement
  // (centred, except e.g. the fullscreen hero's 22% anchor).
  const base: DevicePlacement = frame.defaultDevice ?? CENTERED_DEVICE;
  const [draft, setDraft] = useState<DraftState>(() => toDraft(image.placement, base));
  const [device, setDevice] = useState<PlacementDevice>("desktop");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origin: DevicePlacement } | null>(null);
  const pendingRef = useRef<DevicePlacement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Reset the draft whenever the editor is (re)opened for an image.
  useEffect(() => {
    if (open) {
      setDraft(toDraft(image.placement, frame.defaultDevice ?? CENTERED_DEVICE));
      setDevice("desktop");
      setNatural(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, image.url]);

  // Natural dimensions come from the preview image's own load event
  // (CMS values carry no media id — plan doc §2); no separate probe, so
  // a failed load simply leaves the dimensions panel hidden.
  const onPreviewLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const current: ImagePlacement = draft;
  const effective = effectiveDevicePlacement(current, device);
  const separate = device === "desktop" ? true : draft[device] !== undefined;
  const minZoom = draft.fit === "cover" ? 1 : 0.5;

  const setDeviceValues = (next: DevicePlacement) => {
    const clamped = {
      x: clamp(round1(next.x), 0, 100),
      y: clamp(round1(next.y), 0, 100),
      zoom: clamp(round2(next.zoom), minZoom, 3),
    };
    setDraft((d) => ({ ...d, [device]: clamped }));
  };

  const setSeparate = (on: boolean) => {
    if (device === "desktop") return;
    setDraft((d) => {
      if (!on) {
        const copy = { ...d };
        delete copy[device];
        return copy;
      }
      return { ...d, [device]: { ...effectiveDevicePlacement(d, device) } };
    });
  };

  const setFit = (fit: "cover" | "contain") => {
    setDraft((d) => {
      const next: DraftState = { ...d, fit };
      if (fit === "cover") {
        const lift = (v?: DevicePlacement) =>
          v ? { ...v, zoom: clamp(v.zoom, 1, 3) } : v;
        next.desktop = lift(next.desktop) ?? { ...CENTERED_DEVICE };
        next.tablet = lift(next.tablet);
        next.mobile = lift(next.mobile);
      }
      return next;
    });
  };

  // -- Drag to reposition ------------------------------------------------
  // Gain comes from dragDeltaPercent (exact for the object-position +
  // zoom-about-the-point model), so the grabbed content tracks the
  // pointer. State updates are rAF-throttled and flushed on release.
  // Editing an inherited device forks it (setDeviceValues writes the
  // device entry) — no separate toggle needed first.
  const flushPending = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) setDeviceValues(next);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: { ...effective } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = frameRef.current;
    if (!drag || !box) return;
    const rect = box.getBoundingClientRect();
    const imgAspect = natural ? natural.w / natural.h : fw / fh;
    const frameAspect = fw / fh;
    pendingRef.current = {
      ...drag.origin,
      x: drag.origin.x + dragDeltaPercent(e.clientX - drag.startX, rect.width, imgAspect, frameAspect, drag.origin.zoom, draft.fit, "x"),
      y: drag.origin.y + dragDeltaPercent(e.clientY - drag.startY, rect.height, imgAspect, frameAspect, drag.origin.zoom, draft.fit, "y"),
    };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) setDeviceValues(next);
      });
    }
  };
  const endDrag = () => {
    flushPending();
    dragRef.current = null;
  };
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // -- Wheel zoom (non-passive so the modal does not scroll) ------------
  const wheelRef = useRef({ device, effective, separate, setDeviceValues });
  wheelRef.current = { device, effective, separate, setDeviceValues };
  useEffect(() => {
    const box = frameRef.current;
    if (!box || !open) return;
    const onWheel = (e: WheelEvent) => {
      const s = wheelRef.current;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      s.setDeviceValues({ ...s.effective, zoom: s.effective.zoom * factor });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [open, device]);

  // -- Frame geometry ------------------------------------------------------
  const frameDims: [number, number] = frame.natural
    ? natural
      ? [natural.w, natural.h]
      : [4, 3]
    : frame[device];
  const [fw, fh] = frameDims;
  const frameWidthCls = device === "mobile" ? "max-w-[300px]" : device === "tablet" ? "max-w-[440px]" : "max-w-[660px]";
  const region = natural
    ? visibleRegion(natural.w, natural.h, fw, fh, effective, draft.fit)
    : null;
  // Preview with the ACTIVE device's effective values as the desktop
  // entry, so PlacedImage's own media queries cannot interfere — the
  // editor, not the admin's screen size, chooses what is previewed.
  const previewPlacement: ImagePlacement = { fit: draft.fit, desktop: effective };

  const save = () => {
    const normalized: ImagePlacement = {
      fit: draft.fit,
      desktop: { x: Math.round(draft.desktop.x), y: Math.round(draft.desktop.y), zoom: round2(draft.desktop.zoom) },
    };
    if (draft.tablet) {
      normalized.tablet = { x: Math.round(draft.tablet.x), y: Math.round(draft.tablet.y), zoom: round2(draft.tablet.zoom) };
    }
    if (draft.mobile) {
      normalized.mobile = { x: Math.round(draft.mobile.x), y: Math.round(draft.mobile.y), zoom: round2(draft.mobile.zoom) };
    }
    // A draft that merely restates the frame's built-in composition
    // (centred — or the fullscreen hero's 22% anchor) stores nothing.
    const eq = (a: DevicePlacement, b: DevicePlacement) =>
      a.x === b.x && a.y === b.y && a.zoom === b.zoom;
    const restatesBase =
      draft.fit === "cover" &&
      eq(normalized.desktop, base) &&
      (!normalized.tablet || eq(normalized.tablet, base)) &&
      (!normalized.mobile || eq(normalized.mobile, base));
    onSave(restatesBase ? undefined : normalized);
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit image position" wide>
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Preview column */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
            {frame.label} — {device} preview
          </p>
          <div className={cx("mx-auto w-full", frameWidthCls)}>
            <div
              ref={frameRef}
              className="relative w-full cursor-grab touch-none overflow-hidden border border-border bg-[repeating-conic-gradient(#ddd5c3_0%_25%,#efe9da_0%_50%)] bg-[length:16px_16px] active:cursor-grabbing"
              style={{ aspectRatio: `${fw} / ${fh}` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <PlacedImage
                src={image.url}
                alt=""
                placement={previewPlacement}
                draggable={false}
                onLoad={onPreviewLoad}
                className="absolute inset-0 h-full w-full select-none"
              />
              {showGuides && (
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/35" />
                  <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/35" />
                  <div className="absolute right-0 left-0 top-1/3 h-px bg-white/35" />
                  <div className="absolute right-0 left-0 top-2/3 h-px bg-white/35" />
                </div>
              )}
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${effective.x}%`, top: `${effective.y}%` }}
                aria-hidden="true"
              >
                <Crosshair size={26} className="text-white drop-shadow-[0_0_3px_rgba(0,0,0,0.9)]" />
              </div>
            </div>
          </div>
          {!separate && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {device === "tablet" ? "Tablet" : "Mobile"} currently inherits the{" "}
              {device === "mobile" && draft.tablet ? "tablet" : "desktop"} position — drag the image
              or use the controls and it gets its own settings.
            </p>
          )}
          {frame.fluid && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              This frame's height varies with the visitor's screen size, so the frame above is a
              representative ratio — the focal point you set holds at any size.
            </p>
          )}
          {/* Source thumbnail with the visible region outlined */}
          {natural && region && (
            <div className="mt-4 flex items-start gap-4">
              <div className="relative w-40 shrink-0 overflow-hidden border border-border">
                <img src={image.url} alt="" className="block w-full" draggable={false} />
                <div
                  className="absolute border-2 border-[#9A6F2A] shadow-[0_0_0_9999px_rgba(15,13,10,0.45)]"
                  style={{
                    left: `${region.x}%`,
                    top: `${region.y}%`,
                    width: `${region.width}%`,
                    height: `${region.height}%`,
                  }}
                  aria-hidden="true"
                />
              </div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                <p>
                  Original: {natural.w} × {natural.h}px (ratio {(natural.w / natural.h).toFixed(2)})
                </p>
                <p>
                  Frame ratio: {(fw / fh).toFixed(2)} — about{" "}
                  {Math.round((region.width * region.height) / 100)}% of the image is visible on{" "}
                  {device}.
                </p>
                <p className="mt-1">The gold outline on the full image shows the kept area.</p>
              </div>
            </div>
          )}
        </div>

        {/* Controls column */}
        <div className="w-full shrink-0 space-y-4 lg:w-72">
          <div className="flex overflow-hidden rounded-sm border border-border" role="group" aria-label="Device">
            {DEVICES.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={device === d.id}
                onClick={() => setDevice(d.id)}
                className={cx(
                  "flex-1 px-2 py-1.5 text-xs font-medium",
                  device === d.id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {d.label}
                {d.id !== "desktop" && draft[d.id] ? " •" : ""}
              </button>
            ))}
          </div>

          {device !== "desktop" && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#9A6F2A]"
                checked={separate}
                onChange={(e) => setSeparate(e.target.checked)}
              />
              <span className="text-sm">Separate {device} settings</span>
            </label>
          )}

          <Field label="Display mode">
            <select
              className={inputCls}
              value={draft.fit}
              onChange={(e) => setFit(e.target.value as "cover" | "contain")}
              aria-label="Display mode"
            >
              <option value="cover">Cover — fill the frame (may crop)</option>
              <option value="contain">Contain — show the whole image</option>
            </select>
          </Field>

          <fieldset className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium">Horizontal position</span>
                <span className="flex items-center gap-1">
                  <NumInput
                    key={`x-${device}`}
                    value={Math.round(effective.x)}
                    min={0}
                    max={100}
                    onCommit={(n) => setDeviceValues({ ...effective, x: n })}
                    ariaLabel="Horizontal position in percent"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={effective.x}
                onChange={(e) => setDeviceValues({ ...effective, x: Number(e.target.value) })}
                className="w-full accent-[#9A6F2A]"
                aria-label="Horizontal position slider"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium">Vertical position</span>
                <span className="flex items-center gap-1">
                  <NumInput
                    key={`y-${device}`}
                    value={Math.round(effective.y)}
                    min={0}
                    max={100}
                    onCommit={(n) => setDeviceValues({ ...effective, y: n })}
                    ariaLabel="Vertical position in percent"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={effective.y}
                onChange={(e) => setDeviceValues({ ...effective, y: Number(e.target.value) })}
                className="w-full accent-[#9A6F2A]"
                aria-label="Vertical position slider"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium">Zoom</span>
                <span className="flex items-center gap-1">
                  <NumInput
                    key={`z-${device}`}
                    value={round2(effective.zoom)}
                    min={minZoom}
                    max={3}
                    step={0.05}
                    onCommit={(n) => setDeviceValues({ ...effective, zoom: n })}
                    ariaLabel="Zoom level"
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                </span>
              </div>
              <input
                type="range"
                min={minZoom}
                max={3}
                step={0.01}
                value={effective.zoom}
                onChange={(e) => setDeviceValues({ ...effective, zoom: Number(e.target.value) })}
                className="w-full accent-[#9A6F2A]"
                aria-label="Zoom slider"
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium">Quick position</p>
              <div className="grid w-24 grid-cols-3 gap-1">
                {QUICK_POSITIONS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    title={q.label}
                    aria-label={q.label}
                    aria-pressed={effective.x === q.x && effective.y === q.y}
                    onClick={() => setDeviceValues({ ...effective, x: q.x, y: q.y })}
                    className={cx(
                      "h-7 rounded-sm border text-[0.6rem]",
                      effective.x === q.x && effective.y === q.y
                        ? "border-[#9A6F2A] bg-[#9A6F2A]/15"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    ●
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Btn size="sm" variant="ghost" onClick={() => setDeviceValues({ ...base, zoom: Math.max(minZoom, base.zoom) })}>
                <RotateCcw size={13} /> Reset {device}
              </Btn>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[#9A6F2A]"
                  checked={showGuides}
                  onChange={(e) => setShowGuides(e.target.checked)}
                />
                Rule-of-thirds guides
              </label>
            </div>
          </fieldset>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => onSave(undefined)}
          disabled={!image.placement}
        >
          <Trash2 size={13} /> Remove positioning
        </Btn>
        <span className="flex-1" />
        <Btn size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn size="sm" onClick={save}>
          Save placement
        </Btn>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Saving stores the position with this section only — the original image is never changed, and
        the same image used elsewhere keeps its own position. Remember to save the page afterwards.
      </p>
    </Modal>
  );
}
