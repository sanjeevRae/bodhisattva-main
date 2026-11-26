/**
 * Invitations service (DATABASE_DESIGN.md §6.1, PERMISSIONS.md §8,
 * SECURITY_THREAT_MODEL T-11).
 *
 * Rules enforced here:
 *  - Only administrative roles can be invited (never CUSTOMER), and an
 *    inviter can never grant a role above their own highest role.
 *  - The token is a ≥256-bit CSPRNG value; only its SHA-256 hash is stored.
 *    The raw token exists only in this return value and the email.
 *  - One live invitation per email: re-issue revokes predecessors.
 *  - SUPER_ADMIN invitations count against the MAX_SUPER_ADMINS cap
 *    (config/limits.ts): creation is refused when active Super Admins
 *    plus live Super Admin invitations reach the cap, and acceptance
 *    re-checks the ceiling before consuming the invitation.
 *  - Acceptance consumes the invitation with ONE conditional UPDATE
 *    (status pending + unexpired), so concurrent accepts cannot both win;
 *    the account email is taken from the invitation row — it cannot be
 *    changed during acceptance. No session is created on acceptance:
 *    the new admin logs in and completes MFA enrolment then.
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { AppConfig } from "../../config/env.js";
import { MAX_SUPER_ADMINS } from "../../config/limits.js";
import type { Database } from "../../database/client.js";
import {
  invitations,
  roles as rolesTable,
  userRoles,
  users,
} from "../../database/schema/index.js";
import type { AuthContext } from "../../middleware/authorization.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { getMailer } from "../../services/mailer.js";
import {
  ROLE_RANK,
  getHighestRole,
  getUserRoles,
} from "../../services/permissions.js";
import { hashPassword } from "../../utils/password.js";
import { generateToken, hashToken } from "../../utils/tokens.js";
import {
  countActiveSuperAdmins,
  countPendingSuperAdminInvitations,
  superAdminLimitError,
} from "../roles/super-admin-cap.js";
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  InvitableRole,
} from "./invitations.schemas.js";

export interface InvitationsDeps {
  db: Database;
  config: AppConfig;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface InvitationView {
  id: number;
  email: string;
  role: string;
  status: InvitationStatus;
  invitedBy: number;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedUserId: number | null;
  revokedAt: string | null;
  createdAt: string;
}

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours (§6.1)

type InvitationRow = typeof invitations.$inferSelect;

function toView(row: InvitationRow, roleCode: string): InvitationView {
  const status: InvitationStatus = row.acceptedAt
    ? "ACCEPTED"
    : row.revokedAt
      ? "REVOKED"
      : row.expiresAt.getTime() <= Date.now()
        ? "EXPIRED"
        : "PENDING";
  return {
    id: row.id,
    email: row.email,
    role: roleCode,
    status,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    acceptedUserId: row.acceptedUserId,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function affectedRows(result: unknown): number {
  const header = (result as [{ affectedRows?: unknown }] | null)?.[0];
  return typeof header?.affectedRows === "number" ? header.affectedRows : 0;
}

function isDuplicateEntryError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const carrier = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (carrier.code === "ER_DUP_ENTRY") return true;
    if (typeof carrier.message === "string" && carrier.message.includes("Duplicate entry")) {
      return true;
    }
    current = carrier.cause;
  }
  return false;
}

function invalidInvitationError(): AppError {
  // One generic message for unknown / expired / revoked / consumed tokens —
  // the endpoint must not become an invitation-state oracle (T-11).
  return new AppError(
    "VALIDATION_FAILED",
    "This invitation is invalid, expired, or has already been used.",
  );
}

export async function createInvitation(
  deps: InvitationsDeps,
  actor: AuthContext,
  input: CreateInvitationInput,
  meta: RequestMeta,
): Promise<InvitationView> {
  const { db, config } = deps;
  const email = input.email.trim();
  const emailNormalized = email.toLowerCase();

  // Privilege cap: never grant a role above the inviter's own highest role.
  const actorRoles = await getUserRoles(db, actor.userId);
  const actorHighest = getHighestRole(actorRoles);
  if (!actorHighest || ROLE_RANK[actorHighest] < ROLE_RANK[input.role]) {
    throw AppError.forbidden(
      "You cannot invite an administrator with a role above your own.",
    );
  }

  const [roleRow] = await db
    .select({ id: rolesTable.id, code: rolesTable.code })
    .from(rolesTable)
    .where(eq(rolesTable.code, input.role))
    .limit(1);
  if (!roleRow) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Roles are not initialised. Run the database seed first.",
    );
  }

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  if (existingUser) {
    throw AppError.conflict(
      "An account with this email address already exists.",
    );
  }

  // generateToken returns the raw token (shown once, in the email) and its
  // SHA-256 hash (the only form ever stored).
  const { raw: rawToken, hash: tokenHash } = generateToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  let invitationId = 0;
  await db.transaction(async (tx) => {
    // One live invitation per email: revoke any still-pending predecessors.
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.emailNormalized, emailNormalized),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    // Super Admin cap (owner decision 2026-11-18, config/limits.ts):
    // a SUPER_ADMIN invitation reserves a slot, so it is refused when
    // active Super Admins + live Super Admin invitations already reach
    // MAX_SUPER_ADMINS. Checked after the revocation above, so a
    // re-issued invitation for the same email never counts its own
    // just-revoked predecessors against itself.
    if (input.role === "SUPER_ADMIN") {
      const txDb = tx as unknown as Database;
      const activeSuperAdmins = await countActiveSuperAdmins(txDb);
      const pendingSuperAdmins =
        await countPendingSuperAdminInvitations(txDb);
      if (activeSuperAdmins + pendingSuperAdmins >= MAX_SUPER_ADMINS) {
        throw superAdminLimitError();
      }
    }
    const [created] = await tx
      .insert(invitations)
      .values({
        email,
        emailNormalized,
        roleId: roleRow.id,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt,
      })
      .$returningId();
    invitationId = created.id;
  });

  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorRole: actorHighest,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.invitationsCreate,
    resourceType: "invitation",
    resourceId: invitationId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { email, role: input.role, invitationId },
  });

  const acceptUrl = `${config.appUrl.replace(/\/$/, "")}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
  try {
    await getMailer(config).sendMail({
      to: email,
      subject: "You have been invited to administer the Bodhisattva Museum website",
      text: [
        `You have been invited to join the Bodhisattva Museum website administration team with the role ${input.role}.`,
        ``,
        `Accept the invitation within 72 hours using this link:`,
        acceptUrl,
        ``,
        `If you were not expecting this invitation, you can ignore this email.`,
      ].join("\n"),
      html: [
        `<p>You have been invited to join the Bodhisattva Museum website administration team with the role <strong>${input.role}</strong>.</p>`,
        `<p><a href="${acceptUrl}">Accept the invitation</a> within 72 hours.</p>`,
        `<p>If you were not expecting this invitation, you can ignore this email.</p>`,
      ].join("\n"),
    });
  } catch (cause) {
    await writeAudit(db, {
      actorId: actor.userId,
      actorType: "ADMIN",
      actorRole: actorHighest,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.invitationsCreate,
      resourceType: "invitation",
      resourceId: invitationId,
      result: "FAILURE",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: { email, role: input.role, invitationId, emailSent: false },
    });
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "The invitation was created but its email could not be sent. Revoke it and try again.",
      undefined,
      { cause },
    );
  }

  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  return toView(row, roleRow.code);
}

export async function listInvitations(
  deps: InvitationsDeps,
  pagination: PaginationParams,
): Promise<{ items: InvitationView[]; total: number }> {
  const { db } = deps;
  const offset = (pagination.page - 1) * pagination.pageSize;
  const [totalRow] = await db.select({ value: count() }).from(invitations);
  const rows = await db
    .select({ invitation: invitations, roleCode: rolesTable.code })
    .from(invitations)
    .innerJoin(rolesTable, eq(invitations.roleId, rolesTable.id))
    .orderBy(desc(invitations.createdAt))
    .limit(pagination.pageSize)
    .offset(offset);
  return {
    items: rows.map((r) => toView(r.invitation, r.roleCode)),
    total: totalRow?.value ?? 0,
  };
}

export async function revokeInvitation(
  deps: InvitationsDeps,
  actor: AuthContext,
  invitationId: number,
  meta: RequestMeta,
): Promise<InvitationView> {
  const { db } = deps;
  const [existing] = await db
    .select({ invitation: invitations, roleCode: rolesTable.code })
    .from(invitations)
    .innerJoin(rolesTable, eq(invitations.roleId, rolesTable.id))
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (!existing) throw AppError.notFound("Invitation not found.");
  if (existing.invitation.acceptedAt || existing.invitation.revokedAt) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      "Only a pending invitation can be revoked.",
    );
  }

  // Conditional update: exactly one revoker wins a concurrent race.
  const result = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.id, invitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  if (affectedRows(result) !== 1) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      "Only a pending invitation can be revoked.",
    );
  }

  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.invitationsRevoke,
    resourceType: "invitation",
    resourceId: invitationId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { invitationId, email: existing.invitation.email },
  });

  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  return toView(row, existing.roleCode);
}

export interface AcceptInvitationResult {
  userId: number;
  email: string;
  role: InvitableRole | string;
  /** The client must now send the user to login; MFA enrolment happens there. */
  nextStep: "LOGIN";
}

export async function acceptInvitation(
  deps: InvitationsDeps,
  input: AcceptInvitationInput,
  meta: RequestMeta,
): Promise<AcceptInvitationResult> {
  const { db } = deps;
  const tokenHash = hashToken(input.token);

  const [invitation] = await db
    .select({ invitation: invitations, roleCode: rolesTable.code })
    .from(invitations)
    .innerJoin(rolesTable, eq(invitations.roleId, rolesTable.id))
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  if (!invitation) throw invalidInvitationError();
  const inv = invitation.invitation;
  if (inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() <= Date.now()) {
    throw invalidInvitationError();
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  let newUserId = 0;

  try {
    await db.transaction(async (tx) => {
      // Super Admin cap (owner decision 2026-11-18, config/limits.ts):
      // slots can fill between invitation and acceptance (e.g. a direct
      // promotion), so acceptance re-checks the ceiling BEFORE consuming.
      // Locking every SUPER_ADMIN assignment row serializes acceptances
      // against promotions/demotions. Throwing here rolls the whole
      // transaction back, so the invitation is NOT consumed and stays
      // usable once a slot frees up.
      if (invitation.roleCode === "SUPER_ADMIN") {
        await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, inv.roleId))
          .for("update");
        const activeSuperAdmins = await countActiveSuperAdmins(
          tx as unknown as Database,
        );
        if (activeSuperAdmins >= MAX_SUPER_ADMINS) {
          throw AppError.conflict(
            `The Super Admin limit (${MAX_SUPER_ADMINS}) has been reached, so this invitation cannot be accepted. Ask an existing Super Admin to free a slot first.`,
          );
        }
      }

      // Atomic consume: a single conditional UPDATE is the single-use gate —
      // pending, unrevoked and unexpired at the moment of the write.
      const consumed = await tx
        .update(invitations)
        .set({ acceptedAt: now })
        .where(
          and(
            eq(invitations.id, inv.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, now),
          ),
        );
      if (affectedRows(consumed) !== 1) throw invalidInvitationError();

      const [created] = await tx
        .insert(users)
        .values({
          fullName: input.name,
          email: inv.email,
          emailNormalized: inv.emailNormalized,
          passwordHash,
          // Possession of the emailed token proves control of the mailbox.
          emailVerifiedAt: now,
          status: "ACTIVE",
        })
        .$returningId();
      newUserId = created.id;

      await tx.insert(userRoles).values({
        userId: newUserId,
        roleId: inv.roleId,
        grantedBy: inv.invitedBy,
      });
      await tx
        .update(invitations)
        .set({ acceptedUserId: newUserId })
        .where(eq(invitations.id, inv.id));

      await writeAudit(tx as unknown as Database, {
        actorId: newUserId,
        actorType: "ADMIN",
        actorRole: invitation.roleCode,
        actorEmail: inv.email,
        action: AUDIT_ACTIONS.invitationsAccept,
        resourceType: "invitation",
        resourceId: inv.id,
        result: "SUCCESS",
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        metadata: { invitationId: inv.id, userId: newUserId, role: invitation.roleCode },
      });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isDuplicateEntryError(err)) {
      throw AppError.conflict(
        "An account with this email address already exists.",
      );
    }
    throw err;
  }

  return {
    userId: newUserId,
    email: inv.email,
    role: invitation.roleCode,
    nextStep: "LOGIN",
  };
}
