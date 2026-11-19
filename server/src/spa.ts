/**
 * SPA serving with social-share metadata injection (opt-in).
 *
 * Why this exists: WhatsApp, Facebook, Telegram and similar crawlers
 * fetch a shared link's raw HTML and never run JavaScript, so a React
 * SPA that only sets Open Graph tags client-side shows them the
 * generic site preview for every page. When SERVE_SPA is enabled, this
 * server also serves the built frontend (dist/) and injects the
 * page's own OG/Twitter tags into index.html before sending it —
 * for /news/:slug, the published article's title, summary and scan
 * image. The same populated HTML goes to crawlers and browsers alike
 * (no user-agent sniffing); the client app then refines the tags on
 * navigation (src/app/lib/meta.ts — keep the two route tables in step).
 *
 * Safety contract (reviewed with three external reviewers, 2026-11-19):
 *  - Article lookup uses the public eligibility rule only
 *    (isPublished AND deletedAt IS NULL) and never increments the
 *    article view counter — crawlers must not inflate read counts.
 *  - Slugs are validated against ^[a-z0-9-]{1,100}$ before any query.
 *  - Every injected value is attribute-escaped (& < > " '), newlines
 *    are stripped, and summaries are tag-stripped + truncated.
 *  - Replacement uses replacer FUNCTIONS, so a title containing "$&"
 *    or "$1" can never corrupt the template (String.replace tokens).
 *  - og:url / og:image are built from the configured APP_URL origin
 *    only — never from the request's Host header (host-header
 *    poisoning of cached previews). Stored image URLs are accepted
 *    only when site-relative or same-origin; anything else falls
 *    back to the default share image.
 *  - Unknown or unpublished slugs get the default tags — draft
 *    titles/summaries never leak into shared HTML.
 *  - The rendered HTML is never cached (Cache-Control: no-cache);
 *    only the template is read once at boot. Hashed /assets files
 *    are served immutable; unknown asset paths 404 (never index.html,
 *    which would break module MIME checks).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { AppConfig } from "./config/env.js";
import type { Database } from "./database/client.js";
import { mediaAssets, newsArticles } from "./database/schema/index.js";
import { mediaFileUrl } from "./modules/media/media.service.js";
import type { Logger } from "pino";

export const SITE_NAME = "Bodhisattva International";
export const SITE_TITLE =
  "Bodhisattva International — Purna Museum of Newa Art & Bodhisattva Gallery";
export const SITE_DESCRIPTION =
  "Bodhisattva International unites the Purna Museum of Newa Art, Bodhisattva Gallery, the Bodhisattva Foundation and the Gift Shop in Kupondole, Lalitpur — preserving and reimagining the sacred artistic traditions of the Kathmandu Valley.";
export const DEFAULT_SHARE_IMAGE = "/og-share.jpg";
export const SHARE_IMAGE_ALT =
  "A visitor before a monumental Newa Buddhist artwork at the Purna Museum of Newa Art";

export interface SpaMeta {
  title: string;
  description: string;
  /** Site-relative image path or path under the configured origin. */
  image: string;
  /** Site-relative canonical path. */
  path: string;
  type: "website" | "article";
  imageAlt?: string;
}

/** Static per-route metadata — mirror of src/app/lib/meta.ts ROUTE_META. */
export const ROUTE_META: Record<
  string,
  { title: string; description?: string; image?: string }
> = {
  "/": { title: SITE_TITLE },
  "/museum": {
    title: `Purna Museum of Newa Art — ${SITE_NAME}`,
    description:
      "Inside the Purna Museum of Newa Art in Kupondole: three floors of paubha painting, sculpture and repoussé from the Shakya family collection, opened in 2023.",
    image: "/images/pages/museum-hero.jpg",
  },
  "/gallery": {
    title: `Bodhisattva Gallery — ${SITE_NAME}`,
    description:
      "Bodhisattva Gallery, Kupondole — exhibitions of sacred Newa art from the family collection founded in the 1980s by the late Purna Man Shakya.",
  },
  "/shop": {
    title: `Gift Shop — ${SITE_NAME}`,
    description:
      "The Bodhisattva Gift Shop: books, prints and handcrafted pieces from the museum and gallery, available to order with cash on delivery.",
  },
  "/news": {
    title: `News Clippings & Digital Press Archive — ${SITE_NAME}`,
    description:
      "Press coverage of Bodhisattva International and the Purna Museum of Newa Art, preserved as a searchable digital archive with the original printed pages.",
  },
  "/foundation": {
    title: `Bodhisattva Foundation — ${SITE_NAME}`,
    description:
      "The Bodhisattva Foundation sustains Newa artistic traditions — including the Purna Man Singh Memorial Award for young artists.",
    image: "/images/pages/foundation-hero.jpg",
  },
  "/about": {
    title: `About Us — ${SITE_NAME}`,
    description:
      "The story of Bodhisattva International: a Shakya-family institution in Kupondole, Lalitpur, led by Anjana Shakya, uniting museum, gallery, foundation and gift shop.",
    image: "/images/pages/about-history.jpg",
  },
};

const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/;

/** Escape a value for an HTML attribute (and title text) context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text description: markup stripped, whitespace collapsed, ~200 chars. */
export function cleanDescription(value: string | null | undefined): string {
  if (!value) return SITE_DESCRIPTION;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return SITE_DESCRIPTION;
  if (text.length <= 200) return text;
  const cut = text.slice(0, 200);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Accept a stored image reference for og:image only when it resolves
 * to the configured origin: site-relative paths pass through, absolute
 * URLs must be same-origin, everything else falls back to the default.
 */
export function resolveShareImage(
  stored: string | null | undefined,
  origin: string,
): string {
  if (!stored) return DEFAULT_SHARE_IMAGE;
  if (stored.startsWith("/") && !stored.startsWith("//")) return stored;
  try {
    const url = new URL(stored);
    if (url.origin === new URL(origin).origin) {
      return url.pathname + url.search;
    }
  } catch {
    // Not a URL at all — fall through to the default.
  }
  return DEFAULT_SHARE_IMAGE;
}

function absolute(origin: string, pathName: string): string {
  return `${origin.replace(/\/+$/, "")}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
}

/** The full OG/Twitter/canonical block that replaces the marked region. */
export function buildMetaBlock(meta: SpaMeta, origin: string): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(cleanDescription(meta.description));
  const url = escapeHtml(absolute(origin, meta.path));
  const image = escapeHtml(
    absolute(origin, resolveShareImage(meta.image, origin)),
  );
  const imageAlt = escapeHtml(meta.imageAlt ?? SHARE_IMAGE_ALT);
  const lines = [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
  ];
  if (meta.image === DEFAULT_SHARE_IMAGE) {
    lines.push(
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
    );
  }
  lines.push(
    `<meta property="og:image:alt" content="${imageAlt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  );
  return lines.join("\n      ");
}

/**
 * Inject one page's metadata into the built index.html template.
 * Replacer functions are used throughout so "$&"-style sequences in
 * titles can never be interpreted as replacement tokens.
 */
export function renderSpaHtml(
  template: string,
  meta: SpaMeta,
  origin: string,
): string {
  const block = buildMetaBlock(meta, origin);
  let html = template.replace(
    /<!--OG_START-->[\s\S]*?<!--OG_END-->/,
    () => block,
  );
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escapeHtml(meta.title)}</title>`,
  );
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    () =>
      `<meta name="description" content="${escapeHtml(cleanDescription(meta.description))}" />`,
  );
  return html;
}

function defaultMeta(pathname: string): SpaMeta {
  const route = ROUTE_META[pathname] ??
    (pathname.startsWith("/news/")
      ? ROUTE_META["/news"]
      : undefined) ?? { title: SITE_TITLE };
  return {
    title: route.title,
    description: route.description ?? SITE_DESCRIPTION,
    image: route.image ?? DEFAULT_SHARE_IMAGE,
    path: pathname,
    type: "website",
  };
}

/**
 * Published-article metadata for /news/:slug, using the public
 * eligibility rule (published, not deleted) WITHOUT the view counter
 * side effect of the reading endpoint. Returns null for anything
 * else, so drafts and unknown slugs fall back to the default tags.
 */
async function lookupArticleMeta(
  db: Database,
  slug: string,
): Promise<SpaMeta | null> {
  const [row] = await db
    .select({
      title: newsArticles.title,
      summary: newsArticles.summary,
      imageUrl: newsArticles.imageUrl,
      imageAlt: newsArticles.imageAlt,
      coverMediaId: newsArticles.coverMediaId,
    })
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.slug, slug),
        eq(newsArticles.isPublished, true),
        isNull(newsArticles.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  let image = row.imageUrl;
  if (row.coverMediaId != null) {
    const [asset] = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(
        and(eq(mediaAssets.id, row.coverMediaId), isNull(mediaAssets.deletedAt)),
      )
      .limit(1);
    if (asset) image = mediaFileUrl(asset.id, "master");
  }
  return {
    title: `${row.title} — ${SITE_NAME}`,
    description: cleanDescription(row.summary),
    image: image ?? DEFAULT_SHARE_IMAGE,
    path: `/news/${slug}`,
    type: "article",
    imageAlt: row.imageAlt ?? undefined,
  };
}

async function resolveMeta(
  db: Database | undefined,
  pathname: string,
): Promise<SpaMeta> {
  const articleMatch = /^\/news\/([^/]+)$/.exec(pathname);
  if (articleMatch && db) {
    const slug = articleMatch[1];
    if (SLUG_PATTERN.test(slug)) {
      try {
        const meta = await lookupArticleMeta(db, slug);
        if (meta) return meta;
      } catch {
        // A database failure must never break page delivery — the
        // default tags are always safe to serve.
      }
    }
  }
  return defaultMeta(pathname);
}

/**
 * Content-Security-Policy for the SPA document. The global helmet
 * policy stays in force for the API; the document needs inline styles
 * (index.html boot style + component style attributes are attributes,
 * not style elements — the boot <style> is the inline case) and
 * blob: workers/frames for the PDF viewer.
 */
const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export interface SpaOptions {
  config: AppConfig;
  db?: Database;
  /** Frontend build directory; default <repo>/dist. */
  distDir?: string;
  logger?: Logger;
}

/**
 * Mount SPA serving on the app (call BEFORE the API 404 handler).
 * Returns false — and mounts nothing — when the build's index.html
 * cannot be read, so a missing frontend build never breaks the API.
 */
export function mountSpa(app: Express, opts: SpaOptions): boolean {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const distDir =
    opts.distDir ?? path.resolve(moduleDir, "../../dist");
  let template: string;
  try {
    template = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  } catch {
    opts.logger?.warn(
      { distDir },
      "SERVE_SPA is enabled but the frontend build was not found; SPA serving disabled",
    );
    return false;
  }
  const origin = opts.config.appUrl;

  // Dynamic sitemap (registered before static so it wins over any
  // static sitemap.xml in the build): main routes + published articles.
  app.get("/sitemap.xml", async (_req, res) => {
    const urls = Object.keys(ROUTE_META);
    if (opts.db) {
      try {
        const rows = await opts.db
          .select({ slug: newsArticles.slug })
          .from(newsArticles)
          .where(
            and(
              eq(newsArticles.isPublished, true),
              isNull(newsArticles.deletedAt),
            ),
          );
        for (const row of rows) urls.push(`/news/${row.slug}`);
      } catch {
        // Serve the static routes alone rather than failing.
      }
    }
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map((u) => `  <url><loc>${escapeHtml(absolute(origin, u))}</loc></url>`)
        .join("\n") +
      `\n</urlset>\n`;
    res
      .type("application/xml")
      .setHeader("Cache-Control", "public, max-age=300")
      .send(body);
  });

  // Build assets: hashed files are immutable; everything else is
  // served without a long cache so deploys take effect immediately.
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        }
      },
    }),
  );

  const fallback: RequestHandler = async (req, res, next) => {
    // API paths are never the SPA's business — unknown ones belong to
    // the API's JSON 404 handler, mounted after this module.
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    // Unknown paths that look like files were already missed by the
    // static mount — a real 404, never the SPA shell (module scripts
    // would fail with MIME errors instead of a clean 404).
    if (/\.[a-z0-9]{1,10}$/i.test(req.path)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    const meta = await resolveMeta(opts.db, req.path);
    res
      .type("html")
      .setHeader("Cache-Control", "no-cache")
      .setHeader("Content-Security-Policy", SPA_CSP)
      .send(renderSpaHtml(template, meta, origin));
  };
  app.get("/", fallback);
  app.get("/*splat", fallback);
  return true;
}
