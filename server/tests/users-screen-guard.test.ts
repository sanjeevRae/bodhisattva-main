/**
 * Users-screen wiring guard (unit) — the admin Users screen's Delete
 * action, Super Admin seat line and persistent refusal banner exist
 * only as SPA wiring; a refactor could silently drop any of them while
 * every API test stays green. This source-scan keeps them present:
 * the delete API call, the Delete button + danger dialog, the seat
 * counter, the action banner, and the server route behind them.
 * (Pattern follows accept-invitation-guard.test.ts.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("users screen wiring guard", () => {
  it("the admin API exposes deleteUser over DELETE /api/admin/users/:id", () => {
    const api = read("src/admin/api.ts");
    expect(api).toContain("deleteUser(userId: number)");
    expect(api).toContain("`/api/admin/users/${userId}`");
    expect(api).toContain('method: "DELETE"');
  });

  it("the Users screen wires the Delete button, danger dialog and step-up retry", () => {
    const screen = read("src/admin/screens/Users.tsx");
    expect(screen).toContain("setDeleteTarget(user)");
    expect(screen).toContain("usersApi.deleteUser(target.id)");
    expect(screen).toContain("Delete user account");
    expect(screen).toContain("cannot be undone");
    // The delete goes through the step-up retry wrapper, like the
    // role change and MFA reset.
    expect(screen).toContain("confirmDelete");
  });

  it("the Users screen shows the seat count and the persistent refusal banner", () => {
    const screen = read("src/admin/screens/Users.tsx");
    expect(screen).toContain("Super Admin seats:");
    expect(screen).toContain("of 3 in use");
    expect(screen).toContain("actionError");
    expect(screen).toContain("Could not change");
  });

  it("the server registers the delete route behind users.manage + step-up", () => {
    const routes = read("server/src/modules/roles/roles.routes.ts");
    expect(routes).toContain('"/users/:userId"');
    expect(routes).toContain("deleteUser(");
    expect(routes).toContain('requirePermission(deps.db, "users.manage")');
    const audit = read("server/src/services/audit.ts");
    expect(audit).toContain('usersDelete: "admin.users.delete"');
  });
});
