/**
 * MFA service (DATABASE_DESIGN.md §6.2–§6.3, PERMISSIONS.md §7,
 * PHASE0_REVIEW.md amendment A3).
 *
 * Enrolment state lives in `mfa_credentials.confirmed_at`: NULL = enrolment
 * pending, set = active. Replay protection: a TOTP time-step may be
 * consumed exactly once — verification computes the matched step, then a
 * single conditional UPDATE (`last_used_counter < step`) claims it; zero
 * affected rows means the code was already used (replay) and is rejected.
 *
 * Completing enrolment, TOTP verification or recovery-code use rotates the
 * session to auth_level "full" and stamps the step-up time (rotation on MFA
 * completion — ARCHITECTURE.md §7). Recovery codes are Argon2id-hashed
 * (amendment A3), shown once at enrolment, and each is consumed atomically;
 * a successful recovery is audited and flagged for admin review.
 *
 * Admin reset (Super Admin, `users.manage` + step-up) deletes the target's
 * credential and recovery codes, revokes all their sessions and bumps
 * their session_version (amendment A9) — the target must re-enrol.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Response } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  mfaCredentials,
  mfaRecoveryCodes,
  users,
} from "../../database/schema/index.js";
import type { AuthContext } from "../../middleware/authorization.js";
import { createRateLimiter } from "../../security/rate-limit.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { getUserRoles, isAdminRole, getHighestRole } from "../../services/permissions.js";
import {
  createSessionService,
  setSessionCookie,
} from "../../services/session.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import {
  buildOtpAuthUrl,
  decodeTotpKey,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  matchTotpStep,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "./totp.js";

export interface MfaDeps {
  db: Database;
  config: AppConfig;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** What a route hands the service so it can rotate the caller's session. */
export interface SessionRotation {
  /** The caller's current raw session token (from the session cookie). */
  rawToken: string;
  res: Response;
}

/**
 * Rotate the caller's session to auth_level "full" after an MFA success
 * and set the fresh cookie. The session service stamps step_up_at itself
 * when a session is raised to "full" (fresh MFA = fresh step-up).
 */
async function rotateToFull(
  deps: MfaDeps,
  auth: AuthContext,
  session: SessionRotation,
  meta: RequestMeta,
): Promise<void> {
  const sessions = createSessionService(deps);
  const created = await sessions.rotateSession(session.rawToken, "full", {
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    isAdmin: auth.isAdmin,
  });
  setSessionCookie(session.res, deps.config, created.rawToken, created.expiresAt);
}

type MfaCredentialRow = typeof mfaCredentials.$inferSelect;

function affectedRows(result: unknown): number {
  const header = (result as [{ affectedRows?: unknown }] | null)?.[0];
  return typeof header?.affectedRows === "number" ? header.affectedRows : 0;
}

async function loadCredential(
  db: Database,
  userId: number,
): Promise<MfaCredentialRow | undefined> {
  const [row] = await db
    .select()
    .from(mfaCredentials)
    .where(
      and(eq(mfaCredentials.userId, userId), eq(mfaCredentials.type, "TOTP")),
    )
    .limit(1);
  return row;
}

function invalidCodeError(): AppError {
  return AppError.unauthenticated("Invalid verification code.");
}

export interface EnrolResult {
  /** Shown once, for QR/manual entry; never returned again by any endpoint. */
  secret: string;
  otpauthUrl: string;
}

export async function enrolMfa(
  deps: MfaDeps,
  auth: AuthContext,
  meta: RequestMeta,
): Promise<EnrolResult> {
  const { db, config } = deps;
  const userId = auth.userId;

  const roles = await getUserRoles(db, userId);
  const highest = getHighestRole(roles);
  if (!highest || !isAdminRole(highest)) {
    throw AppError.forbidden(
      "Two-factor authentication enrolment is for administrator accounts.",
    );
  }

  const existing = await loadCredential(db, userId);
  if (existing?.confirmedAt) {
    throw AppError.conflict(
      "Two-factor authentication is already enabled for this account.",
    );
  }

  const secret = generateTotpSecret();
  const key = decodeTotpKey(config.secrets.totpEncryptionKey);
  const secretEncrypted = encryptTotpSecret(secret, key);

  if (existing) {
    // Re-enrolment before confirmation replaces the pending secret.
    await db
      .update(mfaCredentials)
      .set({
        secretEncrypted,
        confirmedAt: null,
        lastUsedAt: null,
        lastUsedCounter: null,
      })
      .where(eq(mfaCredentials.id, existing.id));
  } else {
    await db.insert(mfaCredentials).values({
      userId,
      type: "TOTP",
      secretEncrypted,
    });
  }

  await writeAudit(db, {
    actorId: userId,
    actorType: "ADMIN",
    actorRole: highest,
    actorEmail: auth.email,
    action: AUDIT_ACTIONS.mfaEnrol,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { secret, otpauthUrl: buildOtpAuthUrl(auth.email, secret) };
}

export interface ConfirmResult {
  /** Shown exactly once — the client must tell the user to store them. */
  recoveryCodes: string[];
}

export async function confirmMfa(
  deps: MfaDeps,
  auth: AuthContext,
  code: string,
  session: SessionRotation,
  meta: RequestMeta,
): Promise<ConfirmResult> {
  const { db, config } = deps;
  const userId = auth.userId;

  const credential = await loadCredential(db, userId);
  if (!credential) {
    throw AppError.validation(
      [{ field: "code", issue: "No MFA enrolment is in progress for this account." }],
    );
  }
  if (credential.confirmedAt) {
    throw AppError.conflict(
      "Two-factor authentication is already enabled for this account.",
    );
  }

  const key = decodeTotpKey(config.secrets.totpEncryptionKey);
  const secret = decryptTotpSecret(credential.secretEncrypted, key);
  const step = matchTotpStep(secret, code);
  if (step === null) {
    await writeAudit(db, {
      actorId: userId,
      actorType: "ADMIN",
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.mfaConfirm,
      resourceType: "user",
      resourceId: userId,
      result: "FAILURE",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
    throw invalidCodeError();
  }

  const now = new Date();
  const claimed = await db
    .update(mfaCredentials)
    .set({ confirmedAt: now, lastUsedAt: now, lastUsedCounter: step })
    .where(
      and(eq(mfaCredentials.id, credential.id), isNull(mfaCredentials.confirmedAt)),
    );
  if (affectedRows(claimed) !== 1) {
    throw AppError.conflict(
      "Two-factor authentication is already enabled for this account.",
    );
  }

  // Recovery codes: regeneration deletes all previous rows (§6.3). Hashes
  // are computed before the transaction so Argon2id work never holds it open.
  const displayCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const codeHashes: string[] = [];
  for (const display of displayCodes) {
    codeHashes.push(await hashPassword(normalizeRecoveryCode(display)));
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, userId));
    for (const codeHash of codeHashes) {
      await tx.insert(mfaRecoveryCodes).values({ userId, codeHash });
    }
  });

  await rotateToFull(deps, auth, session, meta);

  await writeAudit(db, {
    actorId: userId,
    actorType: "ADMIN",
    actorEmail: auth.email,
    action: AUDIT_ACTIONS.mfaConfirm,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { issuedCount: RECOVERY_CODE_COUNT },
  });

  return { recoveryCodes: displayCodes };
}

export async function verifyMfa(
  deps: MfaDeps,
  auth: AuthContext,
  code: string,
  session: SessionRotation,
  meta: RequestMeta,
): Promise<{ authLevel: "full" }> {
  const { db, config } = deps;
  const userId = auth.userId;

  const fail = async (reason?: string): Promise<never> => {
    await writeAudit(db, {
      actorId: userId,
      actorType: "ADMIN",
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.mfaVerify,
      resourceType: "user",
      resourceId: userId,
      result: "FAILURE",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: reason ? { reason } : undefined,
    });
    throw invalidCodeError();
  };

  const credential = await loadCredential(db, userId);
  if (!credential?.confirmedAt) {
    return fail("no_active_credential");
  }

  const key = decodeTotpKey(config.secrets.totpEncryptionKey);
  const secret = decryptTotpSecret(credential.secretEncrypted, key);
  const step = matchTotpStep(secret, code);
  if (step === null) {
    return fail("code_mismatch");
  }

  // Replay protection (A3): claim this time-step atomically. If the row no
  // longer satisfies `last_used_counter < step`, the code was already used.
  const now = new Date();
  const claimed = await db
    .update(mfaCredentials)
    .set({ lastUsedCounter: step, lastUsedAt: now })
    .where(
      and(
        eq(mfaCredentials.id, credential.id),
        or(
          isNull(mfaCredentials.lastUsedCounter),
          lt(mfaCredentials.lastUsedCounter, step),
        ),
      ),
    );
  if (affectedRows(claimed) !== 1) {
    return fail("replay");
  }

  await rotateToFull(deps, auth, session, meta);

  await writeAudit(db, {
    actorId: userId,
    actorType: "ADMIN",
    actorEmail: auth.email,
    action: AUDIT_ACTIONS.mfaVerify,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { authLevel: "full" };
}

/** Step-up failure budget: 5 wrong codes per user per 15 minutes. */
const STEP_UP_MAX_FAILURES = 5;
const STEP_UP_WINDOW_SECONDS = 15 * 60;

/**
 * In-place MFA step-up (Phase 4 review fix): a full admin session whose
 * step-up stamp has aged past `requireStepUp`'s window re-verifies with a
 * fresh TOTP code WITHOUT signing out — the same code-verification path
 * as login (including the A3 single-use step claim), but instead of
 * rotating the session it re-stamps `step_up_at` on the current one.
 * Failures are rate-limited per user (5 / 15 min, mirroring the login
 * account scope) and the counter clears on success.
 */
export async function stepUpMfa(
  deps: MfaDeps,
  auth: AuthContext,
  code: string,
  meta: RequestMeta,
): Promise<{ stepUpAt: string }> {
  const { db, config } = deps;
  const userId = auth.userId;

  const roles = await getUserRoles(db, userId);
  const highest = getHighestRole(roles);
  if (!highest || !isAdminRole(highest)) {
    throw AppError.forbidden(
      "Step-up verification is for administrator accounts.",
    );
  }

  const limiter = createRateLimiter({
    db,
    keySecret: config.secrets.otpHmacSecret,
  });
  const limitKey = String(userId);
  const gate = await limiter.checkLimit(
    "mfa:stepup",
    limitKey,
    STEP_UP_MAX_FAILURES,
    STEP_UP_WINDOW_SECONDS,
  );
  if (!gate.allowed) {
    await writeAudit(db, {
      actorId: userId,
      actorType: "ADMIN",
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.mfaStepUp,
      resourceType: "user",
      resourceId: userId,
      result: "FAILURE",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: { reason: "rate_limited" },
    });
    throw new AppError("RATE_LIMITED");
  }

  const fail = async (reason?: string): Promise<never> => {
    await limiter.recordHit("mfa:stepup", limitKey, STEP_UP_WINDOW_SECONDS);
    await writeAudit(db, {
      actorId: userId,
      actorType: "ADMIN",
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.mfaStepUp,
      resourceType: "user",
      resourceId: userId,
      result: "FAILURE",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: reason ? { reason } : undefined,
    });
    throw invalidCodeError();
  };

  const credential = await loadCredential(db, userId);
  if (!credential?.confirmedAt) {
    return fail("no_active_credential");
  }

  const key = decodeTotpKey(config.secrets.totpEncryptionKey);
  const secret = decryptTotpSecret(credential.secretEncrypted, key);
  const step = matchTotpStep(secret, code);
  if (step === null) {
    return fail("code_mismatch");
  }

  // Replay protection (A3): claim this time-step atomically, exactly as
  // login verification does — a code already used (at login, enrolment
  // confirmation or a previous step-up) can never step up twice.
  const now = new Date();
  const claimed = await db
    .update(mfaCredentials)
    .set({ lastUsedCounter: step, lastUsedAt: now })
    .where(
      and(
        eq(mfaCredentials.id, credential.id),
        or(
          isNull(mfaCredentials.lastUsedCounter),
          lt(mfaCredentials.lastUsedCounter, step),
        ),
      ),
    );
  if (affectedRows(claimed) !== 1) {
    return fail("replay");
  }

  await createSessionService(deps).markStepUp(auth.sessionId);
  // Success proves authenticator possession: clear the failure counter so
  // earlier fat-fingered attempts cannot lock the admin out (login rule).
  await limiter.resetScope("mfa:stepup", limitKey, STEP_UP_WINDOW_SECONDS);

  await writeAudit(db, {
    actorId: userId,
    actorType: "ADMIN",
    actorEmail: auth.email,
    action: AUDIT_ACTIONS.mfaStepUp,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { stepUpAt: now.toISOString() };
}

export async function recoverMfa(
  deps: MfaDeps,
  auth: AuthContext,
  rawRecoveryCode: string,
  session: SessionRotation,
  meta: RequestMeta,
): Promise<{ authLevel: "full" }> {
  const { db } = deps;
  const userId = auth.userId;
  const normalized = normalizeRecoveryCode(rawRecoveryCode);

  const fail = async (): Promise<never> => {
    await writeAudit(db, {
      actorId: userId,
      actorType: "ADMIN",
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.mfaRecover,
      resourceType: "user",
      resourceId: userId,
      result: "FAILURE",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
    throw AppError.unauthenticated("Invalid recovery code.");
  };

  if (normalized.length < 10) return fail();

  // Recovery codes are Argon2id-hashed (A3), so matching is a verify per
  // unused code (at most 10) rather than a hash lookup.
  const candidates = await db
    .select()
    .from(mfaRecoveryCodes)
    .where(
      and(
        eq(mfaRecoveryCodes.userId, userId),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .limit(20);

  let matched: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (await verifyPassword(candidate.codeHash, normalized)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) return fail();

  // Single-use: atomic consume — a concurrent use of the same code loses.
  const now = new Date();
  const consumed = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(mfaRecoveryCodes.id, matched.id),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    );
  if (affectedRows(consumed) !== 1) return fail();

  await rotateToFull(deps, auth, session, meta);

  await writeAudit(db, {
    actorId: userId,
    actorType: "ADMIN",
    actorEmail: auth.email,
    action: AUDIT_ACTIONS.mfaRecover,
    resourceType: "user",
    resourceId: userId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    // Flagged for admin review: recovery-code use is a sensitive event.
    metadata: { recovery_code_id: matched.id, requiresAdminReview: true },
  });

  return { authLevel: "full" };
}

export async function resetMfaForUser(
  deps: MfaDeps,
  actor: AuthContext,
  targetUserId: number,
  meta: RequestMeta,
): Promise<{ userId: number; mfaReset: true }> {
  const { db } = deps;

  const [target] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw AppError.notFound("User not found.");

  await db.transaction(async (tx) => {
    await tx
      .delete(mfaCredentials)
      .where(eq(mfaCredentials.userId, targetUserId));
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, targetUserId));
  });
  // Revoking every session also bumps the user's session_version
  // (amendment A9) inside the session service's own transaction.
  await createSessionService(deps).revokeAllSessions(
    targetUserId,
    "ADMIN_ACTION",
  );

  await writeAudit(db, {
    actorId: actor.userId,
    actorType: "ADMIN",
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.mfaReset,
    resourceType: "user",
    resourceId: targetUserId,
    result: "SUCCESS",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { userId: targetUserId, targetEmail: target.email },
  });

  return { userId: targetUserId, mfaReset: true };
}
