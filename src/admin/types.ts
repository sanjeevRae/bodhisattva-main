/**
 * Admin SPA types — mirror the server response views (Phase 2 auth,
 * Phase 3 CMS/media, Phase 4 users delta). Kept in sync by hand with:
 *  - server/src/modules/auth/service.ts        PublicUser
 *  - server/src/modules/cms/service.ts         PageAdminView, DraftView,
 *                                              SectionView, RevisionView,
 *                                              MenuView, SettingView
 *  - server/src/modules/media/media.service.ts MediaAssetView, MediaFolderView
 *  - server/src/modules/invitations/…          InvitationView
 *  - server/src/modules/roles/roles.service.ts RoleView, UserListItem
 */

export interface MeUser {
  id: number;
  name: string;
  email: string;
  roles: string[];
}

export type AuthLevel = "full" | "mfa_pending" | "enrolment_required";

export interface LoginResponse {
  user: { id: number; name: string; email: string; phone: string | null; roles: string[] };
  authLevel: AuthLevel;
  mfaRequired?: boolean;
  mfaEnrolmentRequired?: boolean;
  csrfToken: string;
}

export interface MeResponse {
  user: MeUser;
  authLevel: AuthLevel;
  csrfToken: string;
}

export interface PageAdmin {
  id: number;
  slug: string;
  title: string;
  status: string;
  isSystem: boolean;
  seoTitle: string | null;
  metaDescription: string | null;
  ogImageMediaId: number | null;
  draftRevisionId: number | null;
  publishedRevisionId: number | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftSection {
  id: number;
  type: string;
  sortOrder: number;
  isVisible: boolean;
  config: Record<string, any>;
  design: Record<string, any> | null;
}

export interface Draft {
  pageId: number;
  revisionId: number;
  revisionNo: number;
  version: number;
  sections: DraftSection[];
}

export interface Revision {
  id: number;
  revisionNo: number;
  version: number;
  label: string | null;
  createdBy: number | null;
  createdAt: string;
  isDraft: boolean;
  isPublished: boolean;
  sectionCount: number;
}

export interface MenuItem {
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

export interface Menu {
  code: string;
  name: string;
  items: MenuItem[];
}

export interface Setting {
  key: string;
  value: unknown;
  isPublic: boolean;
  updatedAt: string;
}

export interface MediaAsset {
  id: number;
  folderId: number | null;
  storageName: string;
  originalName: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
  updatedAt: string;
  urls: { master: string; thumb: string | null; medium: string | null };
}

export interface MediaFolder {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: string;
}

export interface Invitation {
  id: number;
  email: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  invitedBy: number;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedUserId: number | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface RoleInfo {
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface AdminUser {
  id: number;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  lastLoginAt: string | null;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicPage {
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  ogImageMediaId: number | null;
  publishedAt: string | null;
  sections: Array<{
    type: string;
    sortOrder: number;
    config: Record<string, any>;
    design: Record<string, any> | null;
  }>;
  preview?: boolean;
  revisionId?: number;
}

// ---------------------------------------------------------------------------
// Museum module admin records (Phase 5) — mirror the admin views in
// server/src/modules/museum/service.ts (full table rows, camelCase).
// ---------------------------------------------------------------------------

export interface CollectionAdmin {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  periodLabel: string | null;
  description: string | null;
  history: string | null;
  coverMediaId: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  itemCount: number | null;
  isFeatured: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExhibitionAdmin {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  coverMediaId: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  location: string | null;
  curator: string | null;
  category: string | null;
  startsOn: string | null;
  endsOn: string | null;
  /** UPCOMING | CURRENT | PAST */
  status: string;
  coverAspect: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryItemAdmin {
  id: number;
  mediaId: number;
  exhibitionId: number | null;
  title: string | null;
  caption: string | null;
  category: string | null;
  year: number | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewsCategoryAdmin {
  id: number;
  slug: string;
  name: string;
  colorToken: string | null;
  createdAt: string;
}

export interface NewsArticleAdmin {
  id: number;
  slug: string;
  categoryId: number | null;
  title: string;
  outlet: string | null;
  articleType: string | null;
  summary: string | null;
  publishedOn: string | null;
  externalUrl: string | null;
  documentMediaId: number | null;
  coverMediaId: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FoundationProgramAdmin {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  impactLabel: string | null;
  iconName: string | null;
  coverMediaId: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestimonialAdmin {
  id: number;
  quote: string;
  authorName: string;
  authorRole: string | null;
  avatarMediaId: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  /** Stored verbatim — the renderer matches "foundation" | "curator". */
  context: string;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
