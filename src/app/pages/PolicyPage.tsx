import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ApiError, getPolicy, type PolicyPublic } from "../lib/api";
import { buildHeadingIds } from "../lib/slug";
import { setPageMeta } from "../lib/meta";
import { PageStatus } from "../components/PageRenderer";

/**
 * PolicyPage — one of the three legal pages (Privacy Policy, Terms
 * of Use, Accessibility). Content is admin-edited rich text, served
 * sanitized by the API and rendered as HTML.
 *
 * Table of contents: after the body renders, the component walks
 * its h2/h3/h4 elements, assigns each an id built from its
 * textContent (shared slug helpers — restricted alphabet, prefixed,
 * deduped), and builds the TOC from those headings. A scroll
 * listener (rAF-throttled) marks the last heading above the reading
 * line as current; the sticky TOC highlights it. Heading ids are
 * plain DOM property assignments — heading text never becomes
 * markup or a selector.
 */

interface TocEntry {
  id: string;
  text: string;
  level: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ok"; policy: PolicyPublic };

const READING_LINE_PX = 150;

export default function PolicyPage({ slug }: { slug: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    getPolicy(slug).then(
      (policy) => {
        if (!alive) return;
        setState({ status: "ok", policy });
        setPageMeta({
          title: `${policy.title} — Bodhisattva International`,
          path: `/${slug}`,
        });
      },
      (err: unknown) => {
        if (!alive) return;
        setState({
          status: err instanceof ApiError && err.status === 404 ? "missing" : "error",
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [slug]);

  const bodyHtml = state.status === "ok" ? state.policy.bodyHtml : null;

  // Build heading ids + TOC once the body HTML is in the DOM. This
  // effect re-runs when the TOC state flips, because the first pass
  // renders the single-column branch and setting the TOC swaps in
  // the grid branch — a fresh body node whose headings need the ids
  // assigned again. The equality guard keeps that second pass from
  // looping: once the live node's entries match the state, it stops.
  useEffect(() => {
    const container = bodyRef.current;
    if (!container || bodyHtml === null) return;
    const headings = Array.from(
      container.querySelectorAll<HTMLElement>("h2, h3, h4"),
    );
    const ids = buildHeadingIds(
      headings.map((h) => h.textContent ?? ""),
      "policy-section-",
    );
    headings.forEach((h, i) => {
      h.id = ids[i];
    });
    headingsRef.current = headings;
    const entries = headings.map((h, i) => ({
      id: ids[i],
      text: (h.textContent ?? "").trim(),
      level: Number(h.tagName.slice(1)),
    }));
    const unchanged =
      entries.length === toc.length &&
      entries.every((e, i) => e.id === toc[i].id && e.text === toc[i].text && e.level === toc[i].level);
    if (!unchanged) {
      setToc(entries);
      setActiveId(ids[0] ?? null);
    }
  }, [bodyHtml, toc]);

  // Scrollspy: the current section is the last heading that has
  // scrolled above the reading line (just under the fixed header).
  useEffect(() => {
    if (toc.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const headings = headingsRef.current;
      let current: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= READING_LINE_PX) current = h.id;
        else break;
      }
      // At the very bottom the final short sections may never cross
      // the reading line (the page cannot scroll any further) — the
      // last section is what the reader is looking at.
      if (
        headings.length > 0 &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2
      ) {
        current = headings[headings.length - 1].id;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [toc]);

  if (state.status === "loading") return <PageStatus />;
  if (state.status === "error") return <PageStatus error />;
  if (state.status === "missing") return <PageStatus error />;

  const { policy } = state;
  const updated = new Date(policy.updatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hasToc = toc.length > 0;

  const jumpTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActiveId(id);
    setTocOpen(false);
  };

  const tocList = (ordered: TocEntry[]) => (
    <ol className="space-y-1">
      {ordered.map((entry, i) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={jumpTo(entry.id)}
            aria-current={activeId === entry.id ? "location" : undefined}
            className={
              "block rounded-sm px-3 py-1.5 font-sans text-[0.83rem] leading-snug transition-colors " +
              (entry.level === 3 ? "pl-7 " : entry.level === 4 ? "pl-10 " : "") +
              (activeId === entry.id
                ? "bg-accent/10 font-medium text-accent"
                : "font-light text-muted-foreground hover:text-foreground")
            }
          >
            <span className="mr-1.5 font-mono text-[0.7rem] text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pt-32 pb-24 sm:px-8">
      <header className="max-w-[68ch]">
        <p className="font-mono text-[0.6rem] tracking-[0.3em] uppercase text-accent">
          Bodhisattva International
        </p>
        <h1 className="mt-3 font-display text-4xl leading-tight font-medium text-foreground sm:text-5xl">
          {policy.title}
        </h1>
        <p className="mt-4 font-sans text-sm font-light text-muted-foreground">
          Last updated {updated}
        </p>
      </header>

      {hasToc ? (
        <div className="mt-10 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
          {/* Mobile: collapsible contents */}
          <div className="mb-8 lg:hidden">
            <button
              type="button"
              onClick={() => setTocOpen((v) => !v)}
              aria-expanded={tocOpen}
              className="flex w-full items-center justify-between rounded-sm border border-border px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.25em] uppercase text-foreground"
            >
              Contents
              <ChevronDown
                size={14}
                className={"transition-transform " + (tocOpen ? "rotate-180" : "")}
              />
            </button>
            {tocOpen ? <div className="mt-2 border border-border p-2">{tocList(toc)}</div> : null}
          </div>
          {/* Desktop: sticky contents */}
          <aside className="hidden lg:block">
            <nav aria-label="Contents" className="sticky top-28">
              <p className="px-3 pb-2 font-mono text-[0.6rem] tracking-[0.3em] uppercase text-muted-foreground">
                Contents
              </p>
              {tocList(toc)}
            </nav>
          </aside>
          <div ref={bodyRef} className="policy-body min-w-0" dangerouslySetInnerHTML={{ __html: policy.bodyHtml }} />
        </div>
      ) : (
        <div
          ref={bodyRef}
          className="policy-body mt-10 max-w-[68ch]"
          dangerouslySetInnerHTML={{ __html: policy.bodyHtml }}
        />
      )}
    </main>
  );
}
