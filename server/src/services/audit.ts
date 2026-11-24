/**
 * Audit service (DATABASE_DESIGN.md §11.2, spec Part 14).
 *
 * The ONLY write path to `audit_logs`. The table is append-only: this module
 * exposes `writeAudit` and nothing else — no update, no delete, and no admin
 * API in this phase touches the table (the Super Admin read API arrives with
 * `audit.read` in a later phase).
 *
 * Content rules (enforced here, not by callers):
 *  - Passwords, OTPs, tokens, session ids, TOTP secrets and recovery codes
 *    are NEVER written. `sanitizeAuditMetadata` recursively drops any key
 *    matching /password|otp|token|secret|code/i — except safe identifier
 *    keys (e.g. `invitationId`, `user_id`), which carry no secret value.
 *  - Writing an audit row must never break the request that caused it:
 *    failures are logged through pino and swallowed.
 *
 * Schema mapping note: `audit_logs` (Phase 1 DDL) has no `actor_type`
 * column; the caller's `actorType` is persisted in `actor_role` unless the
 * caller supplies a more specific `actorRole` snapshot (e.g. SUPER_ADMIN).
 * A non-numeric `resourceId` cannot fit `target_id` (BIGINT), so it is kept
 * in metadata as `resourceRef` instead of being silently dropped.
 */
import pino from "pino";
import type { Database } from "../database/client.js";
import { auditLogs } from "../database/schema/index.js";

const log = pino({ name: "audit", level: process.env.LOG_LEVEL ?? "info" });

export type AuditActorType = "CUSTOMER" | "ADMIN" | "SYSTEM";
export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED";

export interface AuditEntry {
  /** users.id of the actor; null/omitted for anonymous or system events. */
  actorId?: number | null;
  actorType: AuditActorType;
  /** Role snapshot (e.g. "SUPER_ADMIN"); defaults to `actorType`. */
  actorRole?: string | null;
  /** Email snapshot so history survives account changes. */
  actorEmail?: string | null;
  /** Dotted action string, e.g. "auth.login.success", "admin.roles.assign". */
  action: string;
  resourceType?: string | null;
  /** Numeric ids land in `target_id`; anything else is kept as metadata.resourceRef. */
  resourceId?: number | string | null;
  result: AuditResult;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Safe structured detail only — sanitised before insert, always. */
  metadata?: Record<string, unknown> | null;
}

/** Action taxonomy for the Phase 2 identity domains (DATABASE_DESIGN §11.2 style). */
export const AUDIT_ACTIONS = {
  invitationsCreate: "admin.invitations.create",
  invitationsRevoke: "admin.invitations.revoke",
  invitationsAccept: "admin.invitations.accept",
  mfaEnrol: "auth.mfa.enrol",
  mfaConfirm: "auth.mfa.confirm",
  mfaVerify: "auth.mfa.verify",
  mfaRecover: "auth.mfa.recover",
  mfaReset: "auth.mfa.reset",
  mfaStepUp: "auth.mfa.step_up",
  rolesAssign: "admin.roles.assign",
  bootstrapSuperAdmin: "admin.bootstrap.super_admin",
  authorizationDenied: "authorization.denied",
  cmsPagesCreate: "cms.pages.create",
  cmsPagesUpdate: "cms.pages.update",
  cmsPagesPublish: "cms.pages.publish",
  cmsPagesRestore: "cms.pages.restore",
  cmsPagesDelete: "cms.pages.delete",
  cmsMenusUpdate: "cms.menus.update",
  settingsUpdate: "settings.update",
  museumCollectionsCreate: "museum.collections.create",
  museumCollectionsUpdate: "museum.collections.update",
  museumCollectionsDelete: "museum.collections.delete",
  museumCollectionsReorder: "museum.collections.reorder",
  museumExhibitionsCreate: "museum.exhibitions.create",
  museumExhibitionsUpdate: "museum.exhibitions.update",
  museumExhibitionsDelete: "museum.exhibitions.delete",
  museumExhibitionsReorder: "museum.exhibitions.reorder",
  museumGalleryCreate: "museum.gallery.create",
  museumGalleryUpdate: "museum.gallery.update",
  museumGalleryDelete: "museum.gallery.delete",
  policyUpdate: "policy.update",
  policyRestore: "policy.restore",
  museumGalleryReorder: "museum.gallery.reorder",
  newsArticlesCreate: "news.articles.create",
  newsArticlesUpdate: "news.articles.update",
  newsArticlesDelete: "news.articles.delete",
  newsArticlesPublish: "news.articles.publish",
  newsArticlesUnpublish: "news.articles.unpublish",
  newsArticlesDuplicate: "news.articles.duplicate",
  newsArticlesBulk: "news.articles.bulk",
  newsPdfUpload: "news.pdf.upload",
  newsPdfReplace: "news.pdf.replace",
  newsPdfRemove: "news.pdf.remove",
  newsPdfDownload: "news.pdf.download",
  newsPreviewCreate: "news.preview.create",
  newsCategoriesCreate: "news.categories.create",
  newsCategoriesUpdate: "news.categories.update",
  newsCategoriesDelete: "news.categories.delete",
  foundationProgramsCreate: "foundation.programs.create",
  foundationProgramsUpdate: "foundation.programs.update",
  foundationProgramsDelete: "foundation.programs.delete",
  foundationProgramsReorder: "foundation.programs.reorder",
  foundationTestimonialsCreate: "foundation.testimonials.create",
  foundationTestimonialsUpdate: "foundation.testimonials.update",
  foundationTestimonialsDelete: "foundation.testimonials.delete",
  foundationTestimonialsReorder: "foundation.testimonials.reorder",
  storeProductsCreate: "store.products.create",
  storeProductsUpdate: "store.products.update",
  storeProductsArchive: "store.products.archive",
  storeProductsActivate: "store.products.activate",
  storeProductsDelete: "store.products.delete",
  storeProductImagesCreate: "store.product_images.create",
  storeProductImagesUpdate: "store.product_images.update",
  storeProductImagesDelete: "store.product_images.delete",
  storeVariantsCreate: "store.variants.create",
  storeVariantsUpdate: "store.variants.update",
  storeVariantsDelete: "store.variants.delete",
  storeCategoriesCreate: "store.categories.create",
  storeCategoriesUpdate: "store.categories.update",
  storeCategoriesDelete: "store.categories.delete",
  storeInventoryAdjust: "store.inventory.adjust",
  storeOrdersCreate: "store.orders.create",
  storeOrdersApprove: "store.orders.approve",
  storeOrdersReject: "store.orders.reject",
  storeOrdersCancel: "store.orders.cancel",
  storeOrdersUpdate: "store.orders.update",
  storeInvoicesCreate: "store.invoices.create",
  storeInvoicesResend: "store.invoices.resend",
  storeInvoicesEmailDead: "store.invoices.email_dead",
  storeInvoicesCreditNote: "store.invoices.credit_note",
  storeInvoiceTemplatesUpdate: "store.invoice_templates.update",
  storeOutboxRetry: "store.outbox.retry",
} as const;

const SENSITIVE_KEY = /password|otp|token|secret|code/i;
const SAFE_ID_KEY = /(?:^|_)id$/i;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 512;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively sanitise audit metadata: drop secret-bearing keys, bound the
 * size/depth, and convert Dates to ISO strings. Exported for tests.
 */
export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeAuditMetadata(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key) && !SAFE_ID_KEY.test(key)) continue;
      out[key] = sanitizeAuditMetadata(child, depth + 1);
    }
    return out;
  }
  // Anything else (class instances, Buffers, …) is not audit-safe detail.
  return undefined;
}

function toTargetId(
  resourceId: number | string | null | undefined,
): number | null {
  if (resourceId === null || resourceId === undefined) return null;
  if (typeof resourceId === "number") {
    return Number.isSafeInteger(resourceId) ? resourceId : null;
  }
  const parsed = Number(resourceId);
  return Number.isSafeInteger(parsed) && String(parsed) === resourceId.trim()
    ? parsed
    : null;
}

/**
 * Append one audit row. NEVER throws: an audit failure is logged and the
 * caller's operation proceeds (availability of the request path wins; the
 * failure itself is visible in the diagnostic log).
 *
 * Accepts the app `Database`; transaction handles are structurally
 * compatible for `insert` and may be passed by transactional callers.
 */
export async function writeAudit(
  db: Database,
  entry: AuditEntry,
): Promise<void> {
  try {
    const targetId = toTargetId(entry.resourceId);
    let metadata = entry.metadata
      ? (sanitizeAuditMetadata(entry.metadata) as Record<string, unknown>)
      : undefined;
    if (
      entry.resourceId !== null &&
      entry.resourceId !== undefined &&
      targetId === null
    ) {
      metadata = { ...(metadata ?? {}), resourceRef: String(entry.resourceId) };
    }

    await db.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      actorEmailSnapshot: entry.actorEmail ?? null,
      actorRole: entry.actorRole ?? entry.actorType,
      action: entry.action.slice(0, 80),
      targetType: entry.resourceType ?? null,
      targetId,
      result: entry.result,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 512) : null,
      metadata: metadata ?? null,
    });
  } catch (err) {
    log.error(
      { err, action: entry.action, result: entry.result },
      "audit write failed",
    );
  }
}
