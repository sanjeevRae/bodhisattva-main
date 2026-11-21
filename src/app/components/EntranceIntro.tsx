import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../styles/entrance.css";

/**
 * First-visit entrance — "The Quiet Presence".
 *
 * The owner rejected the previous version ("The Seal Releases
 * the Ink", eight animated beats in under three seconds) as
 * "not premium — too fast and too big", and asked for "a premium
 * smooth fade in type". This version was researched and planned
 * with ChatGPT (Thinking) and Gemini, cross-checked against an
 * independent research pass (NN/g guidance; the Met, Rijksmuseum
 * and Apple run no splash at all), and approved as a build gate:
 * ChatGPT 9.3/10, Gemini 9.2/10, both "APPROVED TO BUILD"
 * (2026-11-21). The principle both reviewers converged on: the
 * museum is not performing an entrance — it is quietly opening
 * its doors. Almost nothing happens, slowly:
 *
 *  - 0.00–0.30 s — warm ivory #F7F3EC. Nothing moves.
 *  - 0.30–1.50 s — the white disc fades in (opacity, balanced
 *    ease cubic-bezier(0.4,0,0.6,1)) while settling from scale
 *    0.99 to 1 (the settle alone uses the expo-out curve). The
 *    disc carries a STATIC 1px gold keyline and a soft shadow.
 *  - 0.50–1.85 s — the ORIGINAL figure artwork fades in.
 *    Opacity only: no clip, no blur, no movement.
 *  - 0.85–1.95 s — the eleven ORIGINAL letters of BODHISATTVA
 *    become legible: each alpha-transparent tile (split from the
 *    owner's PNG by connected-component analysis; figure + tiles
 *    recombine to the original with zero differing pixels) fades
 *    in over ~900 ms with a 16 ms stagger, read by the eye as
 *    one soft wave, never as eleven events.
 *  - 1.95–3.00 s — stillness. The complete emblem, absolutely
 *    still. No breath, no glow, no ring.
 *  - 3.00–4.35 s — the dissolve: the ivory field crossfades onto
 *    the dark homepage hero while the seal fades out inside it
 *    (3.20–4.20 s), gone before the field fully clears — no
 *    ghost over the artwork. The overlay leaves the DOM at
 *    4.35 s.
 *
 * The seal is small — clamp(148px, 17vw, 190px) — with generous
 * ivory around it. Opacity is the only animated property except
 * the disc's settle. All opacity fades use the balanced ease:
 * an ease-out curve delivers most opacity early and would feel
 * quick in disguise (ChatGPT's amendment, adopted).
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
 *  - Asset preflight (ChatGPT's amendment): the figure and all
 *    eleven letter tiles must load AND decode before the layered
 *    animation starts. If any layer fails, the intro falls back
 *    to the complete emblem asset as a single fade on the same
 *    timings — if that is ready; otherwise the intro is bypassed
 *    entirely. A partial or damaged wordmark is never shown.
 *  - Non-blocking dismissal (ChatGPT's amendment): the overlay
 *    is pointer-events: none, aria-hidden, with no focusable
 *    descendants. The first pointer, keyboard, wheel or touch
 *    interaction dismisses it instantly via document-level
 *    listeners — without preventDefault or stopPropagation, so
 *    a click both dismisses AND activates what was clicked. The
 *    page beneath is live the whole time.
 *  - Reduced motion: the inline script never claims the visit,
 *    so this renders nothing; if the preference switches on
 *    while the splash is visible, it removes itself instantly.
 *  - Failsafes, layered honestly: the component unmounts at
 *    4.35 s (4.9 s hard timer); a pure-CSS backstop makes the
 *    overlay transparent and invisible by ~5.2 s even if no
 *    script runs after mount (CSS cannot remove a node —
 *    JavaScript removes it when it can); the inline script
 *    drops its own class at 5.4 s if the app never mounts.
 */

const UNMOUNT_MS = 4350; // the dissolve completes; remove the node
const FAILSAFE_MS = 4900; // hard removal, whatever happened

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
const LETTER_START_MS = 850;
const LETTER_STEP_MS = 16;

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
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
