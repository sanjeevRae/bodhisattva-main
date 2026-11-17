/**
 * Audit service tests: metadata redaction (§11.2 rule 5 — secrets are never
 * logged) and the never-throws guarantee (§11.2 rule 3).
 */
import { describe, expect, it, vi } from "vitest";
import {
  sanitizeAuditMetadata,
  writeAudit,
  type AuditEntry,
} from "../src/services/audit.js";

describe("sanitizeAuditMetadata", () => {
  it("drops secret-bearing keys at any depth", () => {
    const out = sanitizeAuditMetadata({
      email: "admin@example.com",
      password: "hunter2",
      nested: {
        otpCode: "123456",
        tokenHash: "abc",
        apiSecret: "shh",
        note: "kept",
      },
      list: [{ recoveryCode: "XXXXX-XXXXX", ok: 1 }],
    }) as Record<string, unknown>;
    expect(out.email).toBe("admin@example.com");
    expect(out.password).toBeUndefined();
    const nested = out.nested as Record<string, unknown>;
    expect(nested.otpCode).toBeUndefined();
    expect(nested.tokenHash).toBeUndefined();
    expect(nested.apiSecret).toBeUndefined();
    expect(nested.note).toBe("kept");
    const first = (out.list as Record<string, unknown>[])[0];
    expect(first.recoveryCode).toBeUndefined();
    expect(first.ok).toBe(1);
  });

  it("keeps safe identifier keys that merely end in _id", () => {
    const out = sanitizeAuditMetadata({
      userId: 7,
      invitation_id: 3,
      recoveryCodeId: 11,
    }) as Record<string, unknown>;
    expect(out.userId).toBe(7);
    expect(out.invitation_id).toBe(3);
    // 'recoveryCodeId' ends in 'Id', not '_id', and contains 'code' → dropped.
    expect(out.recoveryCodeId).toBeUndefined();
  });

  it("passes through primitives and converts dates", () => {
    expect(sanitizeAuditMetadata(undefined)).toBeUndefined();
    expect(sanitizeAuditMetadata("plain")).toBe("plain");
    const out = sanitizeAuditMetadata({
      at: new Date("2026-11-17T00:00:00.000Z"),
    }) as Record<string, unknown>;
    expect(out.at).toBe("2026-11-17T00:00:00.000Z");
  });
});

describe("writeAudit", () => {
  const entry: AuditEntry = {
    actorId: 1,
    actorType: "ADMIN",
    action: "auth.mfa.verify",
    resourceType: "user",
    resourceId: 1,
    result: "SUCCESS",
    metadata: { password: "never-log-this", attempt: 2 },
  };

  it("inserts a sanitized row", async () => {
    const values = vi.fn(async (_v: Record<string, unknown>) => undefined);
    const db = { insert: () => ({ values }) } as never;
    await writeAudit(db, entry);
    expect(values).toHaveBeenCalledOnce();
    const row = values.mock.calls[0][0] as Record<string, unknown>;
    expect(row.action).toBe("auth.mfa.verify");
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.password).toBeUndefined();
    expect(metadata.attempt).toBe(2);
  });

  it("never throws when the insert fails", async () => {
    const db = {
      insert: () => ({
        values: async () => {
          throw new Error("db down");
        },
      }),
    } as never;
    await expect(writeAudit(db, entry)).resolves.toBeUndefined();
  });
});
