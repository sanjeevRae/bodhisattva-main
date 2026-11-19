/**
 * Per-route document metadata — browser tab titles plus the Open
 * Graph / Twitter tags that link previews read.
 *
 * Two layers share this contract:
 *  - this client updater runs on navigation (tab titles, JS-capable
 *    crawlers and in-app browsers), resetting to the route's own
 *    values so a previous page's tags never linger;
 *  - the server's SPA mode (server/src/spa.ts) injects the same tags
 *    into the raw HTML for crawlers that never run JavaScript
 *    (WhatsApp, Facebook, Telegram) — keep the two tables in step.
 */

export const SITE_NAME = "Bodhisattva International";
export const SITE_TITLE =
  "Bodhisattva International — Purna Museum of Newa Art & Bodhisattva Gallery";
export const SITE_DESCRIPTION =
  "Bodhisattva International unites the Purna Museum of Newa Art, Bodhisattva Gallery, the Bodhisattva Foundation and the Gift Shop in Kupondole, Lalitpur — preserving and reimagining the sacred artistic traditions of the Kathmandu Valley.";
export const DEFAULT_SHARE_IMAGE = "/og-share.jpg";

export interface PageMetaInput {
  /** Full document title (already includes the site name). */
  title: string;
  description?: string;
  /** Site-relative or absolute image URL; resolved to absolute. */
  image?: string;
  /** Site-relative path for og:url / canonical (default: current). */
  path?: string;
  type?: "website" | "article";
}

function absoluteUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, window.location.origin).href;
  } catch {
    return pathOrUrl;
  }
}

function upsertMeta(
  attr: "property" | "name",
  key: string,
  content: string,
): void {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Apply one page's metadata to the live document. */
export function setPageMeta(input: PageMetaInput): void {
  const description = input.description?.trim() || SITE_DESCRIPTION;
  const image = absoluteUrl(input.image || DEFAULT_SHARE_IMAGE);
  const url = absoluteUrl(input.path || window.location.pathname);
  document.title = input.title;
  upsertMeta("name", "description", description);
  upsertMeta("property", "og:type", input.type ?? "website");
  upsertMeta("property", "og:site_name", SITE_NAME);
  upsertMeta("property", "og:title", input.title);
  upsertMeta("property", "og:description", description);
  upsertMeta("property", "og:url", url);
  upsertMeta("property", "og:image", image);
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", input.title);
  upsertMeta("name", "twitter:description", description);
  upsertMeta("name", "twitter:image", image);
  let canonical = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", url);
}

interface RouteMeta {
  title: string;
  description?: string;
  image?: string;
}

/** Static per-route metadata for the public pages. */
export const ROUTE_META: Record<string, RouteMeta> = {
  "/": { title: SITE_TITLE },
  "/museum": {
    title: `Purna Museum of Newa Art — ${SITE_NAME}`,
    description:
      "Inside the Purna Museum of Newa Art in Kupondole: three floors of paubha painting, sculpture and repoussé from the Shakya family collection, opened in 2023.",
    image: "/images/pages/museum-banner.jpg",
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
    image: "/images/pages/foundation-banner.jpg",
  },
  "/about": {
    title: `About Us — ${SITE_NAME}`,
    description:
      "The story of Bodhisattva International: a Shakya-family institution in Kupondole, Lalitpur, led by Anjana Shakya, uniting museum, gallery, foundation and gift shop.",
    image: "/images/pages/about-history.jpg",
  },
};

/** The metadata for a pathname (article routes resolve to the archive's). */
export function routeMeta(pathname: string): RouteMeta {
  if (pathname.startsWith("/news/")) return ROUTE_META["/news"];
  return ROUTE_META[pathname] ?? { title: SITE_TITLE };
}
