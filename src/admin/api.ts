/**
 * Admin API client.
 *
 * - Same-origin relative `/api/...` URLs (Vite dev/preview proxy → :4000;
 *   one origin in production), cookies included on every request.
 * - CSRF: the server issues a token at login (and via /api/auth/me and
 *   /api/auth/csrf-token); it is kept in memory here and echoed as the
 *   `X-CSRF-Token` header on every state-changing request. If memory is
 *   empty (page reload), the non-HttpOnly `csrf` cookie is read as the
 *   fallback source — that is exactly what the cookie exists for.
 * - Errors: the shared envelope `{ error: { code, message, details } }`
 *   becomes a thrown ApiError carrying status, code and field details.
 * - A 401 from any call (except the login request itself) notifies the
 *   registered unauthorized handler, which routes the SPA to login.
 */
import type {
  AdminUser,
  CollectionAdmin,
  Draft,
  ExhibitionAdmin,
  FoundationProgramAdmin,
  GalleryItemAdmin,
  Invitation,
  InventorySummaryAdmin,
  LoginResponse,
  MeResponse,
  MediaAsset,
  MediaFolder,
  Menu,
  NewsArticleAdmin,
  NewsCategoryAdmin,
  PageAdmin,
  PageMeta,
  ProductAdmin,
  ProductCategoryAdmin,
  ProductImageAdmin,
  ProductVariantAdmin,
  PublicPage,
  Revision,
  RoleInfo,
  Setting,
  TestimonialAdmin,
} from "./types";

export interface FieldIssue {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: FieldIssue[];

  constructor(status: number, code: string, message: string, details: FieldIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Server validation issues rendered as one readable line. */
  get detailText(): string {
    return this.details.map((d) => `${d.field}: ${d.issue}`).join("; ");
  }
}

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  if (csrfToken) return csrfToken;
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Do not route to login on 401 (used by the /me probe and login). */
  silent401?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const token = getCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "include",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection and try again.");
  }

  if (res.status === 401 && !options.silent401) {
    unauthorizedHandler?.();
  }

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(
      res.status,
      typeof err.code === "string" ? err.code : "UNKNOWN",
      typeof err.message === "string" ? err.message : `Request failed (${res.status}).`,
      Array.isArray(err.details) ? err.details : [],
    );
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      silent401: true,
    });
    setCsrfToken(data.csrfToken);
    return data;
  },

  async me(): Promise<MeResponse> {
    const data = await request<MeResponse>("/api/auth/me", { silent401: true });
    setCsrfToken(data.csrfToken);
    return data;
  },

  async refreshCsrf(): Promise<void> {
    const data = await request<{ csrfToken: string }>("/api/auth/csrf-token", { silent401: true });
    setCsrfToken(data.csrfToken);
  },

  logout(): Promise<{ loggedOut: boolean }> {
    return request("/api/auth/logout", { method: "POST", silent401: true });
  },

  mfaEnrol(): Promise<{ secret: string; otpauthUrl: string; message: string }> {
    return request("/api/auth/mfa/enrol", { method: "POST" });
  },

  mfaConfirm(code: string): Promise<{ recoveryCodes: string[]; message: string }> {
    return request("/api/auth/mfa/confirm", { method: "POST", body: { code } });
  },

  mfaVerify(code: string): Promise<unknown> {
    return request("/api/auth/mfa/verify", { method: "POST", body: { code } });
  },

  mfaRecover(recoveryCode: string): Promise<unknown> {
    return request("/api/auth/mfa/recover", { method: "POST", body: { recoveryCode } });
  },

  /** In-place step-up: refresh the session's recent-MFA stamp (full session). */
  stepUp(code: string): Promise<{ stepUpAt: string; message: string }> {
    return request("/api/auth/mfa/step-up", { method: "POST", body: { code } });
  },

  resetMfa(userId: number): Promise<{ message: string }> {
    return request(`/api/admin/mfa/reset/${userId}`, { method: "POST" });
  },
};

// ---------------------------------------------------------------------------
// CMS — pages, drafts, menus, settings
// ---------------------------------------------------------------------------

export const pagesApi = {
  list(): Promise<{ items: PageAdmin[] }> {
    return request("/api/admin/pages");
  },
  get(id: number): Promise<PageAdmin> {
    return request(`/api/admin/pages/${id}`);
  },
  create(input: { slug: string; title: string; seoTitle?: string | null; metaDescription?: string | null }): Promise<PageAdmin> {
    return request("/api/admin/pages", { method: "POST", body: input });
  },
  update(id: number, patch: Record<string, unknown>): Promise<PageAdmin> {
    return request(`/api/admin/pages/${id}`, { method: "PATCH", body: patch });
  },
  remove(id: number): Promise<{ message: string }> {
    return request(`/api/admin/pages/${id}`, { method: "DELETE" });
  },
  getDraft(id: number): Promise<Draft> {
    return request(`/api/admin/pages/${id}/draft`);
  },
  saveDraft(id: number, revisionId: number, expectedVersion: number, sections: Array<{ type: string; isVisible: boolean; config: Record<string, any>; design: Record<string, any> | null }>): Promise<Draft> {
    return request(`/api/admin/pages/${id}/draft`, {
      method: "PUT",
      body: { revisionId, expectedVersion, sections },
    });
  },
  publish(id: number): Promise<PageAdmin> {
    return request(`/api/admin/pages/${id}/publish`, { method: "POST" });
  },
  revisions(id: number): Promise<{ items: Revision[] }> {
    return request(`/api/admin/pages/${id}/revisions`);
  },
  rollback(id: number, revisionId: number): Promise<PageAdmin> {
    return request(`/api/admin/pages/${id}/rollback/${revisionId}`, { method: "POST" });
  },
  createPreviewToken(id: number): Promise<{ token: string; revisionId: number; expiresAt: string }> {
    return request(`/api/admin/pages/${id}/preview-token`, { method: "POST" });
  },
  fetchPreview(slug: string, token: string): Promise<PublicPage> {
    return request(`/api/pages/${encodeURIComponent(slug)}/preview?token=${encodeURIComponent(token)}`, { silent401: true });
  },
};

export const menusApi = {
  list(): Promise<{ items: Menu[] }> {
    return request("/api/admin/menus");
  },
  replace(code: string, items: Array<{ label: string; linkType: string; pageId?: number | null; url?: string | null; sortOrder?: number; isVisible?: boolean }>): Promise<Menu> {
    return request(`/api/admin/menus/${encodeURIComponent(code)}`, { method: "PUT", body: { items } });
  },
};

export const settingsApi = {
  list(): Promise<{ items: Setting[] }> {
    return request("/api/admin/settings");
  },
  update(settings: Array<{ key: string; value: unknown; isPublic?: boolean }>): Promise<{ items: Setting[] }> {
    return request("/api/admin/settings", { method: "PUT", body: { settings } });
  },
};

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const mediaApi = {
  list(params: { page?: number; pageSize?: number; search?: string; folderId?: number } = {}): Promise<{ items: MediaAsset[]; meta: PageMeta }> {
    const query = new URLSearchParams();
    query.set("page", String(params.page ?? 1));
    query.set("pageSize", String(params.pageSize ?? 48));
    if (params.search) query.set("search", params.search);
    if (params.folderId != null) query.set("folderId", String(params.folderId));
    return request(`/api/admin/media?${query.toString()}`);
  },

  async upload(file: File, folderId?: number | null): Promise<MediaAsset> {
    const form = new FormData();
    form.append("file", file);
    if (folderId != null) form.append("folderId", String(folderId));
    const headers: Record<string, string> = {};
    const token = getCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
    const res = await fetch("/api/admin/media", {
      method: "POST",
      headers,
      credentials: "include",
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) unauthorizedHandler?.();
      const err = (data as any)?.error ?? {};
      throw new ApiError(
        res.status,
        typeof err.code === "string" ? err.code : "UNKNOWN",
        typeof err.message === "string" ? err.message : `Upload failed (${res.status}).`,
        Array.isArray(err.details) ? err.details : [],
      );
    }
    return data as MediaAsset;
  },

  update(id: number, patch: { altText?: string | null; caption?: string | null; originalName?: string; folderId?: number | null }): Promise<MediaAsset> {
    return request(`/api/admin/media/${id}`, { method: "PATCH", body: patch });
  },

  remove(id: number): Promise<{ id: number; message: string }> {
    return request(`/api/admin/media/${id}`, { method: "DELETE" });
  },

  listFolders(): Promise<{ items: MediaFolder[] }> {
    return request("/api/admin/media/folders");
  },
  createFolder(name: string, parentId?: number | null): Promise<MediaFolder> {
    return request("/api/admin/media/folders", { method: "POST", body: { name, parentId: parentId ?? null } });
  },
  updateFolder(id: number, patch: { name?: string; parentId?: number | null }): Promise<MediaFolder> {
    return request(`/api/admin/media/folders/${id}`, { method: "PATCH", body: patch });
  },
  removeFolder(id: number): Promise<{ id: number; message: string }> {
    return request(`/api/admin/media/folders/${id}`, { method: "DELETE" });
  },
};

// ---------------------------------------------------------------------------
// Users, roles, invitations
// ---------------------------------------------------------------------------

export const usersApi = {
  list(page = 1, pageSize = 50): Promise<{ items: AdminUser[]; meta: PageMeta }> {
    return request(`/api/admin/users?page=${page}&pageSize=${pageSize}`);
  },
  roles(): Promise<{ items: RoleInfo[] }> {
    return request("/api/admin/roles");
  },
  assignRole(userId: number, role: string): Promise<{ userId: number; role: string; changed: boolean; message: string }> {
    return request(`/api/admin/users/${userId}/roles`, { method: "PUT", body: { role } });
  },
  listInvitations(page = 1, pageSize = 50): Promise<{ items: Invitation[]; meta: PageMeta }> {
    return request(`/api/admin/invitations?page=${page}&pageSize=${pageSize}`);
  },
  createInvitation(email: string, role: string): Promise<Invitation> {
    return request("/api/admin/invitations", { method: "POST", body: { email, role } });
  },
  revokeInvitation(id: number): Promise<Invitation> {
    return request(`/api/admin/invitations/${id}/revoke`, { method: "POST" });
  },
};

// ---------------------------------------------------------------------------
// Museum modules (Phase 5) — collections, exhibitions (+ gallery items),
// news (+ categories), foundation (programs + testimonials).
//
// Unlike the CMS endpoints above, the museum routes wrap payloads in
// the shared success envelope ({ success, data, meta }), so every call
// unwraps `.data` (and `.meta` for lists). Module writes are NOT
// step-up gated — plain saves.
// ---------------------------------------------------------------------------

interface ModuleEnvelope<T> {
  success: boolean;
  data: T;
  meta?: PageMeta;
}

async function moduleList<T>(path: string): Promise<{ items: T[]; meta: PageMeta }> {
  const env = await request<ModuleEnvelope<T[]>>(path);
  return {
    items: env.data,
    meta: env.meta ?? { page: 1, pageSize: env.data.length, total: env.data.length, totalPages: 1 },
  };
}

async function moduleOne<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const env = await request<ModuleEnvelope<T>>(path, options);
  return env.data;
}

function listQuery(page: number, pageSize: number): string {
  return `?page=${page}&pageSize=${pageSize}`;
}

export const collectionsApi = {
  list(page = 1, pageSize = 100): Promise<{ items: CollectionAdmin[]; meta: PageMeta }> {
    return moduleList(`/api/admin/collections${listQuery(page, pageSize)}`);
  },
  create(body: Record<string, unknown>): Promise<CollectionAdmin> {
    return moduleOne("/api/admin/collections", { method: "POST", body });
  },
  update(id: number, body: Record<string, unknown>): Promise<CollectionAdmin> {
    return moduleOne(`/api/admin/collections/${id}`, { method: "PATCH", body });
  },
  remove(id: number): Promise<unknown> {
    return request(`/api/admin/collections/${id}`, { method: "DELETE" });
  },
  reorder(ids: number[]): Promise<unknown> {
    return request("/api/admin/collections/reorder", { method: "POST", body: { ids } });
  },
};

export const exhibitionsApi = {
  list(page = 1, pageSize = 100): Promise<{ items: ExhibitionAdmin[]; meta: PageMeta }> {
    return moduleList(`/api/admin/exhibitions${listQuery(page, pageSize)}`);
  },
  create(body: Record<string, unknown>): Promise<ExhibitionAdmin> {
    return moduleOne("/api/admin/exhibitions", { method: "POST", body });
  },
  update(id: number, body: Record<string, unknown>): Promise<ExhibitionAdmin> {
    return moduleOne(`/api/admin/exhibitions/${id}`, { method: "PATCH", body });
  },
  remove(id: number): Promise<unknown> {
    return request(`/api/admin/exhibitions/${id}`, { method: "DELETE" });
  },
  reorder(ids: number[]): Promise<unknown> {
    return request("/api/admin/exhibitions/reorder", { method: "POST", body: { ids } });
  },
  listGalleryItems(exhibitionId: number, page = 1, pageSize = 100): Promise<{ items: GalleryItemAdmin[]; meta: PageMeta }> {
    return moduleList(`/api/admin/exhibitions/${exhibitionId}/gallery-items${listQuery(page, pageSize)}`);
  },
  createGalleryItem(exhibitionId: number, body: Record<string, unknown>): Promise<GalleryItemAdmin> {
    return moduleOne(`/api/admin/exhibitions/${exhibitionId}/gallery-items`, { method: "POST", body });
  },
  updateGalleryItem(id: number, body: Record<string, unknown>): Promise<GalleryItemAdmin> {
    return moduleOne(`/api/admin/gallery-items/${id}`, { method: "PATCH", body });
  },
  removeGalleryItem(id: number): Promise<unknown> {
    return request(`/api/admin/gallery-items/${id}`, { method: "DELETE" });
  },
  reorderGalleryItems(ids: number[]): Promise<unknown> {
    return request("/api/admin/gallery-items/reorder", { method: "POST", body: { ids } });
  },
};

export const newsApi = {
  listArticles(page = 1, pageSize = 100): Promise<{ items: NewsArticleAdmin[]; meta: PageMeta }> {
    return moduleList(`/api/admin/news${listQuery(page, pageSize)}`);
  },
  createArticle(body: Record<string, unknown>): Promise<NewsArticleAdmin> {
    return moduleOne("/api/admin/news", { method: "POST", body });
  },
  updateArticle(id: number, body: Record<string, unknown>): Promise<NewsArticleAdmin> {
    return moduleOne(`/api/admin/news/${id}`, { method: "PATCH", body });
  },
  removeArticle(id: number): Promise<unknown> {
    return request(`/api/admin/news/${id}`, { method: "DELETE" });
  },
  async listCategories(): Promise<{ items: NewsCategoryAdmin[] }> {
    // The categories list is the one unpaginated museum endpoint: its
    // envelope data is { items } rather than the bare array sendList
    // returns elsewhere.
    const env = await request<ModuleEnvelope<{ items: NewsCategoryAdmin[] }>>("/api/admin/news/categories");
    return { items: env.data.items };
  },
  createCategory(body: Record<string, unknown>): Promise<NewsCategoryAdmin> {
    return moduleOne("/api/admin/news/categories", { method: "POST", body });
  },
  updateCategory(id: number, body: Record<string, unknown>): Promise<NewsCategoryAdmin> {
    return moduleOne(`/api/admin/news/categories/${id}`, { method: "PATCH", body });
  },
  removeCategory(id: number): Promise<unknown> {
    return request(`/api/admin/news/categories/${id}`, { method: "DELETE" });
  },
};

export const foundationApi = {
  listPrograms(page = 1, pageSize = 100): Promise<{ items: FoundationProgramAdmin[]; meta: PageMeta }> {
    return moduleList(`/api/admin/foundation-programs${listQuery(page, pageSize)}`);
  },
  createProgram(body: Record<string, unknown>): Promise<FoundationProgramAdmin> {
    return moduleOne("/api/admin/foundation-programs", { method: "POST", body });
  },
  updateProgram(id: number, body: Record<string, unknown>): Promise<FoundationProgramAdmin> {
    return moduleOne(`/api/admin/foundation-programs/${id}`, { method: "PATCH", body });
  },
  removeProgram(id: number): Promise<unknown> {
    return request(`/api/admin/foundation-programs/${id}`, { method: "DELETE" });
  },
  reorderPrograms(ids: number[]): Promise<unknown> {
    return request("/api/admin/foundation-programs/reorder", { method: "POST", body: { ids } });
  },
  listTestimonials(page = 1, pageSize = 100): Promise<{ items: TestimonialAdmin[]; meta: PageMeta }> {
    return moduleList(`/api/admin/testimonials${listQuery(page, pageSize)}`);
  },
  createTestimonial(body: Record<string, unknown>): Promise<TestimonialAdmin> {
    return moduleOne("/api/admin/testimonials", { method: "POST", body });
  },
  updateTestimonial(id: number, body: Record<string, unknown>): Promise<TestimonialAdmin> {
    return moduleOne(`/api/admin/testimonials/${id}`, { method: "PATCH", body });
  },
  removeTestimonial(id: number): Promise<unknown> {
    return request(`/api/admin/testimonials/${id}`, { method: "DELETE" });
  },
  reorderTestimonials(ids: number[]): Promise<unknown> {
    return request("/api/admin/testimonials/reorder", { method: "POST", body: { ids } });
  },
};

// ---------------------------------------------------------------------------
// Store (Phase 6) — product categories, products (+ images, variants),
// inventory. Same success envelope as the museum modules. Product
// DELETE archives (the API never hard-deletes a product).
// ---------------------------------------------------------------------------

export const storeApi = {
  listCategories(page = 1, pageSize = 100, search?: string): Promise<{ items: ProductCategoryAdmin[]; meta: PageMeta }> {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set("search", search);
    return moduleList(`/api/admin/product-categories?${query.toString()}`);
  },
  createCategory(body: Record<string, unknown>): Promise<ProductCategoryAdmin> {
    return moduleOne("/api/admin/product-categories", { method: "POST", body });
  },
  updateCategory(id: number, body: Record<string, unknown>): Promise<ProductCategoryAdmin> {
    return moduleOne(`/api/admin/product-categories/${id}`, { method: "PATCH", body });
  },
  removeCategory(id: number): Promise<unknown> {
    return request(`/api/admin/product-categories/${id}`, { method: "DELETE" });
  },

  listProducts(page = 1, pageSize = 100, search?: string): Promise<{ items: ProductAdmin[]; meta: PageMeta }> {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set("search", search);
    return moduleList(`/api/admin/products?${query.toString()}`);
  },
  getProduct(id: number): Promise<ProductAdmin> {
    return moduleOne(`/api/admin/products/${id}`);
  },
  createProduct(body: Record<string, unknown>): Promise<ProductAdmin> {
    return moduleOne("/api/admin/products", { method: "POST", body });
  },
  updateProduct(id: number, body: Record<string, unknown>): Promise<ProductAdmin> {
    return moduleOne(`/api/admin/products/${id}`, { method: "PATCH", body });
  },
  archiveProduct(id: number): Promise<ProductAdmin> {
    return moduleOne(`/api/admin/products/${id}`, { method: "DELETE" });
  },

  async listImages(productId: number): Promise<ProductImageAdmin[]> {
    const data = await moduleOne<{ items: ProductImageAdmin[] }>(`/api/admin/products/${productId}/images`);
    return data.items;
  },
  createImage(productId: number, body: Record<string, unknown>): Promise<ProductImageAdmin> {
    return moduleOne(`/api/admin/products/${productId}/images`, { method: "POST", body });
  },
  updateImage(id: number, body: Record<string, unknown>): Promise<ProductImageAdmin> {
    return moduleOne(`/api/admin/products/images/${id}`, { method: "PATCH", body });
  },
  removeImage(id: number): Promise<unknown> {
    return request(`/api/admin/products/images/${id}`, { method: "DELETE" });
  },

  async listVariants(productId: number): Promise<ProductVariantAdmin[]> {
    const data = await moduleOne<{ items: ProductVariantAdmin[] }>(`/api/admin/products/${productId}/variants`);
    return data.items;
  },
  createVariant(productId: number, body: Record<string, unknown>): Promise<ProductVariantAdmin> {
    return moduleOne(`/api/admin/products/${productId}/variants`, { method: "POST", body });
  },
  updateVariant(productId: number, variantId: number, body: Record<string, unknown>): Promise<ProductVariantAdmin> {
    return moduleOne(`/api/admin/products/${productId}/variants/${variantId}`, { method: "PATCH", body });
  },
  removeVariant(productId: number, variantId: number): Promise<unknown> {
    return request(`/api/admin/products/${productId}/variants/${variantId}`, { method: "DELETE" });
  },

  getInventory(productId: number, page = 1, pageSize = 50): Promise<InventorySummaryAdmin> {
    return moduleOne(`/api/admin/products/${productId}/inventory${listQuery(page, pageSize)}`);
  },
  adjustInventory(productId: number, body: Record<string, unknown>): Promise<InventorySummaryAdmin> {
    return moduleOne(`/api/admin/products/${productId}/inventory/adjust`, { method: "POST", body });
  },
};

/** Public path for a page slug (home is the root). */
export function pagePath(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}
