import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowRight,
  FileText,
  Newspaper,
  RotateCcw,
  SearchX,
  Star,
} from "lucide-react";
import {
  getNewsArchive,
  getNewsFacets,
  type NewsArchiveItem,
  type NewsFacets,
  type NewsListMeta,
  type NewsSort,
} from "../lib/api";

/**
 * NewsArchive — the digital press archive under the /news hero band.
 *
 * Everything is server-driven: search (the hero input, passed in as
 * `query`), the filter bar and Load More all call GET /api/news with
 * query params; filter options come from GET /api/news/facets. Filter
 * state lives in the URL (useSearchParams) so filtered views are
 * shareable and the back button works. The hero search is mirrored into
 * the `search` param once it settles (debounced) for the same reason.
 *
 * Layout is editorial, not a shop grid: a featured story block (only in
 * the unfiltered view), then ruled rows — thumbnail left, text right —
 * in the visual language of the Phase 5 news rows.
 */

const PAGE_SIZE = 10;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-05" → "05 Aug 2026" (same display format as PageRenderer). */
export function formatNewsDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

const SORT_OPTIONS: { value: NewsSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "added", label: "Recently added" },
  { value: "alpha", label: "Alphabetical (A–Z)" },
];

// ---------------------------------------------------------------------------
// One archive row (also reused for the article page's Related list).
// ---------------------------------------------------------------------------

export function NewsListRow({
  article,
  lead = false,
}: {
  article: NewsArchiveItem;
  lead?: boolean;
}) {
  return (
    <article className="group grid gap-6 py-8 md:grid-cols-12">
      <Link
        to={`/news/${article.slug}`}
        className={`block ${lead ? "md:col-span-5" : "md:col-span-4 lg:col-span-3"}`}
        aria-label={article.title}
      >
        <div className="aspect-[4/3] overflow-hidden border border-border bg-muted">
          {article.image ? (
            <img
              src={article.image.url}
              alt={article.image.alt}
              loading="lazy"
              className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-secondary px-4 text-center">
              <Newspaper size={22} className="text-accent" />
              <span className="font-display text-sm font-medium tracking-wide text-muted-foreground">
                {article.sourceName ?? "News Clipping"}
              </span>
            </div>
          )}
        </div>
      </Link>
      <div className={lead ? "md:col-span-7" : "md:col-span-8 lg:col-span-9"}>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {article.categoryName && (
            <span
              className={`font-mono text-[0.52rem] tracking-widest uppercase ${article.colorToken ?? "text-accent"}`}
            >
              {article.categoryName}
            </span>
          )}
          <span className="font-mono text-[0.52rem] tracking-wider text-muted-foreground">
            {formatNewsDate(article.publishedDate)}
          </span>
          {article.isFeatured && (
            <span className="inline-flex items-center gap-1 font-mono text-[0.52rem] tracking-widest uppercase text-accent">
              <Star size={10} /> Featured
            </span>
          )}
        </div>
        {article.sourceName && (
          <p className="mb-1.5 font-sans text-xs font-medium text-foreground">
            {article.sourceName}
          </p>
        )}
        <Link to={`/news/${article.slug}`}>
          <h3
            className={`font-display font-medium leading-snug transition-colors group-hover:text-accent ${
              lead ? "text-2xl md:text-[2rem]" : "text-xl"
            }`}
          >
            {article.title}
          </h3>
        </Link>
        {article.summary && (
          <p className="mt-3 max-w-3xl font-sans text-sm font-light leading-relaxed text-muted-foreground line-clamp-3">
            {article.summary}
          </p>
        )}
        {article.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <span
                key={tag.id}
                className="border border-border px-2 py-1 font-mono text-[0.5rem] tracking-widest uppercase text-muted-foreground"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-6">
          <Link
            to={`/news/${article.slug}`}
            className="flex items-center gap-2 font-mono text-[0.55rem] tracking-widest uppercase text-foreground transition-colors hover:text-accent"
          >
            Read Article <ArrowRight size={11} />
          </Link>
          {article.hasPdf && (
            <Link
              to={`/news/${article.slug}`}
              className="flex items-center gap-2 font-mono text-[0.55rem] tracking-widest uppercase text-muted-foreground transition-colors hover:text-accent"
            >
              <FileText size={11} /> View PDF
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Filter bar pieces.
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1.5 sm:flex-none">
      <span className="font-mono text-[0.5rem] tracking-[0.2em] uppercase text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border bg-background px-3 py-2.5 font-sans text-sm text-foreground focus:border-accent focus:outline-none sm:w-auto"
      >
        {children}
      </select>
    </label>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`border px-3.5 py-2.5 font-mono text-[0.52rem] tracking-[0.16em] uppercase transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:border-accent hover:text-accent"
      }`}
    >
      {label}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid animate-pulse gap-6 py-10 md:grid-cols-12">
          <div className="aspect-[4/3] bg-muted md:col-span-4 lg:col-span-3" />
          <div className="space-y-3 md:col-span-8 lg:col-span-9">
            <div className="h-3 w-44 bg-muted" />
            <div className="h-6 w-3/4 bg-muted" />
            <div className="h-3 w-full bg-muted" />
            <div className="h-3 w-2/3 bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The archive.
// ---------------------------------------------------------------------------

export default function NewsArchive({
  query,
  onClearQuery,
}: {
  /** The hero search input's value (owned by NewsPage). */
  query: string;
  /** Called when the archive clears all filters, hero search included. */
  onClearQuery?: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get("category") ?? "";
  const publication = searchParams.get("publication") ?? "";
  const year = searchParams.get("year") ?? "";
  const type = searchParams.get("type") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const hasPdf = searchParams.get("hasPdf") === "1";
  const featuredOnly = searchParams.get("featured") === "1";
  const sortParam = searchParams.get("sort");
  const sort: NewsSort = SORT_OPTIONS.some((o) => o.value === sortParam)
    ? (sortParam as NewsSort)
    : "newest";

  // Debounce the hero search before it drives fetches / the URL.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Mirror the settled search into the URL (replace, so typing does not
  // stack history entries) — filtered views stay shareable end to end.
  useEffect(() => {
    const settled = debouncedQuery.trim();
    if ((searchParams.get("search") ?? "") === settled) return;
    const next = new URLSearchParams(searchParams);
    if (settled) next.set("search", settled);
    else next.delete("search");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const filtersActive = Boolean(
    debouncedQuery.trim() ||
      category ||
      publication ||
      year ||
      type ||
      dateFrom ||
      dateTo ||
      hasPdf ||
      featuredOnly,
  );

  // Facets (filter options) — fetched once; a failure just leaves the
  // selects with their "All" option, the archive itself still works.
  const [facets, setFacets] = useState<NewsFacets | null>(null);
  useEffect(() => {
    let alive = true;
    getNewsFacets().then(
      (data) => alive && setFacets(data),
      () => alive && setFacets(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Featured story — only in the unfiltered view.
  const [featured, setFeatured] = useState<NewsArchiveItem | null>(null);
  useEffect(() => {
    if (filtersActive) {
      setFeatured(null);
      return;
    }
    let alive = true;
    getNewsArchive({ featured: true, page: 1, pageSize: 1 }).then(
      (result) => alive && setFeatured(result.items[0] ?? null),
      () => alive && setFeatured(null),
    );
    return () => {
      alive = false;
    };
  }, [filtersActive]);

  // Result list with Load More pagination.
  const [items, setItems] = useState<NewsArchiveItem[]>([]);
  const [meta, setMeta] = useState<NewsListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const searchTerm = debouncedQuery.trim();
  const fetchPage = useCallback(
    (pageToLoad: number) =>
      getNewsArchive({
        search: searchTerm || undefined,
        category: category || undefined,
        publication: publication || undefined,
        year: year ? Number(year) : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        type: type || undefined,
        hasPdf: hasPdf || undefined,
        featured: featuredOnly || undefined,
        sort,
        page: pageToLoad,
        pageSize: PAGE_SIZE,
      }),
    [
      searchTerm,
      category,
      publication,
      year,
      dateFrom,
      dateTo,
      type,
      hasPdf,
      featuredOnly,
      sort,
    ],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setMoreError(false);
    setPage(1);
    fetchPage(1).then(
      (result) => {
        if (!alive) return;
        setItems(result.items);
        setMeta(result.meta);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [fetchPage, reloadTick]);

  const loadMore = async () => {
    if (!meta || loadingMore || items.length >= meta.total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const result = await fetchPage(nextPage);
      setItems((prev) => [...prev, ...result.items]);
      setMeta(result.meta);
      setPage(nextPage);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => {
    onClearQuery?.();
    setSearchParams(new URLSearchParams());
  };

  // The featured story also appears in the default listing — don't show
  // it twice when its block is on screen.
  const showFeatured = !filtersActive && featured !== null;
  const visibleItems = useMemo(
    () =>
      showFeatured && featured
        ? items.filter((item) => item.id !== featured.id)
        : items,
    [items, showFeatured, featured],
  );
  const allLoaded = meta !== null && items.length >= meta.total;

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12 lg:px-10">
      {/* Featured story */}
      {showFeatured && featured && (
        <section aria-label="Featured clipping" className="mb-14">
          <div className="grid border border-border bg-secondary/50 lg:grid-cols-2">
            <Link
              to={`/news/${featured.slug}`}
              className="group relative block aspect-[16/10] overflow-hidden bg-muted lg:aspect-auto lg:min-h-[22rem]"
              aria-label={featured.title}
            >
              {featured.image ? (
                <img
                  src={featured.image.url}
                  alt={featured.image.alt}
                  className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-secondary px-6 text-center">
                  <Newspaper size={30} className="text-accent" />
                  <span className="font-display text-lg font-medium text-muted-foreground">
                    {featured.sourceName ?? "News Clipping"}
                  </span>
                </div>
              )}
            </Link>
            <div className="flex flex-col justify-center p-8 md:p-12">
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 font-mono text-[0.55rem] tracking-[0.2em] uppercase text-accent">
                  <Star size={11} /> Featured clipping
                </span>
                {featured.categoryName && (
                  <span
                    className={`font-mono text-[0.52rem] tracking-widest uppercase ${featured.colorToken ?? "text-accent"}`}
                  >
                    {featured.categoryName}
                  </span>
                )}
              </div>
              <p className="mb-2 font-sans text-sm font-medium text-foreground">
                {featured.sourceName}
                {featured.publishedDate && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {formatNewsDate(featured.publishedDate)}
                  </span>
                )}
              </p>
              <Link to={`/news/${featured.slug}`}>
                <h2 className="font-display text-3xl font-medium leading-tight transition-colors hover:text-accent md:text-4xl">
                  {featured.title}
                </h2>
              </Link>
              {featured.summary && (
                <p className="mt-4 font-sans text-sm font-light leading-relaxed text-muted-foreground">
                  {featured.summary}
                </p>
              )}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  to={`/news/${featured.slug}`}
                  className="inline-flex items-center gap-2 bg-foreground px-5 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase text-background transition-colors hover:bg-accent"
                >
                  Read Article <ArrowRight size={12} />
                </Link>
                {featured.hasPdf && (
                  <Link
                    to={`/news/${featured.slug}`}
                    className="inline-flex items-center gap-2 border border-foreground px-5 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase transition-colors hover:border-accent hover:text-accent"
                  >
                    <FileText size={12} /> View PDF
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Filter bar */}
      <section
        aria-label="Filter the archive"
        className="mb-4 border border-border bg-secondary/40 px-5 py-5"
      >
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <FilterSelect
            label="Category"
            value={category}
            onChange={(v) => setParam("category", v)}
          >
            <option value="">All categories</option>
            {(facets?.categories ?? []).map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name} ({c.count})
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Publication"
            value={publication}
            onChange={(v) => setParam("publication", v)}
          >
            <option value="">All publications</option>
            {(facets?.publications ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.count})
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Year"
            value={year}
            onChange={(v) => setParam("year", v)}
          >
            <option value="">All years</option>
            {(facets?.years ?? []).map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Type"
            value={type}
            onChange={(v) => setParam("type", v)}
          >
            <option value="">All types</option>
            {(facets?.types ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Sort by"
            value={sort}
            onChange={(v) => setParam("sort", v === "newest" ? "" : v)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-4 border-t border-border pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.5rem] tracking-[0.2em] uppercase text-muted-foreground">
              From
            </span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setParam("dateFrom", e.target.value)}
              className="border border-border bg-background px-3 py-2.5 font-sans text-sm text-foreground focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.5rem] tracking-[0.2em] uppercase text-muted-foreground">
              To
            </span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setParam("dateTo", e.target.value)}
              className="border border-border bg-background px-3 py-2.5 font-sans text-sm text-foreground focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            <ToggleChip
              label="PDF available"
              active={hasPdf}
              onClick={() => setParam("hasPdf", hasPdf ? "" : "1")}
            />
            <ToggleChip
              label="Featured"
              active={featuredOnly}
              onClick={() => setParam("featured", featuredOnly ? "" : "1")}
            />
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-2 py-2.5 font-mono text-[0.52rem] tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:text-accent"
              >
                <RotateCcw size={11} /> Clear filters
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Result count */}
      {!loading && !error && meta && (
        <p className="py-4 font-mono text-[0.55rem] tracking-[0.2em] uppercase text-muted-foreground">
          {meta.total} {meta.total === 1 ? "article" : "articles"}
          {searchTerm && (
            <>
              {" "}
              for &ldquo;{searchTerm}&rdquo;
            </>
          )}
        </p>
      )}

      {/* Results */}
      {loading && <SkeletonRows />}

      {!loading && error && (
        <div className="py-20 text-center">
          <p className="mb-3 font-display text-2xl font-medium">
            The archive could not be loaded
          </p>
          <p className="mx-auto mb-7 max-w-md font-sans text-sm font-light leading-relaxed text-muted-foreground">
            Something went wrong while fetching the clippings. Please try
            again.
          </p>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="inline-flex items-center gap-2 border border-foreground px-5 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase transition-colors hover:border-accent hover:text-accent"
          >
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="py-20 text-center">
          <SearchX size={24} className="mx-auto mb-4 text-accent" />
          <p className="mb-3 font-display text-2xl font-medium">
            No clippings match your search
          </p>
          <p className="mx-auto mb-7 max-w-md font-sans text-sm font-light leading-relaxed text-muted-foreground">
            Try a different keyword, or clear the filters to browse the full
            archive.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-2 border border-foreground px-5 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase transition-colors hover:border-accent hover:text-accent"
          >
            <RotateCcw size={12} /> Clear filters
          </button>
        </div>
      )}

      {!loading && !error && visibleItems.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {visibleItems.map((article, index) => (
            <NewsListRow
              key={article.id}
              article={article}
              lead={!showFeatured && !filtersActive && index === 0}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {!loading && !error && meta && !allLoaded && (
        <div className="flex flex-col items-center gap-3 py-10">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 bg-foreground px-6 py-3.5 font-mono text-[0.55rem] tracking-[0.18em] uppercase text-background transition-colors hover:bg-accent disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more articles"}
          </button>
          <p className="font-mono text-[0.52rem] tracking-[0.18em] uppercase text-muted-foreground">
            Showing {items.length} of {meta.total}
          </p>
          {moreError && (
            <p className="font-sans text-xs text-destructive">
              Could not load more articles — please try again.
            </p>
          )}
        </div>
      )}
      {!loading && !error && meta && allLoaded && items.length > PAGE_SIZE && (
        <p className="py-10 text-center font-mono text-[0.52rem] tracking-[0.18em] uppercase text-muted-foreground">
          All {meta.total} articles loaded
        </p>
      )}
    </div>
  );
}
