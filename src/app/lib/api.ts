import { useEffect, useState } from "react";
import type { ImagePlacement } from "./image-placement";
import { getShopProducts, type ShopProduct } from "./shop";

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
  /** Per-usage placement (docs/IMAGE_PLACEMENT_EDITOR.md). */
  placement?: import("./image-placement").ImagePlacement;
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

// ---------------------------------------------------------------------------
// Museum module records (Phase 5) — collections, exhibitions, news and
// foundation content served by server/src/modules/museum. Unlike the
// CMS endpoints above, the museum endpoints wrap their payload in the
// shared success envelope ({ success, data }), so these getters unwrap
// `.data`. PageRenderer consumes the records via its `moduleData` prop.
// ---------------------------------------------------------------------------

export interface MuseumImageRef {
  url: string;
  alt: string;
  /** Cover placement (migration 0024); absent when none is set. */
  placement?: ImagePlacement;
}

export interface CollectionRecord {
  id: number;
  slug: string;
  name: string;
  periodLabel: string | null;
  worksCountLabel: string | null;
  category: string | null;
  isFeatured: boolean;
  sortOrder: number;
  image: MuseumImageRef | null;
}

export interface ExhibitionRecord {
  id: number;
  slug: string;
  title: string;
  locationLabel: string | null;
  /** Lowercase: "upcoming" | "current" | "past". */
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  dateLabel: string;
  description: string | null;
  curator: string | null;
  category: string | null;
  coverAspect: "tall" | "standard" | null;
  isFeatured: boolean;
  sortOrder: number;
  image: MuseumImageRef | null;
}

export interface NewsCategoryRef {
  id: number;
  slug: string;
  name: string;
  colorToken: string | null;
}

export interface NewsArticleRecord {
  id: number;
  slug: string;
  title: string;
  sourceName: string | null;
  /** ISO date (YYYY-MM-DD). */
  publishedDate: string | null;
  summary: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  colorToken: string | null;
  externalUrl: string | null;
  documentUrl: string | null;
  image: MuseumImageRef | null;
}

export interface NewsPayload {
  categories: NewsCategoryRef[];
  items: NewsArticleRecord[];
}

export interface FoundationProgramRecord {
  id: number;
  slug: string;
  name: string;
  categoryLabel: string | null;
  description: string | null;
  impactMetric: string | null;
  iconName: string | null;
  sortOrder: number;
  image: MuseumImageRef | null;
}

export interface TestimonialRecord {
  id: number;
  quote: string;
  authorName: string;
  authorRole: string | null;
  /** "foundation" | "curator" (stored verbatim). */
  context: string;
  sortOrder: number;
  image: MuseumImageRef | null;
}

export interface FoundationPayload {
  programs: FoundationProgramRecord[];
  testimonials: TestimonialRecord[];
}

/** The module data PageRenderer's module sections consume. */
export interface ModuleData {
  collections?: CollectionRecord[];
  exhibitions?: ExhibitionRecord[];
  news?: NewsPayload;
  foundation?: FoundationPayload;
  /** Phase 6 store products (featured sort) for featured_products sections. */
  products?: ShopProduct[];
}

async function fetchModuleJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export function getCollections(): Promise<CollectionRecord[]> {
  return cached("module:collections", async () => {
    const data = await fetchModuleJson<{ items: CollectionRecord[] }>("/api/collections");
    return data.items;
  });
}

export function getExhibitions(): Promise<ExhibitionRecord[]> {
  return cached("module:exhibitions", async () => {
    const data = await fetchModuleJson<{ items: ExhibitionRecord[] }>("/api/exhibitions");
    return data.items;
  });
}

export function getNewsPayload(): Promise<NewsPayload> {
  return cached("module:news", () => fetchModuleJson<NewsPayload>("/api/news"));
}

export function getFoundation(): Promise<FoundationPayload> {
  return cached("module:foundation", () => fetchModuleJson<FoundationPayload>("/api/foundation"));
}

/**
 * Store products in the API's "featured" order (flagged products first)
 * for featured_products sections. One cached fetch shared by the public
 * pages and the editor canvas, like the museum getters above.
 */
export function getFeaturedProducts(): Promise<ShopProduct[]> {
  return cached("module:products", async () => {
    const { items } = await getShopProducts({ sort: "featured", page: 1, pageSize: 24 });
    return items;
  });
}

export function useFeaturedProducts(): AsyncState<ShopProduct[]> {
  return useCached(getFeaturedProducts);
}

export function useCollections(): AsyncState<CollectionRecord[]> {
  return useCached(getCollections);
}

export function useExhibitions(): AsyncState<ExhibitionRecord[]> {
  return useCached(getExhibitions);
}

export function useFoundation(): AsyncState<FoundationPayload> {
  return useCached(getFoundation);
}

/**
 * News with optional server-side search/category. With no filters it
 * serves the shared cached payload (Home cards, editor canvas); with a
 * search term or category slug it fetches `/api/news?search=&category=`
 * debounced by ~300ms, so the News page's search box drives the API
 * instead of filtering client-side.
 */
export function useNews(search = "", category = ""): AsyncState<NewsPayload> {
  const [state, setState] = useState<AsyncState<NewsPayload>>({ data: null, error: false });
  useEffect(() => {
    let alive = true;
    const load = (): Promise<NewsPayload> => {
      const term = search.trim();
      if (!term && !category) return getNewsPayload();
      const params = new URLSearchParams();
      if (term) params.set("search", term);
      if (category) params.set("category", category);
      return fetchModuleJson<NewsPayload>(`/api/news?${params.toString()}`);
    };
    const timer = setTimeout(
      () => {
        load().then(
          (data) => alive && setState({ data, error: false }),
          () => alive && setState({ data: null, error: true }),
        );
      },
      search || category ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, category]);
  return state;
}

// ---------------------------------------------------------------------------
// News archive (press clippings) — the archive endpoints layered over the
// same GET /api/news resource: server-side search / filters / pagination
// for the /news page, the facets that drive its filter bar, the article
// detail for /news/:slug and the tokenised draft preview. List items keep
// every NewsArticleRecord field and add the archive fields below. These
// getters are NOT module-cached (queries vary per call); errors carry the
// HTTP status so pages can tell a 404 (unknown/draft slug) from a failure.
// ---------------------------------------------------------------------------

/** Fetch error carrying the HTTP status (see the archive getters below). */
export class ApiError extends Error {
  status: number;
  constructor(url: string, status: number) {
    super(`GET ${url} failed: ${status}`);
    this.status = status;
  }
}

export interface NewsTagRef {
  id: number;
  name: string;
  slug: string;
}

export interface NewsArchiveItem extends NewsArticleRecord {
  author: string | null;
  isFeatured: boolean;
  hasPdf: boolean;
  readingTimeMinutes: number | null;
  tags: NewsTagRef[];
  /** Editorial type label (e.g. "Interview"); null when untyped. */
  type: string | null;
}

export interface NewsListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type NewsSort = "newest" | "oldest" | "added" | "alpha";

export interface NewsArchiveParams {
  search?: string;
  category?: string;
  publication?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  hasPdf?: boolean;
  featured?: boolean;
  sort?: NewsSort;
  page?: number;
  pageSize?: number;
}

export interface NewsArchiveResult {
  items: NewsArchiveItem[];
  categories: NewsCategoryRef[];
  meta: NewsListMeta;
}

export interface NewsFacetCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface NewsFacets {
  categories: NewsFacetCategory[];
  publications: { name: string; count: number }[];
  years: number[];
  types: string[];
}

export interface NewsPdfRef {
  viewUrl: string;
  downloadUrl: string;
  originalName: string;
  /** Standardized filename the visitor's downloaded copy will carry. */
  downloadName: string;
  fileSize: number;
}

export interface NewsArticleDetail extends NewsArchiveItem {
  /** Sanitized article HTML, or null when the clipping is PDF-only. */
  content: string | null;
  pdf: NewsPdfRef | null;
  related: NewsArchiveItem[];
  /** True when served through the draft-preview token route. */
  preview?: boolean;
}

async function fetchNewsEnvelope<T>(url: string): Promise<{ data: T; meta?: NewsListMeta }> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(url, res.status);
  return (await res.json()) as { data: T; meta?: NewsListMeta };
}

/**
 * Fill the archive fields' defaults on a raw list item, so a payload
 * that predates a field (or omits it on some rows) can never crash the
 * rendering components, which treat the fields as always present.
 */
function normalizeArchiveItem(raw: NewsArchiveItem): NewsArchiveItem {
  return {
    ...raw,
    author: raw.author ?? null,
    isFeatured: raw.isFeatured ?? false,
    hasPdf: raw.hasPdf ?? false,
    readingTimeMinutes: raw.readingTimeMinutes ?? null,
    tags: raw.tags ?? [],
    type: raw.type ?? null,
  };
}

export async function getNewsArchive(params: NewsArchiveParams = {}): Promise<NewsArchiveResult> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.category) query.set("category", params.category);
  if (params.publication) query.set("publication", params.publication);
  if (params.year) query.set("year", String(params.year));
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.type) query.set("type", params.type);
  if (params.hasPdf) query.set("hasPdf", "true");
  if (params.featured) query.set("featured", "true");
  if (params.sort) query.set("sort", params.sort);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  const body = await fetchNewsEnvelope<{
    items: NewsArchiveItem[];
    categories: NewsCategoryRef[];
    meta?: NewsListMeta;
  }>(`/api/news?${query.toString()}`);
  const items = (body.data.items ?? []).map(normalizeArchiveItem);
  // The pagination meta may ride on the envelope (store convention) or
  // inside the payload; fall back to a single-page meta when absent.
  const meta =
    body.meta ??
    body.data.meta ?? { page, pageSize, total: items.length, totalPages: 1 };
  return { items, categories: body.data.categories ?? [], meta };
}

export function getNewsFacets(): Promise<NewsFacets> {
  return cached("module:news-facets", async () => {
    const body = await fetchNewsEnvelope<NewsFacets>("/api/news/facets");
    return {
      categories: body.data.categories ?? [],
      publications: body.data.publications ?? [],
      years: body.data.years ?? [],
      types: body.data.types ?? [],
    };
  });
}

function normalizeArticleDetail(raw: NewsArticleDetail): NewsArticleDetail {
  return {
    ...normalizeArchiveItem(raw),
    content: raw.content ?? null,
    pdf: raw.pdf ?? null,
    related: (raw.related ?? []).map(normalizeArchiveItem),
  };
}

export async function getNewsArticle(slug: string): Promise<NewsArticleDetail> {
  const body = await fetchNewsEnvelope<NewsArticleDetail>(
    `/api/news/${encodeURIComponent(slug)}`,
  );
  return normalizeArticleDetail(body.data);
}

/** One of the three legal policy pages (footer links). */
export interface PolicyPublic {
  slug: string;
  title: string;
  bodyHtml: string;
  version: number;
  updatedAt: string;
}

export async function getPolicy(slug: string): Promise<PolicyPublic> {
  const body = await fetchNewsEnvelope<PolicyPublic>(
    `/api/policies/${encodeURIComponent(slug)}`,
  );
  return body.data;
}

export async function getNewsPreview(token: string): Promise<NewsArticleDetail> {
  const body = await fetchNewsEnvelope<NewsArticleDetail>(
    `/api/news/preview/${encodeURIComponent(token)}`,
  );
  return { ...normalizeArticleDetail(body.data), preview: true };
}
