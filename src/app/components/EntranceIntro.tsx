import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../styles/entrance.css";

/**
 * First-visit entrance — "The Threshold".
 *
 * The museum opens its doors: on a visitor's first visit, two flat
 * ivory panels fill the screen with the museum's emblem held
 * perfectly still at the centre — the original circular mark
 * (public/logo-emblem.png, resized only, never redrawn or
 * recoloured) presented inside a separate fine gold ring so its
 * white disc reads as an enamelled seal. A single gold hairline
 * draws outward beneath the seal, a beat of stillness, then the
 * panels part from the centre (1,100 ms, heavy architectural
 * easing) and reveal the real page; the seal lifts away as the
 * opening widens past it, and the page's own navigation and
 * headline settle in as the doors finish.
 *
 * Design provenance (2026-11-20): the owner's verdict on the first
 * version ("no animation at all") sent the concept back out —
 * ChatGPT (Thinking) and Gemini (maximum model) each proposed
 * concepts independently, both chose parting doors, and both
 * scored this final synthesis 9.4/10. Choreography: line 450 ms,
 * stillness 250 ms, doors from 700 ms for 1,100 ms
 * (cubic-bezier(0.76, 0, 0.24, 1)), seal departure triggered by
 * geometry (gap ≈ 1.1× the framed seal diameter, computed below),
 * settle overlapping the doors' final quarter, complete ≈ 2 s.
 *
 * Behaviour contract:
 *  - Shown ONCE per visitor. The inline script in index.html
 *    claims the visit (writes localStorage "bi-entrance-seen")
 *    BEFORE the app loads and adds the `bi-intro` class to <html>;
 *    this component renders only when that class is present, so a
 *    refresh mid-intro or a second tab can never replay it.
 *  - The animation clock runs from PAGE ENTRY, independent of app
 *    readiness — the entrance never waits on loading. The CSS
 *    animations receive negative delays for whatever time the
 *    bundle took to mount, so the choreography (and the 2 s
 *    finish) is always measured from navigation, and a slow mount
 *    can never stretch the visitor's wait. (The page paints
 *    beneath the closed doors; the doors open on schedule.)
 *  - Reduced motion: the inline script never claims the visit, so
 *    this renders nothing; if the preference switches on while the
 *    intro is visible, it removes itself instantly.
 *  - Failsafes, layered: the component unmounts at 2,000 ms
 *    (2,400 ms hard timer), a pure-CSS backstop hides the overlay
 *    by ~2.6 s even if every timer failed, and the inline script
 *    removes its own class at 2.6 s if the app never mounts — the
 *    overlay can never trap a visitor. A logo that fails to load
 *    removes the entrance at once.
 *  - The whole overlay is decorative (aria-hidden): it must never
 *    delay screen-reader or keyboard access to the real website,
 *    and it is removed from the DOM when it completes.
 */

const SETTLE_MS = 1550; // nav + headline settle begins (doors ~75% open)
const FINISH_MS = 2000; // overlay unmounts (choreography complete)
const FAILSAFE_MS = 2400; // hard removal, whatever happened
const DOORS_START_MS = 700; // line 450 ms + stillness 250 ms
const DOORS_MS = 1100;

/**
 * Invert the doors' easing (cubic-bezier(0.76, 0, 0.24, 1)): given
 * the eased progress p (the revealed gap as a fraction of viewport
 * width), return the fraction of the door duration at which that
 * progress is reached. Used to time the seal's departure to the
 * real opening geometry on any viewport size.
 */
function doorTimeFraction(p: number): number {
  // y(t) = 3(1-t)t^2 + t^3 for control points y1=0, y2=1.
  let lo = 0;
  let hi = 1;
  let t = 0.5;
  for (let i = 0; i < 32; i++) {
    t = (lo + hi) / 2;
    const y = 3 * (1 - t) * t * t + t * t * t;
    if (y < p) lo = t;
    else hi = t;
  }
  // x(t) for control points x1=0.76, x2=0.24.
  const x =
    3 * (1 - t) * (1 - t) * t * 0.76 + 3 * (1 - t) * t * t * 0.24 + t * t * t;
  return x;
}

/**
 * The choreography's CSS delays, measured from page entry. Each
 * panel is 50.5% of the viewport wide and translates by a
 * percentage of its own width, so the revealed gap in pixels is
 * (1.01 × progress − 0.01) × viewport width; the seal's departure
 * is timed for the moment that gap passes 1.1× the framed seal's
 * diameter. Subtracting the time already spent mounting (negative
 * delays start a CSS animation part-way through) keeps every beat
 * on the entry clock.
 */
function computeDelays(): { line: number; doors: number; depart: number } {
  try {
    const entryMs = performance.now();
    const w = window.innerWidth;
    const seal = w <= 400 ? 96 : w <= 768 ? 112 : 152;
    const framed = seal + 10; // 4px gap + 1px ring, both sides
    const p = Math.min(0.62, ((1.1 * framed) / w + 0.01) / 1.01);
    const departAbs = DOORS_START_MS + doorTimeFraction(p) * DOORS_MS;
    return {
      line: Math.round(-entryMs),
      doors: Math.round(DOORS_START_MS - entryMs),
      depart: Math.round(departAbs - entryMs),
    };
  } catch {
    return { line: 0, doors: DOORS_START_MS, depart: 1050 };
  }
}

export default function EntranceIntro() {
  const [gone, setGone] = useState(
    () =>
      typeof document === "undefined" ||
      !document.documentElement.classList.contains("bi-intro"),
  );
  const [delays] = useState(() =>
    typeof window === "undefined"
      ? { line: 0, doors: DOORS_START_MS, depart: 1050 }
      : computeDelays(),
  );
  const finishRef = useRef<(() => void) | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (gone) return;
    const root = document.documentElement;
    root.classList.add("bi-intro-lock");

    let done = false;
    const timers: number[] = [];
    // Timers are scheduled against the page-entry clock, matching
    // the CSS delays: a slow mount shortens the remaining waits
    // instead of stretching the whole sequence.
    const entryElapsed = performance.now();
    const later = (fn: () => void, absMs: number) => {
      timers.push(
        window.setTimeout(fn, Math.max(0, absMs - entryElapsed)),
      );
    };

    // The settle: the site navigation and the page headline are
    // held invisible (the headline also 8px low) while the doors
    // are closed, then released as the doors finish so the page
    // composes itself in front of the visitor. Inline styles are
    // used so nothing in the site's own code needs to know about
    // the entrance; the headline's hold uses the standalone
    // `translate` property, which composes with — never fights —
    // any transform the page's own animation applies.
    const held: HTMLElement[] = [];
    const hold = (el: HTMLElement | null, rise: boolean) => {
      if (!el || held.includes(el)) return;
      el.style.transition = rise
        ? "opacity 400ms ease-out, translate 400ms ease-out"
        : "opacity 250ms ease-out";
      el.style.opacity = "0";
      if (rise) el.style.translate = "0px 8px";
      held.push(el);
    };
    const release = () => {
      held.forEach((el) => {
        el.style.opacity = "1";
        el.style.translate = "0px 0px";
      });
    };
    const clearHeld = () => {
      held.forEach((el) => {
        el.style.removeProperty("opacity");
        el.style.removeProperty("translate");
        el.style.removeProperty("transition");
      });
      held.length = 0;
    };

    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => window.clearTimeout(t));
      // If the settle already ran, its transitions have completed
      // by FINISH_MS, so clearing the inline styles is invisible;
      // on an early finish it simply snaps the page to its natural
      // state. Either way nothing of the entrance is left behind.
      clearHeld();
      root.classList.remove("bi-intro-lock");
      root.classList.remove("bi-intro");
      setGone(true);
    };
    finishRef.current = finish;

    // A logo that already failed before this effect ran (a fast
    // network error can beat React's onError) must still remove
    // the entrance at once: a complete image with no natural size
    // is a broken one.
    const img = overlayRef.current?.querySelector("img");
    if (img && img.complete && img.naturalWidth === 0) {
      finish();
      return;
    }

    hold(document.querySelector("header"), false);
    const findHeadline = () => hold(document.querySelector("main h1"), true);
    findHeadline();
    // The headline is CMS-rendered and may arrive just after mount;
    // look again before the doors open. If it never appears, the
    // settle simply has one less participant.
    later(findHeadline, 350);
    later(findHeadline, 690);

    later(release, SETTLE_MS);
    later(finish, FINISH_MS);
    later(finish, FAILSAFE_MS);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMqChange = () => {
      if (mq.matches) finish();
    };
    mq.addEventListener("change", onMqChange);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      mq.removeEventListener("change", onMqChange);
      clearHeld();
      root.classList.remove("bi-intro-lock");
      finishRef.current = null;
    };
  }, [gone]);

  if (gone) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="bi-intro-overlay"
      aria-hidden="true"
      style={
        {
          "--bi-line-delay": `${delays.line}ms`,
          "--bi-door-delay": `${delays.doors}ms`,
          "--bi-depart-delay": `${delays.depart}ms`,
        } as React.CSSProperties
      }
    >
      <div className="bi-door bi-door-left">
        <div className="bi-line bi-line-left" />
      </div>
      <div className="bi-door bi-door-right">
        <div className="bi-line bi-line-right" />
      </div>
      <div className="bi-intro-seal">
        <img
          className="bi-intro-emblem"
          src="/logo-emblem.png"
          alt=""
          width={384}
          height={384}
          draggable={false}
          onError={() => finishRef.current?.()}
        />
      </div>
    </div>,
    document.body,
  );
}
