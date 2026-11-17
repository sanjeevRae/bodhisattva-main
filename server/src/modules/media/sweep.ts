/**
 * Orphan media sweep (Phase 8d ops utility).
 *
 * Compares the files under the upload directory with the `media_assets`
 * rows and classifies:
 *
 *   (a) orphan files — files on disk that no media asset row accounts
 *       for (neither a master `storage_name` nor one of its derived
 *       variant files). These accumulate when an upload transaction
 *       fails after the files were written, or after manual tinkering.
 *   (b) missing masters — media asset rows whose master file is not on
 *       disk. The asset can no longer be served; a human decides
 *       whether to restore the file or purge the row.
 *
 * Only the media storage layout is in scope: files live at
 * `<uploadDirectory>/<first 2 chars of storage name>/<storage name>`
 * with `_thumb` / `_medium` derivatives beside the master (see
 * media.service.ts). Other subtrees of the upload directory — notably
 * `invoices/` (invoice + credit-note PDFs) — are NOT media and are
 * never reported or deleted.
 *
 * The sweep is pure with respect to the database: the caller supplies
 * the asset rows, so the classification is unit-testable against a
 * temp directory. Deletion happens only when `deleteOrphans` is set,
 * and only ever removes category (a) files.
 */
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface SweepAssetRow {
  id: number;
  storageName: string;
  /** Soft-deleted rows keep their files on disk by design. */
  deletedAt: Date | null;
}

export interface OrphanFile {
  /** Path relative to the upload directory, POSIX separators. */
  relativePath: string;
  sizeBytes: number;
}

export interface MissingMaster {
  assetId: number;
  storageName: string;
  softDeleted: boolean;
}

export interface MediaSweepReport {
  uploadDirectory: string;
  /** Total media files found on disk (masters + derivatives). */
  filesScanned: number;
  /** Files accounted for by an asset row (master or derivative). */
  filesMatched: number;
  assetRows: number;
  orphanFiles: OrphanFile[];
  orphanBytes: number;
  missingMasters: MissingMaster[];
  /** Files actually removed (only when deleteOrphans was requested). */
  deletedFiles: string[];
}

const VARIANT_SUFFIXES = ["_thumb", "_medium"] as const;

/** All on-disk file names an asset row accounts for. */
export function expectedFileNames(storageName: string): string[] {
  const dot = storageName.lastIndexOf(".");
  if (dot <= 0) return [storageName];
  const base = storageName.slice(0, dot);
  const ext = storageName.slice(dot);
  return [
    storageName,
    ...VARIANT_SUFFIXES.map((suffix) => `${base}${suffix}${ext}`),
  ];
}

/** The 2-character shard directory a storage name belongs in. */
function shardOf(storageName: string): string {
  return storageName.slice(0, 2);
}

interface DiskFile {
  relativePath: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Walk the media shard directories of the upload directory. Media
 * files live in top-level directories named by the first two
 * characters of their storage name, so every file inside a
 * two-character directory is a sweep candidate — classification by
 * storage name decides whether a row accounts for it. Longer-named
 * subtrees (`invoices/`, …) are out of scope without a denylist.
 */
async function walkMediaFiles(uploadDirectory: string): Promise<DiskFile[]> {
  const out: DiskFile[] = [];
  let topLevel: string[];
  try {
    topLevel = await readdir(uploadDirectory);
  } catch {
    return out; // No upload directory yet — nothing on disk.
  }
  for (const entry of topLevel) {
    if (entry.length !== 2) continue;
    const dirPath = path.join(uploadDirectory, entry);
    const dirStat = await stat(dirPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;
    const names = await readdir(dirPath).catch(() => [] as string[]);
    for (const name of names) {
      const fileStat = await stat(path.join(dirPath, name)).catch(() => null);
      if (!fileStat?.isFile()) continue;
      out.push({
        relativePath: `${entry}/${name}`,
        fileName: name,
        sizeBytes: fileStat.size,
      });
    }
  }
  return out;
}

export interface SweepOptions {
  uploadDirectory: string;
  assets: SweepAssetRow[];
  /** When true, orphan files are unlinked after classification. */
  deleteOrphans?: boolean;
}

export async function sweepMedia(
  options: SweepOptions,
): Promise<MediaSweepReport> {
  const uploadDirectory = path.resolve(options.uploadDirectory);
  const diskFiles = await walkMediaFiles(uploadDirectory);

  const knownNames = new Set<string>();
  for (const asset of options.assets) {
    for (const name of expectedFileNames(asset.storageName)) {
      knownNames.add(name);
    }
  }

  const orphanFiles: OrphanFile[] = [];
  let filesMatched = 0;
  for (const file of diskFiles) {
    if (knownNames.has(file.fileName)) {
      filesMatched += 1;
    } else {
      orphanFiles.push({
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
      });
    }
  }
  orphanFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const onDiskPaths = new Set(diskFiles.map((f) => f.relativePath));
  const missingMasters: MissingMaster[] = [];
  for (const asset of options.assets) {
    // A master counts as present only at its canonical path
    // (<shard>/<storage name>) — that is the only path the media
    // service will ever serve it from.
    const expectedRel = `${shardOf(asset.storageName)}/${asset.storageName}`;
    if (!onDiskPaths.has(expectedRel)) {
      missingMasters.push({
        assetId: asset.id,
        storageName: asset.storageName,
        softDeleted: asset.deletedAt !== null,
      });
    }
  }
  missingMasters.sort((a, b) => a.assetId - b.assetId);

  const deletedFiles: string[] = [];
  if (options.deleteOrphans) {
    for (const orphan of orphanFiles) {
      await unlink(path.join(uploadDirectory, orphan.relativePath));
      deletedFiles.push(orphan.relativePath);
    }
  }

  return {
    uploadDirectory,
    filesScanned: diskFiles.length,
    filesMatched,
    assetRows: options.assets.length,
    orphanFiles,
    orphanBytes: orphanFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
    missingMasters,
    deletedFiles,
  };
}
