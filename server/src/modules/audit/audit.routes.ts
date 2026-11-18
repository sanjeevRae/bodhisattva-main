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

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (this router mounts at
 * /api/admin in src/app.ts). The audit log is read-only by design.
 * ======================================================================== */

/**
 * @openapi
 * /api/admin/audit-logs:
 *   get:
 *     tags: [Audit]
 *     summary: Query the audit log
 *     description: Read-only record of security and admin events. Requires a full session and the audit.read permission (Super Admin only in the role matrix). The action filter matches by prefix, so action=store.orders matches store.orders.approve, .cancel and .update, and action=auth matches every auth event.
 *     operationId: auditList
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - name: from
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *         description: ISO date or timestamp bounding created_at from below.
 *       - name: to
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *         description: ISO date or timestamp bounding created_at from above.
 *       - name: actor
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 254
 *         description: Numeric value matches the actor id; anything else matches a substring of the actor email snapshot.
 *       - name: role
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *         description: Exact actor role snapshot (SUPER_ADMIN, ADMIN, STORE_ADMIN, CUSTOMER or SYSTEM).
 *       - name: action
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 80
 *         description: Action prefix, doubling as the module filter.
 *       - name: result
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [SUCCESS, FAILURE, DENIED]
 *       - name: targetType
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *     responses:
 *       '200':
 *         description: Paginated audit entries.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */
