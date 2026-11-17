/**
 * Whole-transaction deadlock retry (Phase 8, Phase 7 review
 * disposition 4).
 *
 * MariaDB/InnoDB picks a victim for every deadlock (errno 1213) and
 * can time out a lock wait (errno 1205); in both cases the victim's
 * transaction is rolled back, so re-running the WHOLE transaction is
 * safe — provided the transaction body re-reads and re-validates state
 * inside the new attempt (never blindly repeats side effects). That
 * precondition holds for the two call sites this helper is used at:
 *
 *  - checkout (store service): state is re-read under the product-row
 *    locks, and the A2 idempotency key makes a retry after an
 *    ambiguous outcome return the original order instead of creating
 *    a second one;
 *  - transitionOrder (orders service): the order's state is validated
 *    under its row lock at the top of every attempt, so a retry after
 *    a rival transition committed fails cleanly with 422 rather than
 *    double-applying.
 *
 * Only 1213/1205 are retried, at most `maxAttempts` total attempts,
 * with a short jittered backoff. Every other error propagates on the
 * first attempt.
 */

/** MariaDB/InnoDB error numbers + codes that mark a retryable
 * transaction-victim failure. */
const DEADLOCK_ERRNOS = new Set([1213, 1205]);
const DEADLOCK_CODES = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

/** True when the error (or anything in its cause chain — drizzle wraps
 * driver errors) is a deadlock / lock-wait-timeout victim failure. */
export function isDeadlockError(err: unknown): boolean {
  let current: unknown = err;
  for (
    let depth = 0;
    depth < 4 && typeof current === "object" && current !== null;
    depth += 1
  ) {
    const candidate = current as {
      errno?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (
      (typeof candidate.errno === "number" &&
        DEADLOCK_ERRNOS.has(candidate.errno)) ||
      (typeof candidate.code === "string" && DEADLOCK_CODES.has(candidate.code))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export interface DeadlockRetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Backoff base in ms; attempt n waits base * 2^(n-1) + jitter. */
  baseDelayMs?: number;
  /** Injectable for tests — defaults to a setTimeout promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1) — defaults to Math.random. */
  random?: () => number;
  /** Called before each retry (observability hook). */
  onRetry?: (err: unknown, attempt: number) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` (a whole transaction), retrying it from scratch when it
 * fails as a deadlock/lock-wait victim. `fn` MUST re-read and
 * re-validate all state it depends on — see the module header.
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  options: DeadlockRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 25;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isDeadlockError(err)) throw err;
      options.onRetry?.(err, attempt);
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(random() * baseDelayMs);
      await sleep(backoff + jitter);
    }
  }
}
