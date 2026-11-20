import { AppError } from "@bodhisattva/shared/errors";
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { sitePolicies, sitePolicyRevisions } from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { sanitizePolicyHtml } from "./sanitize.js";
import type { PolicySlug } from "./schemas.js";

/**
 * Policy pages service (legal pages feature, 2026-11-20; plan
 * reviewed by ChatGPT thinking mode — amendments adopted).
 *
 * Invariants:
 *  - Exactly three policies exist (DB CHECK + API allowlist + no
 *    create/delete). Reads of an unknown slug are 404.
 *  - Every save is ONE transaction: snapshot the current content
 *    into site_policy_revisions → update the policy (version + 1) →
 *    write the audit row. If any step fails, none of it happened —
 *    a legal page can never change without its history and audit.
 *  - Optimistic concurrency: the update/restore must name the
 *    version the editor loaded; a mismatch is a 409, never a silent
 *    overwrite of a colleague's save.
 *  - Body HTML passes sanitizePolicyHtml on the way IN and again on
 *    the way OUT (public and admin reads), so nothing reaches a
 *    rendering sink unsanitized even if a row predates a rule.
 *  - The public view carries no editor metadata (no updatedBy).
 */

export interface PolicyDeps {
  db: Database;
}

export interface PolicyActor {
  userId: number;
  email: string;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

type PolicyRow = typeof sitePolicies.$inferSelect;
type RevisionRow = typeof sitePolicyRevisions.$inferSelect;

export interface PolicyPublicView {
  slug: string;
  title: string;
  bodyHtml: string;
  version: number;
  updatedAt: string;
}

export interface PolicyAdminView extends PolicyPublicView {
  updatedBy: number | null;
  revisionsCount: number;
}

export interface PolicyRevisionView {
  id: number;
  slug: string;
  title: string;
  version: number;
  savedBy: number | null;
  createdAt: string;
}

export interface PolicyRevisionDetail extends PolicyRevisionView {
  bodyHtml: string;
}

const SLUG_ORDER: PolicySlug[] = ["privacy-policy", "terms-of-use", "accessibility"];

async function loadPolicy(db: Database, slug: PolicySlug): Promise<PolicyRow> {
  const [row] = await db.select().from(sitePolicies).where(eq(sitePolicies.slug, slug)).limit(1);
  if (!row) throw AppError.notFound("Policy page not found.");
  return row;
}

async function revisionsCount(db: Database, slug: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(sitePolicyRevisions)
    .where(eq(sitePolicyRevisions.slug, slug));
  return Number(row?.n ?? 0);
}

function toPublicView(row: PolicyRow): PolicyPublicView {
  return {
    slug: row.slug,
    title: row.title,
    bodyHtml: sanitizePolicyHtml(row.bodyHtml),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toAdminView(db: Database, row: PolicyRow): Promise<PolicyAdminView> {
  return {
    ...toPublicView(row),
    updatedBy: row.updatedBy,
    revisionsCount: await revisionsCount(db, row.slug),
  };
}

function toRevisionView(row: RevisionRow): PolicyRevisionView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    version: row.version,
    savedBy: row.savedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getPublicPolicy(
  deps: PolicyDeps,
  slug: PolicySlug,
): Promise<PolicyPublicView> {
  return toPublicView(await loadPolicy(deps.db, slug));
}

export async function listAdminPolicies(deps: PolicyDeps): Promise<PolicyAdminView[]> {
  const views: PolicyAdminView[] = [];
  for (const slug of SLUG_ORDER) {
    const [row] = await deps.db
      .select()
      .from(sitePolicies)
      .where(eq(sitePolicies.slug, slug))
      .limit(1);
    if (row) views.push(await toAdminView(deps.db, row));
  }
  return views;
}

export async function getAdminPolicy(
  deps: PolicyDeps,
  slug: PolicySlug,
): Promise<PolicyAdminView> {
  return toAdminView(deps.db, await loadPolicy(deps.db, slug));
}

export async function listRevisions(
  deps: PolicyDeps,
  slug: PolicySlug,
): Promise<PolicyRevisionView[]> {
  await loadPolicy(deps.db, slug);
  const rows = await deps.db
    .select()
    .from(sitePolicyRevisions)
    .where(eq(sitePolicyRevisions.slug, slug))
    .orderBy(desc(sitePolicyRevisions.id))
    .limit(50);
  return rows.map(toRevisionView);
}

export async function getRevision(
  deps: PolicyDeps,
  slug: PolicySlug,
  revisionId: number,
): Promise<PolicyRevisionDetail> {
  const [row] = await deps.db
    .select()
    .from(sitePolicyRevisions)
    .where(eq(sitePolicyRevisions.id, revisionId))
    .limit(1);
  if (!row || row.slug !== slug) throw AppError.notFound("Policy revision not found.");
  return { ...toRevisionView(row), bodyHtml: sanitizePolicyHtml(row.bodyHtml) };
}

/**
 * The one write path, shared by update and restore: version check →
 * snapshot current → apply new content → audit, all in one tx.
 */
async function applySave(
  deps: PolicyDeps,
  actor: PolicyActor,
  meta: RequestMeta,
  slug: PolicySlug,
  input: { title: string; bodyHtml: string; version: number },
  action: string,
  auditMetadata?: Record<string, unknown>,
): Promise<PolicyAdminView> {
  const cleanBody = sanitizePolicyHtml(input.bodyHtml);
  let updated: PolicyRow | null = null;
  await deps.db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    const [current] = await tx
      .select()
      .from(sitePolicies)
      .where(eq(sitePolicies.slug, slug))
      .limit(1);
    if (!current) throw AppError.notFound("Policy page not found.");
    if (current.version !== input.version) {
      throw AppError.conflict(
        "This page was changed by someone else since you opened it. Reload the page to see the latest version, then make your edit again.",
      );
    }
    await tx.insert(sitePolicyRevisions).values({
      slug,
      title: current.title,
      bodyHtml: current.bodyHtml,
      version: current.version,
      savedBy: actor.userId,
    });
    await tx
      .update(sitePolicies)
      .set({
        title: input.title,
        bodyHtml: cleanBody,
        version: current.version + 1,
        updatedBy: actor.userId,
      })
      .where(eq(sitePolicies.slug, slug));
    await writeAudit(txDb, {
      actorId: actor.userId,
      actorType: "ADMIN",
      actorEmail: actor.email,
      action,
      resourceType: "site_policy",
      resourceId: slug,
      result: "SUCCESS",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { ...auditMetadata, fromVersion: current.version, toVersion: current.version + 1 },
    });
    const [row] = await tx
      .select()
      .from(sitePolicies)
      .where(eq(sitePolicies.slug, slug))
      .limit(1);
    updated = row ?? null;
  });
  if (!updated) throw AppError.internal();
  return toAdminView(deps.db, updated);
}

export function updatePolicy(
  deps: PolicyDeps,
  actor: PolicyActor,
  meta: RequestMeta,
  slug: PolicySlug,
  input: { title: string; bodyHtml: string; version: number },
): Promise<PolicyAdminView> {
  return applySave(deps, actor, meta, slug, input, AUDIT_ACTIONS.policyUpdate);
}

export async function restoreRevision(
  deps: PolicyDeps,
  actor: PolicyActor,
  meta: RequestMeta,
  slug: PolicySlug,
  input: { revisionId: number; version: number },
): Promise<PolicyAdminView> {
  const revision = await getRevision(deps, slug, input.revisionId);
  return applySave(
    deps,
    actor,
    meta,
    slug,
    { title: revision.title, bodyHtml: revision.bodyHtml, version: input.version },
    AUDIT_ACTIONS.policyRestore,
    { revisionId: input.revisionId, restoredFromVersion: revision.version },
  );
}
