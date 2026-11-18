import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Link2,
  Printer,
} from "lucide-react";
import {
  ApiError,
  getNewsArticle,
  getNewsPreview,
  type NewsArticleDetail,
} from "../lib/api";
import { NewsListRow, formatNewsDate } from "../components/NewsArchive";
import { PageStatus } from "../components/PageRenderer";
import { SectionLabel } from "../components/shared";

/**
 * NewsArticlePage — the reading experience for one clipping, at
 * /news/:slug (and /news/preview/:token for drafts, rendered by the
 * same component in preview mode with a visible banner).
 *
 * Body priority: authored rich text (sanitized server-side, rendered in
 * the .article-body typographic column) — the original PDF is offered
 * below it in the built-in viewer. A PDF-only clipping makes the viewer
 * the primary body. Unknown or draft slugs get the API's 404, shown as
 * a plain "not available" state — drafts are never leaked.
 */

const PdfViewer = lazy(() => import("../components/PdfViewer"));

type LoadState =
  | { status: "loading" }
  | { status: "ok"; article: NewsArticleDetail }
  | { status: "missing" }
  | { status: "error" };

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const solidButtonCls =
  "inline-flex items-center gap-2 bg-foreground px-5 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase text-background transition-colors hover:bg-accent";
const outlineButtonCls =
  "inline-flex items-center gap-2 border border-foreground px-5 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase transition-colors hover:border-accent hover:text-accent";

export default function NewsArticlePage({
  preview = false,
}: {
  preview?: boolean;
}) {
  const params = useParams();
  const slug = preview ? undefined : params.slug;
  const token = preview ? params.token : undefined;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    const load = preview
      ? getNewsPreview(token ?? "")
      : getNewsArticle(slug ?? "");
    load.then(
      (article) => alive && setState({ status: "ok", article }),
      (err: unknown) => {
        if (!alive) return;
        setState({
          status:
            err instanceof ApiError && err.status === 404
              ? "missing"
              : "error",
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [preview, slug, token]);

  if (state.status === "loading") return <PageStatus />;
  if (state.status === "error") return <PageStatus error />;
  if (state.status === "missing") {
    return (
      <div className="pt-16">
        <div className="mx-auto max-w-screen-xl px-6 py-24 text-center lg:px-10">
          <p className="mb-4 font-mono text-[0.6rem] tracking-[0.22em] uppercase text-accent">
            News Clippings
          </p>
          <h1 className="mb-4 font-display text-4xl font-medium">
            This article is not available
          </h1>
          <p className="mx-auto mb-8 max-w-md font-sans text-sm font-light leading-relaxed text-muted-foreground">
            It may have been moved or unpublished. Please browse the archive
            for other clippings.
          </p>
          <Link to="/news" className={outlineButtonCls}>
            <ArrowLeft size={12} /> Back to News Clippings
          </Link>
        </div>
      </div>
    );
  }

  const article = state.article;
  const hasContent = Boolean(article.content && article.content.trim());
  const scrollToPdf = () => {
    document
      .getElementById("article-pdf")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — no-op.
    }
  };

  return (
    <div className="pt-16">
      <article className="mx-auto max-w-screen-xl px-6 pb-20 lg:px-10">
        {/* Breadcrumb + back */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-8">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 font-mono text-[0.55rem] tracking-[0.16em] uppercase text-muted-foreground"
          >
            <Link to="/" className="transition-colors hover:text-accent">
              Home
            </Link>
            <ChevronRight size={10} aria-hidden="true" />
            <Link to="/news" className="transition-colors hover:text-accent">
              News Clippings
            </Link>
            <ChevronRight size={10} aria-hidden="true" />
            <span aria-current="page" className="max-w-56 truncate text-foreground sm:max-w-md">
              {article.title}
            </span>
          </nav>
          <Link
            to="/news"
            className="inline-flex items-center gap-2 font-mono text-[0.55rem] tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:text-accent"
          >
            <ArrowLeft size={11} /> Back to News Clippings
          </Link>
        </div>

        {article.preview && (
          <div
            role="status"
            className="mb-8 border border-accent bg-accent/10 px-5 py-3.5 text-center font-mono text-[0.58rem] tracking-[0.2em] uppercase text-accent"
          >
            Preview — this article has not been published yet
          </div>
        )}

        {/* Header */}
        <header className="mx-auto max-w-4xl">
          <div className="mb-5 flex flex-wrap items-center gap-2.5">
            {article.categoryName && (
              <span
                className={`font-mono text-[0.58rem] tracking-[0.2em] uppercase ${article.colorToken ?? "text-accent"}`}
              >
                {article.categoryName}
              </span>
            )}
            {article.type && (
              <span className="border border-border px-2.5 py-1 font-mono text-[0.52rem] tracking-[0.16em] uppercase text-muted-foreground">
                {article.type}
              </span>
            )}
            {article.isFeatured && (
              <span className="border border-accent px-2.5 py-1 font-mono text-[0.52rem] tracking-[0.16em] uppercase text-accent">
                Featured
              </span>
            )}
          </div>
          <h1 className="font-display text-4xl font-medium leading-[1.08] md:text-6xl">
            {article.title}
          </h1>
          {article.summary && (
            <p className="mt-6 font-display text-2xl font-medium leading-snug text-foreground/75 md:text-[1.7rem]">
              {article.summary}
            </p>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border py-4 font-mono text-[0.55rem] tracking-[0.16em] uppercase text-muted-foreground">
            {article.sourceName && (
              <span className="font-sans text-xs font-medium normal-case tracking-normal text-foreground">
                {article.sourceName}
              </span>
            )}
            {article.author && <span>By {article.author}</span>}
            {article.publishedDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={11} />
                {formatNewsDate(article.publishedDate)}
              </span>
            )}
            {article.readingTimeMinutes != null && (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={11} />
                {article.readingTimeMinutes} min read
              </span>
            )}
          </div>
        </header>

        {/* Featured image */}
        {article.image && (
          <figure className="mx-auto mt-10 max-w-5xl">
            <img
              src={article.image.url}
              alt={article.image.alt}
              className="w-full border border-border bg-secondary"
            />
            {article.image.alt && (
              <figcaption className="mt-2.5 text-center font-sans text-xs font-light text-muted-foreground">
                {article.image.alt}
              </figcaption>
            )}
          </figure>
        )}

        {/* PDF actions */}
        {article.pdf && (
          <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center gap-3">
            <button type="button" onClick={scrollToPdf} className={solidButtonCls}>
              <Eye size={12} /> View Original PDF
            </button>
            <a href={article.pdf.downloadUrl} download className={outlineButtonCls}>
              <Download size={12} /> Download PDF
            </a>
            <span className="font-mono text-[0.52rem] tracking-[0.14em] uppercase text-muted-foreground">
              {article.pdf.originalName}
              {article.pdf.fileSize > 0 &&
                ` · ${formatFileSize(article.pdf.fileSize)}`}
            </span>
          </div>
        )}

        {/* Body */}
        {hasContent && (
          <div
            className="article-body mx-auto mt-12 max-w-[68ch]"
            dangerouslySetInnerHTML={{ __html: article.content as string }}
          />
        )}
        {!hasContent && !article.pdf && (
          <p className="mx-auto mt-12 max-w-[68ch] text-center font-sans text-sm font-light leading-relaxed text-muted-foreground">
            The full text of this clipping is not available online yet.
          </p>
        )}

        {/* Original PDF */}
        {article.pdf && (
          <section
            id="article-pdf"
            aria-label="Original newspaper clipping PDF"
            className="mx-auto mt-16 max-w-5xl scroll-mt-24"
          >
            <SectionLabel>Original clipping</SectionLabel>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-3xl font-medium">
                The original newspaper document
              </h2>
              <span className="font-mono text-[0.52rem] tracking-[0.14em] uppercase text-muted-foreground">
                {article.pdf.originalName}
                {article.pdf.fileSize > 0 &&
                  ` · ${formatFileSize(article.pdf.fileSize)}`}
              </span>
            </div>
            {!hasContent && (
              <p className="mb-6 font-sans text-sm font-light leading-relaxed text-muted-foreground">
                This clipping is preserved as the original scanned document —
                read it below, page by page, or download the PDF.
              </p>
            )}
            <Suspense
              fallback={
                <div className="flex h-[60vh] items-center justify-center border border-border bg-secondary/40">
                  <p className="animate-pulse font-mono text-[0.6rem] tracking-[0.22em] uppercase text-muted-foreground">
                    Loading viewer…
                  </p>
                </div>
              }
            >
              <PdfViewer
                url={article.pdf.viewUrl}
                downloadUrl={article.pdf.downloadUrl}
                title={article.pdf.originalName}
              />
            </Suspense>
          </section>
        )}

        {/* Source + share */}
        <footer className="mx-auto mt-16 max-w-4xl border-t border-border pt-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="font-sans text-sm font-light leading-relaxed text-muted-foreground">
              <p className="mb-1 font-mono text-[0.52rem] tracking-[0.2em] uppercase text-muted-foreground">
                Source
              </p>
              <p>
                {article.sourceName && (
                  <span className="font-medium text-foreground">
                    {article.sourceName}
                  </span>
                )}
                {article.publishedDate &&
                  ` · Published ${formatNewsDate(article.publishedDate)}`}
              </p>
              {article.externalUrl && (
                <a
                  href={article.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[0.55rem] tracking-[0.16em] uppercase text-accent transition-opacity hover:opacity-75"
                >
                  View at source <ExternalLink size={11} />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-2 border border-border px-4 py-2.5 font-mono text-[0.52rem] tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                {copied ? <Check size={11} /> : <Link2 size={11} />}
                {copied ? "Link copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 border border-border px-4 py-2.5 font-mono text-[0.52rem] tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Printer size={11} /> Print
              </button>
              {article.pdf && (
                <a
                  href={article.pdf.downloadUrl}
                  download
                  className="inline-flex items-center gap-2 border border-border px-4 py-2.5 font-mono text-[0.52rem] tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  <Download size={11} /> PDF
                </a>
              )}
            </div>
          </div>
        </footer>

        {/* Related */}
        {article.related.length > 0 && (
          <section aria-label="Related articles" className="mt-20">
            <SectionLabel>Keep reading</SectionLabel>
            <h2 className="mb-2 font-display text-3xl font-medium md:text-4xl">
              Related articles
            </h2>
            <div className="divide-y divide-border border-t border-border">
              {article.related.slice(0, 4).map((related) => (
                <NewsListRow key={related.id} article={related} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-14 text-center">
          <Link to="/news" className={outlineButtonCls}>
            <ArrowLeft size={12} /> Back to News Clippings
          </Link>
        </div>
      </article>
    </div>
  );
}
