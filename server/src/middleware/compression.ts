/**
 * Response-compression policy (2026-11-26 admin speed-up).
 *
 * The `compression` package gzips text responses above its 1 KB
 * threshold and itself honours Cache-Control: no-transform. This
 * filter adds the exclusions the package does NOT apply on its own:
 *  - streamed responses (text/event-stream): compression buffers
 *    chunks, which would stall event delivery;
 *  - invoice PDFs (application/pdf): already compressed, and a
 *    transform layer risks corrupting range/download semantics;
 *  - partial responses (HTTP 206 / Content-Range): compressing an
 *    already-selected byte range breaks range semantics;
 *  - an explicit x-no-compression request header (the package's docs
 *    show this as a custom-filter convention — it is not built in).
 */
import compression from "compression";
import type { Request, Response } from "express";

export function shouldCompress(req: Request, res: Response): boolean {
  if (req.headers["x-no-compression"]) return false;
  if (res.statusCode === 206 || res.hasHeader("Content-Range")) {
    return false;
  }
  const type = res.getHeader("Content-Type");
  if (
    typeof type === "string" &&
    (type.includes("text/event-stream") ||
      type.includes("application/pdf") ||
      // XLSX exports are ZIP containers — already compressed.
      type.includes("spreadsheetml.sheet"))
  ) {
    return false;
  }
  return compression.filter(req, res);
}
