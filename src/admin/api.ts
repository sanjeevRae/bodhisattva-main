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
  Draft,
  Invitation,
  LoginResponse,
  MeResponse,
  MediaAsset,
  MediaFolder,
  Menu,
  PageAdmin,
  PageMeta,
  PublicPage,
  Revision,
  RoleInfo,
  Setting,
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

/** Public path for a page slug (home is the root). */
export function pagePath(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}
