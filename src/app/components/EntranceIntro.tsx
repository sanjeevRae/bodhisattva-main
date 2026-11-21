import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../styles/entrance.css";

/**
 * First-visit entrance — "The Seal Releases the Ink".
 *
 * Designed with the owner from his reference video (a phone
 * splash whose mark comes alive, forms its lockup, then floods
 * the screen), planned by ChatGPT (Thinking) and Gemini, and
 * cross-reviewed to approval: ChatGPT 9.4/10, Gemini 9.6/10,
 * both "APPROVED TO BUILD" (2026-11-21). The logo itself is the
 * animation:
 *
 *  - 0.00–0.25 s — a 6px muted-gold point awakens at centre; one
 *    hairline gold ring expands from it and fades.
 *  - 0.18–0.58 s — the white disc blooms (scale 0.08 → 1.035 →
 *    1) with a 1px gold keyline and a whisper of shadow.
 *  - 0.42–1.02 s — the ORIGINAL figure artwork is unveiled by a
 *    circular clip-path expanding from the figure's chest.
 *  - 0.95–1.29 s — the eleven ORIGINAL letters of BODHISATTVA
 *    assemble one by one along their arc. The artwork was split
 *    by connected-component analysis of the owner's PNG: the
 *    figure layer lost ONLY the letters' own pixels, and each
 *    letter is an alpha-transparent tile at its exact original
 *    coordinates — figure + tiles recombine to the original
 *    emblem with zero differing pixels (verified).
 *  - 1.40–1.76 s — the complete seal breathes once
 *    (1 → 1.025 → 1); a gold halo expands behind it and fades.
 *  - 1.76–2.26 s — the seal releases the ink: an SVG circle
 *    (fill #1C1A16, stroke #B89758 at a constant 2px) expands
 *    from behind the seal to cover the screen, its radius eased
 *    with the same cubic-bezier(0.16,1,0.3,1); the seal eases to
 *    0.88 as the flood passes.
 *  - 2.26–2.55 s — the end card: the complete white emblem on
 *    the full ink field. Nothing else.
 *  - 2.55–2.98 s — the overlay dissolves onto the dark homepage
 *    hero and is removed from the DOM.
 *
 * Behaviour contract:
 *  - Shown ONCE per visitor. The inline script in index.html
 *    claims the visit (localStorage "bi-entrance-seen") BEFORE
 *    the app loads and adds the `bi-intro` class to <html>; this
 *    component renders only when that class is present, so a
 *    refresh mid-intro or a second tab can never replay it.
 *  - The clock runs from PAGE ENTRY: CSS delays are shifted by
 *    --bi-shift (minus the mount time), and this component's
 *    timers and the flood's rAF read performance.now() — the
 *    time since navigation — so a slow mount can never stretch
 *    the visitor's wait.
 *  - Reduced motion: the inline script never claims the visit,
 *    so this renders nothing; if the preference switches on
 *    while the splash is visible, it removes itself instantly.
 *  - Failsafes, layered honestly: the component unmounts at
 *    2.98 s (3.3 s hard timer); a pure-CSS backstop makes the
 *    overlay transparent, invisible and non-interactive by
 *    ~3.5 s even if no script runs after mount (CSS cannot
 *    remove a node — JavaScript removes it when it can); the
 *    inline script drops its own class at 3.6 s if the app never
 *    mounts. A figure image that fails to load removes the
 *    entrance at once.
 *  - The whole overlay is decorative (aria-hidden): it must
 *    never delay screen-reader or keyboard access to the real
 *    website.
 */

const FLOOD_START_MS = 1760;
const FLOOD_MS = 500;
const LEAVE_MS = 2550; // the end card begins its fade-out
const FADE_MS = 430; // fade-out duration (unmount at 2,980 ms)
const FAILSAFE_MS = 3300; // hard removal, whatever happened

/** The eleven original letters, at their exact coordinates in
 * the emblem's 512×512 space (percentages of the seal). */
const LETTERS: { left: string; top: string; width: string }[] = [
  { left: "13.48%", top: "51.76%", width: "9.77%" }, // B
  { left: "17.38%", top: "61.52%", width: "9.77%" }, // O
  { left: "22.46%", top: "68.95%", width: "11.52%" }, // D
  { left: "30.86%", top: "74.22%", width: "11.91%" }, // H
  { left: "41.41%", top: "77.34%", width: "4.69%" }, // I
  { left: "45.31%", top: "77.73%", width: "9.96%" }, // S
  { left: "54.69%", top: "76.76%", width: "11.33%" }, // A
  { left: "60.74%", top: "72.46%", width: "9.38%" }, // T
  { left: "67.38%", top: "67.19%", width: "9.96%" }, // T
  { left: "72.27%", top: "59.38%", width: "10.94%" }, // V
  { left: "76.76%", top: "51.56%", width: "9.96%" }, // A
];
const LETTER_START_MS = 950;
const LETTER_STEP_MS = 20;

/** cubic-bezier(0.16, 1, 0.3, 1) evaluated in JS, so the flood's
 * radius follows the exact easing of the CSS beats. */
function easeExpoOut(t: number): number {
  const x1 = 0.16;
  const y1 = 1;
  const x2 = 0.3;
  const y2 = 1;
  const cx = (u: number) =>
    3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const cy = (u: number) =>
    3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cx(mid) < t) lo = mid;
    else hi = mid;
  }
  return cy((lo + hi) / 2);
}

export default function EntranceIntro() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(
    () =>
      typeof document === "undefined" ||
      !document.documentElement.classList.contains("bi-intro"),
  );
  // Minus the time already spent reaching this mount, so every
  // CSS delay lands on the page-entry timeline.
  const [shift] = useState(() =>
    typeof performance === "undefined" ? 0 : -Math.round(performance.now()),
  );
  const finishRef = useRef<((instant?: boolean) => void) | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const floodRef = useRef<SVGCircleElement | null>(null);

  useEffect(() => {
    if (gone) return;
    const root = document.documentElement;
    root.classList.add("bi-intro-lock");

    let done = false;
    let raf = 0;
    const timers: number[] = [];
    const later = (fn: () => void, absMs: number) => {
      timers.push(
        window.setTimeout(fn, Math.max(0, absMs - performance.now())),
      );
    };
    const finish = (instant = false) => {
      if (done) return;
      done = true;
      timers.forEach((t) => window.clearTimeout(t));
      if (raf) cancelAnimationFrame(raf);
      root.classList.remove("bi-intro-lock");
      root.classList.remove("bi-intro");
      setGone(true);
    };
    const leave = () => {
      if (done) return;
      setLeaving(true);
      later(() => finish(), LEAVE_MS + FADE_MS);
    };
    finishRef.current = (instant?: boolean) =>
      instant ? finish() : leave();

    // A figure image that already failed before this effect ran
    // must still remove the entrance at once.
    const img = overlayRef.current?.querySelector(".bi-figure");
    if (
      img instanceof HTMLImageElement &&
      img.complete &&
      img.naturalWidth === 0
    ) {
      finish();
      return;
    }

    later(leave, LEAVE_MS);
    later(() => finish(), FAILSAFE_MS);

    // The ink flood: one SVG circle, fill ink, stroke gold at a
    // constant 2px, radius eased on the page-entry clock. If the
    // tab is backgrounded, rAF pauses — the timers above still
    // end the entrance gracefully, flood or no flood.
    const cover =
      Math.hypot(window.innerWidth, window.innerHeight) / 2 + 6;
    const tick = () => {
      if (done) return;
      const t = performance.now();
      const p = (t - FLOOD_START_MS) / FLOOD_MS;
      const circle = floodRef.current;
      if (circle) {
        if (p >= 1) {
          circle.setAttribute("r", String(cover));
        } else if (p > 0) {
          circle.setAttribute("r", String(cover * easeExpoOut(p)));
        }
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMqChange = () => {
      if (mq.matches) finish();
    };
    mq.addEventListener("change", onMqChange);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      if (raf) cancelAnimationFrame(raf);
      mq.removeEventListener("change", onMqChange);
      root.classList.remove("bi-intro-lock");
      finishRef.current = null;
    };
  }, [gone]);

  if (gone) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={`bi-intro-overlay${leaving ? " is-leaving" : ""}`}
      aria-hidden="true"
      style={{ "--bi-shift": `${shift}ms` } as React.CSSProperties}
    >
      <svg className="bi-flood" aria-hidden="true">
        <circle
          ref={floodRef}
          cx="50%"
          cy="50%"
          r="0"
          fill="#1C1A16"
          stroke="#B89758"
          strokeWidth="2"
        />
      </svg>
      <div className="bi-stage">
        <div className="bi-point" />
        <div className="bi-ring1" />
        <div className="bi-halo" />
        <div className="bi-seal-scale">
          <div className="bi-seal-breath">
            <div className="bi-disc">
              <img
                className="bi-figure"
                src="/seal/figure.png"
                alt=""
                width={512}
                height={512}
                draggable={false}
                onError={() => finishRef.current?.(true)}
              />
              {LETTERS.map((pos, i) => (
                <img
                  key={i}
                  className="bi-letter"
                  src={`/seal/letter-${i}.png`}
                  alt=""
                  draggable={false}
                  style={
                    {
                      left: pos.left,
                      top: pos.top,
                      width: pos.width,
                      "--bi-letter-at": `${LETTER_START_MS + i * LETTER_STEP_MS}ms`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
