/**
 * Audit routes (Phase 7b, PERMISSIONS.md §8 route table).
 *
 * Admin — mount at /api/admin:
 *   GET /audit-logs    audit.read (Super Admin only in the role matrix)
 *
 * Read-only by design: PERMISSIONS.md defines no audit.update or
 * audit.delete permission for any role, and none is routed here.
 */
import { buildPaginationMeta, paginationQuerySchema } from "@bodhisattva/shared/pagination";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { auditLogQuerySchema } from "./audit.schemas.js";
import { listAuditLogs } from "./audit.service.js";

export interface AuditRouteDeps {
  db: Database;
  config: AppConfig;
}

const listQuerySchema = paginationQuerySchema.extend(auditLogQuerySchema.shape);

export function createAuditRouter(deps: AuditRouteDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });

  router.get(
    "/audit-logs",
    fullSession,
    requirePermission(deps.db, "audit.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await listAuditLogs(deps.db, query, query);
      res.status(200).json({
        success: true,
        data: result.items,
        meta: buildPaginationMeta(result.total, query),
        requestId: res.locals.requestId,
      });
    }),
  );

  return router;
}
