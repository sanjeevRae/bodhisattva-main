import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { PlacedImage } from "../lib/PlacedImage";
import type { ShopImage } from "../lib/shop";
import { magnifierGeometry } from "../lib/magnifier-geometry";

/**
 * The product page's main-image magnifier (0025).
 *
 * Desktop (hover-capable fine pointer, viewport ≥ 1024px): an
 * Amazon-style lens + side panel at 2×, positioned from the frame's
 * real bounds (fixed, so no ancestor can clip it), pointer-events
 * none and aria-hidden — pure decoration over the image, whose alt
 * text remains the accessible content. Geometry comes from
 * magnifier-geometry (the visibleRegion model), so the panel shows
 * exactly the source area under the cursor, placement included.
 * Updates mutate DOM styles through refs inside requestAnimationFrame
 * — no React re-render per mousemove.
 *
 * Touch / small screens / keyboard: tapping the image (or the zoom
 * button, always present) opens an accessible full-screen zoom
 * dialog at 2.5×, centred on the tapped point, with drag panning.
 */

const HOVER_ZOOM = 2;
const TAP_ZOOM = 2.5;
const ARM_QUERY = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export default function ProductMagnifier({ image }: { image: ShopImage }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const lensRef = useRef<HTMLDivElement | null>(null);
  const panelImgRef = useRef<HTMLImageElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const rafRef = useRef(0);
  const [armed, setArmed] = useState(false);
  const [panelBox, setPanelBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dialog, setDialog] = useState<{ fx: number; fy: number } | null>(null);

  // Arm/disarm with the capability gate.
  useEffect(() => {
    const mq = window.matchMedia(ARM_QUERY);
    setArmed(mq.matches);
    const onChange = () => setArmed(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Natural size via a probe on the same URL (served from cache) —
  // the geometry needs it before any hover math can run.
  useEffect(() => {
    naturalRef.current = null;
    const probe = new Image();
    probe.onload = () => {
      naturalRef.current = { w: probe.naturalWidth, h: probe.naturalHeight };
    };
    probe.src = image.url;
    return () => {
      probe.onload = null;
    };
  }, [image.url]);

  const hidePanel = useCallback(() => {
    setPanelBox(null);
    if (lensRef.current) lensRef.current.style.opacity = "0";
  }, []);

  // A scrolled or resized frame invalidates the cached bounds — hide
  // rather than show a detached panel.
  useEffect(() => {
    if (!panelBox) return;
    const hide = () => hidePanel();
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [panelBox, hidePanel]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const updateZoom = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rectRef.current;
      const nat = naturalRef.current;
      const lens = lensRef.current;
      const img = panelImgRef.current;
      if (!rect || !nat || !lens || !img) return;
      const geo = magnifierGeometry({
        fx: (clientX - rect.left) / rect.width,
        fy: (clientY - rect.top) / rect.height,
        frameWidth: rect.width,
        frameHeight: rect.height,
        panelWidth: rect.width,
        panelHeight: rect.height,
        zoom: HOVER_ZOOM,
        naturalWidth: nat.w,
        naturalHeight: nat.h,
        placement: image.placement,
      });
      if (!geo) {
        // Over letterboxed space (fit: contain) — no image content
        // under the cursor, so no lens and no panel content.
        lens.style.opacity = "0";
        img.style.opacity = "0";
        return;
      }
      lens.style.opacity = "1";
      lens.style.left = `${geo.lensLeft}px`;
      lens.style.top = `${geo.lensTop}px`;
      lens.style.width = `${geo.lensWidth}px`;
      lens.style.height = `${geo.lensHeight}px`;
      img.style.opacity = "1";
      img.style.width = `${geo.imgWidth}px`;
      img.style.height = `${geo.imgHeight}px`;
      img.style.left = `${geo.imgLeft}px`;
      img.style.top = `${geo.imgTop}px`;
    },
    [image.placement],
  );

  const onEnter = (e: React.PointerEvent) => {
    if (!armed || e.pointerType !== "mouse") return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    rectRef.current = rect;
    let left = rect.right + 12;
    if (left + rect.width > window.innerWidth - 8) left = rect.left - rect.width - 12;
    if (left < 8) left = 8;
    const top = clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8));
    setPanelBox({ left, top, width: rect.width, height: rect.height });
    const { clientX, clientY } = e;
    requestAnimationFrame(() => updateZoom(clientX, clientY));
  };

  const onMove = (e: React.PointerEvent) => {
    if (!armed || e.pointerType !== "mouse" || !panelBox) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => updateZoom(clientX, clientY));
  };

  const onFrameClick = (e: React.MouseEvent) => {
    // Desktop hover users already have the magnifier; everyone else
    // (touch, small windows) gets the zoom dialog, centred where
    // they tapped.
    if (armed) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDialog({
      fx: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      fy: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    });
  };

  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <>
      <div
        ref={frameRef}
        className="relative aspect-[3/4] overflow-hidden bg-muted"
        onPointerEnter={onEnter}
        onPointerMove={onMove}
        onPointerLeave={hidePanel}
        onClick={onFrameClick}
      >
        <PlacedImage
          src={image.url}
          alt={image.alt}
          placement={image.placement}
          className="h-full w-full object-cover"
          draggable={false}
        />
        <div
          ref={lensRef}
          aria-hidden
          className="pointer-events-none absolute z-10 border border-accent/80 bg-accent/10 opacity-0"
        />
        <button
          type="button"
          aria-label="Zoom image"
          onClick={(e) => {
            e.stopPropagation();
            setDialog({ fx: 0.5, fy: 0.5 });
          }}
          className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground backdrop-blur-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ZoomIn size={15} />
        </button>
      </div>

      {armed && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-30 overflow-hidden border border-border bg-background shadow-2xl transition-opacity duration-150"
          style={{
            left: panelBox?.left ?? -9999,
            top: panelBox?.top ?? -9999,
            width: panelBox?.width ?? 0,
            height: panelBox?.height ?? 0,
            opacity: panelBox ? 1 : 0,
          }}
        >
          <img
            ref={panelImgRef}
            src={image.url}
            alt=""
            draggable={false}
            className="absolute max-w-none opacity-0"
          />
        </div>
      )}

      {dialog && (
        <ZoomDialog image={image} fx={dialog.fx} fy={dialog.fy} onClose={closeDialog} />
      )}
    </>
  );
}

function ZoomDialog({
  image,
  fx,
  fy,
  onClose,
}: {
  image: ShopImage;
  fx: number;
  fy: number;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const applyPan = useCallback(() => {
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${TAP_ZOOM})`;
    }
  }, []);

  const clampPan = useCallback((x: number, y: number) => {
    const frame = frameRef.current;
    if (!frame) return { x, y };
    const maxX = ((TAP_ZOOM - 1) / 2) * frame.clientWidth;
    const maxY = ((TAP_ZOOM - 1) / 2) * frame.clientHeight;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  // Open centred on the tapped point; lock scroll; manage focus.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame) {
      panRef.current = clampPan(
        -TAP_ZOOM * (fx - 0.5) * frame.clientWidth,
        -TAP_ZOOM * (fy - 0.5) * frame.clientHeight,
      );
      applyPan();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [fx, fy, applyPan, clampPan, onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: panRef.current.x,
      baseY: panRef.current.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    panRef.current = clampPan(drag.baseX + (e.clientX - drag.startX), drag.baseY + (e.clientY - drag.startY));
    applyPan();
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Zoom — ${image.alt}`}
      className="fixed inset-0 z-50 bg-background"
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          ref={frameRef}
          className="relative cursor-grab touch-none overflow-hidden bg-muted active:cursor-grabbing"
          style={{ width: "min(100vw, 75vh)", aspectRatio: "3/4" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div ref={innerRef} className="h-full w-full will-change-transform">
            <PlacedImage
              src={image.url}
              alt={image.alt}
              placement={image.placement}
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        </div>
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close zoom"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-background/85 text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <X size={17} />
      </button>
      <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
        Drag to look around
      </p>
    </div>
  );
}
