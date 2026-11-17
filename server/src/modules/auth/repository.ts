/**
 * Auth repository — every query for the auth module lives here, always
 * parameterised through Drizzle (no string-built SQL), with ownership and
 * status conditions inside the queries themselves.
 *
 * Tables: users, user_roles/roles, email_verification_codes,
 * password_reset_tokens, mfa_credentials (DATABASE_DESIGN.md §4–§6).
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import {
  emailVerificationCodes,
  mfaCredentials,
  passwordResetTokens,
  roles,
  userRoles,
  users,
} from "../../database/schema/index.js";

/** Database handle or an open transaction — both expose the same query API. */
export type DbLike = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type UserRow = typeof users.$inferSelect;

export async function findUserByEmailNormalized(
  db: DbLike,
  emailNormalized: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  return rows[0];
}

export async function findUserById(
  db: DbLike,
  userId: number,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0];
}

export async function createUser(
  db: DbLike,
  values: {
    fullName: string;
    email: string;
    emailNormalized: string;
    phone: string | null;
    passwordHash: string;
  },
): Promise<number> {
  const [inserted] = await db
    .insert(users)
    .values({ ...values, status: "PENDING_VERIFICATION" })
    .$returningId();
  return inserted.id;
}

/** Re-registration of a still-unverified account refreshes its credentials. */
export async function updateUnverifiedUserCredentials(
  db: DbLike,
  userId: number,
  values: { fullName: string; phone: string | null; passwordHash: string },
): Promise<void> {
  await db
    .update(users)
    .set(values)
    .where(
      and(eq(users.id, userId), eq(users.status, "PENDING_VERIFICATION")),
    );
}

export async function assignRoleByCode(
  db: DbLike,
  userId: number,
  roleCode: string,
): Promise<void> {
  const roleRows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, roleCode))
    .limit(1);
  const role = roleRows[0];
  if (!role) {
    // Roles are seeded reference data (Phase 2 seed). Missing seed data is
    // a deployment error, never a client error.
    throw new Error(`Role ${roleCode} is not seeded`);
  }
  await db
    .insert(userRoles)
    .values({ userId, roleId: role.id })
    .onDuplicateKeyUpdate({ set: { userId } });
}

export async function getUserRoleCodes(
  db: DbLike,
  userId: number,
): Promise<string[]> {
  const rows = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows.map((row) => row.code);
}

/** True when the user has a confirmed (active) MFA credential. */
export async function hasActiveMfa(
  db: DbLike,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: mfaCredentials.id })
    .from(mfaCredentials)
    .where(
      and(
        eq(mfaCredentials.userId, userId),
        eq(mfaCredentials.type, "TOTP"),
        // confirmed_at NULL = enrolment started but never confirmed.
        isNotNull(mfaCredentials.confirmedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/* ------------------------- verification codes ------------------------- */

export type VerificationCodeRow = typeof emailVerificationCodes.$inferSelect;

export async function invalidateUnconsumedCodes(
  db: DbLike,
  userId: number,
  now: Date,
): Promise<void> {
  await db
    .update(emailVerificationCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(emailVerificationCodes.userId, userId),
        isNull(emailVerificationCodes.consumedAt),
      ),
    );
}

export async function insertVerificationCode(
  db: DbLike,
  values: {
    userId: number;
    codeHmac: string;
    maxAttempts: number;
    expiresAt: Date;
  },
): Promise<void> {
  await db.insert(emailVerificationCodes).values(values);
}

/** Latest code row for the user (consumed or not) — drives the cooldown. */
export async function findLatestCode(
  db: DbLike,
  userId: number,
): Promise<VerificationCodeRow | undefined> {
  const rows = await db
    .select()
    .from(emailVerificationCodes)
    .where(eq(emailVerificationCodes.userId, userId))
    .orderBy(desc(emailVerificationCodes.id))
    .limit(1);
  return rows[0];
}

/** Latest unconsumed code, locked for the verify transaction. */
export async function findLatestUnconsumedCodeForUpdate(
  db: DbLike,
  userId: number,
): Promise<VerificationCodeRow | undefined> {
  const rows = await db
    .select()
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.userId, userId),
        isNull(emailVerificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(emailVerificationCodes.id))
    .limit(1)
    .for("update");
  return rows[0];
}

export async function incrementCodeAttempts(
  db: DbLike,
  codeId: number,
): Promise<void> {
  await db
    .update(emailVerificationCodes)
    .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
    .where(eq(emailVerificationCodes.id, codeId));
}

export async function consumeCode(
  db: DbLike,
  codeId: number,
  now: Date,
): Promise<boolean> {
  const [result] = await db
    .update(emailVerificationCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(emailVerificationCodes.id, codeId),
        isNull(emailVerificationCodes.consumedAt),
      ),
    );
  return result.affectedRows === 1;
}

export async function markUserVerified(
  db: DbLike,
  userId: number,
  now: Date,
): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: now, status: "ACTIVE" })
    .where(
      and(eq(users.id, userId), eq(users.status, "PENDING_VERIFICATION")),
    );
}

export async function touchLastLogin(
  db: DbLike,
  userId: number,
  now: Date,
): Promise<void> {
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
}

/* -------------------------- password resets --------------------------- */

export async function invalidateUserResetTokens(
  db: DbLike,
  userId: number,
  now: Date,
): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.consumedAt),
      ),
    );
}

export async function insertResetToken(
  db: DbLike,
  values: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
    requestIp: string | null;
  },
): Promise<void> {
  await db.insert(passwordResetTokens).values(values);
}

export async function findResetTokenByHash(
  db: DbLike,
  tokenHash: string,
): Promise<typeof passwordResetTokens.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

/** Atomic single-use consume: only succeeds for a live, unconsumed token. */
export async function consumeResetToken(
  db: DbLike,
  tokenId: number,
  now: Date,
): Promise<boolean> {
  const [result] = await db
    .update(passwordResetTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(passwordResetTokens.id, tokenId),
        isNull(passwordResetTokens.consumedAt),
      ),
    );
  return result.affectedRows === 1;
}

export async function setUserPasswordHash(
  db: DbLike,
  userId: number,
  passwordHash: string,
): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}
