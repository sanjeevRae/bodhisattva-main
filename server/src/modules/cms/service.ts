/**
 * CMS service (DATABASE_DESIGN.md §7.3 revision/publication model,
 * PERMISSIONS.md §5 CMS rows).
 *
 * Invariants enforced here:
 *  - Content lives only in `page_sections` rows owned by a revision;
 *    revisions are immutable once published. Editing always targets the
 *    draft revision, which is CLONED from the published revision on first
 *    edit (clone-on-edit) so a published revision is never mutated.
 *  - Public reads resolve strictly through `published_revision_id` —
 *    drafts are never publicly visible.
 *  - Publish validates every draft section against the registry, then
 *    swaps the pointer in a single transaction: a validation failure
 *    leaves the previously published revision live.
 *  - Draft saves are optimistic-concurrency checked against
 *    `page_revisions.version` (spec §5.4): a stale editor gets 409.
 *  - System pages (the 7 migrated pages) cannot be deleted and their
 *    slugs cannot change (§7.1); reserved slugs (shared ids.ts) can never
 *    be taken by any page.
 *  - Every mutation is audited (cms.pages.* / cms.menus.update /
 *    settings.update).
 */
import { AppError } from "@bodhisattva/shared/errors";
import { isReservedSlug, slugSchema } from "@bodhisattva/shared/ids";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  max,
  sql,
} from "drizzle-orm";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  menuItems,
  menus,
  pageRevisions,
  pageSections,
  pages,
  siteSettings,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { createPreviewToken, resolvePreviewToken } from "./preview.js";
import { validateSection } from "./registry.js";

export interface CmsDeps {
  db: Database;
  config: AppConfig;
}

export interface CmsActor {
  userId: number;
  email: string;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The drizzle transaction handle type, for helpers shared by both. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

type PageRow = typeof pages.$inferSelect;
type RevisionRow = typeof pageRevisions.$inferSelect;

export interface SectionView {
  id: number;
  type: string;
  sortOrder: number;
  isVisible: boolean;
  config: Record<string, unknown>;
  design: Record<string, unknown> | null;
}

export interface PageAdminView {
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
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftView {
  pageId: number;
  revisionId: number;
  revisionNo: number;
  version: number;
  sections: SectionView[];
}

export interface PublicPageView {
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  ogImageMediaId: number | null;
  publishedAt: Date | null;
  sections: Omit<SectionView, "id" | "isVisible">[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toAdminView(page: PageRow): PageAdminView {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    status: page.status,
    isSystem: page.isSystem,
    seoTitle: page.seoTitle,
    metaDescription: page.metaDescription,
    ogImageMediaId: page.ogImageMediaId,
    draftRevisionId: page.draftRevisionId,
    publishedRevisionId: page.publishedRevisionId,
    publishedAt: page.publishedAt,
    hasUnpublishedChanges: page.draftRevisionId !== page.publishedRevisionId,
    createdBy: page.createdBy,
    updatedBy: page.updatedBy,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

async function loadPage(db: Database, pageId: number): Promise<PageRow> {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
    .limit(1);
  if (!page) throw AppError.notFound("Page not found.");
  return page;
}

async function loadSections(
  db: Database,
  revisionId: number,
): Promise<SectionView[]> {
  const rows = await db
    .select()
    .from(pageSections)
    .where(eq(pageSections.revisionId, revisionId))
    .orderBy(asc(pageSections.sortOrder));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    sortOrder: row.sortOrder,
    isVisible: row.isVisible,
    config: (row.config ?? {}) as Record<string, unknown>,
    design: (row.design ?? null) as Record<string, unknown> | null,
  }));
}

/** Insert a new revision copying the source revision's sections. */
async function cloneRevision(
  tx: Tx,
  pageId: number,
  sourceRevisionId: number,
  createdBy: number,
): Promise<RevisionRow> {
  const [maxRow] = await tx
    .select({ maxNo: max(pageRevisions.revisionNo) })
    .from(pageRevisions)
    .where(eq(pageRevisions.pageId, pageId));
  const [inserted] = await tx
    .insert(pageRevisions)
    .values({
      pageId,
      revisionNo: (maxRow?.maxNo ?? 0) + 1,
      version: 1,
      createdBy,
    })
    .$returningId();

  const sourceSections = await tx
    .select()
    .from(pageSections)
    .where(eq(pageSections.revisionId, sourceRevisionId))
    .orderBy(asc(pageSections.sortOrder));
  if (sourceSections.length > 0) {
    await tx.insert(pageSections).values(
      sourceSections.map((section) => ({
        revisionId: inserted.id,
        type: section.type,
        sortOrder: section.sortOrder,
        isVisible: section.isVisible,
        config: section.config,
        design: section.design,
      })),
    );
  }

  const [revision] = await tx
    .select()
    .from(pageRevisions)
    .where(eq(pageRevisions.id, inserted.id))
    .limit(1);
  return revision;
}

/**
 * Resolve the page's editable draft revision, cloning on first edit
 * (§7.3): when draft == published (or no draft exists yet), the draft
 * becomes a fresh clone so the published revision is never mutated.
 * Runs inside the caller's transaction and updates the page pointer.
 */
async function ensureDraftRevision(
  tx: Tx,
  page: PageRow,
  createdBy: number,
): Promise<RevisionRow> {
  if (page.draftRevisionId !== null && page.draftRevisionId !== page.publishedRevisionId) {
    const [draft] = await tx
      .select()
      .from(pageRevisions)
      .where(eq(pageRevisions.id, page.draftRevisionId))
      .limit(1);
    if (draft) return draft;
  }

  const sourceId = page.publishedRevisionId ?? page.draftRevisionId;
  let draft: RevisionRow;
  if (sourceId === null) {
    const [inserted] = await tx
      .insert(pageRevisions)
      .values({ pageId: page.id, revisionNo: 1, version: 1, createdBy })
      .$returningId();
    const [row] = await tx
      .select()
      .from(pageRevisions)
      .where(eq(pageRevisions.id, inserted.id))
      .limit(1);
    draft = row;
  } else {
    draft = await cloneRevision(tx, page.id, sourceId, createdBy);
  }
  await tx
    .update(pages)
    .set({ draftRevisionId: draft.id })
    .where(eq(pages.id, page.id));
  return draft;
}

function assertValidSlug(slug: string): void {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) {
    throw AppError.validation(
      parsed.error.issues.map((issue) => ({
        field: "slug",
        issue: issue.message,
      })),
      "The submitted data is invalid.",
    );
  }
  if (isReservedSlug(slug)) {
    throw AppError.validation(
      [{ field: "slug", issue: `'${slug}' is a reserved route and cannot be used for a page.` }],
      "The submitted data is invalid.",
    );
  }
}

function isDuplicateEntry(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === "ER_DUP_ENTRY") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function audit(
  deps: CmsDeps,
  actor: CmsActor,
  action: string,
  pageId: number | null,
  meta: RequestMeta,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await writeAudit(deps.db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action,
    resourceType: "page",
    resourceId: pageId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata,
  });
}

// ---------------------------------------------------------------------------
// Pages — admin
// ---------------------------------------------------------------------------

export interface CreatePageInput {
  slug: string;
  title: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  ogImageMediaId?: number | null;
}

export async function createPage(
  deps: CmsDeps,
  actor: CmsActor,
  input: CreatePageInput,
  meta: RequestMeta,
): Promise<PageAdminView> {
  const { db } = deps;
  assertValidSlug(input.slug);

  const [existing] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.slug, input.slug))
    .limit(1);
  if (existing) {
    throw AppError.conflict(`A page with slug '${input.slug}' already exists.`);
  }

  let pageId = 0;
  try {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(pages)
        .values({
          slug: input.slug,
          title: input.title,
          status: "DRAFT",
          isSystem: false,
          seoTitle: input.seoTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          ogImageMediaId: input.ogImageMediaId ?? null,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .$returningId();
      pageId = inserted.id;
      const [revision] = await tx
        .insert(pageRevisions)
        .values({ pageId, revisionNo: 1, version: 1, createdBy: actor.userId })
        .$returningId();
      await tx
        .update(pages)
        .set({ draftRevisionId: revision.id })
        .where(eq(pages.id, pageId));
    });
  } catch (err) {
    if (isDuplicateEntry(err)) {
      throw AppError.conflict(`A page with slug '${input.slug}' already exists.`);
    }
    throw err;
  }

  await audit(deps, actor, AUDIT_ACTIONS.cmsPagesCreate, pageId, meta, {
    slug: input.slug,
    title: input.title,
  });
  return getPageAdmin(deps, pageId);
}

export async function listPages(deps: CmsDeps): Promise<PageAdminView[]> {
  const rows = await deps.db
    .select()
    .from(pages)
    .where(isNull(pages.deletedAt))
    .orderBy(asc(pages.id));
  return rows.map(toAdminView);
}

export async function getPageAdmin(
  deps: CmsDeps,
  pageId: number,
): Promise<PageAdminView> {
  return toAdminView(await loadPage(deps.db, pageId));
}

export interface UpdatePageInput {
  title?: string;
  slug?: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  ogImageMediaId?: number | null;
}

export async function updatePageMetadata(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
  input: UpdatePageInput,
  meta: RequestMeta,
): Promise<PageAdminView> {
  const { db } = deps;
  const page = await loadPage(db, pageId);

  const patch: Partial<PageRow> = { updatedBy: actor.userId };
  if (input.title !== undefined) patch.title = input.title;
  if (input.seoTitle !== undefined) patch.seoTitle = input.seoTitle;
  if (input.metaDescription !== undefined) patch.metaDescription = input.metaDescription;
  if (input.ogImageMediaId !== undefined) patch.ogImageMediaId = input.ogImageMediaId;
  if (input.slug !== undefined && input.slug !== page.slug) {
    if (page.isSystem) {
      throw AppError.forbidden(
        "System pages have locked slugs and cannot be renamed.",
      );
    }
    assertValidSlug(input.slug);
    const [existing] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.slug, input.slug))
      .limit(1);
    if (existing) {
      throw AppError.conflict(`A page with slug '${input.slug}' already exists.`);
    }
    patch.slug = input.slug;
  }

  try {
    await db.update(pages).set(patch).where(eq(pages.id, pageId));
  } catch (err) {
    if (isDuplicateEntry(err)) {
      throw AppError.conflict(`A page with slug '${input.slug}' already exists.`);
    }
    throw err;
  }

  await audit(deps, actor, AUDIT_ACTIONS.cmsPagesUpdate, pageId, meta, {
    slug: patch.slug ?? page.slug,
    changedFields: Object.keys(input),
  });
  return getPageAdmin(deps, pageId);
}

export async function deletePage(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
  meta: RequestMeta,
): Promise<void> {
  const page = await loadPage(deps.db, pageId);
  if (page.isSystem) {
    throw AppError.forbidden("System pages cannot be deleted.");
  }
  await deps.db
    .update(pages)
    .set({ deletedAt: new Date(), updatedBy: actor.userId })
    .where(eq(pages.id, pageId));
  await audit(deps, actor, AUDIT_ACTIONS.cmsPagesDelete, pageId, meta, {
    slug: page.slug,
  });
}

// ---------------------------------------------------------------------------
// Draft editing, publishing, rollback
// ---------------------------------------------------------------------------

export async function getDraft(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
): Promise<DraftView> {
  const { db } = deps;
  return db.transaction(async (tx) => {
    // Lock the page row (Phase 3 review fix): without it, two concurrent
    // editor opens could both clone-on-edit and orphan one draft. saveDraft,
    // publishPage and rollbackPage already serialize on this same lock.
    const [page] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
      .for("update")
      .limit(1);
    if (!page) throw AppError.notFound("Page not found.");
    const draft = await ensureDraftRevision(tx, page, actor.userId);
    const sections = await loadSections(tx as unknown as Database, draft.id);
    return {
      pageId,
      revisionId: draft.id,
      revisionNo: draft.revisionNo,
      version: draft.version,
      sections,
    };
  });
}

export interface SectionInput {
  type: string;
  isVisible?: boolean;
  config: unknown;
  design?: unknown;
}

export async function saveDraft(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
  sections: SectionInput[],
  expectedVersion: number,
  revisionId: number,
  meta: RequestMeta,
): Promise<DraftView> {
  const { db } = deps;
  // Validate + sanitise everything before touching the database: one bad
  // section rejects the whole batch (the stored draft is untouched).
  const validated = sections.map((section) => ({
    type: section.type,
    isVisible: section.isVisible ?? true,
    ...validateSection(section.type, section.config, section.design),
  }));

  const result = await db.transaction(async (tx) => {
    const [page] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
      .for("update")
      .limit(1);
    if (!page) throw AppError.notFound("Page not found.");

    // Revision binding (Phase 4 review fix): the editor must be saving the
    // exact draft revision it loaded. If the page was published or rolled
    // back since, the loaded revision is no longer the draft — it either
    // stopped being the draft pointer, or it has itself become the
    // published revision (publishing points published_revision_id AT the
    // draft). Without this check, a stale editor whose expectedVersion
    // happens to match the fresh clone-on-edit draft (e.g. both are
    // version 1) would silently overwrite the newer work.
    if (
      page.draftRevisionId !== revisionId ||
      (page.publishedRevisionId !== null &&
        revisionId === page.publishedRevisionId)
    ) {
      throw AppError.conflict(
        "This draft has been superseded (the page was published or rolled back elsewhere). Reload the draft.",
      );
    }

    const draft = await ensureDraftRevision(tx, page, actor.userId);
    if (draft.version !== expectedVersion) {
      throw AppError.conflict(
        `The draft has changed since it was loaded (current version ${draft.version}). Reload and re-apply your edits.`,
      );
    }

    await tx
      .delete(pageSections)
      .where(eq(pageSections.revisionId, draft.id));
    if (validated.length > 0) {
      await tx.insert(pageSections).values(
        validated.map((section, index) => ({
          revisionId: draft.id,
          type: section.type,
          sortOrder: index,
          isVisible: section.isVisible,
          config: section.config,
          design: section.design,
        })),
      );
    }
    await tx
      .update(pageRevisions)
      .set({ version: sql`${pageRevisions.version} + 1` })
      .where(eq(pageRevisions.id, draft.id));
    await tx
      .update(pages)
      .set({ updatedBy: actor.userId })
      .where(eq(pages.id, pageId));

    return { revisionId: draft.id, revisionNo: draft.revisionNo, version: draft.version + 1 };
  });

  await audit(deps, actor, AUDIT_ACTIONS.cmsPagesUpdate, pageId, meta, {
    revisionId: result.revisionId,
    version: result.version,
    sectionCount: validated.length,
  });

  const saved = await loadSections(db, result.revisionId);
  return {
    pageId,
    revisionId: result.revisionId,
    revisionNo: result.revisionNo,
    version: result.version,
    sections: saved,
  };
}

export async function publishPage(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
  meta: RequestMeta,
): Promise<PageAdminView> {
  const { db } = deps;
  let publishedRevisionId = 0;
  await db.transaction(async (tx) => {
    const [page] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
      .for("update")
      .limit(1);
    if (!page) throw AppError.notFound("Page not found.");
    if (page.draftRevisionId === null) {
      throw AppError.conflict("This page has no draft to publish.");
    }

    // Re-validate EVERY section of the exact revision being published,
    // inside the transaction: a failure aborts before the pointer swap,
    // leaving the previously published revision live (§7.3).
    const draftSections = await loadSections(
      tx as unknown as Database,
      page.draftRevisionId,
    );
    for (const section of draftSections) {
      validateSection(section.type, section.config, section.design);
    }

    await tx
      .update(pages)
      .set({
        publishedRevisionId: page.draftRevisionId,
        status: "PUBLISHED",
        publishedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(eq(pages.id, pageId));
    publishedRevisionId = page.draftRevisionId;
  });

  await audit(deps, actor, AUDIT_ACTIONS.cmsPagesPublish, pageId, meta, {
    revisionId: publishedRevisionId,
  });
  return getPageAdmin(deps, pageId);
}

export async function rollbackPage(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
  revisionId: number,
  meta: RequestMeta,
): Promise<PageAdminView> {
  const { db } = deps;
  await db.transaction(async (tx) => {
    const [page] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
      .for("update")
      .limit(1);
    if (!page) throw AppError.notFound("Page not found.");

    const [target] = await tx
      .select({ id: pageRevisions.id })
      .from(pageRevisions)
      .where(
        and(eq(pageRevisions.id, revisionId), eq(pageRevisions.pageId, pageId)),
      )
      .limit(1);
    if (!target) throw AppError.notFound("Revision not found for this page.");

    await tx
      .update(pages)
      .set({
        publishedRevisionId: revisionId,
        status: "PUBLISHED",
        publishedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(eq(pages.id, pageId));

    // Editing continues from a fresh clone of the restored revision.
    const draft = await cloneRevision(tx, pageId, revisionId, actor.userId);
    await tx
      .update(pages)
      .set({ draftRevisionId: draft.id })
      .where(eq(pages.id, pageId));
  });

  await audit(deps, actor, AUDIT_ACTIONS.cmsPagesRestore, pageId, meta, {
    revisionId,
  });
  return getPageAdmin(deps, pageId);
}

export interface RevisionView {
  id: number;
  revisionNo: number;
  version: number;
  label: string | null;
  createdBy: number | null;
  createdAt: Date;
  isDraft: boolean;
  isPublished: boolean;
  sectionCount: number;
}

export async function listRevisions(
  deps: CmsDeps,
  pageId: number,
): Promise<RevisionView[]> {
  const { db } = deps;
  const page = await loadPage(db, pageId);
  const rows = await db
    .select()
    .from(pageRevisions)
    .where(eq(pageRevisions.pageId, pageId))
    .orderBy(desc(pageRevisions.revisionNo));
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      revisionId: pageSections.revisionId,
      count: sql<number>`COUNT(*)`,
    })
    .from(pageSections)
    .where(
      sql`${pageSections.revisionId} IN (${sql.join(
        rows.map((row) => sql`${row.id}`),
        sql`, `,
      )})`,
    )
    .groupBy(pageSections.revisionId);
  const countByRevision = new Map(counts.map((row) => [row.revisionId, Number(row.count)]));
  return rows.map((row) => ({
    id: row.id,
    revisionNo: row.revisionNo,
    version: row.version,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    isDraft: row.id === page.draftRevisionId,
    isPublished: row.id === page.publishedRevisionId,
    sectionCount: countByRevision.get(row.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Preview tokens
// ---------------------------------------------------------------------------

export async function createPagePreviewToken(
  deps: CmsDeps,
  actor: CmsActor,
  pageId: number,
): Promise<{ token: string; revisionId: number; expiresAt: Date }> {
  const { db } = deps;
  const draft = await db.transaction(async (tx) => {
    const page = await loadPage(tx as unknown as Database, pageId);
    return ensureDraftRevision(tx, page, actor.userId);
  });
  return createPreviewToken(db, pageId, draft.id, actor.userId);
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

function toPublicView(
  page: PageRow,
  sections: SectionView[],
): PublicPageView {
  return {
    slug: page.slug,
    title: page.title,
    seoTitle: page.seoTitle,
    metaDescription: page.metaDescription,
    ogImageMediaId: page.ogImageMediaId,
    publishedAt: page.publishedAt,
    sections: sections
      .filter((section) => section.isVisible)
      .map((section) => ({
        type: section.type,
        sortOrder: section.sortOrder,
        config: section.config,
        design: section.design,
      })),
  };
}

export async function getPublishedPageBySlug(
  deps: CmsDeps,
  slug: string,
): Promise<PublicPageView> {
  const { db } = deps;
  const [page] = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.slug, slug),
        isNull(pages.deletedAt),
        eq(pages.status, "PUBLISHED"),
      ),
    )
    .limit(1);
  if (!page || page.publishedRevisionId === null) {
    throw AppError.notFound("Page not found.");
  }
  const sections = await loadSections(db, page.publishedRevisionId);
  return toPublicView(page, sections);
}

export async function getPreviewPageBySlug(
  deps: CmsDeps,
  slug: string,
  rawToken: string,
): Promise<PublicPageView & { preview: true; revisionId: number }> {
  const { db } = deps;
  // No oracle: every failure mode is the same 404.
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), isNull(pages.deletedAt)))
    .limit(1);
  if (!page) throw AppError.notFound("Page not found.");
  const revisionId = await resolvePreviewToken(db, page.id, rawToken);
  if (revisionId === null) throw AppError.notFound("Page not found.");
  const sections = await loadSections(db, revisionId);
  return { ...toPublicView(page, sections), preview: true, revisionId };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export interface MenuItemView {
  id: number;
  label: string;
  linkType: string;
  pageId: number | null;
  slug: string | null;
  path: string | null;
  url: string | null;
  sortOrder: number;
  isVisible: boolean;
}

export interface MenuView {
  code: string;
  name: string;
  items: MenuItemView[];
}

function pagePath(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}

export async function getMenuByCode(
  deps: CmsDeps,
  code: string,
): Promise<MenuView> {
  const { db } = deps;
  const [menu] = await db
    .select()
    .from(menus)
    .where(eq(menus.code, code))
    .limit(1);
  if (!menu) throw AppError.notFound("Menu not found.");
  const items = await db
    .select({
      id: menuItems.id,
      label: menuItems.label,
      linkType: menuItems.linkType,
      pageId: menuItems.pageId,
      url: menuItems.url,
      sortOrder: menuItems.sortOrder,
      isVisible: menuItems.isVisible,
      slug: pages.slug,
    })
    .from(menuItems)
    .leftJoin(pages, eq(menuItems.pageId, pages.id))
    .where(and(eq(menuItems.menuId, menu.id), eq(menuItems.isVisible, true)))
    .orderBy(asc(menuItems.sortOrder));
  return {
    code: menu.code,
    name: menu.name,
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      linkType: item.linkType,
      pageId: item.pageId,
      slug: item.slug,
      path: item.slug ? pagePath(item.slug) : null,
      url: item.url,
      sortOrder: item.sortOrder,
      isVisible: item.isVisible,
    })),
  };
}

export async function listMenusAdmin(deps: CmsDeps): Promise<MenuView[]> {
  const { db } = deps;
  const menuRows = await db.select().from(menus).orderBy(asc(menus.id));
  const views: MenuView[] = [];
  for (const menu of menuRows) {
    const items = await db
      .select({
        id: menuItems.id,
        label: menuItems.label,
        linkType: menuItems.linkType,
        pageId: menuItems.pageId,
        url: menuItems.url,
        sortOrder: menuItems.sortOrder,
        isVisible: menuItems.isVisible,
        slug: pages.slug,
      })
      .from(menuItems)
      .leftJoin(pages, eq(menuItems.pageId, pages.id))
      .where(eq(menuItems.menuId, menu.id))
      .orderBy(asc(menuItems.sortOrder));
    views.push({
      code: menu.code,
      name: menu.name,
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        linkType: item.linkType,
        pageId: item.pageId,
        slug: item.slug,
        path: item.slug ? pagePath(item.slug) : null,
        url: item.url,
        sortOrder: item.sortOrder,
        isVisible: item.isVisible,
      })),
    });
  }
  return views;
}

export interface MenuItemInput {
  label: string;
  linkType: "PAGE" | "EXTERNAL" | "ANCHOR";
  pageId?: number | null;
  pageSlug?: string;
  url?: string | null;
  sortOrder?: number;
  isVisible?: boolean;
}

export async function replaceMenuItems(
  deps: CmsDeps,
  actor: CmsActor,
  code: string,
  items: MenuItemInput[],
  meta: RequestMeta,
): Promise<MenuView> {
  const { db } = deps;
  const [menu] = await db
    .select()
    .from(menus)
    .where(eq(menus.code, code))
    .limit(1);
  if (!menu) throw AppError.notFound("Menu not found.");

  // Resolve + validate every item before writing anything.
  const resolved: {
    label: string;
    linkType: string;
    pageId: number | null;
    url: string | null;
    sortOrder: number;
    isVisible: boolean;
  }[] = [];
  for (const [index, item] of items.entries()) {
    if (item.linkType === "PAGE") {
      let pageId = item.pageId ?? null;
      if (pageId === null && item.pageSlug) {
        const [target] = await db
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.slug, item.pageSlug), isNull(pages.deletedAt)))
          .limit(1);
        pageId = target?.id ?? null;
      }
      if (pageId === null) {
        throw AppError.validation(
          [{ field: `items.${index}.pageId`, issue: "Menu item must reference an existing page." }],
          "The submitted data is invalid.",
        );
      }
      resolved.push({
        label: item.label,
        linkType: item.linkType,
        pageId,
        url: null,
        sortOrder: item.sortOrder ?? index,
        isVisible: item.isVisible ?? true,
      });
    } else {
      if (!item.url) {
        throw AppError.validation(
          [{ field: `items.${index}.url`, issue: "External/anchor menu items require a url." }],
          "The submitted data is invalid.",
        );
      }
      resolved.push({
        label: item.label,
        linkType: item.linkType,
        pageId: null,
        url: item.url,
        sortOrder: item.sortOrder ?? index,
        isVisible: item.isVisible ?? true,
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(menuItems).where(eq(menuItems.menuId, menu.id));
    if (resolved.length > 0) {
      await tx.insert(menuItems).values(
        resolved.map((item) => ({ menuId: menu.id, ...item })),
      );
    }
  });

  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.cmsMenusUpdate,
    resourceType: "menu",
    resourceId: menu.id,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { code, itemCount: resolved.length },
  });
  return getMenuByCode(deps, code);
}

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

export interface SettingView {
  key: string;
  value: unknown;
  isPublic: boolean;
  updatedAt: Date;
}

function parseSettingValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export async function getPublicSettings(
  deps: CmsDeps,
): Promise<Record<string, unknown>> {
  const rows = await deps.db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.isPublic, true));
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    out[row.settingKey] = parseSettingValue(row.settingValue);
  }
  return out;
}

export async function listSettingsAdmin(
  deps: CmsDeps,
): Promise<SettingView[]> {
  const rows = await deps.db
    .select()
    .from(siteSettings)
    .orderBy(asc(siteSettings.settingKey));
  return rows.map((row) => ({
    key: row.settingKey,
    value: parseSettingValue(row.settingValue),
    isPublic: row.isPublic,
    updatedAt: row.updatedAt,
  }));
}

export interface SettingInput {
  key: string;
  value: unknown;
  isPublic?: boolean;
}

export async function updateSettings(
  deps: CmsDeps,
  actor: CmsActor,
  entries: SettingInput[],
  meta: RequestMeta,
): Promise<SettingView[]> {
  const { db } = deps;
  const changes: { key: string; oldValue: unknown; newValue: unknown }[] = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const [old] = await tx
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.settingKey, entry.key))
        .limit(1);
      const oldValue = old ? parseSettingValue(old.settingValue) : null;
      if (JSON.stringify(oldValue) !== JSON.stringify(entry.value)) {
        changes.push({ key: entry.key, oldValue, newValue: entry.value });
      }
      await tx
        .insert(siteSettings)
        .values({
          settingKey: entry.key,
          settingValue: JSON.stringify(entry.value),
          isPublic: entry.isPublic ?? old?.isPublic ?? false,
          updatedBy: actor.userId,
        })
        .onDuplicateKeyUpdate({
          set: {
            settingValue: JSON.stringify(entry.value),
            isPublic: entry.isPublic ?? old?.isPublic ?? false,
            updatedBy: actor.userId,
          },
        });
    }
  });

  if (changes.length > 0) {
    await writeAudit(db, {
      actorId: actor.userId,
      actorType: "ADMIN",
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.settingsUpdate,
      resourceType: "site_settings",
      resourceId: null,
      result: "SUCCESS",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: { changes },
    });
  }
  return listSettingsAdmin(deps);
}
