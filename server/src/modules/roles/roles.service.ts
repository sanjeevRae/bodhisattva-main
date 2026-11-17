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
 *  - A privilege change revokes the target's sessions (revoke reason
 *    ROLE_CHANGE) and bumps their session_version (amendment A9).
 *  - Every assignment is audited with from/to roles.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { isRole, type Role } from "@bodhisattva/shared/permissions";
import { and, count, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
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
        permissions: byRole.get(role.id) ?? [],
      },
    ];
  });
}

async function countActiveSuperAdmins(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      and(eq(rolesTable.code, "SUPER_ADMIN"), eq(users.status, "ACTIVE")),
    );
  return row?.value ?? 0;
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
