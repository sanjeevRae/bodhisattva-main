/**
 * Effective-permission resolution (PERMISSIONS.md §1, §9; ARCHITECTURE.md §7).
 *
 * Permissions are resolved FRESH from the database on every call —
 * user_roles → role_permissions → permissions. There is deliberately no
 * cross-request cache: Passenger runs multiple worker processes, so an
 * in-process cache would serve stale grants after a role change (Phase 0
 * review amendment A6). Callers that need the set more than once per
 * request memoise it on the request object instead (see
 * middleware/authorization.ts).
 *
 * Role model (PERMISSIONS.md §2, §5): a user holds at most one
 * administrative role (SUPER_ADMIN | ADMIN | STORE_ADMIN) plus CUSTOMER;
 * when several roles are present their permissions union, and the highest
 * administrative role wins for privilege comparisons (invitation grants,
 * role assignment caps).
 */
import {
  isPermission,
  type Permission,
  type Role,
} from "@bodhisattva/shared/permissions";
import { eq } from "drizzle-orm";
import type { Database } from "../database/client.js";
import {
  permissions as permissionsTable,
  rolePermissions,
  roles as rolesTable,
  userRoles,
} from "../database/schema/index.js";

/** Privilege ranking for cap comparisons; higher wins. */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  STORE_ADMIN: 2,
  CUSTOMER: 1,
};

export const ADMIN_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "STORE_ADMIN",
];

export function isAdminRole(role: Role): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/** Highest-privilege role from a list, or null when the list is empty. */
export function getHighestRole(roleList: readonly Role[]): Role | null {
  let best: Role | null = null;
  for (const role of roleList) {
    if (best === null || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

/** All role codes currently assigned to the user (fresh DB read). */
export async function getUserRoles(
  db: Database,
  userId: number,
): Promise<Role[]> {
  const rows = await db
    .select({ code: rolesTable.code })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(eq(userRoles.userId, userId));
  const out: Role[] = [];
  for (const row of rows) {
    if (
      row.code === "SUPER_ADMIN" ||
      row.code === "ADMIN" ||
      row.code === "STORE_ADMIN" ||
      row.code === "CUSTOMER"
    ) {
      out.push(row.code);
    }
  }
  return out;
}

/**
 * The user's effective permission set: the union of every permission
 * granted to every role they hold, restricted to the shared catalogue.
 */
export async function getEffectivePermissions(
  db: Database,
  userId: number,
): Promise<Set<Permission>> {
  const rows = await db
    .select({ code: permissionsTable.code })
    .from(userRoles)
    .innerJoin(
      rolePermissions,
      eq(userRoles.roleId, rolePermissions.roleId),
    )
    .innerJoin(
      permissionsTable,
      eq(rolePermissions.permissionId, permissionsTable.id),
    )
    .where(eq(userRoles.userId, userId));
  const out = new Set<Permission>();
  for (const row of rows) {
    if (isPermission(row.code)) out.add(row.code);
  }
  return out;
}

/** Roles + effective permissions + highest role, resolved in two reads. */
export interface SessionAuthContext {
  userId: number;
  roles: Role[];
  highestRole: Role | null;
  permissions: Set<Permission>;
}

export async function resolveSessionAuthContext(
  db: Database,
  userId: number,
): Promise<SessionAuthContext> {
  const [roles, permissions] = await Promise.all([
    getUserRoles(db, userId),
    getEffectivePermissions(db, userId),
  ]);
  return {
    userId,
    roles,
    highestRole: getHighestRole(roles),
    permissions,
  };
}
