/**
 * SitePopup — the admin-controlled announcement popup (2026-11-20).
 *
 * Behaviour (plan reviewed by ChatGPT 9/10 + Gemini 8.5/10):
 *  - Home page only; fetched once per page load from GET /api/popup,
 *    which returns the single ACTIVE popup or null. No polling.
 *  - Shown once per visitor: the browser keeps a seen marker in
 *    localStorage keyed by (popup id, version). The marker is written
 *    when the visitor CLOSES the popup (×, backdrop, Esc, or the
 *    button) — never merely because it appeared.
 *  - Editing content in the admin bumps the version, so updated
 *    content shows once more; hide/show of unchanged content does not.
 *  - Fail-silent: any fetch/storage problem means no popup — the site
 *    is never blocked or broken by this feature. Storage access is
 *    wrapped in try/catch (private modes can throw); when storage is
 *    unavailable an in-memory flag still limits it to once per visit.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

export interface PublicPopup {
  id: number;
  version: number;
  heading: string;
  message: string;
  imageUrl: string | null;
  imageAlt: string | null;
  buttonLabel: string | null;
  linkUrl: string | null;
}

const SEEN_PREFIX = "popup-seen:";
const SHOW_DELAY_MS = 700;
const MAX_SEEN_KEYS = 5;

// One fetch per page load, shared across remounts/StrictMode doubles.
let popupPromise: Promise<PublicPopup | null> | null = null;
// In-memory once-per-visit guard for when localStorage is unavailable.
let shownThisVisit = false;

function fetchActivePopup(): Promise<PublicPopup | null> {
  if (!popupPromise) {
    popupPromise = (async () => {
      try {
        const res = await fetch("/api/popup", { headers: { Accept: "application/json" } });
        if (!res.ok) return null;
        const body = (await res.json()) as { success?: boolean; data?: PublicPopup | null };
        if (!body?.success || !body.data) return null;
        const p = body.data;
        if (typeof p.id !== "number" || typeof p.version !== "number" || typeof p.heading !== "string") {
          return null;
        }
        return p;
      } catch {
        return null;
      }
    })();
  }
  return popupPromise;
}

function seenKey(popup: PublicPopup): string {
  return `${SEEN_PREFIX}${popup.id}:${popup.version}`;
}

function hasSeen(popup: PublicPopup): boolean {
  try {
    return window.localStorage.getItem(seenKey(popup)) !== null;
  } catch {
    return false;
  }
}

function markSeen(popup: PublicPopup): void {
  try {
    const store = window.localStorage;
    store.setItem(seenKey(popup), new Date().toISOString());
    // Prune old markers so years of announcements don't accumulate.
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(SEEN_PREFIX)) keys.push(key);
    }
    if (keys.length > MAX_SEEN_KEYS) {
      keys
        .map((key) => ({ key, at: Date.parse(store.getItem(key) ?? "") || 0 }))
        .sort((a, b) => a.at - b.at)
        .slice(0, keys.length - MAX_SEEN_KEYS)
        .forEach(({ key }) => store.removeItem(key));
    }
  } catch {
    // Storage unavailable — the in-memory flag still applies.
  }
}

export default function SitePopup() {
  const { pathname } = useLocation();
  const [popup, setPopup] = useState<PublicPopup | null>(null);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const onHome = pathname === "/";

  useEffect(() => {
    if (!onHome || shownThisVisit) return;
    let cancelled = false;
    let timer: number | undefined;
    void fetchActivePopup().then((data) => {
      if (cancelled || !data) return;
      if (hasSeen(data)) return;
      setPopup(data);
      timer = window.setTimeout(() => {
        if (cancelled) return;
        shownThisVisit = true;
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }, SHOW_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [onHome]);

  const close = () => {
    if (popup) markSeen(popup);
    setOpen(false);
  };

  // Navigating away from the home page while the popup is up closes it
  // cleanly (without marking it seen — the visitor never dismissed it).
  useEffect(() => {
    if (!onHome && open) setOpen(false);
  }, [onHome, open]);

  // Focus the close button on open; restore focus on close; Esc closes;
  // body scroll is locked while the popup is up.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      const prev = restoreFocusRef.current;
      if (prev && document.contains(prev)) prev.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  if (!onHome || !popup) return null;

  const isInternal = popup.linkUrl?.startsWith("/") ?? false;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={popup.heading}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-md bg-background shadow-2xl"
          >
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close announcement"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/50 text-background transition-colors hover:bg-foreground/70"
            >
              <X size={16} />
            </button>
            {popup.imageUrl && (
              <img src={popup.imageUrl} alt={popup.imageAlt ?? ""} className="aspect-[16/9] w-full object-cover" />
            )}
            <div className="space-y-3 px-6 py-6 text-center sm:px-8">
              <h2 className="font-display text-2xl font-medium leading-tight tracking-wide">{popup.heading}</h2>
              <p className="whitespace-pre-line font-sans text-sm font-light leading-relaxed text-muted-foreground">
                {popup.message}
              </p>
              {popup.linkUrl && popup.buttonLabel && (
                <div className="pt-2">
                  {isInternal ? (
                    <Link
                      to={popup.linkUrl}
                      onClick={close}
                      className="inline-block rounded-sm bg-accent px-6 py-2.5 font-sans text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
                    >
                      {popup.buttonLabel}
                    </Link>
                  ) : (
                    <a
                      href={popup.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className="inline-block rounded-sm bg-accent px-6 py-2.5 font-sans text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
                    >
                      {popup.buttonLabel}
                    </a>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
