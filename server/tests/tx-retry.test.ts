/**
 * Deadlock-retry unit tests (Phase 8, Phase 7 review disposition 4).
 *
 * The classifier recognises MariaDB 1213 (deadlock victim) and 1205
 * (lock wait timeout), including when drizzle has wrapped the driver
 * error in a cause chain; the runner retries ONLY those, at most 3
 * total attempts, and propagates everything else immediately. A fake
 * failing function stands in for the transaction body — the real
 * bodies are exercised against MariaDB by the integration suites.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isDeadlockError,
  withDeadlockRetry,
} from "../src/database/tx-retry.js";

const noSleep = (): Promise<void> => Promise.resolve();

function deadlockError(): Error & { errno: number; code: string } {
  return Object.assign(new Error("Deadlock found when trying to get lock"), {
    errno: 1213,
    code: "ER_LOCK_DEADLOCK",
  });
}

function lockWaitError(): Error & { errno: number } {
  return Object.assign(new Error("Lock wait timeout exceeded"), {
    errno: 1205,
  });
}

describe("isDeadlockError", () => {
  it("recognises 1213 / 1205 by errno and by code", () => {
    expect(isDeadlockError(deadlockError())).toBe(true);
    expect(isDeadlockError(lockWaitError())).toBe(true);
    expect(isDeadlockError({ code: "ER_LOCK_WAIT_TIMEOUT" })).toBe(true);
  });

  it("sees through a wrapped cause chain (drizzle query errors)", () => {
    const wrapped = new Error("query failed");
    (wrapped as { cause?: unknown }).cause = deadlockError();
    expect(isDeadlockError(wrapped)).toBe(true);
  });

  it("rejects other errors, including duplicate-key and plain values", () => {
    expect(isDeadlockError(Object.assign(new Error("dup"), { errno: 1062 }))).toBe(false);
    expect(isDeadlockError(new Error("boom"))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError("1213")).toBe(false);
  });
});

describe("withDeadlockRetry", () => {
  it("returns the first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withDeadlockRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a deadlock victim and returns the eventual success", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw deadlockError();
      return "recovered";
    });
    const onRetry = vi.fn();
    await expect(
      withDeadlockRetry(fn, { sleep: noSleep, onRetry }),
    ).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("also retries lock-wait timeouts (1205)", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw lockWaitError();
      return 42;
    });
    await expect(withDeadlockRetry(fn, { sleep: noSleep })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts and throws the last deadlock error", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw deadlockError();
    });
    await expect(
      withDeadlockRetry(fn, { sleep: noSleep }),
    ).rejects.toMatchObject({ errno: 1213 });
    expect(fn).toHaveBeenCalledTimes(3); // default: 3 total attempts
  });

  it("propagates non-retryable errors on the first attempt", async () => {
    const failure = new Error("validation failed");
    const fn = vi.fn(async (): Promise<string> => {
      throw failure;
    });
    await expect(withDeadlockRetry(fn, { sleep: noSleep })).rejects.toBe(failure);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits with growing backoff between attempts", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw deadlockError();
      return "ok";
    });
    await withDeadlockRetry(fn, { sleep, baseDelayMs: 10, random: () => 0 });
    expect(delays).toEqual([10, 20]);
  });
});
