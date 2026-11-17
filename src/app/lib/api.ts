import { useEffect, useState } from "react";

/**
 * Tiny client for the public CMS API (ARCHITECTURE.md §5.1/§8.3).
 *
 * All requests are same-origin relative `/api/...` URLs — the Vite dev /
 * preview proxy forwards them to the API server on :4000, and production
 * serves both from one origin, so no base-URL configuration is needed.
 *
 * Responses are cached at module level (one fetch per resource per page
 * load): Nav, Footer, PageRenderer and the contact-information section
 * all share the same menus/settings/page payloads.
 */

export interface CmsImageRef {
  url: string;
  alt: string;
}

export interface CmsLinkRef {
  kind: "page" | "url";
  label: string;
  style?: "solid" | "outline";
  /** Set for kind: "page" — a `pages.id`; resolve via the page path map. */
  pageId?: number;
  /** Set in site settings (not seed-resolved) for kind: "page". */
  pageSlug?: string;
  url?: string;
}

export interface CmsSection {
  type: string;
  sortOrder: number;
  // Section config is registry-validated server-side at save time; the
  // shapes per type are defined by CMS_CONTENT_MAPPING.md and mirrored
  // in server/src/database/seed-data/cms-content.ts.
  config: Record<string, any>;
  design: Record<string, any> | null;
}

export interface CmsPage {
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  sections: CmsSection[];
}

export interface CmsMenuItem {
  id: number;
  label: string;
  linkType: "PAGE" | "EXTERNAL" | "ANCHOR";
  pageId: number | null;
  slug: string | null;
  path: string | null;
  url: string | null;
  sortOrder: number;
  isVisible: boolean;
}

export interface CmsMenu {
  code: string;
  name: string;
  items: CmsMenuItem[];
}

export type SiteSettings = Record<string, unknown>;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const pending = load();
  cache.set(key, pending);
  // Never cache a rejection — a later mount should retry.
  pending.catch(() => cache.delete(key));
  return pending;
}

export function getPage(slug: string): Promise<CmsPage> {
  return cached(`page:${slug}`, () => fetchJson<CmsPage>(`/api/pages/${slug}`));
}

export function getMenu(code: string): Promise<CmsMenu> {
  return cached(`menu:${code}`, () => fetchJson<CmsMenu>(`/api/menus/${code}`));
}

export function getSiteSettings(): Promise<SiteSettings> {
  return cached("site", async () => {
    const data = await fetchJson<{ settings: SiteSettings }>("/api/site");
    return data.settings ?? {};
  });
}

/**
 * pageId → public path, built from the `primary` menu (its items carry
 * both). Needed because section config links reference pages by id only
 * (see the contract-gap note in docs/phase-3/visual-diff.md).
 */
export function getPagePathMap(): Promise<Map<number, string>> {
  return cached("page-path-map", async () => {
    const menu = await getMenu("primary");
    const map = new Map<number, string>();
    for (const item of menu.items) {
      if (item.pageId != null && item.path) map.set(item.pageId, item.path);
    }
    return map;
  });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface AsyncState<T> {
  data: T | null;
  error: boolean;
}

function useCached<T>(load: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: false });
  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ data, error: false }),
      () => alive && setState({ data: null, error: true }),
    );
    return () => {
      alive = false;
    };
    // `load` is one of the module-level cached getters — stable per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

export function usePage(slug: string): AsyncState<CmsPage> {
  const [state, setState] = useState<AsyncState<CmsPage>>({ data: null, error: false });
  useEffect(() => {
    let alive = true;
    getPage(slug).then(
      (data) => alive && setState({ data, error: false }),
      () => alive && setState({ data: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [slug]);
  return state;
}

export function useMenu(code: string): AsyncState<CmsMenu> {
  return useCached(() => getMenu(code));
}

export function useSiteSettings(): AsyncState<SiteSettings> {
  return useCached(getSiteSettings);
}

export function usePagePathMap(): Map<number, string> | null {
  const { data } = useCached(getPagePathMap);
  return data;
}

/** Read a string setting, falling back when absent or not a string. */
export function settingString(settings: SiteSettings | null, key: string, fallback: string): string {
  const value = settings?.[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
