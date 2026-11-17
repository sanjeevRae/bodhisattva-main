/**
 * MySQL-backed rate limiting (SECURITY_THREAT_MODEL.md §7, DATABASE_DESIGN.md
 * §11.4; spec §15.3).
 *
 * Store decision (threat model §7.2): limits live in the `rate_limits` table,
 * never in process memory — Passenger runs multiple workers and recycles
 * them, so in-memory counters would be decorative. Increments are a single
 * atomic upsert (`INSERT … ON DUPLICATE KEY UPDATE hit_count = hit_count + 1`)
 * so concurrent requests cannot race past a limit.
 *
 * Keys: the stored `scope` is `<flow>:<subject-kind>:<HMAC>` where the HMAC
 * is HMAC-SHA-256 keyed by the server OTP secret over the raw identifier —
 * raw email addresses and IPs are never stored as rate-limit keys (§11.4).
 *
 * Windows are fixed windows aligned to the epoch. When a limit trips, the
 * row's `blocked_until` is set to the window end (progressive backoff: the
 * caller must wait out the window; there is never a permanent lockout).
 *
 * Failure mode (threat model §7.2): auth-sensitive flows FAIL CLOSED — if
 * the store is unreachable these helpers throw SERVICE_UNAVAILABLE rather
 * than silently disabling brute-force protection.
 */
import { createHmac } from "node:crypto";
import { AppError } from "@bodhisattva/shared/errors";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { rateLimits } from "../database/schema/index.js";

export interface RateLimitDeps {
  db: Database;
  /** Secret used to HMAC rate-limit subject keys (AppConfig OTP secret). */
  keySecret: string;
}

export interface LimitResult {
  allowed: boolean;
  /** Hits recorded in the current window (after this call, for hitLimit). */
  count: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
  /** When the current window (and any block) ends. */
  resetAt: Date;
}

export interface RateLimiter {
  /** Record one hit, then report whether it is within the limit. */
  hitLimit(
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<LimitResult>;
  /** Peek at the current window without recording a hit. */
  checkLimit(
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<LimitResult>;
  /** Record one hit without evaluating a limit; returns the new count. */
  recordHit(
    scope: string,
    key: string,
    windowSeconds: number,
  ): Promise<number>;
  /**
   * Clear the current window's counter for one (scope, key). Used to reset
   * the ACCOUNT login-failure scope after a successful login (Phase 2
   * review: both reviewers flagged that never clearing counters turns the
   * limiter into an account-lockout DoS — an attacker who knows an email
   * could keep a victim permanently blocked; a successful login proves
   * possession of the password, so clearing the account scope is safe.
   * The IP scope is deliberately NOT cleared: it is shared across accounts
   * and clearing it would let one valid login reset an attacker's budget.)
   */
  resetScope(scope: string, key: string, windowSeconds: number): Promise<void>;
  /** The stored scope string for a (scope, key) pair — exported for tests. */
  storedScope(scope: string, key: string): string;
}

function windowFor(nowMs: number, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return {
    windowStart: new Date(startMs),
    windowEnd: new Date(startMs + windowMs),
  };
}

export function createRateLimiter(deps: RateLimitDeps): RateLimiter {
  const { db } = deps;

  function storedScope(scope: string, key: string): string {
    const digest = createHmac("sha256", deps.keySecret)
      .update(key, "utf8")
      .digest("hex");
    return `${scope}:${digest}`;
  }

  async function readRow(scope: string, windowStart: Date) {
    const rows = await db
      .select({
        hitCount: rateLimits.hitCount,
        blockedUntil: rateLimits.blockedUntil,
        windowEnd: rateLimits.windowEnd,
      })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.scope, scope),
          eq(rateLimits.windowStart, windowStart),
        ),
      )
      .limit(1);
    return rows[0];
  }

  function evaluate(
    row: { hitCount: number; blockedUntil: Date | null; windowEnd: Date } | undefined,
    limit: number,
    windowEnd: Date,
    nowMs: number,
  ): LimitResult {
    if (!row) {
      return { allowed: true, count: 0, retryAfterSeconds: 0, resetAt: windowEnd };
    }
    if (row.blockedUntil && row.blockedUntil.getTime() > nowMs) {
      return {
        allowed: false,
        count: row.hitCount,
        retryAfterSeconds: Math.ceil((row.blockedUntil.getTime() - nowMs) / 1000),
        resetAt: row.blockedUntil,
      };
    }
    const allowed = row.hitCount < limit;
    return {
      allowed,
      count: row.hitCount,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((windowEnd.getTime() - nowMs) / 1000)),
      resetAt: windowEnd,
    };
  }

  async function recordHit(
    scope: string,
    key: string,
    windowSeconds: number,
  ): Promise<number> {
    const stored = storedScope(scope, key);
    const { windowStart, windowEnd } = windowFor(Date.now(), windowSeconds);
    try {
      await db
        .insert(rateLimits)
        .values({ scope: stored, windowStart, windowEnd, hitCount: 1 })
        .onDuplicateKeyUpdate({
          set: { hitCount: sql`${rateLimits.hitCount} + 1` },
        });
      const row = await readRow(stored, windowStart);
      return row?.hitCount ?? 1;
    } catch (cause) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Rate limiting is temporarily unavailable.",
        undefined,
        { cause },
      );
    }
  }

  async function checkLimit(
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<LimitResult> {
    const stored = storedScope(scope, key);
    const nowMs = Date.now();
    const { windowStart, windowEnd } = windowFor(nowMs, windowSeconds);
    try {
      const row = await readRow(stored, windowStart);
      return evaluate(row, limit, windowEnd, nowMs);
    } catch (cause) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Rate limiting is temporarily unavailable.",
        undefined,
        { cause },
      );
    }
  }

  async function hitLimit(
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<LimitResult> {
    const stored = storedScope(scope, key);
    const nowMs = Date.now();
    const { windowStart, windowEnd } = windowFor(nowMs, windowSeconds);
    const count = await recordHit(scope, key, windowSeconds);
    const result: LimitResult = {
      allowed: count <= limit,
      count,
      retryAfterSeconds:
        count <= limit
          ? 0
          : Math.max(1, Math.ceil((windowEnd.getTime() - nowMs) / 1000)),
      resetAt: windowEnd,
    };
    if (!result.allowed) {
      // Progressive backoff marker: blocked until the window ends.
      try {
        await db
          .update(rateLimits)
          .set({ blockedUntil: windowEnd })
          .where(
            and(
              eq(rateLimits.scope, stored),
              eq(rateLimits.windowStart, windowStart),
            ),
          );
      } catch {
        // Best effort — the count itself still enforces the limit.
      }
    }
    return result;
  }

  async function resetScope(
    scope: string,
    key: string,
    windowSeconds: number,
  ): Promise<void> {
    const stored = storedScope(scope, key);
    const { windowStart } = windowFor(Date.now(), windowSeconds);
    try {
      await db
        .delete(rateLimits)
        .where(
          and(
            eq(rateLimits.scope, stored),
            eq(rateLimits.windowStart, windowStart),
          ),
        );
    } catch (cause) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Rate limiting is temporarily unavailable.",
        undefined,
        { cause },
      );
    }
  }

  return { hitLimit, checkLimit, recordHit, resetScope, storedScope };
}
