import { AppError } from "@bodhisattva/shared/errors";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { mediaAssets, sitePopups } from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { mediaFileUrl } from "../media/media.service.js";
import type { CreatePopupInput, UpdatePopupInput } from "./schemas.js";

/**
 * Website popup service (owner feature, 2026-11-20).
 *
 * Invariants:
 *  - At most one popup is active. Activation runs in ONE transaction
 *    (deactivate-all, then activate) and the DB's generated-column
 *    unique index (migration 0019) is the hard backstop.
 *  - `version` increments ONLY when visitor-facing content changes
 *    (heading, message, image, button label, link URL) — never on
 *    activate/deactivate — because the browser's seen marker is keyed
 *    by (id, version).
 *  - The public read returns ONLY the active row, with its image
 *    resolved through the media pipeline; a missing/soft-deleted
 *    asset degrades to no image, never a broken URL.
 */

export interface PopupDeps {
  db: Database;
}

export interface PopupActor {
  userId: number;
  email: string;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

type PopupRow = typeof sitePopups.$inferSelect;

export interface PopupAdminView {
  id: number;
  heading: string;
  message: string;
  imageMediaId: number | null;
  imageUrl: string | null;
  buttonLabel: string | null;
  linkUrl: string | null;
  isActive: boolean;
  version: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PopupPublicView {
  id: number;
  version: number;
  heading: string;
  message: string;
  imageUrl: string | null;
  imageAlt: string | null;
  buttonLabel: string | null;
  linkUrl: string | null;
}

async function resolveImage(
  db: Database,
  mediaId: number | null,
): Promise<{ url: string | null; alt: string | null }> {
  if (mediaId == null) return { url: null, alt: null };
  const [asset] = await db
    .select({ id: mediaAssets.id, altText: mediaAssets.altText })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, mediaId), isNull(mediaAssets.deletedAt)))
    .limit(1);
  if (!asset) return { url: null, alt: null };
  return { url: mediaFileUrl(asset.id, "master"), alt: asset.altText };
}

async function toAdminView(db: Database, row: PopupRow): Promise<PopupAdminView> {
  const image = await resolveImage(db, row.imageMediaId);
  return {
    id: row.id,
    heading: row.heading,
    message: row.message,
    imageMediaId: row.imageMediaId,
    imageUrl: image.url,
    buttonLabel: row.buttonLabel,
    linkUrl: row.linkUrl,
    isActive: row.isActive,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertMediaExists(db: Database, mediaId: number): Promise<void> {
  const [asset] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, mediaId), isNull(mediaAssets.deletedAt)))
    .limit(1);
  if (!asset) {
    throw AppError.validation(
      [{ field: "imageMediaId", issue: "Media asset not found." }],
      "The submitted data is invalid.",
    );
  }
}

async function loadPopup(db: Database, id: number): Promise<PopupRow> {
  const [row] = await db.select().from(sitePopups).where(eq(sitePopups.id, id)).limit(1);
  if (!row) throw AppError.notFound("Popup not found.");
  return row;
}

function audit(
  db: Database,
  actor: PopupActor,
  action: string,
  popupId: number,
  meta: RequestMeta,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action,
    resourceType: "popup",
    resourceId: popupId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata,
  });
}

export async function listAdminPopups(deps: PopupDeps): Promise<PopupAdminView[]> {
  const rows = await deps.db
    .select()
    .from(sitePopups)
    .orderBy(desc(sitePopups.id));
  const views: PopupAdminView[] = [];
  for (const row of rows) views.push(await toAdminView(deps.db, row));
  return views;
}

export async function createPopup(
  deps: PopupDeps,
  actor: PopupActor,
  input: CreatePopupInput,
  meta: RequestMeta,
): Promise<PopupAdminView> {
  const { db } = deps;
  if (input.imageMediaId != null) await assertMediaExists(db, input.imageMediaId);
  const [inserted] = await db
    .insert(sitePopups)
    .values({
      heading: input.heading,
      message: input.message,
      imageMediaId: input.imageMediaId ?? null,
      buttonLabel: input.buttonLabel ?? null,
      linkUrl: input.linkUrl ?? null,
      isActive: false,
      version: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .$returningId();
  await audit(db, actor, AUDIT_ACTIONS.popupCreate, inserted.id, meta);
  return toAdminView(db, await loadPopup(db, inserted.id));
}

const CONTENT_FIELDS = ["heading", "message", "imageMediaId", "buttonLabel", "linkUrl"] as const;

export async function updatePopup(
  deps: PopupDeps,
  actor: PopupActor,
  id: number,
  input: UpdatePopupInput,
  meta: RequestMeta,
): Promise<PopupAdminView> {
  const { db } = deps;
  const row = await loadPopup(db, id);
  if (input.imageMediaId != null) await assertMediaExists(db, input.imageMediaId);

  const patch: Partial<PopupRow> = { updatedBy: actor.userId };
  let contentChanged = false;
  for (const field of CONTENT_FIELDS) {
    if (input[field] !== undefined) {
      if (input[field] !== row[field]) contentChanged = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[field] = input[field];
    }
  }
  if (contentChanged) patch.version = row.version + 1;
  await db.update(sitePopups).set(patch).where(eq(sitePopups.id, id));
  await audit(db, actor, AUDIT_ACTIONS.popupUpdate, id, meta, {
    versionBumped: contentChanged,
  });
  return toAdminView(db, await loadPopup(db, id));
}

export async function activatePopup(
  deps: PopupDeps,
  actor: PopupActor,
  id: number,
  meta: RequestMeta,
): Promise<PopupAdminView> {
  const { db } = deps;
  await loadPopup(db, id);
  await db.transaction(async (tx) => {
    await tx.update(sitePopups).set({ isActive: false });
    await tx
      .update(sitePopups)
      .set({ isActive: true, updatedBy: actor.userId })
      .where(eq(sitePopups.id, id));
  });
  await audit(db, actor, AUDIT_ACTIONS.popupActivate, id, meta);
  return toAdminView(db, await loadPopup(db, id));
}

export async function deactivatePopup(
  deps: PopupDeps,
  actor: PopupActor,
  id: number,
  meta: RequestMeta,
): Promise<PopupAdminView> {
  const { db } = deps;
  await loadPopup(db, id);
  await db
    .update(sitePopups)
    .set({ isActive: false, updatedBy: actor.userId })
    .where(eq(sitePopups.id, id));
  await audit(db, actor, AUDIT_ACTIONS.popupDeactivate, id, meta);
  return toAdminView(db, await loadPopup(db, id));
}

export async function deletePopup(
  deps: PopupDeps,
  actor: PopupActor,
  id: number,
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  await loadPopup(db, id);
  await db.delete(sitePopups).where(eq(sitePopups.id, id));
  await audit(db, actor, AUDIT_ACTIONS.popupDelete, id, meta);
}

export async function getPublicPopup(deps: PopupDeps): Promise<PopupPublicView | null> {
  const { db } = deps;
  const [row] = await db
    .select()
    .from(sitePopups)
    .where(eq(sitePopups.isActive, true))
    .limit(1);
  if (!row) return null;
  const image = await resolveImage(db, row.imageMediaId);
  return {
    id: row.id,
    version: row.version,
    heading: row.heading,
    message: row.message,
    imageUrl: image.url,
    imageAlt: image.alt,
    buttonLabel: row.buttonLabel,
    linkUrl: row.linkUrl,
  };
}
