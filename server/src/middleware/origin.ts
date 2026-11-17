/**
 * Origin validation for state-changing API requests (Phase 2 review fix).
 *
 * The double-submit CSRF cookie is not session-bound, so as defence in
 * depth every POST/PUT/PATCH/DELETE under /api that carries an Origin
 * header must match the configured CORS allowlist exactly. Browsers send
 * Origin on all cross-origin and same-origin POSTs, so a forged request
 * from another site is rejected here even before the CSRF check. Requests
 * WITHOUT an Origin header (curl, server-to-server, some same-origin GET-
 * style flows) are allowed through: they cannot be classic browser CSRF,
 * and the CSRF token check still applies to session-bearing mutations.
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config/env.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createOriginCheck(config: AppConfig) {
  const allowed = new Set(config.corsOrigins);
  return function originCheck(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (!STATE_CHANGING.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin === undefined) return next();
    if (!allowed.has(origin)) {
      return next(
        new AppError("FORBIDDEN", "Request origin is not allowed."),
      );
    }
    return next();
  };
}
