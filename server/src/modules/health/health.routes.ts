/**
 * Health module (Phase 1 deliverable, DEVELOPMENT_ROADMAP.md §3).
 *
 * GET /health        — liveness: the process is up. Never touches the DB.
 * GET /health/ready  — readiness: performs a real `SELECT 1` through the
 *                      injected database handle. Returns 503 with the shared
 *                      error envelope when the database is unreachable or
 *                      not configured.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler.js";

/** Structural probe so this module never imports the database client. */
export interface ReadinessProbe {
  ping: () => Promise<void>;
}

export interface HealthDeps {
  database?: ReadinessProbe;
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      if (!deps.database) {
        throw new AppError("SERVICE_UNAVAILABLE", "Database is not configured.");
      }
      try {
        await deps.database.ping();
      } catch (cause) {
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "Database connection is not ready.",
          undefined,
          { cause },
        );
      }
      res.status(200).json({ status: "ready", database: "ok" });
    }),
  );

  return router;
}
