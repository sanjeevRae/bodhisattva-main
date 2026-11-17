/**
 * Last-good published-content cache (Phase 8d). The read function is
 * injected, so the fallback is proven with a fake failing read — no
 * database involved.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "@bodhisattva/shared/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readLastGood,
  withLastGood,
  writeLastGood,
} from "../src/modules/cms/last-good.js";

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "last-good-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("withLastGood", () => {
  it("returns the live payload and refreshes the cache file", async () => {
    const payload = { slug: "home", sections: [1, 2] };
    const result = await withLastGood({
      cacheDir,
      name: "page-home",
      read: async () => payload,
    });
    expect(result).toEqual({ payload, source: "live" });
    const raw = await readFile(path.join(cacheDir, "page-home.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(payload);
  });

  it("serves the cached payload when the read fails with a DB-style error", async () => {
    const payload = { settings: { site_name: "Bodhisattva" } };
    await writeLastGood(cacheDir, "site", payload);
    const result = await withLastGood({
      cacheDir,
      name: "site",
      read: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:3306");
      },
    });
    expect(result).toEqual({ payload, source: "cache" });
  });

  it("propagates the original error when no cache exists", async () => {
    await expect(
      withLastGood({
        cacheDir,
        name: "page-nope",
        read: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    ).rejects.toThrow("connect ECONNREFUSED");
  });

  it("never falls back for application errors (a real 404 stays a 404)", async () => {
    await writeLastGood(cacheDir, "page-draft", { slug: "draft" });
    await expect(
      withLastGood({
        cacheDir,
        name: "page-draft",
        read: async () => {
          throw AppError.notFound("Page not found.");
        },
      }),
    ).rejects.toThrow("Page not found.");
  });

  it("sanitises cache names so a slug cannot escape the cache dir", async () => {
    const result = await withLastGood({
      cacheDir,
      name: "page-../../etc/passwd",
      read: async () => ({ ok: true }),
    });
    expect(result.source).toBe("live");
    const cached = await readLastGood(cacheDir, "page-../../etc/passwd");
    expect(cached).toEqual({ ok: true });
  });
});
