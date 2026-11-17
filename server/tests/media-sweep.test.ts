/**
 * Orphan media sweep classification (Phase 8d). Runs against a temp
 * upload directory + caller-supplied asset rows — no database.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectedFileNames,
  sweepMedia,
  type SweepAssetRow,
} from "../src/modules/media/sweep.js";

let uploadDir: string;

const MASTER = "abcdef0123456789abcdef0123456789.png"; // shard "ab"
const DELETED_MASTER = "cd1111111111111111111111111111.jpg"; // shard "cd"
const MISSING_MASTER = "ef2222222222222222222222222222.webp"; // shard "ef"

async function write(rel: string, bytes = 10): Promise<void> {
  const full = path.join(uploadDir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.alloc(bytes, 1));
}

const assets: SweepAssetRow[] = [
  { id: 1, storageName: MASTER, deletedAt: null },
  { id: 2, storageName: DELETED_MASTER, deletedAt: new Date() },
  { id: 3, storageName: MISSING_MASTER, deletedAt: null },
];

beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "media-sweep-"));
  // Asset 1: master + thumb on disk (medium never generated — small image).
  await write(`ab/${MASTER}`, 100);
  await write(`ab/${MASTER.replace(".png", "_thumb.png")}`, 40);
  // Asset 2 (soft-deleted): files retained on disk by design.
  await write(`cd/${DELETED_MASTER}`, 60);
  // Orphans: an unknown master + an unknown derivative.
  await write("ab/zz9999999999999999999999999999.png", 25);
  await write("ab/aa8888888888888888888888888888_medium.png", 30);
  // Not media: the invoices subtree must be ignored entirely.
  await write("invoices/2026/INV-2026-00001.pdf", 500);
});

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

describe("sweepMedia", () => {
  it("derives the expected file names for an asset", () => {
    expect(expectedFileNames("ab12cd.png")).toEqual([
      "ab12cd.png",
      "ab12cd_thumb.png",
      "ab12cd_medium.png",
    ]);
  });

  it("classifies orphans and missing masters, ignoring invoices/", async () => {
    const report = await sweepMedia({ uploadDirectory: uploadDir, assets });
    expect(report.filesScanned).toBe(5); // invoices/ subtree excluded
    expect(report.filesMatched).toBe(3); // master, thumb, soft-deleted master
    expect(report.orphanFiles.map((f) => f.relativePath)).toEqual([
      "ab/aa8888888888888888888888888888_medium.png",
      "ab/zz9999999999999999999999999999.png",
    ]);
    expect(report.orphanBytes).toBe(55);
    expect(report.missingMasters).toEqual([
      { assetId: 3, storageName: MISSING_MASTER, softDeleted: false },
    ]);
    expect(report.deletedFiles).toEqual([]);
  });

  it("deletes only orphan files when --delete behaviour is requested", async () => {
    const report = await sweepMedia({
      uploadDirectory: uploadDir,
      assets,
      deleteOrphans: true,
    });
    expect(report.deletedFiles).toHaveLength(2);
    await expect(
      stat(path.join(uploadDir, "ab/zz9999999999999999999999999999.png")),
    ).rejects.toThrow();
    // Known files and the invoice PDF are untouched.
    await expect(
      stat(path.join(uploadDir, `ab/${MASTER}`)),
    ).resolves.toBeDefined();
    await expect(
      stat(path.join(uploadDir, "invoices/2026/INV-2026-00001.pdf")),
    ).resolves.toBeDefined();
  });

  it("reports nothing for an empty upload directory", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "media-sweep-empty-"));
    try {
      const report = await sweepMedia({
        uploadDirectory: empty,
        assets: [],
      });
      expect(report.filesScanned).toBe(0);
      expect(report.orphanFiles).toEqual([]);
      expect(report.missingMasters).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
