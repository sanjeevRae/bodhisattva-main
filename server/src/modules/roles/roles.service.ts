/**
 * Roles service (PERMISSIONS.md §5–§8, PHASE0_REVIEW.md amendment A6).
 *
 * Role assignment rules:
 *  - The actor needs `roles.manage` (route gate) AND cannot grant a role
 *    above their own highest role.
 *  - A user holds at most one administrative role (plus CUSTOMER);
 *    assigning replaces the administrative role and leaves the CUSTOMER
 *    membership alone, except assigning CUSTOMER, which clears all
 *    administrative roles.
 *  - The LAST active SUPER_ADMIN can never be demoted (lockout guard).
 *  - At most MAX_SUPER_ADMINS active SUPER_ADMINs may exist (owner
 *    decision 2026-11-18, config/limits.ts): promotions beyond the cap
 *    are refused inside the assignment transaction.
 *  - A privilege change revokes the target's sessions (revoke reason
 *    ROLE_CHANGE) and bumps their session_version (amendment A9).
 *  - Every assignment is audited with from/to roles.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { isRole, PERMISSIONS, type Role } from "@bodhisattva/shared/permissions";
import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";
import type { AppConfig } from "../../config/env.js";
import { MAX_SUPER_ADMINS } from "../../config/limits.js";
import type { Database } from "../../database/client.js";
import {
  carts,
  customerAddresses,
  emailVerificationCodes,
  invitations,
  mfaCredentials,
  mfaRecoveryCodes,
  passwordResetTokens,
  permissions as permissionsTable,
  rolePermissions,
  roles as rolesTable,
  userRoles,
  users,
} from "../../database/schema/index.js";
import type { AuthContext } from "../../middleware/authorization.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import {
  ROLE_RANK,
  getHighestRole,
  getUserRoles,
  isAdminRole,
} from "../../services/permissions.js";
import { createSessionService } from "../../services/session.js";
import {
  countActiveSuperAdmins,
  superAdminLimitError,
} from "./super-admin-cap.js";

export interface RolesDeps {
  db: Database;
  config: AppConfig;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RoleView {
  code: Role;
  name: string;
  description: string | null;
  permissions: string[];
}

export async function listRoles(db: Database): Promise<RoleView[]> {
  const roleRows = await db
    .select()
    .from(rolesTable)
    .orderBy(rolesTable.id);
  const grants = await db
    .select({
      roleId: rolePermissions.roleId,
      code: permissionsTable.code,
    })
    .from(rolePermissions)
    .innerJoin(
      permissionsTable,
      eq(rolePermissions.permissionId, permissionsTable.id),
    )
    .orderBy(permissionsTable.code);

  const byRole = new Map<number, string[]>();
  for (const grant of grants) {
    const list = byRole.get(grant.roleId) ?? [];
    list.push(grant.code);
    byRole.set(grant.roleId, list);
  }
  return roleRows.flatMap((role) => {
    if (!isRole(role.code)) return [];
    return [
      {
        code: role.code,
        name: role.name,
        description: role.description,
        // SUPER_ADMIN holds the full catalogue by construction
        // (PERMISSIONS.md §2/§5) — present it that way regardless of
        // the grant rows, exactly as getEffectivePermissions
        // resolves it. The admin SPA builds its sidebar from this
        // list; row-only data hid newer features (policies,
        // store settings) from Super Admins on databases seeded
        // before those permissions existed (owner report,
        // 2026-11-20).
        permissions:
          role.code === "SUPER_ADMIN"
            ? [...PERMISSIONS].sort()
            : (byRole.get(role.id) ?? []),
      },
    ];
  });
}

/** One row of the admin users list (Phase 4 delta — the admin SPA's Users
 * screen needs a directory; only non-sensitive fields are exposed). */
export interface UserListItem {
  id: number;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  lastLoginAt: Date | null;
}

/**
 * Paginated user directory for the admin UI. Soft-deleted users are
 * excluded; roles are resolved with one join query for the whole page
 * (same pattern as listRoles' grants query).
 */
export async function listUsers(
  db: Database,
  pagination: { page: number; pageSize: number },
): Promise<{ items: UserListItem[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.pageSize;
  const [countRow] = await db
    .select({ value: count() })
    .from(users)
    .where(isNull(users.deletedAt));
  const total = countRow?.value ?? 0;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(asc(users.id))
    .limit(pagination.pageSize)
    .offset(offset);

  const rolesByUser = new Map<number, string[]>();
  if (rows.length > 0) {
    const grants = await db
      .select({ userId: userRoles.userId, code: rolesTable.code })
      .from(userRoles)
      .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
      .where(
        inArray(
          userRoles.userId,
          rows.map((row) => row.id),
        ),
      );
    for (const grant of grants) {
      const list = rolesByUser.get(grant.userId) ?? [];
      list.push(grant.code);
      rolesByUser.set(grant.userId, list);
    }
  }

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.fullName,
      status: row.status,
      roles: rolesByUser.get(row.id) ?? [],
      lastLoginAt: row.lastLoginAt,
    })),
  };
}

export interface AssignRoleResult {
  userId: number;
  role: Role;
  changed: boolean;
}

export async function assignRole(
  deps: RolesDeps,
  actor: AuthContext,
  targetUserId: number,
  role: Role,
  meta: RequestMeta,
): Promise<AssignRoleResult> {
  const { db } = deps;

  const [target] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw AppError.notFound("User not found.");

  // Privilege cap: cannot grant above the actor's own highest role.
  const actorHighest = getHighestRole(await getUserRoles(db, actor.userId));
  if (!actorHighest || ROLE_RANK[actorHighest] < ROLE_RANK[role]) {
    throw AppError.forbidden("You cannot grant a role above your own.");
  }

  const targetRoles = await getUserRoles(db, targetUserId);
  const currentAdmin =
    targetRoles
      .filter((r) => isAdminRole(r))
      .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null;
  const newAdmin: Role | null = role === "CUSTOMER" ? null : role;

  // Last-active-Super-Admin protection (A6): demoting the only active
  // SUPER_ADMIN would lock the platform out of its own administration.
  if (currentAdmin === "SUPER_ADMIN" && newAdmin !== "SUPER_ADMIN") {
    if ((await countActiveSuperAdmins(db)) <= 1 && target.status === "ACTIVE") {
      throw AppError.conflict(
        "This user is the last active Super Admin and cannot be demoted. Promote another Super Admin first.",
      );
    }
  }

  if (currentAdmin === newAdmin) {
    return { userId: targetUserId, role, changed: false };
  }

  // An administrative role on a non-active account is a role the user
  // can never exercise (login refuses non-ACTIVE accounts) — refuse it
  // loudly instead of persisting a silent no-op promotion. Clearing to
  // CUSTOMER stays allowed for any status.
  if (newAdmin !== null && target.status !== "ACTIVE") {
    throw AppError.conflict(
      "This account is not active, so it cannot hold an administrative role. Reactivate the account first.",
    );
  }

  const roleRows = await db
    .select({ id: rolesTable.id, code: rolesTable.code })
    .from(rolesTable);
  const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));
  const adminRoleIds = roleRows
    .filter((r) => r.code !== "CUSTOMER")
    .map((r) => r.id);
  const customerRoleId = roleIdByCode.get("CUSTOMER");

  await db.transaction(async (tx) => {
    // Last-active-Super-Admin invariant, enforced INSIDE the transaction
    // (Phase 2 review fix): the pre-check above is only a fast path — two
    // concurrent demotions could both pass it. Locking every SUPER_ADMIN
    // assignment row serializes demotions, and the locking count below
    // then reads the latest committed state.
    if (currentAdmin === "SUPER_ADMIN" && newAdmin !== "SUPER_ADMIN") {
      const superAdminRoleId = roleIdByCode.get("SUPER_ADMIN");
      if (superAdminRoleId) {
        await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, superAdminRoleId))
          .for("update");
        const [saRow] = await tx
          .select({ value: count() })
          .from(userRoles)
          .innerJoin(users, eq(userRoles.userId, users.id))
          .where(
            and(
              eq(userRoles.roleId, superAdminRoleId),
              eq(users.status, "ACTIVE"),
            ),
          );
        if ((saRow?.value ?? 0) <= 1 && target.status === "ACTIVE") {
          throw AppError.conflict(
            "This user is the last active Super Admin and cannot be demoted. Promote another Super Admin first.",
          );
        }
      }
    }

    // Super Admin cap (owner decision 2026-11-18, config/limits.ts):
    // a promotion TO SUPER_ADMIN is refused once MAX_SUPER_ADMINS active
    // Super Admins exist. Enforced inside the transaction with the same
    // locking pattern as the demotion guard — locking every SUPER_ADMIN
    // assignment row serializes promotions against each other and
    // against demotions, and the count then reads the latest committed
    // state.
    if (currentAdmin !== "SUPER_ADMIN" && newAdmin === "SUPER_ADMIN") {
      const superAdminRoleId = roleIdByCode.get("SUPER_ADMIN");
      if (superAdminRoleId) {
        await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, superAdminRoleId))
          .for("update");
        const activeSuperAdmins = await countActiveSuperAdmins(
          tx as unknown as Database,
        );
        if (activeSuperAdmins >= MAX_SUPER_ADMINS) {
          throw superAdminLimitError();
        }
      }
    }

    // Replace the administrative role; CUSTOMER membership is untouched
    // unless the assignment IS customer-only.
    await tx
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          inArray(userRoles.roleId, adminRoleIds),
        ),
      );
    if (newAdmin) {
      const roleId = roleIdByCode.get(newAdmin);
      if (!roleId) {
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "Roles are not initialised. Run the database seed first.",
        );
      }
      await tx.insert(userRoles).values({
        userId: targetUserId,
        roleId,
        grantedBy: actor.userId,
      });
    } else if (customerRoleId && !targetRoles.includes("CUSTOMER")) {
      await tx.insert(userRoles).values({
        userId: targetUserId,
        roleId: customerRoleId,
        grantedBy: actor.userId,
      });
    }
  });

  // Privilege change ⇒ the target's existing sessions must not survive it.
  // revokeAllSessions also bumps the user's session_version (amendment A9)
  // in the same transaction as the revocations.
  await createSessionService(deps).revokeAllSessions(
    targetUserId,
    "ROLE_CHANGE",
  );

  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorRole: actorHighest,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.rolesAssign,
    resourceType: "user",
    resourceId: targetUserId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: {
      userId: targetUserId,
      targetEmail: target.email,
      fromRole: currentAdmin,
      toRole: newAdmin,
    },
  });

  return { userId: targetUserId, role, changed: true };
}

export interface DeleteUserResult {
  userId: number;
}

/**
 * Delete a user account (owner request 2026-11-26; plan reviewed by
 * ChatGPT Thinking 8.2/10 and Gemini 8.5/10 — proceed with changes).
 *
 * A hard DELETE is impossible by design: sessions, MFA material,
 * invitations, audit rows, CMS authorship and orders all reference
 * users.id with ON DELETE RESTRICT, and order/invoice history must
 * survive for the financial record. Deletion is therefore a
 * tombstone + pseudonymization, in one transaction:
 *  - the row is marked deleted_at (the authoritative marker — login
 *    and session validation already refuse deleted accounts) and set
 *    DEACTIVATED;
 *  - identity is pseudonymized: email + normalized email rewritten to
 *    deleted-<id>@deleted.invalid (freeing the address for a future
 *    account), display name replaced, phone/password/verification
 *    stamps cleared;
 *  - every live access mechanism is removed: role rows, MFA
 *    credentials + recovery codes, email verification codes, password
 *    reset tokens, the user's cart (items cascade) and saved
 *    addresses, and pending invitations issued by or addressed to
 *    the user (revoked, history preserved);
 *  - sessions are revoked afterwards (ADMIN_ACTION), which also bumps
 *    session_version.
 * Orders keep their own immutable delivery snapshots, so fulfilment
 * never depends on the deleted profile.
 *
 * Guards: the actor cannot delete themself; an actor cannot delete an
 * account whose highest administrative role outranks their own (the
 * same privilege cap as role assignment); the last active
 * SUPER_ADMIN cannot be deleted — enforced inside the transaction
 * under the same FOR UPDATE lock on Super Admin assignment rows that
 * serializes promotions and demotions.
 *
 * The audit row stores the target id, the actor, and the account's
 * prior roles and status — deliberately NOT the email address, and
 * not a hash of it either: an unsalted hash of a low-entropy address
 * is reversible by guessing, and deletion is the one action whose
 * purpose is erasure (post-implementation review, ChatGPT 9.0/10).
 */
export async function deleteUser(
  deps: RolesDeps,
  actor: AuthContext,
  targetUserId: number,
  meta: RequestMeta,
): Promise<DeleteUserResult> {
  const { db } = deps;

  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      emailNormalized: users.emailNormalized,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target || target.deletedAt) throw AppError.notFound("User not found.");

  if (target.id === actor.userId) {
    throw AppError.conflict("You cannot delete your own account.");
  }

  const targetRoles = await getUserRoles(db, targetUserId);
  const targetAdmin =
    targetRoles
      .filter((r) => isAdminRole(r))
      .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null;

  // Privilege cap (mirrors assignRole): nobody deletes an account that
  // outranks them.
  const actorHighest = getHighestRole(await getUserRoles(db, actor.userId));
  if (
    targetAdmin &&
    (!actorHighest || ROLE_RANK[actorHighest] < ROLE_RANK[targetAdmin])
  ) {
    throw AppError.forbidden(
      "You cannot delete an account with a higher role than your own.",
    );
  }

  const tombstoneEmail = `deleted-${target.id}@deleted.invalid`;
  const now = new Date();

  await db.transaction(async (tx) => {
    // Last-active-Super-Admin invariant under the shared lock: lock
    // every SUPER_ADMIN assignment row so a concurrent promotion,
    // demotion or deletion cannot interleave with the count below.
    if (targetAdmin === "SUPER_ADMIN" && target.status === "ACTIVE") {
      const [saRole] = await tx
        .select({ id: rolesTable.id })
        .from(rolesTable)
        .where(eq(rolesTable.code, "SUPER_ADMIN"))
        .limit(1);
      if (saRole) {
        await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, saRole.id))
          .for("update");
        const activeSuperAdmins = await countActiveSuperAdmins(
          tx as unknown as Database,
        );
        if (activeSuperAdmins <= 1) {
          throw AppError.conflict(
            "This user is the last active Super Admin and cannot be deleted. Promote another Super Admin first.",
          );
        }
      }
    }

    await tx
      .update(users)
      .set({
        deletedAt: now,
        status: "DEACTIVATED",
        email: tombstoneEmail,
        emailNormalized: tombstoneEmail,
        fullName: "Deleted user",
        phone: null,
        passwordHash: null,
        emailVerifiedAt: null,
      })
      .where(eq(users.id, target.id));

    await tx.delete(userRoles).where(eq(userRoles.userId, target.id));
    await tx
      .delete(mfaCredentials)
      .where(eq(mfaCredentials.userId, target.id));
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, target.id));
    await tx
      .delete(emailVerificationCodes)
      .where(eq(emailVerificationCodes.userId, target.id));
    await tx
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, target.id));

    // Pending invitations in either direction die with the account;
    // accepted/revoked history rows are preserved.
    await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          or(
            eq(invitations.invitedBy, target.id),
            eq(invitations.emailNormalized, target.emailNormalized),
          ),
        ),
      );

    // Cart items cascade with the cart; saved addresses are the user's
    // own personal data and go with the account. Orders are untouched:
    // they carry immutable delivery snapshots from checkout.
    await tx.delete(carts).where(eq(carts.userId, target.id));
    await tx
      .delete(customerAddresses)
      .where(eq(customerAddresses.userId, target.id));
  });

  await createSessionService(deps).revokeAllSessions(
    targetUserId,
    "ADMIN_ACTION",
  );

  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorRole: actorHighest,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.usersDelete,
    resourceType: "user",
    resourceId: targetUserId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: {
      userId: targetUserId,
      roles: targetRoles,
      status: target.status,
    },
  });

  return { userId: targetUserId };
}
