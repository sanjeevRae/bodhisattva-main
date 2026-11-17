/**
 * Server-side session service (spec §7.2/§15.2, DATABASE_DESIGN.md §4.2,
 * PHASE0_REVIEW.md amendment A9).
 *
 * Model: the browser holds an opaque 256-bit token in an HttpOnly cookie;
 * the database holds only its SHA-256 hash (`user_sessions.session_id_hash`).
 * Validation is one indexed lookup on the hash plus checks on revocation,
 * absolute expiry (expires_at), idle expiry (last_seen_at + policy window),
 * the account's status, and — amendment A9 — the revocation generation:
 *
 *  - `users.session_version` is incremented by revokeAllSessions() in the
 *    SAME transaction that revokes the session rows, so a version bump and
 *    its revocations commit (or roll back) together.
 *  - If `user_sessions` gains a `session_version` snapshot column in a
 *    later migration, createSession writes the snapshot and
 *    validateSession enforces it exactly; the conditional below keys off
 *    the Drizzle schema object so both shapes work. Until then the
 *    revocation pairing above is the enforcement mechanism.
 *
 * Lifetimes (ARCHITECTURE.md A11): customers idle 24 h / absolute 7 days;
 * admin-role holders idle 30 min / absolute 12 h. Idle is enforced against
 * last_seen_at, which validation refreshes at most every 5 minutes.
 *
 * Cookie: `__Host-session` in production (Secure, Path=/, no Domain — the
 * __Host- contract), plain `session` elsewhere so local http works.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Response } from "express";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../database/client.js";
import {
  roles,
  userRoles,
  userSessions,
  users,
} from "../database/schema/index.js";
import { generateToken, hashToken } from "../utils/tokens.js";

/** Session privilege states. `full` = password (+ MFA where required) done. */
export type AuthLevel = "full" | "mfa_pending" | "enrolment_required";

export const ADMIN_ROLE_CODES = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN"] as const;

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  /** True when the account holds any admin role (drives lifetime policy). */
  isAdmin: boolean;
}

export interface CreatedSession {
  /** Raw token — set it in the cookie; never stored or logged. */
  rawToken: string;
  sessionId: number;
  authLevel: AuthLevel;
  expiresAt: Date;
}

export interface SessionUser {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerifiedAt: Date | null;
}

export interface ValidatedSession {
  sessionId: number;
  userId: number;
  authLevel: string;
  roles: string[];
  isAdmin: boolean;
  user: SessionUser;
  stepUpAt: Date | null;
  createdAt: Date;
}

export type RevokeReason =
  | "LOGOUT"
  | "LOGOUT_ALL"
  | "PASSWORD_CHANGE"
  | "ROLE_CHANGE"
  | "ADMIN_ACTION"
  | "EXPIRED";

const CUSTOMER_IDLE_SECONDS = 24 * 60 * 60;
const CUSTOMER_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_IDLE_SECONDS = 30 * 60;
const ADMIN_ABSOLUTE_SECONDS = 12 * 60 * 60;
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export function sessionCookieName(config: AppConfig): string {
  return config.isProduction ? "__Host-session" : "session";
}

export function setSessionCookie(
  res: Response,
  config: AppConfig,
  rawToken: string,
  expiresAt: Date,
): void {
  res.cookie(sessionCookieName(config), rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.isProduction,
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(sessionCookieName(config), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.isProduction,
  });
}

type SessionRow = typeof userSessions.$inferSelect & {
  sessionVersion?: number;
};

/** True once the schema carries the A9 snapshot column (see header). */
const hasVersionSnapshot = "sessionVersion" in userSessions;

export interface SessionService {
  createSession(
    userId: number,
    authLevel: AuthLevel,
    ctx: SessionContext,
  ): Promise<CreatedSession>;
  validateSession(rawToken: string): Promise<ValidatedSession | null>;
  rotateSession(
    currentRawToken: string,
    newAuthLevel: AuthLevel,
    ctx: SessionContext,
  ): Promise<CreatedSession>;
  /**
   * Stamp `step_up_at = now` on an existing session (in-place MFA step-up,
   * Phase 4 review fix): the session keeps its id and token — only the
   * recent-verification timestamp that `requireStepUp` reads is refreshed.
   */
  markStepUp(sessionId: number): Promise<void>;
  revokeSessionByToken(
    rawToken: string,
    reason?: RevokeReason,
  ): Promise<void>;
  revokeAllSessions(userId: number, reason: RevokeReason): Promise<void>;
  idleSecondsFor(isAdmin: boolean): number;
}

export function createSessionService(deps: {
  db: Database;
  config: AppConfig;
}): SessionService {
  const { db } = deps;

  function idleSecondsFor(isAdmin: boolean): number {
    return isAdmin ? ADMIN_IDLE_SECONDS : CUSTOMER_IDLE_SECONDS;
  }

  function absoluteSecondsFor(isAdmin: boolean): number {
    return isAdmin ? ADMIN_ABSOLUTE_SECONDS : CUSTOMER_ABSOLUTE_SECONDS;
  }

  async function loadRoleCodes(userId: number): Promise<string[]> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return rows.map((row) => row.code);
  }

  async function createSession(
    userId: number,
    authLevel: AuthLevel,
    ctx: SessionContext,
  ): Promise<CreatedSession> {
    const { raw, hash } = generateToken(32);
    const expiresAt = new Date(
      Date.now() + absoluteSecondsFor(ctx.isAdmin) * 1000,
    );
    const values: Record<string, unknown> = {
      sessionIdHash: hash,
      userId,
      authLevel,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 512) : null,
      expiresAt,
    };
    if (hasVersionSnapshot) {
      const [user] = await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      values.sessionVersion = user?.sessionVersion ?? 0;
    }
    const [inserted] = await db
      .insert(userSessions)
      .values(values as typeof userSessions.$inferInsert)
      .$returningId();
    return { rawToken: raw, sessionId: inserted.id, authLevel, expiresAt };
  }

  async function markRevoked(
    sessionId: number,
    reason: RevokeReason,
  ): Promise<void> {
    await db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)),
      );
  }

  async function validateSession(
    rawToken: string,
  ): Promise<ValidatedSession | null> {
    if (!rawToken) return null;
    const hash = hashToken(rawToken);
    const rows = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.sessionIdHash, hash))
      .limit(1);
    const session = rows[0] as SessionRow | undefined;
    if (!session) return null;

    const now = new Date();
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= now.getTime()) {
      await markRevoked(session.id, "EXPIRED").catch(() => undefined);
      return null;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user || user.deletedAt) return null;
    // SUSPENDED / DEACTIVATED / INVITED / PENDING_VERIFICATION accounts hold
    // no valid sessions (design §4.1: status blocks at the session layer).
    if (user.status !== "ACTIVE") return null;

    // A9 snapshot enforcement when the column exists (see header).
    if (
      hasVersionSnapshot &&
      session.sessionVersion !== undefined &&
      session.sessionVersion !== user.sessionVersion
    ) {
      return null;
    }

    const roleCodes = await loadRoleCodes(user.id);
    const isAdmin = roleCodes.some((code) =>
      (ADMIN_ROLE_CODES as readonly string[]).includes(code),
    );

    // Idle expiry against last_seen_at.
    const idleLimitMs = idleSecondsFor(isAdmin) * 1000;
    if (session.lastSeenAt.getTime() + idleLimitMs <= now.getTime()) {
      await markRevoked(session.id, "EXPIRED").catch(() => undefined);
      return null;
    }

    // Refresh last_seen_at at most every 5 minutes (write throttling).
    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await db
        .update(userSessions)
        .set({ lastSeenAt: now })
        .where(eq(userSessions.id, session.id))
        .catch(() => undefined);
    }

    return {
      sessionId: session.id,
      userId: user.id,
      authLevel: session.authLevel,
      roles: roleCodes,
      isAdmin,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      stepUpAt: session.stepUpAt,
      createdAt: session.createdAt,
    };
  }

  async function rotateSession(
    currentRawToken: string,
    newAuthLevel: AuthLevel,
    ctx: SessionContext,
  ): Promise<CreatedSession> {
    const current = await validateSession(currentRawToken);
    if (!current) {
      throw AppError.unauthenticated("The current session is no longer valid.");
    }
    let created: CreatedSession | undefined;
    await db.transaction(async (tx) => {
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokeReason: "ROLE_CHANGE" })
        .where(
          and(
            eq(userSessions.id, current.sessionId),
            isNull(userSessions.revokedAt),
          ),
        );
      const { raw, hash } = generateToken(32);
      const expiresAt = new Date(
        Date.now() + absoluteSecondsFor(ctx.isAdmin) * 1000,
      );
      const values: Record<string, unknown> = {
        sessionIdHash: hash,
        userId: current.userId,
        authLevel: newAuthLevel,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 512) : null,
        expiresAt,
        // A completed MFA step is a fresh step-up for sensitive actions.
        stepUpAt: newAuthLevel === "full" ? new Date() : null,
      };
      if (hasVersionSnapshot) {
        const [user] = await tx
          .select({ sessionVersion: users.sessionVersion })
          .from(users)
          .where(eq(users.id, current.userId))
          .limit(1);
        values.sessionVersion = user?.sessionVersion ?? 0;
      }
      const [inserted] = await tx
        .insert(userSessions)
        .values(values as typeof userSessions.$inferInsert)
        .$returningId();
      created = {
        rawToken: raw,
        sessionId: inserted.id,
        authLevel: newAuthLevel,
        expiresAt,
      };
    });
    if (!created) throw AppError.internal();
    return created;
  }

  async function markStepUp(sessionId: number): Promise<void> {
    await db
      .update(userSessions)
      .set({ stepUpAt: new Date() })
      .where(
        and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)),
      );
  }

  async function revokeSessionByToken(
    rawToken: string,
    reason: RevokeReason = "LOGOUT",
  ): Promise<void> {
    if (!rawToken) return;
    await db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(
          eq(userSessions.sessionIdHash, hashToken(rawToken)),
          isNull(userSessions.revokedAt),
        ),
      );
  }

  async function revokeAllSessions(
    userId: number,
    reason: RevokeReason,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // A9: bump the revocation generation in the same commit as the
      // revocations, so the two can never diverge.
      await tx
        .update(users)
        .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, userId));
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokeReason: reason })
        .where(
          and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)),
        );
    });
  }

  return {
    createSession,
    validateSession,
    rotateSession,
    markStepUp,
    revokeSessionByToken,
    revokeAllSessions,
    idleSecondsFor,
  };
}
