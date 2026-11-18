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

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (this router mounts at
 * /health in src/app.ts). Served at /api/docs when API docs are enabled.
 * ======================================================================== */

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Liveness probe
 *     description: Returns 200 whenever the process is up. Never touches the database.
 *     operationId: healthLiveness
 *     security: []
 *     responses:
 *       '200':
 *         description: The process is up.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *               required: [status]
 */

/**
 * @openapi
 * /health/ready:
 *   get:
 *     tags: [System]
 *     summary: Readiness probe
 *     description: Performs a real SELECT 1 through the database pool. Returns 503 with the shared error envelope when the database is unreachable or not configured.
 *     operationId: healthReadiness
 *     security: []
 *     responses:
 *       '200':
 *         description: The database connection is ready.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ready
 *                 database:
 *                   type: string
 *                   example: ok
 *               required: [status, database]
 *       '503':
 *         $ref: '#/components/responses/ServiceUnavailable'
 */
