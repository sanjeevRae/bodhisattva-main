import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../styles/entrance.css";

/**
 * First-visit entrance — "The Inscribed Seal".
 *
 * The owner's rejection history shaped this version. v1 (a
 * plain fade) and v5 "The Quiet Presence" (pure fades, 190px)
 * both died as lifeless — "no animation at all", "the logo is
 * still too big, the animation is not good". v4 (eight beats,
 * 380px) died as theatrical. His words for this round: "make it
 * small — put a good animation, with the premium look and
 * animation." Planned with ChatGPT (Thinking) and Gemini and
 * approved as a build gate — ChatGPT 9.2/10, Gemini 9.1/10,
 * both "APPROVED TO BUILD" (2026-11-22). The principle: ONE
 * visible signature gesture, executed with restraint — a
 * goldsmith inscribing the museum's seal:
 *
 *  - 0.00–0.20 s — warm ivory #F7F3EC. Nothing moves.
 *  - 0.20–0.78 s — the small white disc fades in (balanced ease
 *    cubic-bezier(0.4,0,0.6,1)). No border, no scale — only a
 *    soft static shadow.
 *  - 0.35–1.85 s — THE INSCRIPTION: a 1px gold line draws the
 *    disc's EXACT perimeter in one continuous counterclockwise
 *    pass from 12 o'clock (stroke-dashoffset), then stays as
 *    the seal's gold edge. Fixed radius, no track beneath, no
 *    glow — the undrawn perimeter is simply absent, so it reads
 *    as inscription, never as a progress ring. The stroke is
 *    protected at 1 unit: never thickened (ChatGPT's watchout).
 *  - 0.45–1.60 s — the ORIGINAL figure artwork fades in while
 *    the line draws — an alive interior is what keeps the
 *    gesture from reading as a spinner.
 *  - 0.80–1.60 s — the eleven ORIGINAL letters (alpha-
 *    transparent tiles split from the owner's PNG by connected-
 *    component analysis; figure + tiles recombine to the
 *    original with zero differing pixels) fade in COLLECTIVELY
 *    as one wordmark — no per-letter performance.
 *  - 1.85–2.55 s — stillness: the completed, inscribed seal.
 *  - 2.55–3.95 s — the dissolve: the ivory field crossfades
 *    onto the dark homepage hero while the seal fades out
 *    inside it (2.75–3.70 s). No exit scale. The overlay
 *    leaves the DOM at 3.95 s.
 *
 * The seal is small — clamp(96px, 10vw, 120px) — with generous
 * ivory around it: an institutional seal, not a centrepiece.
 *
 * Behaviour contract:
 *  - Shown ONCE per visitor. The inline script in index.html
 *    claims the visit (localStorage "bi-entrance-seen") BEFORE
 *    the app loads and adds the `bi-intro` class to <html>; this
 *    component renders only when that class is present, so a
 *    refresh mid-intro or a second tab can never replay it.
 *  - The clock runs from PAGE ENTRY: CSS delays are shifted by
 *    --bi-shift (minus the mount time) and this component's
 *    timers read performance.now(), so a slow mount or the
 *    asset preflight can never stretch the visitor's wait.
 *  - Asset preflight: the figure and all eleven letter tiles
 *    must load AND decode before the seal is revealed. If any
 *    layer fails, the intro falls back to the complete emblem
 *    asset as a single fade on the same timings, WITHOUT the
 *    inscription (it already carries its own perimeter) — if
 *    that is ready; otherwise the intro is bypassed entirely.
 *    A partial or damaged wordmark is never shown. The overlay
 *    itself renders from first mount with the seal hidden until
 *    verification passes, so a slow check never flashes the
 *    bare page; a check hanging past 2 s is decided from
 *    whatever has resolved by then.
 *  - Non-blocking dismissal: the overlay is pointer-events:
 *    none, aria-hidden, with no focusable descendants. The
 *    first pointer, keyboard, wheel or touch interaction
 *    dismisses it instantly via document-level listeners —
 *    without preventDefault or stopPropagation, so a click
 *    both dismisses AND activates what was clicked. The page
 *    beneath is live the whole time.
 *  - Reduced motion: the inline script never claims the visit,
 *    so this renders nothing; if the preference switches on
 *    while the splash is visible, it removes itself instantly.
 *  - Failsafes, layered honestly: the component unmounts at
 *    3.95 s (4.5 s hard timer); a pure-CSS backstop makes the
 *    overlay transparent and invisible by ~4.8 s even if no
 *    script runs after mount (CSS cannot remove a node —
 *    JavaScript removes it when it can); the inline script
 *    drops its own class at 5.0 s if the app never mounts.
 */

const UNMOUNT_MS = 3950; // the dissolve completes; remove the node
const FAILSAFE_MS = 4500; // hard removal, whatever happened

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
const FIGURE_SRC = "/seal/figure.png";
const EMBLEM_SRC = "/icon-512.png";
const LAYER_SRCS: string[] = [
  FIGURE_SRC,
  ...LETTERS.map((_, i) => `/seal/letter-${i}.png`),
];

/** True only when the image has loaded AND decoded — a broken
 * or undecodable asset must never reach the screen. */
function imageReady(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === "function") {
        img.decode().then(
          () => resolve(true),
          () => resolve(false),
        );
      } else {
        resolve(img.naturalWidth > 0);
      }
    };
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

type Mode = "checking" | "layers" | "fallback";

export default function EntranceIntro() {
  const [gone, setGone] = useState(
    () =>
      typeof document === "undefined" ||
      !document.documentElement.classList.contains("bi-intro"),
  );
  const [mode, setMode] = useState<Mode>("checking");
  // Minus the time already spent reaching this mount, so every
  // CSS delay lands on the page-entry timeline.
  const [shift] = useState(() =>
    typeof performance === "undefined" ? 0 : -Math.round(performance.now()),
  );
  const finishRef = useRef<(() => void) | null>(null);
  const emblemReadyRef = useRef<boolean | null>(null);

  // Preflight: verify every layered asset before the seal is
  // revealed. The overlay itself renders from the first mount
  // (below), so a slow check can never flash the bare page —
  // the visitor just sees the plan's quiet ivory opening for a
  // beat longer, and the seal's CSS animations (entry-shifted)
  // are already on the clock when it is revealed. A check that
  // hangs past 2 s on the entry clock is decided from whatever
  // has resolved by then: fallback if the emblem is ready,
  // otherwise bypass. Never partial, never blocked.
  useEffect(() => {
    if (gone) return;
    let alive = true;
    let decided = false;
    const decide = (layersOk: boolean, emblem: boolean) => {
      if (!alive || decided) return;
      decided = true;
      emblemReadyRef.current = emblem;
      if (layersOk) {
        setMode("layers");
      } else if (emblem) {
        setMode("fallback");
      } else {
        finishRef.current?.();
      }
    };
    let layersResult: boolean | null = null;
    let emblemResult: boolean | null = null;
    Promise.all(LAYER_SRCS.map(imageReady)).then((layers) => {
      layersResult = layers.every(Boolean);
      if (emblemResult !== null) decide(layersResult, emblemResult);
    });
    imageReady(EMBLEM_SRC).then((emblem) => {
      emblemResult = emblem;
      emblemReadyRef.current = emblem;
      if (layersResult !== null) decide(layersResult, emblem);
    });
    const deadline = window.setTimeout(
      () => decide(layersResult === true, emblemResult === true),
      Math.max(0, 2000 - performance.now()),
    );
    return () => {
      alive = false;
      window.clearTimeout(deadline);
    };
  }, [gone]);

  // Lifecycle: scroll lock, entry-relative timers, dismissal and
  // reduced-motion listeners. Runs from the first mount, so the
  // intro can be dismissed even while the preflight is pending.
  useEffect(() => {
    if (gone) return;
    const root = document.documentElement;
    root.classList.add("bi-intro-lock");

    let done = false;
    const timers: number[] = [];
    const later = (fn: () => void, absMs: number) => {
      timers.push(
        window.setTimeout(fn, Math.max(0, absMs - performance.now())),
      );
    };
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => window.clearTimeout(t));
      root.classList.remove("bi-intro-lock");
      root.classList.remove("bi-intro");
      setGone(true);
    };
    finishRef.current = finish;

    later(finish, UNMOUNT_MS);
    later(finish, FAILSAFE_MS);

    // First contact dismisses instantly — and is NEVER swallowed:
    // no preventDefault, no stopPropagation, and the overlay
    // itself is pointer-events: none, so the visitor's click,
    // keypress or scroll reaches the real page untouched.
    const dismiss = () => finish();
    const opts: AddEventListenerOptions = { passive: true };
    document.addEventListener("pointerdown", dismiss, opts);
    document.addEventListener("keydown", dismiss);
    document.addEventListener("wheel", dismiss, opts);
    document.addEventListener("touchmove", dismiss, opts);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMqChange = () => {
      if (mq.matches) finish();
    };
    mq.addEventListener("change", onMqChange);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("wheel", dismiss);
      document.removeEventListener("touchmove", dismiss);
      mq.removeEventListener("change", onMqChange);
      root.classList.remove("bi-intro-lock");
      finishRef.current = null;
    };
  }, [gone]);

  if (gone) return null;

  return createPortal(
    <div
      className="bi-intro-overlay"
      aria-hidden="true"
      style={{ "--bi-shift": `${shift}ms` } as React.CSSProperties}
    >
      <div className="bi-stage">
        <div
          className="bi-seal-fade"
          style={
            mode === "checking" ? { visibility: "hidden" } : undefined
          }
        >
          {mode === "fallback" ? (
            <img
              className="bi-emblem-full"
              src={EMBLEM_SRC}
              alt=""
              width={512}
              height={512}
              draggable={false}
              onError={() => finishRef.current?.()}
            />
          ) : (
            <>
              <div className="bi-disc">
                <img
                  className="bi-figure"
                  src={FIGURE_SRC}
                  alt=""
                  width={512}
                  height={512}
                  draggable={false}
                  onError={() =>
                    emblemReadyRef.current
                      ? setMode("fallback")
                      : finishRef.current?.()
                  }
                />
                {LETTERS.map((pos, i) => (
                  <img
                    key={i}
                    className="bi-letter"
                    src={`/seal/letter-${i}.png`}
                    alt=""
                    draggable={false}
                    onError={() =>
                      emblemReadyRef.current
                        ? setMode("fallback")
                        : finishRef.current?.()
                    }
                    style={{
                      left: pos.left,
                      top: pos.top,
                      width: pos.width,
                    }}
                  />
                ))}
              </div>
              {/* The inscription: two half-arcs forming the disc's
                  exact perimeter, starting at 12 o'clock and drawn
                  counterclockwise (sweep 0). pathLength normalises
                  the dash to 100 units. */}
              <svg
                className="bi-inscribe"
                viewBox="0 0 120 120"
                aria-hidden="true"
              >
                <path
                  d="M 60 0.5 A 59.5 59.5 0 1 0 60 119.5 A 59.5 59.5 0 1 0 60 0.5"
                  pathLength={100}
                />
              </svg>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
