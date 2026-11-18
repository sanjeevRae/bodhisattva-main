/**
 * News Clippings admin (Phase 5, press-archive rework) — news.manage.
 *
 * The archive list: server-side search / category / status / featured /
 * PDF filters, sorting and pagination over GET /api/admin/news, with
 * per-row actions (view, edit, preview, PDF download, publish toggle,
 * duplicate, archive) and bulk publish / unpublish / archive.
 *
 * The editor edits the full record — basic information, the TipTap
 * rich-text body, tags, featured image — and manages the original
 * newspaper-clipping PDF through the dedicated /pdf endpoints (upload
 * with progress, in-admin preview via the shared PdfViewer, replace,
 * remove). Categories keep their own manager below the list.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  Copy,
  Download,
  Eye,
  FileText,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ApiError, newsApi } from "../api";
import { RichTextFieldLazy } from "../fields";
import type {
  NewsArticleAdmin,
  NewsArticleDetailAdmin,
  NewsCategoryAdmin,
  NewsPdfAttachmentAdmin,
} from "../types";
import {
  Badge,
  Btn,
  ConfirmDialog,
  ErrorBox,
  Field,
  Modal,
  Notice,
  Spinner,
  Switch,
  cx,
  formatBytes,
  formatDateTime,
  inputCls,
} from "../ui";
import { ImageFields, orNull, recordThumb, slugify } from "./module-shared";

const PdfViewer = lazy(() => import("../../app/components/PdfViewer"));

const PAGE_SIZE = 25;

const ARTICLE_TYPES = ["News", "Interview", "Feature", "Press Release", "Review"] as const;

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Recently updated" },
  { value: "published", label: "Publication date (newest first)" },
  { value: "title", label: "Title A–Z" },
];

type StatusFilter = "all" | "published" | "draft";

interface ListFilters {
  search: string;
  categoryId: string;
  status: StatusFilter;
  featuredOnly: boolean;
  hasPdfOnly: boolean;
  sort: string;
}

const DEFAULT_FILTERS: ListFilters = {
  search: "",
  categoryId: "",
  status: "all",
  featuredOnly: false,
  hasPdfOnly: false,
  sort: "",
};

type BulkAction = "publish" | "unpublish" | "archive";

export default function NewsScreen() {
  const [articles, setArticles] = useState<NewsArticleAdmin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<NewsCategoryAdmin[]>([]);
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [archiving, setArchiving] = useState<NewsArticleAdmin | null>(null);
  const [archiveError, setArchiveError] = useState<unknown>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ id: number | null } | null>(null);

  const load = useCallback(async (pageNo: number, f: ListFilters) => {
    try {
      const [articleData, categoryData] = await Promise.all([
        newsApi.listArticles({
          page: pageNo,
          pageSize: PAGE_SIZE,
          search: f.search.trim() || undefined,
          categoryId: f.categoryId === "" ? undefined : Number(f.categoryId),
          status: f.status,
          featured: f.featuredOnly || undefined,
          hasPdf: f.hasPdfOnly || undefined,
          sort: f.sort || undefined,
        }),
        newsApi.listCategories(),
      ]);
      setArticles(articleData.items);
      setTotal(articleData.meta.total);
      setPage(pageNo);
      setCategories(categoryData.items);
      setSelected(new Set());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load(1, DEFAULT_FILTERS);
  }, [load]);

  // Non-search filters reload immediately; the search box is debounced.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const applyFilters = (patch: Partial<ListFilters>, debounce = false) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (debounce) return;
    void load(1, next);
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(1, filtersRef.current), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const categoryName = (article: NewsArticleAdmin) =>
    article.category?.name ?? categories.find((c) => c.id === article.categoryId)?.name ?? "—";

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected =
    articles !== null && articles.length > 0 && articles.every((a) => selected.has(a.id));

  const toggleSelectPage = () => {
    if (!articles) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (articles.every((a) => next.has(a.id))) articles.forEach((a) => next.delete(a.id));
      else articles.forEach((a) => next.add(a.id));
      return next;
    });
  };

  const runBulk = async (action: BulkAction) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await newsApi.bulk(ids, action);
      const verb = action === "publish" ? "Published" : action === "unpublish" ? "Unpublished" : "Archived";
      setNotice(
        result.failed.length === 0
          ? `${verb} ${result.succeeded} article${result.succeeded === 1 ? "" : "s"}.`
          : `${verb} ${result.succeeded} of ${ids.length} articles. Failed for ID ${result.failed
              .map((f) => f.id)
              .join(", ")}.`,
      );
      setBulkConfirm(false);
      await load(page, filters);
    } catch (err) {
      setError(err);
    } finally {
      setBulkBusy(false);
    }
  };

  const rowAction = async (article: NewsArticleAdmin, fn: () => Promise<unknown>, done?: string) => {
    setRowBusyId(article.id);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load(page, filters);
    } catch (err) {
      setError(err);
    } finally {
      setRowBusyId(null);
    }
  };

  const openPreview = async (article: NewsArticleAdmin) => {
    setRowBusyId(article.id);
    setError(null);
    try {
      const preview = await newsApi.createPreview(article.id);
      window.open(preview.url, "_blank", "noopener");
    } catch (err) {
      setError(err);
    } finally {
      setRowBusyId(null);
    }
  };

  const toggleFeatured = async (article: NewsArticleAdmin) => {
    setError(null);
    try {
      const updated = await newsApi.updateArticle(article.id, { isFeatured: !article.isFeatured });
      setArticles((prev) =>
        prev === null ? prev : prev.map((a) => (a.id === article.id ? { ...a, isFeatured: updated.isFeatured } : a)),
      );
    } catch (err) {
      setError(err);
    }
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await newsApi.removeArticle(archiving.id);
      setArchiving(null);
      setNotice(`Archived “${archiving.title}”.`);
      await load(page, filters);
    } catch (err) {
      setArchiveError(err);
    } finally {
      setArchiveBusy(false);
    }
  };

  if (editor !== null) {
    return (
      <ArticleEditor
        key={editor.id ?? "new"}
        articleId={editor.id}
        categories={categories}
        onBack={() => {
          setEditor(null);
          void load(page, filters);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-wide">News Clippings</h1>
            <p className="text-sm text-muted-foreground">
              The digital press archive: articles for the News Clippings page and the Home “Latest News” cards, with
              their original PDF clippings.
            </p>
          </div>
          <Btn variant="accent" onClick={() => setEditor({ id: null })}>
            <Plus size={16} /> New article
          </Btn>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex max-w-sm flex-1 items-center gap-2 rounded-sm border border-border bg-background px-3 focus-within:border-accent">
            <Search size={14} className="text-muted-foreground" />
            <input
              className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
              placeholder="Search title, publication or author…"
              value={filters.search}
              onChange={(e) => applyFilters({ search: e.target.value }, true)}
              aria-label="Search articles"
            />
          </label>
          <span className="w-48 shrink-0">
            <select
              className={inputCls}
              value={filters.categoryId}
              onChange={(e) => applyFilters({ categoryId: e.target.value })}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
          <span className="w-36 shrink-0">
            <select
              className={inputCls}
              value={filters.status}
              onChange={(e) => applyFilters({ status: e.target.value as StatusFilter })}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
            </select>
          </span>
          <span className="w-44 shrink-0">
            <select
              className={inputCls}
              value={filters.sort}
              onChange={(e) => applyFilters({ sort: e.target.value })}
              aria-label="Sort articles"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <button
            type="button"
            aria-pressed={filters.featuredOnly}
            onClick={() => applyFilters({ featuredOnly: !filters.featuredOnly })}
            className={cx(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filters.featuredOnly
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            Featured only
          </button>
          <button
            type="button"
            aria-pressed={filters.hasPdfOnly}
            onClick={() => applyFilters({ hasPdfOnly: !filters.hasPdfOnly })}
            className={cx(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filters.hasPdfOnly
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            With PDF
          </button>
          <span className="font-mono text-xs text-muted-foreground">
            {total} article{total === 1 ? "" : "s"}
          </span>
        </div>

        <ErrorBox error={error} />
        {notice && <Notice>{notice}</Notice>}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-card px-4 py-2.5">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <span className="mx-1 h-4 w-px bg-border" />
            <Btn size="sm" disabled={bulkBusy} onClick={() => void runBulk("publish")}>
              Publish
            </Btn>
            <Btn size="sm" disabled={bulkBusy} onClick={() => void runBulk("unpublish")}>
              Unpublish
            </Btn>
            <Btn size="sm" disabled={bulkBusy} onClick={() => setBulkConfirm(true)}>
              <Archive size={13} /> Archive
            </Btn>
            <Btn size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              Clear selection
            </Btn>
            {bulkBusy && <span className="text-xs text-muted-foreground">Working…</span>}
          </div>
        )}

        {articles === null ? (
          <Spinner label="Loading articles…" />
        ) : articles.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No articles match those filters.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="w-full min-w-[72rem] text-sm">
              <thead>
                <tr className="bg-card text-left">
                  <th scope="col" className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all articles on this page"
                      checked={allPageSelected}
                      onChange={toggleSelectPage}
                      className="h-4 w-4 accent-primary"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Article</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Publication</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Date</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Category</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">PDF</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Featured</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Updated</th>
                  <th scope="col" className="px-3 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Created by</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => {
                  const thumb = recordThumb(article);
                  const busy = rowBusyId === article.id;
                  return (
                    <tr key={article.id} className="border-t border-border bg-background hover:bg-secondary/40">
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select “${article.title}”`}
                          checked={selected.has(article.id)}
                          onChange={() => toggleSelected(article.id)}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-3">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt=""
                              className="h-12 w-10 shrink-0 rounded-sm border border-border object-cover"
                            />
                          ) : (
                            <span className="flex h-12 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary/50 text-muted-foreground">
                              {article.hasPdf ? <FileText size={16} /> : <Newspaper size={16} />}
                            </span>
                          )}
                          <span>
                            <span className="font-medium">{article.title}</span>
                            <span className="block font-mono text-xs text-muted-foreground">{article.slug}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{article.outlet ?? "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{article.publishedOn ?? "—"}</td>
                      <td className="px-3 py-3">{categoryName(article)}</td>
                      <td className="px-3 py-3">
                        {article.hasPdf ? (
                          <Badge tone="accent">
                            <span className="max-w-36 truncate" title={article.pdfOriginalName ?? undefined}>
                              {article.pdfOriginalName ?? "PDF"}
                            </span>
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {article.isPublished ? <Badge tone="accent">Published</Badge> : <Badge>Draft</Badge>}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          aria-label={article.isFeatured ? `Unfeature “${article.title}”` : `Feature “${article.title}”`}
                          aria-pressed={article.isFeatured}
                          title={article.isFeatured ? "Featured — click to unfeature" : "Click to feature"}
                          onClick={() => void toggleFeatured(article)}
                          className="rounded-sm p-1.5 hover:bg-secondary"
                        >
                          <Star
                            size={16}
                            className={article.isFeatured ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(article.updatedAt)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{article.createdByName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {article.isPublished && (
                            <a
                              href={`/news/${article.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                            >
                              <Eye size={13} /> View
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                            onClick={() => setEditor({ id: article.id })}
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                            onClick={() => void openPreview(article)}
                          >
                            <Eye size={13} /> Preview
                          </button>
                          {article.hasPdf && (
                            <a
                              href={newsApi.pdfDownloadUrl(article.id)}
                              className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                            >
                              <Download size={13} /> PDF
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                            onClick={() =>
                              void rowAction(
                                article,
                                () =>
                                  article.isPublished
                                    ? newsApi.unpublishArticle(article.id)
                                    : newsApi.publishArticle(article.id),
                                article.isPublished
                                  ? `Unpublished “${article.title}”.`
                                  : `Published “${article.title}”.`,
                              )
                            }
                          >
                            {article.isPublished ? "Unpublish" : "Publish"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                            onClick={() =>
                              void rowAction(
                                article,
                                () => newsApi.duplicateArticle(article.id),
                                `Duplicated “${article.title}” as a new draft.`,
                              )
                            }
                          >
                            <Copy size={13} /> Duplicate
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                            onClick={() => {
                              setArchiveError(null);
                              setArchiving(article);
                            }}
                          >
                            <Archive size={13} /> Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Btn size="sm" disabled={page <= 1} onClick={() => void load(page - 1, filters)}>
              Previous
            </Btn>
            <span className="font-mono text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Btn size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1, filters)}>
              Next
            </Btn>
          </div>
        )}
      </div>

      <CategoriesManager categories={categories} onChanged={() => load(page, filters)} />

      <ConfirmDialog
        open={archiving !== null}
        title="Archive article"
        danger
        busy={archiveBusy}
        confirmLabel="Archive article"
        body={
          <div className="space-y-3">
            <p>
              Archive <strong>{archiving?.title}</strong>? It will disappear from the public site and from this list.
            </p>
            <ErrorBox error={archiveError} />
          </div>
        }
        onConfirm={() => void confirmArchive()}
        onCancel={() => setArchiving(null)}
      />

      <ConfirmDialog
        open={bulkConfirm}
        title="Archive selected articles"
        danger
        busy={bulkBusy}
        confirmLabel={`Archive ${selected.size} article${selected.size === 1 ? "" : "s"}`}
        body={
          <p>
            Archive the {selected.size} selected article{selected.size === 1 ? "" : "s"}? They will disappear from
            the public site and from this list.
          </p>
        }
        onConfirm={() => void runBulk("archive")}
        onCancel={() => setBulkConfirm(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Article editor
// ---------------------------------------------------------------------------

function isEmptyHtml(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return text === "";
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");

  const addFrom = (raw: string) => {
    const incoming = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (incoming.length === 0) return;
    const seen = new Set(tags.map((t) => t.toLowerCase()));
    const next = [...tags];
    for (const tag of incoming) {
      if (!seen.has(tag.toLowerCase())) {
        seen.add(tag.toLowerCase());
        next.push(tag);
      }
    }
    onChange(next);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-background px-2 py-1.5 focus-within:border-accent">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-w-32 flex-1 bg-transparent py-1 text-sm focus:outline-none"
          value={draft}
          placeholder={tags.length === 0 ? "Type a tag, press Enter…" : "Add another…"}
          aria-label="Tags"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addFrom(draft);
              setDraft("");
            } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            addFrom(draft);
            setDraft("");
          }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Separate tags with Enter or a comma.</p>
    </div>
  );
}

function ArticleEditor({
  articleId,
  categories,
  onBack,
}: {
  articleId: number | null;
  categories: NewsCategoryAdmin[];
  onBack: () => void;
}) {
  const [savedId, setSavedId] = useState<number | null>(articleId);
  const [loading, setLoading] = useState(articleId !== null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(articleId !== null);
  const [outlet, setOutlet] = useState("");
  const [author, setAuthor] = useState("");
  const [publishedOn, setPublishedOn] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [articleType, setArticleType] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [content, setContent] = useState("");
  const [coverMediaId, setCoverMediaId] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [pdf, setPdf] = useState<NewsPdfAttachmentAdmin | null>(null);

  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    if (articleId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const detail: NewsArticleDetailAdmin = await newsApi.getArticle(articleId);
        if (cancelled) return;
        setTitle(detail.title);
        setSlug(detail.slug);
        setOutlet(detail.outlet ?? "");
        setAuthor(detail.author ?? "");
        setPublishedOn(detail.publishedOn ?? "");
        setCategoryId(detail.categoryId != null ? String(detail.categoryId) : "");
        setArticleType(detail.articleType ?? "");
        setTags((detail.tags ?? []).map((t) => t.name));
        setSummary(detail.summary ?? "");
        setExternalUrl(detail.externalUrl ?? "");
        setContent(detail.content ?? "");
        setCoverMediaId(detail.coverMediaId ?? null);
        setImageUrl(detail.imageUrl ?? "");
        setImageAlt(detail.imageAlt ?? "");
        setIsPublished(detail.isPublished);
        setIsFeatured(detail.isFeatured ?? false);
        setPdf(detail.attachment ?? null);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  const save = async (publish: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      slug: slug.trim(),
      outlet: orNull(outlet),
      author: orNull(author),
      publishedOn: orNull(publishedOn),
      categoryId: categoryId === "" ? null : Number(categoryId),
      articleType: articleType === "" ? null : articleType,
      summary: orNull(summary),
      content: isEmptyHtml(content) ? null : content,
      externalUrl: orNull(externalUrl),
      coverMediaId,
      imageUrl: orNull(imageUrl),
      imageAlt: orNull(imageAlt),
      isPublished: publish,
      isFeatured,
      tags,
    };
    try {
      if (savedId !== null) {
        await newsApi.updateArticle(savedId, body);
      } else {
        const created = await newsApi.createArticle(body);
        setSavedId(created.id);
      }
      setIsPublished(publish);
      setSlugTouched(true);
      setNotice(publish ? "Article saved and published." : "Article saved as a draft.");
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the article."));
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async () => {
    if (savedId === null) return;
    setPreviewBusy(true);
    setError(null);
    try {
      const preview = await newsApi.createPreview(savedId);
      window.open(preview.url, "_blank", "noopener");
    } catch (err) {
      setError(err);
    } finally {
      setPreviewBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <Spinner label="Loading article…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <ErrorBox error={loadError} />
        <Btn onClick={onBack}>Back to News Clippings</Btn>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            ← Back to News Clippings
          </button>
          <h1 className="font-display text-3xl tracking-wide">
            {savedId !== null ? "Edit article" : "New article"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {savedId !== null && isPublished && (
            <a
              href={`/news/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              <Eye size={13} /> View live
            </a>
          )}
          {savedId !== null && (
            <Btn size="sm" disabled={previewBusy} onClick={() => void openPreview()}>
              <Eye size={13} /> {previewBusy ? "Preparing…" : "Preview"}
            </Btn>
          )}
        </div>
      </div>

      <ErrorBox error={error} />
      {notice && <Notice>{notice}</Notice>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(isPublished);
        }}
        className="space-y-8"
      >
        <section className="space-y-4">
          <h2 className="font-display text-xl tracking-wide">Basic information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <input
                className={inputCls}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                required
                autoFocus={savedId === null}
              />
            </Field>
            <Field label="Slug" hint="Lowercase letters, numbers and hyphens; must be unique.">
              <input
                className={inputCls}
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                required
              />
            </Field>
            <Field label="Publication / source">
              <input
                className={inputCls}
                value={outlet}
                onChange={(e) => setOutlet(e.target.value)}
                placeholder="The Himalayan Times"
              />
            </Field>
            <Field label="Author / journalist">
              <input className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} />
            </Field>
            <Field label="Published date">
              <input
                className={inputCls}
                type="date"
                value={publishedOn}
                onChange={(e) => setPublishedOn(e.target.value)}
              />
            </Field>
            <Field label="Category">
              <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Article type">
              <select className={inputCls} value={articleType} onChange={(e) => setArticleType(e.target.value)}>
                <option value="">Not specified</option>
                {ARTICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="External URL" hint="The story on the publication's own site, when available.">
              <input
                className={inputCls}
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </div>
          <Field label="Tags">
            <TagInput tags={tags} onChange={setTags} />
          </Field>
          <Field label="Summary">
            <textarea className={inputCls} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <ImageFields
            mediaId={coverMediaId}
            mediaLabel="Featured image (media library)"
            imageUrl={imageUrl}
            imageAlt={imageAlt}
            onPatch={(patch) => {
              if (patch.mediaId !== undefined) setCoverMediaId(patch.mediaId);
              if (patch.imageUrl !== undefined) setImageUrl(patch.imageUrl);
              if (patch.imageAlt !== undefined) setImageAlt(patch.imageAlt);
            }}
          />
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl tracking-wide">Article content</h2>
          <p className="text-sm text-muted-foreground">
            The readable version of the clipping, shown on the article page. Leave empty for PDF-only clippings.
          </p>
          <RichTextFieldLazy value={content} onChange={setContent} ariaLabel="Article content" />
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl tracking-wide">Publishing</h2>
          <div className="flex flex-wrap items-center gap-8">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isPublished} onChange={setIsPublished} label="Published" /> Published
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isFeatured} onChange={setIsFeatured} label="Featured" /> Featured
            </span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Btn type="button" onClick={onBack} disabled={busy}>
              Back
            </Btn>
            <Btn type="button" disabled={busy} onClick={() => void save(false)}>
              {busy ? "Saving…" : "Save draft"}
            </Btn>
            <Btn type="button" variant="accent" disabled={busy} onClick={() => void save(true)}>
              {busy ? "Saving…" : "Save & publish"}
            </Btn>
          </div>
        </section>
      </form>

      <PdfPanel articleId={savedId} pdf={pdf} onPdfChange={setPdf} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF attachment panel
// ---------------------------------------------------------------------------

function PdfPanel({
  articleId,
  pdf,
  onPdfChange,
}: {
  articleId: number | null;
  pdf: NewsPdfAttachmentAdmin | null;
  onPdfChange: (pdf: NewsPdfAttachmentAdmin | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const doUpload = async (file: File) => {
    if (articleId === null) return;
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const info = await newsApi.uploadPdf(articleId, file, (fraction) => setProgress(fraction));
      onPdfChange(info);
    } catch (err) {
      // The existing document stays attached — only the error is shown.
      setError(err instanceof ApiError ? err : new Error("The PDF upload failed."));
    } finally {
      setBusy(false);
      setProgress(null);
      setPendingFile(null);
    }
  };

  const onFileChosen = (file: File | null) => {
    if (!file) return;
    if (pdf) {
      // Replacing is destructive to the current attachment — confirm first.
      setPendingFile(file);
      setError(null);
    } else {
      void doUpload(file);
    }
  };

  const confirmRemovePdf = async () => {
    if (articleId === null) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await newsApi.removePdf(articleId);
      onPdfChange(null);
      setConfirmRemove(false);
    } catch (err) {
      setRemoveError(err);
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-display text-xl tracking-wide">Original PDF clipping</h2>
      <p className="text-sm text-muted-foreground">
        The scanned newspaper page or press document, served to readers exactly as uploaded.
      </p>

      <ErrorBox error={error} />

      {articleId === null ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Save the article first — then you can attach its PDF clipping here.
        </p>
      ) : pdf === null ? (
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border px-4 py-4">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText size={16} /> No PDF attached yet.
          </span>
          <Btn type="button" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <Upload size={13} /> {busy ? "Uploading…" : "Upload PDF"}
          </Btn>
          {progress !== null && <UploadProgress progress={progress} />}
        </div>
      ) : (
        <div className="space-y-3 rounded-sm border border-border px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm">
              <FileText size={16} className="text-muted-foreground" />
              <span className="font-medium">{pdf.originalName ?? "Clipping PDF"}</span>
              <span className="text-xs text-muted-foreground">
                {pdf.fileSize != null ? formatBytes(pdf.fileSize) : ""}
                {pdf.createdAt ? ` · uploaded ${formatDateTime(pdf.createdAt)}` : ""}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn type="button" size="sm" onClick={() => setPreviewOpen(true)}>
              <Eye size={13} /> Preview
            </Btn>
            <a
              href={newsApi.pdfDownloadUrl(articleId)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              <Download size={13} /> Download original
            </a>
            <Btn type="button" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <RefreshCw size={13} /> {busy ? "Uploading…" : "Replace…"}
            </Btn>
            <Btn
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRemoveError(null);
                setConfirmRemove(true);
              }}
            >
              <Trash2 size={13} /> Remove
            </Btn>
            {progress !== null && <UploadProgress progress={progress} />}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-label="Choose a PDF file"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          onFileChosen(file);
        }}
      />

      <ConfirmDialog
        open={pendingFile !== null}
        title="Replace the current PDF?"
        confirmLabel="Replace PDF"
        busy={busy}
        body={
          <div className="space-y-3">
            <p>
              Replace <strong>{pdf?.originalName ?? "the current PDF"}</strong> with{" "}
              <strong>{pendingFile?.name}</strong>? Readers will get the new file as soon as the upload finishes.
            </p>
            {progress !== null && <UploadProgress progress={progress} />}
          </div>
        }
        onConfirm={() => pendingFile && void doUpload(pendingFile)}
        onCancel={() => setPendingFile(null)}
      />

      <ConfirmDialog
        open={confirmRemove}
        title="Remove the PDF?"
        danger
        confirmLabel="Remove PDF"
        busy={removeBusy}
        body={
          <div className="space-y-3">
            <p>
              Remove <strong>{pdf?.originalName ?? "the PDF"}</strong> from this article? The article itself stays
              as it is.
            </p>
            <ErrorBox error={removeError} />
          </div>
        }
        onConfirm={() => void confirmRemovePdf()}
        onCancel={() => setConfirmRemove(false)}
      />

      {articleId !== null && (
        <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={pdf?.originalName ?? "PDF preview"} wide>
          <div className="h-[75vh]">
            <Suspense fallback={<Spinner label="Loading PDF viewer…" />}>
              <PdfViewer
                url={newsApi.pdfViewUrl(articleId)}
                downloadUrl={newsApi.pdfDownloadUrl(articleId)}
                title={pdf?.originalName ?? undefined}
              />
            </Suspense>
          </div>
        </Modal>
      )}
    </section>
  );
}

function UploadProgress({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <span className="flex min-w-44 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Categories manager (unchanged from the Phase 5 screen)
// ---------------------------------------------------------------------------

function CategoriesManager({
  categories,
  onChanged,
}: {
  categories: NewsCategoryAdmin[];
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [colorToken, setColorToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<NewsCategoryAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await newsApi.createCategory({ name: name.trim(), slug: slug.trim(), colorToken: orNull(colorToken) });
      setName("");
      setSlug("");
      setSlugTouched(false);
      setColorToken("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not create the category."));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await newsApi.removeCategory(deleting.id);
      setDeleting(null);
      await onChanged();
    } catch (err) {
      // The server refuses with 409 while articles reference the
      // category; its message is surfaced verbatim here.
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl tracking-wide">Categories</h2>
        <p className="text-sm text-muted-foreground">Article types shown on the News page. The colour token is a Tailwind text-colour class pair.</p>
      </div>
      <ErrorBox error={error} />
      <div className="overflow-hidden rounded-sm border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-card text-left">
              <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Name</th>
              <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Slug</th>
              <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Colour token</th>
              <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.id} className="border-t border-border bg-background hover:bg-secondary/40">
                <td className="px-4 py-3 font-medium">
                  <span className={cat.colorToken ?? undefined}>{cat.name}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{cat.slug}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{cat.colorToken ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(cat);
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={create} className="grid items-end gap-3 rounded-sm border border-border p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
        <Field label="Name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
          />
        </Field>
        <Field label="Slug">
          <input
            className={inputCls}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
          />
        </Field>
        <Field label="Colour token">
          <input className={inputCls} value={colorToken} onChange={(e) => setColorToken(e.target.value)} placeholder="text-amber-700 dark:text-amber-400" />
        </Field>
        <Btn type="submit" variant="accent" disabled={busy}>
          <Plus size={14} /> {busy ? "Adding…" : "Add category"}
        </Btn>
      </form>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete category"
        danger
        busy={deleteBusy}
        confirmLabel="Delete category"
        body={
          <div className="space-y-3">
            <p>
              Delete the <strong>{deleting?.name}</strong> category? Categories still used by articles cannot be deleted — the server will refuse.
            </p>
            <ErrorBox error={deleteError} />
          </div>
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
