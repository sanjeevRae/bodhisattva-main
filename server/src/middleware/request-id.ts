/**
 * Request-id middleware (ARCHITECTURE.md §4.3, §6.2).
 *
 * Every request gets an id (`req_<uuid>`), honouring an inbound
 * `X-Request-Id` header when present. The id is echoed on the response and
 * embedded in every error envelope and log line for the request.
 * (`req.id` itself is typed by pino-http's Express augmentation.)
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound = req.header("x-request-id")?.trim();
  req.id = inbound ? inbound : `req_${randomUUID()}`;
  res.setHeader("X-Request-Id", req.id);
  next();
}

export function getRequestId(req: Request): string {
  return typeof req.id === "string" ? req.id : "req_unknown";
}
