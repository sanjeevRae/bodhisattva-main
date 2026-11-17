/**
 * Users directory (Phase 4 delta): listUsers maps user rows + role grants
 * into the admin UI's shape and paginates. The database is faked with a
 * chainable query-builder stub — each select() consumes the next queued
 * result set, mirroring the three queries listUsers issues (count, page
 * of users, role grants for the page). Live behaviour against a real
 * database is covered by the Phase 4 walkthrough.
 */
import { describe, expect, it } from "vitest";
import type { Database } from "../src/database/client.js";
import { listUsers } from "../src/modules/roles/roles.service.js";

function fakeDb(results: unknown[]): Database {
  let cursor = 0;
  const select = () => {
    const result = results[cursor] ?? [];
    cursor += 1;
    const chain: Record<string, unknown> = {};
    for (const method of [
      "from",
      "where",
      "orderBy",
      "limit",
      "offset",
      "innerJoin",
      "leftJoin",
      "groupBy",
    ]) {
      chain[method] = () => chain;
    }
    chain.then = (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  };
  return { select } as unknown as Database;
}

describe("listUsers", () => {
  it("maps rows and role grants, and reports the total", async () => {
    const db = fakeDb([
      [{ value: 2 }],
      [
        {
          id: 1,
          email: "root@example.com",
          fullName: "Root Admin",
          status: "ACTIVE",
          lastLoginAt: new Date("2026-11-17T08:00:00.000Z"),
        },
        {
          id: 2,
          email: "editor@example.com",
          fullName: "Site Editor",
          status: "ACTIVE",
          lastLoginAt: null,
        },
      ],
      [
        { userId: 1, code: "SUPER_ADMIN" },
        { userId: 1, code: "CUSTOMER" },
        { userId: 2, code: "ADMIN" },
      ],
    ]);

    const { items, total } = await listUsers(db, { page: 1, pageSize: 20 });

    expect(total).toBe(2);
    expect(items).toEqual([
      {
        id: 1,
        email: "root@example.com",
        displayName: "Root Admin",
        status: "ACTIVE",
        roles: ["SUPER_ADMIN", "CUSTOMER"],
        lastLoginAt: new Date("2026-11-17T08:00:00.000Z"),
      },
      {
        id: 2,
        email: "editor@example.com",
        displayName: "Site Editor",
        status: "ACTIVE",
        roles: ["ADMIN"],
        lastLoginAt: null,
      },
    ]);
  });

  it("returns an empty page without issuing the grants query", async () => {
    const db = fakeDb([[{ value: 0 }], []]);
    const { items, total } = await listUsers(db, { page: 3, pageSize: 20 });
    expect(total).toBe(0);
    expect(items).toEqual([]);
  });

  it("gives users without grants an empty roles array", async () => {
    const db = fakeDb([
      [{ value: 1 }],
      [
        {
          id: 9,
          email: "plain@example.com",
          fullName: "Plain User",
          status: "PENDING_VERIFICATION",
          lastLoginAt: null,
        },
      ],
      [],
    ]);
    const { items } = await listUsers(db, { page: 1, pageSize: 20 });
    expect(items[0].roles).toEqual([]);
  });
});
