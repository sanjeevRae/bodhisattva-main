/**
 * Auth service — registration, email verification, login/session issuance,
 * logout, and password reset (spec §7.1–§7.2; SECURITY_THREAT_MODEL.md
 * T-01/T-20/T-22).
 *
 * Enumeration discipline (T-22): register, resend-verification and
 * password-reset request return the SAME response shape whether or not the
 * email exists. Login returns one generic failure for unknown email, wrong
 * password and blocked account states alike; the single deliberate
 * exception is a correct-password login on an unverified account, which
 * returns UNAUTHENTICATED with a "verify your email" message (the caller
 * has already proven knowledge of the password; the catalogue has no
 * EMAIL_NOT_VERIFIED code, so UNAUTHENTICATED is the closest fit — the
 * distinct message rides on the standard envelope).
 *
 * Audit (Part 14): register, email verified, login success/failure, logout,
 * session revoked (logout-all), password reset requested/completed are all
 * written via services/audit.ts. Codes, tokens and passwords are never
 * logged or audited.
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRateLimiter, type RateLimiter } from "../../security/rate-limit.js";
import { writeAudit } from "../../services/audit.js";
import type { Mailer } from "../../services/mailer.js";
import {
  ADMIN_ROLE_CODES,
  createSessionService,
  type AuthLevel,
  type CreatedSession,
  type SessionService,
} from "../../services/session.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { normalizePhone } from "../../utils/phone.js";
import { generateOtpCode, hashOtp, verifyOtp } from "../../utils/otp.js";
import { generateToken, hashToken } from "../../utils/tokens.js";
import * as repo from "./repository.js";
import {
  normaliseEmail,
  PASSWORD_MIN_LENGTH_ADMIN,
  type LoginInput,
  type PasswordResetConfirmInput,
  type RegisterInput,
} from "./schemas.js";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthServiceDeps {
  db: Database;
  config: AppConfig;
  mailer: Mailer;
  logger: Logger;
}

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  roles: string[];
}

export interface LoginResult {
  user: PublicUser;
  authLevel: AuthLevel;
  mfaRequired: boolean;
  mfaEnrolmentRequired: boolean;
  session: CreatedSession;
}

const OTP_PURPOSE_EMAIL_VERIFICATION = "email_verification";
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // design §4.4: issue + 60 minutes
const ONE_HOUR_SECONDS = 60 * 60;

const AUDIT = {
  register: "auth.register",
  emailVerified: "auth.email.verified",
  loginSuccess: "auth.login.success",
  loginFailure: "auth.login.failure",
  logout: "auth.logout",
  sessionRevoked: "auth.session.revoked",
  passwordResetRequested: "auth.password.reset_requested",
  passwordResetCompleted: "auth.password.reset_completed",
} as const;

export function isAdminRoles(roleCodes: string[]): boolean {
  return roleCodes.some((code) =>
    (ADMIN_ROLE_CODES as readonly string[]).includes(code),
  );
}

export interface AuthService {
  register(input: RegisterInput, ctx: RequestContext): Promise<{ email: string }>;
  verifyEmail(email: string, code: string, ctx: RequestContext): Promise<void>;
  resendVerification(email: string, ctx: RequestContext): Promise<void>;
  login(input: LoginInput, ctx: RequestContext): Promise<LoginResult>;
  logout(rawToken: string, auth: { userId: number; email: string; isAdmin: boolean }, ctx: RequestContext): Promise<void>;
  logoutAll(auth: { userId: number; email: string; isAdmin: boolean }, ctx: RequestContext): Promise<void>;
  requestPasswordReset(email: string, ctx: RequestContext): Promise<void>;
  confirmPasswordReset(input: PasswordResetConfirmInput, ctx: RequestContext): Promise<void>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { db, config, mailer, logger } = deps;
  const sessions: SessionService = createSessionService({ db, config });
  const rateLimiter: RateLimiter = createRateLimiter({
    db,
    keySecret: config.secrets.otpHmacSecret,
  });

  function auditCtx(ctx: RequestContext) {
    return { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent };
  }

  /** Send mail without ever failing the flow or logging content. */
  async function sendMailSafe(
    to: string,
    subject: string,
    text: string,
  ): Promise<void> {
    try {
      await mailer.sendMail({ to, subject, text });
    } catch (err) {
      // Only the failure is logged — never the body (it may carry a code).
      logger.error({ err, subject }, "auth email delivery failed");
    }
  }

  /**
   * Issue a fresh verification code for an unverified user, honouring the
   * resend cooldown and the per-email hourly send cap (spec §7.1). Returns
   * true when a code was actually sent. Silently skips (returns false)
   * when a policy blocks the send — callers always answer generically.
   */
  async function issueVerificationCode(
    user: repo.UserRow,
    options: { enforceCooldown: boolean },
  ): Promise<boolean> {
    const now = new Date();
    if (options.enforceCooldown) {
      const latest = await repo.findLatestCode(db, user.id);
      if (
        latest &&
        now.getTime() - latest.createdAt.getTime() <
          config.otpPolicy.resendCooldownSeconds * 1000
      ) {
        return false;
      }
    }
    const cap = await rateLimiter.checkLimit(
      "otp:email",
      user.emailNormalized,
      config.otpPolicy.maxSendsPerHour,
      ONE_HOUR_SECONDS,
    );
    if (!cap.allowed) return false;

    const code = generateOtpCode();
    const codeHmac = hashOtp(
      config.secrets.otpHmacSecret,
      OTP_PURPOSE_EMAIL_VERIFICATION,
      user.emailNormalized,
      code,
    );
    await db.transaction(async (tx) => {
      // A new code invalidates every previous unconsumed code (§4.3).
      await repo.invalidateUnconsumedCodes(tx, user.id, now);
      await repo.insertVerificationCode(tx, {
        userId: user.id,
        codeHmac,
        maxAttempts: config.otpPolicy.maxAttempts,
        expiresAt: new Date(now.getTime() + config.otpPolicy.expirySeconds * 1000),
      });
    });
    await rateLimiter.recordHit("otp:email", user.emailNormalized, ONE_HOUR_SECONDS);
    await sendMailSafe(
      user.email,
      "Your Bodhisattva Museum verification code",
      [
        `Welcome to Bodhisattva Museum.`,
        ``,
        `Your email verification code is: ${code}`,
        ``,
        `It expires in ${Math.round(config.otpPolicy.expirySeconds / 60)} minutes.`,
        `If you did not create an account, you can ignore this email.`,
      ].join("\n"),
    );
    return true;
  }

  async function register(
    input: RegisterInput,
    ctx: RequestContext,
  ): Promise<{ email: string }> {
    // Registration attempts: 3/IP/hour (policy table, §7.1).
    const limit = await rateLimiter.hitLimit(
      "reg:ip",
      ctx.ipAddress ?? "unknown",
      config.rateLimit.registrationPerHour,
      ONE_HOUR_SECONDS,
    );
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", undefined, [
        { field: "retryAfter", issue: String(limit.retryAfterSeconds) },
      ]);
    }

    const emailNormalized = normaliseEmail(input.email);
    // Phone is required and plan-validated; stored in E.164 form. This
    // throws VALIDATION_FAILED (field "phone") before any account work.
    const phone = normalizePhone(input.phone, input.phoneCountry);
    const passwordHash = await hashPassword(input.password);
    const existing = await repo.findUserByEmailNormalized(db, emailNormalized);

    if (existing && existing.emailVerifiedAt) {
      // Verified account already exists: answer exactly like a fresh
      // registration, send nothing (T-22). The attempt is audited for
      // operations visibility; the response reveals nothing.
      await writeAudit(db, {
        actorId: null,
        actorType: "CUSTOMER",
        action: AUDIT.register,
        result: "FAILURE",
        ...auditCtx(ctx),
        metadata: { reason: "duplicate_verified" },
      });
      return { email: input.email };
    }

    let user: repo.UserRow;
    if (existing) {
      // Still unverified: treat as a fresh registration — refresh the
      // credentials and issue a new code (the old code is invalidated).
      await repo.updateUnverifiedUserCredentials(db, existing.id, {
        fullName: input.name,
        phone,
        passwordHash,
      });
      user = { ...existing, fullName: input.name, phone, passwordHash };
    } else {
      const userId = await repo.createUser(db, {
        fullName: input.name,
        email: input.email.trim(),
        emailNormalized,
        phone,
        passwordHash,
      });
      await repo.assignRoleByCode(db, userId, "CUSTOMER");
      const created = await repo.findUserById(db, userId);
      if (!created) throw AppError.internal();
      user = created;
    }

    await issueVerificationCode(user, { enforceCooldown: false });
    await writeAudit(db, {
      actorId: user.id,
      actorType: "CUSTOMER",
      actorEmail: user.email,
      action: AUDIT.register,
      resourceType: "user",
      resourceId: user.id,
      result: "SUCCESS",
      ...auditCtx(ctx),
    });
    return { email: input.email };
  }

  async function verifyEmail(
    email: string,
    code: string,
    ctx: RequestContext,
  ): Promise<void> {
    const emailNormalized = normaliseEmail(email);
    const user = await repo.findUserByEmailNormalized(db, emailNormalized);
    // Unknown email and wrong code are indistinguishable (T-22).
    if (!user) {
      throw AppError.validation([
        { field: "code", issue: "Invalid verification code" },
      ]);
    }
    if (user.emailVerifiedAt) {
      // Already verified: there is no unconsumed code left to check, so any
      // further submission is an invalid code (spec: codes are single-use;
      // a no-op success here would accept ANY code for a verified account).
      // Lead patch at Phase 2 integration — same indistinguishable error as
      // the unknown-email case above.
      throw AppError.validation([
        { field: "code", issue: "Invalid verification code" },
      ]);
    }

    // A wrong code must PERSIST its attempt increment, so the mismatch
    // path cannot throw inside the transaction (the rollback would undo
    // the increment and the attempt cap would never engage — Phase 8
    // security suite finding). Signal via flags, let the transaction
    // commit the increment, then throw after it settles.
    const mismatch: { exceeded: boolean | null } = { exceeded: null };
    await db.transaction(async (tx) => {
      const row = await repo.findLatestUnconsumedCodeForUpdate(tx, user.id);
      if (!row) {
        throw AppError.validation([
          { field: "code", issue: "Invalid verification code" },
        ]);
      }
      const now = new Date();
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw new AppError("OTP_EXPIRED");
      }
      if (row.attempts >= row.maxAttempts) {
        throw new AppError("OTP_ATTEMPTS_EXCEEDED");
      }
      const matches = verifyOtp(
        config.secrets.otpHmacSecret,
        OTP_PURPOSE_EMAIL_VERIFICATION,
        emailNormalized,
        code,
        row.codeHmac,
      );
      if (!matches) {
        // Atomic increment inside the row lock; the code dies at max (§4.3).
        await repo.incrementCodeAttempts(tx, row.id);
        mismatch.exceeded = row.attempts + 1 >= row.maxAttempts;
        return;
      }
      // Single-use: consume in the same transaction as the account update.
      const consumed = await repo.consumeCode(tx, row.id, now);
      if (!consumed) {
        throw AppError.validation([
          { field: "code", issue: "Invalid verification code" },
        ]);
      }
      await repo.markUserVerified(tx, user.id, now);
    });

    if (mismatch.exceeded !== null) {
      if (mismatch.exceeded) {
        throw new AppError("OTP_ATTEMPTS_EXCEEDED");
      }
      throw AppError.validation([
        { field: "code", issue: "Invalid verification code" },
      ]);
    }

    await writeAudit(db, {
      actorId: user.id,
      actorType: "CUSTOMER",
      actorEmail: user.email,
      action: AUDIT.emailVerified,
      resourceType: "user",
      resourceId: user.id,
      result: "SUCCESS",
      ...auditCtx(ctx),
    });
  }

  async function resendVerification(
    email: string,
    ctx: RequestContext,
  ): Promise<void> {
    const emailNormalized = normaliseEmail(email);
    const user = await repo.findUserByEmailNormalized(db, emailNormalized);
    if (user && !user.emailVerifiedAt && user.status === "PENDING_VERIFICATION") {
      await issueVerificationCode(user, { enforceCooldown: true });
    }
    // Generic response regardless — the controller answers identically.
  }

  /* ------------------------------- login ------------------------------- */

  let dummyHashPromise: Promise<string> | undefined;
  function timingDummyHash(): Promise<string> {
    // A real Argon2id hash of a throwaway string, verified against when the
    // account does not exist, so unknown-email logins cost the same work
    // as wrong-password logins (T-22 timing). The result is discarded.
    dummyHashPromise ??= hashPassword("timing-equalisation-throwaway");
    return dummyHashPromise;
  }

  async function login(
    input: LoginInput,
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const emailNormalized = normaliseEmail(input.email);
    const user = await repo.findUserByEmailNormalized(db, emailNormalized);
    const roleCodes = user ? await repo.getUserRoleCodes(db, user.id) : [];
    const isAdmin = isAdminRoles(roleCodes);
    const actorType = isAdmin ? "ADMIN" : "CUSTOMER";

    // Failure limits (§7.1): account scope and IP scope, either can trip.
    // Admin accounts are stricter on the account scope (3 vs 5 per 15 min).
    const acctLimit = isAdmin
      ? config.rateLimit.adminLoginMaxFailures
      : config.rateLimit.loginMaxFailures;
    const loginWindowSeconds = config.rateLimit.loginWindowMinutes * 60;
    const [acct, ip] = await Promise.all([
      rateLimiter.checkLimit("login:acct", emailNormalized, acctLimit, loginWindowSeconds),
      rateLimiter.checkLimit("login:ip", ctx.ipAddress ?? "unknown", config.rateLimit.loginMaxFailures, loginWindowSeconds),
    ]);
    if (!acct.allowed || !ip.allowed) {
      await writeAudit(db, {
        actorId: user?.id ?? null,
        actorType,
        actorEmail: emailNormalized,
        action: AUDIT.loginFailure,
        result: "FAILURE",
        ...auditCtx(ctx),
        metadata: { reason: "rate_limited" },
      });
      throw new AppError("RATE_LIMITED");
    }

    const recordFailure = async (reason: string): Promise<never> => {
      await rateLimiter.recordHit("login:acct", emailNormalized, loginWindowSeconds);
      await rateLimiter.recordHit("login:ip", ctx.ipAddress ?? "unknown", loginWindowSeconds);
      await writeAudit(db, {
        actorId: user?.id ?? null,
        actorType,
        actorEmail: emailNormalized,
        action: AUDIT.loginFailure,
        result: "FAILURE",
        ...auditCtx(ctx),
        metadata: { reason },
      });
      throw AppError.unauthenticated("Invalid email or password.");
    };

    // Always run one Argon2id verification — against the real hash, or the
    // timing dummy when there is no usable stored hash (unknown account or
    // an invited account that has not set a password yet).
    const storedHash = user?.passwordHash ?? (await timingDummyHash());
    const verified = await verifyPassword(storedHash, input.password);
    const passwordOk = Boolean(user?.passwordHash) && verified;

    if (!user || !passwordOk) {
      return recordFailure("bad_credentials");
    }
    if (user.deletedAt) {
      return recordFailure("bad_credentials");
    }
    if (!user.emailVerifiedAt || user.status === "PENDING_VERIFICATION") {
      // Correct password, unverified account (see header note): distinct
      // but safe — and NOT counted as a rate-limit failure.
      await writeAudit(db, {
        actorId: user.id,
        actorType,
        actorEmail: user.email,
        action: AUDIT.loginFailure,
        result: "FAILURE",
        ...auditCtx(ctx),
        metadata: { reason: "email_not_verified" },
      });
      throw AppError.unauthenticated(
        "Please verify your email address before signing in. Use the verification code we sent you, or request a new one.",
      );
    }
    if (user.status !== "ACTIVE") {
      // SUSPENDED / DEACTIVATED / INVITED: same envelope as bad credentials.
      return recordFailure("account_inactive");
    }

    // MFA gate (roadmap §4): an admin-role holder never gets a full
    // session from a password alone.
    let authLevel: AuthLevel = "full";
    let mfaRequired = false;
    let mfaEnrolmentRequired = false;
    if (isAdmin) {
      if (await repo.hasActiveMfa(db, user.id)) {
        authLevel = "mfa_pending";
        mfaRequired = true;
      } else {
        authLevel = "enrolment_required";
        mfaEnrolmentRequired = true;
      }
    }

    // Successful login proves password possession: clear the ACCOUNT-scope
    // failure counter so an attacker who knows the email cannot keep the
    // victim locked out by re-tripping it (Phase 2 review fix). The shared
    // IP scope is intentionally left intact.
    await rateLimiter.resetScope("login:acct", emailNormalized, loginWindowSeconds);

    const session = await sessions.createSession(user.id, authLevel, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      isAdmin,
    });
    await repo.touchLastLogin(db, user.id, new Date());
    await writeAudit(db, {
      actorId: user.id,
      actorType,
      actorEmail: user.email,
      actorRole: roleCodes[0] ?? null,
      action: AUDIT.loginSuccess,
      resourceType: "user",
      resourceId: user.id,
      result: "SUCCESS",
      ...auditCtx(ctx),
      metadata: { authLevel },
    });

    return {
      user: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        roles: roleCodes,
      },
      authLevel,
      mfaRequired,
      mfaEnrolmentRequired,
      session,
    };
  }

  async function logout(
    rawToken: string,
    auth: { userId: number; email: string; isAdmin: boolean },
    ctx: RequestContext,
  ): Promise<void> {
    await sessions.revokeSessionByToken(rawToken, "LOGOUT");
    await writeAudit(db, {
      actorId: auth.userId,
      actorType: auth.isAdmin ? "ADMIN" : "CUSTOMER",
      actorEmail: auth.email,
      action: AUDIT.logout,
      result: "SUCCESS",
      ...auditCtx(ctx),
    });
  }

  async function logoutAll(
    auth: { userId: number; email: string; isAdmin: boolean },
    ctx: RequestContext,
  ): Promise<void> {
    await sessions.revokeAllSessions(auth.userId, "LOGOUT_ALL");
    await writeAudit(db, {
      actorId: auth.userId,
      actorType: auth.isAdmin ? "ADMIN" : "CUSTOMER",
      actorEmail: auth.email,
      action: AUDIT.sessionRevoked,
      resourceType: "user",
      resourceId: auth.userId,
      result: "SUCCESS",
      ...auditCtx(ctx),
      metadata: { scope: "all_sessions" },
    });
  }

  /* --------------------------- password reset --------------------------- */

  async function requestPasswordReset(
    email: string,
    ctx: RequestContext,
  ): Promise<void> {
    const emailNormalized = normaliseEmail(email);
    // Recovery requests: 3/email/hour (§7.1). Budget is consumed uniformly
    // so the endpoint's behaviour does not depend on account existence.
    const cap = await rateLimiter.checkLimit(
      "rcv:email",
      emailNormalized,
      config.rateLimit.recoveryPerHour,
      ONE_HOUR_SECONDS,
    );
    if (!cap.allowed) return;
    await rateLimiter.recordHit("rcv:email", emailNormalized, ONE_HOUR_SECONDS);

    const user = await repo.findUserByEmailNormalized(db, emailNormalized);
    if (!user || user.status !== "ACTIVE" || user.deletedAt) return;

    const { raw, hash } = generateToken(32);
    const now = new Date();
    await db.transaction(async (tx) => {
      await repo.invalidateUserResetTokens(tx, user.id, now);
      await repo.insertResetToken(tx, {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_SECONDS * 1000),
        requestIp: ctx.ipAddress,
      });
    });
    const resetUrl = `${config.appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(raw)}`;
    await sendMailSafe(
      user.email,
      "Reset your Bodhisattva Museum password",
      [
        `We received a request to reset your password.`,
        ``,
        `Use this link within ${RESET_TOKEN_TTL_SECONDS / 60} minutes:`,
        resetUrl,
        ``,
        `If you did not request this, you can ignore this email — your password will not change.`,
      ].join("\n"),
    );
    await writeAudit(db, {
      actorId: user.id,
      actorType: isAdminRoles(await repo.getUserRoleCodes(db, user.id))
        ? "ADMIN"
        : "CUSTOMER",
      actorEmail: user.email,
      action: AUDIT.passwordResetRequested,
      resourceType: "user",
      resourceId: user.id,
      result: "SUCCESS",
      ...auditCtx(ctx),
    });
  }

  async function confirmPasswordReset(
    input: PasswordResetConfirmInput,
    ctx: RequestContext,
  ): Promise<void> {
    const tokenHash = hashToken(input.token);
    const token = await repo.findResetTokenByHash(db, tokenHash);
    const invalid = (): never => {
      throw AppError.validation(
        [{ field: "token", issue: "This reset link is invalid or has expired" }],
        "This reset link is invalid or has expired.",
      );
    };
    if (!token || token.consumedAt) return invalid();
    if (token.expiresAt.getTime() <= Date.now()) return invalid();

    const user = await repo.findUserById(db, token.userId);
    if (!user || user.deletedAt) return invalid();

    // Admin-role holders follow the stricter password policy (§6.1).
    const roleCodes = await repo.getUserRoleCodes(db, user.id);
    if (
      isAdminRoles(roleCodes) &&
      input.newPassword.length < PASSWORD_MIN_LENGTH_ADMIN
    ) {
      throw AppError.validation([
        {
          field: "newPassword",
          issue: `Password must be at least ${PASSWORD_MIN_LENGTH_ADMIN} characters`,
        },
      ]);
    }

    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();
    const consumed = await db.transaction(async (tx) => {
      // Atomic single-use consume first; a concurrent replay loses here.
      const ok = await repo.consumeResetToken(tx, token.id, now);
      if (!ok) return false;
      await repo.setUserPasswordHash(tx, user.id, passwordHash);
      return true;
    });
    if (!consumed) return invalid();

    // A reset revokes every session and bumps the revocation generation.
    await sessions.revokeAllSessions(user.id, "PASSWORD_CHANGE");
    await writeAudit(db, {
      actorId: user.id,
      actorType: isAdminRoles(roleCodes) ? "ADMIN" : "CUSTOMER",
      actorEmail: user.email,
      action: AUDIT.passwordResetCompleted,
      resourceType: "user",
      resourceId: user.id,
      result: "SUCCESS",
      ...auditCtx(ctx),
    });
  }

  return {
    register,
    verifyEmail,
    resendVerification,
    login,
    logout,
    logoutAll,
    requestPasswordReset,
    confirmPasswordReset,
  };
}
