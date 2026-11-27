/**
 * Permission catalogue integrity (Phase 1 review, ChatGPT §7A): the shared
 * catalogue is the single source for the TypeScript union, the Phase 2
 * seed data and the frontend's visibility hints — drift or duplicates here
 * would silently corrupt authorization. PERMISSIONS.md defines 50 grantable
 * permissions (audit.update / audit.delete deliberately do not exist).
 * (51 after policy.manage, back to 50 when the popup feature was
 * removed the same day — 2026-11-20.)
 */
import { describe, expect, it } from "vitest";
import { PERMISSIONS, isPermission } from "@bodhisattva/shared/permissions";
import { diffPermissionCatalogue } from "../src/services/permissions.js";

describe("permission catalogue", () => {
  it("contains exactly the 51 grantable permissions from PERMISSIONS.md", () => {
    expect(PERMISSIONS).toHaveLength(51);
  });

  it("has no duplicates", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("uses dotted module.resource.action strings", () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+(\.[a-z_]+){1,3}$/);
      expect(isPermission(permission)).toBe(true);
    }
  });

  it("does not contain the deliberately non-existent audit mutations", () => {
    expect(isPermission("audit.update")).toBe(false);
    expect(isPermission("audit.delete")).toBe(false);
  });
});

describe("permission catalogue diff (boot parity check)", () => {
  it("reports no difference for identical sets, in any order", () => {
    expect(diffPermissionCatalogue(["a.b", "c.d"], ["c.d", "a.b"])).toEqual({
      missingFromDb: [],
      missingFromCompiled: [],
    });
  });

  it("names a permission that is only in the database (stale build direction)", () => {
    const diff = diffPermissionCatalogue(["a.b"], ["a.b", "policy.manage"]);
    expect(diff.missingFromCompiled).toEqual(["policy.manage"]);
    expect(diff.missingFromDb).toEqual([]);
  });

  it("names a permission that is only in the compiled catalogue (unmigrated database direction)", () => {
    const diff = diffPermissionCatalogue(["a.b", "policy.manage"], ["a.b"]);
    expect(diff.missingFromDb).toEqual(["policy.manage"]);
    expect(diff.missingFromCompiled).toEqual([]);
  });
});
