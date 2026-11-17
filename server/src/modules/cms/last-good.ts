/**
 * Last-good published-content cache (Phase 8d; Phase 3 review item).
 *
 * The public site reads pages and site settings from the database on
 * every request. If the database becomes unreachable, those reads fail
 * and the whole public site goes down with it. This module keeps a
 * file copy of the most recent successful response for the two public
 * CMS reads (GET /api/pages/:slug and GET /api/site):
 *
 *   - on a successful read, the payload is written (best effort) to
 *     `<UPLOAD_DIRECTORY>/../cache/last-good/<name>.json`;
 *   - on a read failure that is NOT an application error, the cached
 *     payload is served instead and the route marks the response with
 *     `X-Content-Source: last-good-cache`;
 *   - application errors (AppError — e.g. a genuine 404 for an
 *     unpublished page) always propagate: the cache covers database
 *     outages, never editorial state;
 *   - with no cache file, the original error propagates unchanged.
 *
 * Only the two public reads are wrapped. Admin, draft and preview
 * reads are never cached — editors must always see the truth.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@bodhisattva/shared/errors";
import pino from "pino";
import type { AppConfig } from "../../config/env.js";

const log = pino({
  name: "last-good-cache",
  level: process.env.LOG_LEVEL ?? "info",
});

export function lastGoodCacheDir(config: AppConfig): string {
  return path.resolve(config.uploadDirectory, "..", "cache", "last-good");
}

/** Cache names come from URL slugs — never let one escape the dir. */
function cacheFilePath(cacheDir: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return path.join(cacheDir, `${safe}.json`);
}

export async function readLastGood<T>(
  cacheDir: string,
  name: string,
): Promise<T | null> {
  try {
    const raw = await readFile(cacheFilePath(cacheDir, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeLastGood(
  cacheDir: string,
  name: string,
  payload: unknown,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    cacheFilePath(cacheDir, name),
    JSON.stringify(payload),
    "utf8",
  );
}

export interface LastGoodResult<T> {
  payload: T;
  source: "live" | "cache";
}

/**
 * Run `read`; on success refresh the cache and return the live
 * payload. On a non-application failure, fall back to the cache when
 * one exists. The read function is injected so the fallback is
 * unit-testable with a fake failing read.
 */
export async function withLastGood<T>(options: {
  cacheDir: string;
  name: string;
  read: () => Promise<T>;
}): Promise<LastGoodResult<T>> {
  const { cacheDir, name, read } = options;
  try {
    const payload = await read();
    try {
      await writeLastGood(cacheDir, name, payload);
    } catch (err) {
      // A cache that cannot be written must never fail the request.
      log.warn(
        { err, name },
        "last-good cache write failed; serving live payload",
      );
    }
    return { payload, source: "live" };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const cached = await readLastGood<T>(cacheDir, name);
    if (cached !== null) {
      log.warn(
        { err, name },
        "public read failed; serving last-good cached payload",
      );
      return { payload: cached, source: "cache" };
    }
    throw err;
  }
}
