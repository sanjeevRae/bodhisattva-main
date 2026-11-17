/**
 * Invoice PDF file storage (Phase 7, ARCHITECTURE.md §9 layout).
 *
 * Files live at `<uploadDirectory>/invoices/<yyyy>/<storageName>` —
 * private storage, never under a public root; bytes are served only
 * through the authorised download endpoints. The storage name is
 * server-generated at issue time (`<invoiceNumber>-<snapshotHash>.pdf`)
 * and validated against a strict pattern before any filesystem use, so
 * a stored name can never traverse out of the invoices directory.
 *
 * The stored file is a cache of a pure function: the renderer rebuilds
 * identical bytes from the invoice's snapshot at any time, so a missing
 * file (fresh checkout, moved storage) is regenerated on demand rather
 * than being an error.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { resolveMediaFile } from "../media/media.service.js";
import type { CreditNoteSnapshot, InvoiceSnapshot } from "./invoice-pdf.js";
import { renderCreditNotePdf, renderInvoicePdf } from "./invoice-pdf.js";

const STORAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/;

function snapshotHash(snapshot: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex")
    .slice(0, 8);
}

/** Deterministic storage name for an invoice: number + snapshot hash. */
export function invoicePdfStorageName(snapshot: InvoiceSnapshot): string {
  const year = snapshot.issuedAt.slice(0, 4);
  return `${year}/${snapshot.invoiceNumber}-${snapshotHash(snapshot)}.pdf`;
}

/** Deterministic storage name for a credit note (Phase 8): same
 * private invoices directory, the CN number keeps files distinct. */
export function creditNotePdfStorageName(snapshot: CreditNoteSnapshot): string {
  const year = snapshot.creditNoteIssuedAt.slice(0, 4);
  return `${year}/${snapshot.creditNoteNumber}-${snapshotHash(snapshot)}.pdf`;
}

/** Absolute path for a stored name, or null if the name is malformed. */
export function invoicePdfAbsolutePath(
  config: AppConfig,
  storageName: string,
): string | null {
  const parts = storageName.split("/");
  if (parts.length !== 2) return null;
  const [year, file] = parts;
  if (!/^\d{4}$/.test(year) || !STORAGE_NAME_PATTERN.test(file)) return null;
  const base = path.resolve(config.uploadDirectory, "invoices");
  const resolved = path.resolve(base, year, file);
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

/** Read a stored PDF; null when absent (callers regenerate). */
export async function readInvoicePdf(
  config: AppConfig,
  storageName: string,
): Promise<Buffer | null> {
  const absolute = invoicePdfAbsolutePath(config, storageName);
  if (!absolute) return null;
  try {
    return await readFile(absolute);
  } catch {
    return null;
  }
}

/**
 * Resolve the logo pinned in an invoice snapshot (the template
 * version's `logoMediaId`) to image bytes for the PDF renderer.
 * Returns null — the typographic-header fallback — when the template
 * hides the logo, no logo is configured, the asset is missing or
 * soft-deleted, the file is gone, or the format is one PDFKit cannot
 * embed (PNG/JPEG only; media masters can also be WebP/GIF).
 */
export async function resolveInvoiceLogoImage(
  db: Database,
  config: AppConfig,
  snapshot: InvoiceSnapshot,
): Promise<Buffer | null> {
  const cfg = snapshot.template.config;
  const logoMediaId = cfg.logoMediaId ?? snapshot.seller.logoMediaId;
  if (!cfg.show.logo || logoMediaId == null) return null;
  try {
    const resolved = await resolveMediaFile({ db, config }, logoMediaId, "master");
    if (!resolved) return null;
    if (resolved.mimeType !== "image/png" && resolved.mimeType !== "image/jpeg") {
      return null;
    }
    return await readFile(resolved.filePath);
  } catch {
    return null;
  }
}

/** Shared cache-or-render path for both document kinds. */
async function ensureDocumentPdf(
  config: AppConfig,
  storageName: string,
  render: () => Promise<Buffer>,
): Promise<Buffer> {
  const existing = await readInvoicePdf(config, storageName);
  if (existing) return existing;
  const buffer = await render();
  const absolute = invoicePdfAbsolutePath(config, storageName);
  if (absolute) {
    try {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, buffer, { flag: "w" });
    } catch {
      // The cache write is best-effort: the bytes are in hand and any
      // later download re-renders deterministically.
    }
  }
  return buffer;
}

/**
 * Return the PDF bytes for an invoice, rendering + caching them from
 * the snapshot when the stored file is missing.
 */
export async function ensureInvoicePdf(
  config: AppConfig,
  storageName: string,
  snapshot: InvoiceSnapshot,
  logoImage?: Buffer | null,
): Promise<Buffer> {
  return ensureDocumentPdf(config, storageName, () =>
    renderInvoicePdf(snapshot, { logoImage }),
  );
}

/**
 * Return the PDF bytes for a credit note (Phase 8), rendering +
 * caching them from its snapshot when the stored file is missing.
 * The snapshot's embedded template config drives logo resolution the
 * same way as invoices (callers pass the resolved bytes in).
 */
export async function ensureCreditNotePdf(
  config: AppConfig,
  storageName: string,
  snapshot: CreditNoteSnapshot,
  logoImage?: Buffer | null,
): Promise<Buffer> {
  return ensureDocumentPdf(config, storageName, () =>
    renderCreditNotePdf(snapshot, { logoImage }),
  );
}
