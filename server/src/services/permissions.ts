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
  PERMISSIONS,
  type Permission,
  type Role,
} from "@bodhisattva/shared/permissions";
import { createHash } from "node:crypto";
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
 *
 * SUPER_ADMIN holds the FULL catalogue by construction (PERMISSIONS.md
 * §2/§5) — enforced HERE, at resolution time, not only by seed rows.
 * The seed grants SUPER_ADMIN every permission that exists when it
 * runs, but a permission introduced later by a migration reaches
 * existing databases only through that migration's own grants; when
 * 0018/0020 granted their new permissions to ADMIN alone,
 * Super Admins on previously-seeded databases silently lost access
 * to those features (owner report, 2026-11-20: newer admin screens
 * visible to Admin, not to Super Admin). Resolving the full catalogue for
 * SUPER_ADMIN makes the documented model true on every database,
 * whatever its seed/migration history. No endpoint can edit a role's
 * permission set, so nothing can legitimately trim this.
 */
export async function getEffectivePermissions(
  db: Database,
  userId: number,
): Promise<Set<Permission>> {
  const rolesHeld = await getUserRoles(db, userId);
  if (rolesHeld.includes("SUPER_ADMIN")) {
    return new Set(PERMISSIONS);
  }
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

/* ------------------------------------------------------------------ */
/* Boot-time catalogue parity check                                    */
/* ------------------------------------------------------------------ */

/**
 * The two directions in which the compiled catalogue and the
 * database `permissions` table can disagree. Both are startup
 * errors: a permission the code knows but the DB lacks means the
 * database was never migrated/seeded for it; a permission the DB
 * has but the compiled catalogue lacks means the running build is
 * stale (its isPermission() filter would silently DROP that grant
 * from every user's effective set — the 2026-11-20 incident, where
 * a stale shared/dist hid policy.manage from Admin and Super Admin
 * alike while the roles list looked almost right).
 */
export interface PermissionCatalogueDiff {
  /** In the compiled catalogue, absent from the database. */
  missingFromDb: string[];
  /** In the database, absent from the compiled catalogue. */
  missingFromCompiled: string[];
}

export function diffPermissionCatalogue(
  compiled: Iterable<string>,
  dbCodes: Iterable<string>,
): PermissionCatalogueDiff {
  const compiledSet = new Set(compiled);
  const dbSet = new Set(dbCodes);
  return {
    missingFromDb: [...compiledSet].filter((c) => !dbSet.has(c)).sort(),
    missingFromCompiled: [...dbSet].filter((c) => !compiledSet.has(c)).sort(),
  };
}

/** Short stable fingerprint of the compiled catalogue, for boot logs. */
export function permissionCatalogueHash(): string {
  return createHash("sha256")
    .update([...PERMISSIONS].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}

/**
 * Startup guard (server.ts, before listen): the compiled permission
 * catalogue must EXACTLY equal the database `permissions` table.
 * Throws — failing the boot, closed — on any difference or if the
 * table cannot be read. Reviewed 2026-11-20 (ChatGPT + Gemini):
 * a catalogue mismatch must never let the server start and silently
 * authorize against an incomplete set.
 */
export async function assertPermissionCatalogueMatchesDb(
  db: Database,
): Promise<{ count: number; hash: string }> {
  const rows = await db
    .select({ code: permissionsTable.code })
    .from(permissionsTable);
  const diff = diffPermissionCatalogue(
    PERMISSIONS,
    rows.map((r) => r.code),
  );
  if (diff.missingFromDb.length > 0 || diff.missingFromCompiled.length > 0) {
    const lines = [
      "Permission catalogue mismatch — the server will not start.",
      "The permissions compiled into this server do not match the permissions table in the database.",
    ];
    if (diff.missingFromCompiled.length > 0) {
      lines.push(
        `  In the database but NOT in the compiled catalogue: ${diff.missingFromCompiled.join(", ")}`,
        "  The running build is stale. Rebuild the shared package: from the project root, `npm --prefix shared run build` (starting the server with `npm run dev` does this automatically).",
      );
    }
    if (diff.missingFromDb.length > 0) {
      lines.push(
        `  In the compiled catalogue but NOT in the database: ${diff.missingFromDb.join(", ")}`,
        "  The database is behind the code. Run `npm run db:migrate` in the server folder (and `npm run db:seed` on a fresh database).",
      );
    }
    throw new Error(lines.join("\n"));
  }
  return { count: PERMISSIONS.length, hash: permissionCatalogueHash() };
}
