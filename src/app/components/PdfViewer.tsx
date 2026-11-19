import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

/**
 * PdfViewer — in-site reader for the original newspaper-clipping PDFs
 * (News Clippings module). Renders one page at a time onto a canvas with
 * PDF.js; the worker is bundled by Vite (`?url` import) so no CDN or
 * external asset is involved. Default-exported so callers can load it
 * with React.lazy — pdfjs lands in its own chunk and pages without a
 * PDF never pay for it.
 *
 * The document itself is streamed from the API view URL (byte-range
 * friendly); this component never sees a filesystem path. If PDF.js
 * cannot load or render the file, the viewer degrades to a clear
 * fallback panel with "Open the original PDF" / download links.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  /** API view URL for the PDF (inline disposition). */
  url: string;
  /** API download URL (attachment disposition); defaults to `url`. */
  downloadUrl?: string;
  title?: string;
  onClose?: () => void;
}

type FitMode = "width" | "page" | null;

const toolbarButtonCls =
  "inline-flex items-center justify-center gap-1.5 px-2 py-2 text-muted-foreground hover:text-accent transition-colors disabled:opacity-35 disabled:hover:text-muted-foreground";
const toolbarLabelCls =
  "font-mono text-[0.6rem] tracking-[0.18em] uppercase px-2 py-2 transition-colors disabled:opacity-35";

export default function PdfViewer({ url, downloadUrl, title, onClose }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rendering, setRendering] = useState(false);
  const [fitMode, setFitMode] = useState<FitMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "width" : "page",
  );
  const [scale, setScale] = useState(1);
  const [displayScale, setDisplayScale] = useState(1);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Load (and reload when the URL changes).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setPdf(null);
    setNumPages(0);
    setPageNum(1);
    const task = pdfjsLib.getDocument({ url });
    task.promise.then(
      (doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        if (doc.numPages < 1) {
          setStatus("error");
          return;
        }
        setPdf(doc);
        setNumPages(doc.numPages);
        setStatus("ready");
      },
      () => {
        if (!cancelled) setStatus("error");
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  // Track the scroll area's size so fit modes can compute a scale.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Render the current page whenever the document, page, zoom or the
  // container size changes.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        let effective = scale;
        if (fitMode === "width" && box.w > 0) {
          effective = Math.max(0.1, (box.w - 24) / base.width);
        } else if (fitMode === "page" && box.w > 0 && box.h > 0) {
          effective = Math.max(
            0.1,
            Math.min((box.w - 24) / base.width, (box.h - 24) / base.height),
          );
        }
        const viewport = page.getViewport({ scale: effective });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setDisplayScale((prev) =>
          Math.abs(prev - effective) > 0.001 ? effective : prev,
        );
        setRendering(true);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
      } catch {
        // Render cancellations land here; a genuine render failure
        // leaves the previous page visible, which is the kinder state.
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNum, scale, fitMode, box]);

  const goToPage = (next: number) => {
    setPageNum(Math.min(Math.max(1, next), Math.max(1, numPages)));
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const zoomBy = (factor: number) => {
    setFitMode(null);
    setScale(Math.min(4, Math.max(0.25, displayScale * factor)));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen?.();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") goToPage(pageNum - 1);
    if (event.key === "ArrowRight") goToPage(pageNum + 1);
  };

  return (
    <div
      ref={containerRef}
      className="flex h-[78vh] flex-col border border-border bg-secondary/40 focus:outline-none [&:fullscreen]:h-full [&:fullscreen]:bg-background"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={title ? `PDF viewer: ${title}` : "PDF viewer"}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-background px-2 py-1.5">
        <div className="flex items-center">
          <button
            type="button"
            className={toolbarButtonCls}
            onClick={() => goToPage(pageNum - 1)}
            disabled={pageNum <= 1 || status !== "ready"}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-1 font-mono text-[0.63rem] tracking-[0.14em] uppercase text-muted-foreground whitespace-nowrap">
            Page {numPages > 0 ? pageNum : "–"} of {numPages > 0 ? numPages : "–"}
          </span>
          <button
            type="button"
            className={toolbarButtonCls}
            onClick={() => goToPage(pageNum + 1)}
            disabled={pageNum >= numPages || status !== "ready"}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />

        <div className="flex items-center">
          <button
            type="button"
            className={toolbarButtonCls}
            onClick={() => zoomBy(1 / 1.25)}
            disabled={status !== "ready"}
            aria-label="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
          <span className="w-11 text-center font-mono text-[0.63rem] tracking-wider text-muted-foreground">
            {Math.round(displayScale * 100)}%
          </span>
          <button
            type="button"
            className={toolbarButtonCls}
            onClick={() => zoomBy(1.25)}
            disabled={status !== "ready"}
            aria-label="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className={`${toolbarLabelCls} ${fitMode === "width" ? "text-accent" : "text-muted-foreground hover:text-accent"}`}
            onClick={() => setFitMode("width")}
            disabled={status !== "ready"}
            aria-pressed={fitMode === "width"}
          >
            Fit width
          </button>
          <button
            type="button"
            className={`${toolbarLabelCls} ${fitMode === "page" ? "text-accent" : "text-muted-foreground hover:text-accent"}`}
            onClick={() => setFitMode("page")}
            disabled={status !== "ready"}
            aria-pressed={fitMode === "page"}
          >
            Fit page
          </button>
        </div>

        <div className="ml-auto flex items-center">
          {title && (
            <span className="mr-1 hidden max-w-48 truncate font-sans text-xs text-muted-foreground lg:block">
              {title}
            </span>
          )}
          <button
            type="button"
            className={toolbarButtonCls}
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
          </button>
          <a
            className={toolbarButtonCls}
            href={downloadUrl ?? url}
            download
            aria-label="Download the original PDF"
          >
            <Download size={15} />
          </a>
          {onClose && (
            <button
              type="button"
              className={toolbarButtonCls}
              onClick={onClose}
              aria-label="Close viewer"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Page area */}
      <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain">
        {status === "loading" && (
          <div className="flex h-full items-center justify-center px-6 py-16">
            <p className="animate-pulse font-mono text-[0.68rem] tracking-[0.22em] uppercase text-muted-foreground">
              Loading document…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full items-center justify-center px-6 py-16">
            <div className="max-w-md text-center">
              <AlertTriangle size={22} className="mx-auto mb-4 text-accent" />
              <p className="mb-2 font-display text-xl font-medium">
                This document could not be displayed here
              </p>
              <p className="mb-6 font-sans text-sm font-light leading-relaxed text-muted-foreground">
                Your browser could not open the PDF viewer for this clipping.
                You can still read the original document directly.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 bg-foreground px-5 py-3 font-mono text-[0.63rem] tracking-[0.18em] uppercase text-background transition-colors hover:bg-accent"
                >
                  Open the original PDF
                </a>
                <a
                  href={downloadUrl ?? url}
                  download
                  className="inline-flex items-center gap-2 border border-foreground px-5 py-3 font-mono text-[0.63rem] tracking-[0.18em] uppercase transition-colors hover:border-accent hover:text-accent"
                >
                  <Download size={12} /> Download
                </a>
              </div>
            </div>
          </div>
        )}

        {status === "ready" && (
          <div className="flex min-h-full items-start justify-center p-3">
            <canvas
              ref={canvasRef}
              className={`bg-white shadow-[0_2px_18px_rgba(28,26,22,0.25)] transition-opacity duration-150 ${rendering ? "opacity-60" : "opacity-100"}`}
              aria-label={`Page ${pageNum} of ${numPages}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
