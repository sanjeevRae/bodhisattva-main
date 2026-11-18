/**
 * Super Admin cap (owner decision 2026-11-18 — see config/limits.ts).
 *
 * Shared counting + error helpers so every Super Admin creation path
 * (bootstrap CLI, role assignment, invitation create/accept) enforces
 * the same MAX_SUPER_ADMINS ceiling with the same semantics:
 *  - "Active" Super Admins are users with status ACTIVE holding the
 *    SUPER_ADMIN role.
 *  - "Pending" Super Admin invitations are unaccepted, unrevoked and
 *    unexpired invitations for the SUPER_ADMIN role; they reserve a
 *    slot so outstanding invitations can never oversubscribe the cap.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { MAX_SUPER_ADMINS } from "../../config/limits.js";
import type { Database } from "../../database/client.js";
import {
  invitations,
  roles as rolesTable,
  userRoles,
  users,
} from "../../database/schema/index.js";

/** Users with status ACTIVE currently holding the SUPER_ADMIN role. */
export async function countActiveSuperAdmins(db: Database): Promise<number> {
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

/** Live (unaccepted, unrevoked, unexpired) SUPER_ADMIN invitations. */
export async function countPendingSuperAdminInvitations(
  db: Database,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(invitations)
    .innerJoin(rolesTable, eq(invitations.roleId, rolesTable.id))
    .where(
      and(
        eq(rolesTable.code, "SUPER_ADMIN"),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  return row?.value ?? 0;
}

/** The one cap error every creation path throws (409 CONFLICT). */
export function superAdminLimitError(): AppError {
  return AppError.conflict(
    `The platform allows at most ${MAX_SUPER_ADMINS} Super Admin accounts.`,
  );
}
