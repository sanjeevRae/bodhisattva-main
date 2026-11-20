import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../styles/entrance.css";

/**
 * First-visit entrance — the "Museum Signature Reveal".
 *
 * A single quiet moment of museum identity before the website:
 * the original Bodhisattva emblem (public/logo-emblem.png — the
 * museum's circular mark, resized only, never redrawn or
 * recoloured) fades in on the site's own ivory background, holds
 * briefly, and fades out onto the real homepage.
 *
 * Behaviour contract (owner brief, 2026-11-20; design reviewed by
 * ChatGPT Thinking + Gemini — opacity-only motion, flag claimed
 * up front, independent failsafes):
 *  - Shown ONCE per visitor. The inline script in index.html
 *    claims the visit (writes localStorage "bi-entrance-seen")
 *    BEFORE the app loads and adds the `bi-intro` class to <html>;
 *    this component renders only when that class is present, so a
 *    refresh mid-intro or a second tab can never replay it.
 *  - Reduced motion: the inline script never claims the visit, so
 *    this renders nothing; if the preference switches on while the
 *    intro is visible, it dismisses instantly.
 *  - Dismissal is tied to readiness, not a fixed delay: it waits
 *    for the app shell's first paint (two animation frames after
 *    mount) AND a minimum moment (fade-in + a short quiet hold),
 *    then fades out. A 1600 ms failsafe starts the fade whatever
 *    happens, a pure-CSS backstop hides the overlay by ~2 s even
 *    if every timer failed, and the inline script removes its own
 *    class at 2 s if the app never mounts — the overlay can never
 *    trap a visitor. A logo that fails to load dismisses at once.
 *  - The emblem is decorative (aria-hidden, empty alt): a silent
 *    one-second mark must not delay screen-reader access to the
 *    real website.
 */

const MIN_MS = 620; // 450 ms fade-in + ~170 ms of quiet hold
const FAILSAFE_MS = 1600; // begin the fade-out no later than this
const FADE_MS = 350; // fade-out duration (gone by ~1950 ms worst case)

export default function EntranceIntro() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(
    () =>
      typeof document === "undefined" ||
      !document.documentElement.classList.contains("bi-intro"),
  );
  const dismissRef = useRef<((instant?: boolean) => void) | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (gone) return;
    const root = document.documentElement;
    const startedAt = Date.now();
    root.classList.add("bi-intro-lock");

    let done = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => window.clearTimeout(t));
      root.classList.remove("bi-intro-lock");
      root.classList.remove("bi-intro");
      setGone(true);
    };
    const dismiss = (instant = false) => {
      if (done) return;
      if (instant) {
        finish();
        return;
      }
      setLeaving(true);
      later(finish, FADE_MS);
    };
    dismissRef.current = dismiss;

    // A logo that already failed before this effect ran (a fast
    // network error can beat React's onError) must still dismiss
    // instantly: a complete image with no natural size is a
    // broken one.
    const img = overlayRef.current?.querySelector("img");
    if (img && img.complete && img.naturalWidth === 0) {
      dismiss(true);
      return;
    }

    // Readiness: two consecutive animation frames after this
    // component mounts mean the app shell has actually painted
    // (the shell renders in the same commit). Dismissal then waits
    // only for the remainder of the minimum moment.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        later(
          () => dismiss(false),
          Math.max(0, MIN_MS - (Date.now() - startedAt)),
        );
      });
    });
    // Independent of readiness: never hold the visitor.
    later(() => dismiss(false), FAILSAFE_MS);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMqChange = () => {
      if (mq.matches) dismiss(true);
    };
    mq.addEventListener("change", onMqChange);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      mq.removeEventListener("change", onMqChange);
      root.classList.remove("bi-intro-lock");
      dismissRef.current = null;
    };
  }, [gone]);

  if (gone) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={`bi-intro-overlay${leaving ? " is-leaving" : ""}`}
      aria-hidden="true"
    >
      <img
        className="bi-intro-emblem"
        src="/logo-emblem.png"
        alt=""
        width={384}
        height={384}
        draggable={false}
        onError={() => dismissRef.current?.(true)}
      />
    </div>,
    document.body,
  );
}
