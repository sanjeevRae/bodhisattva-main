/**
 * Audit routes (Phase 7b, PERMISSIONS.md §8 route table).
 *
 * Admin — mount at /api/admin:
 *   GET /audit-logs          audit.read (Super Admin only in the role matrix)
 *   GET /audit-logs/export   audit.read — CSV/XLSX download (2026-11-27)
 *
 * No mutation surface by design: PERMISSIONS.md defines no
 * audit.update or audit.delete permission for any role, and none is
 * routed here. The export is a read that audits itself.
 */
import { buildPaginationMeta, paginationQuerySchema } from "@bodhisattva/shared/pagination";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requirePermission,
} from "../../middleware/authorization.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import {
  EXPORT_ROW_CAP,
  XLSX_CONTENT_TYPE,
  exportHeaders,
  toCsv,
  toXlsx,
} from "../../services/exports.js";
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

  // Audit-log download (2026-11-27) — same audit.read gate (Super
  // Admin only in the matrix). Columns are an explicit allowlist:
  // no user agents and NO raw metadata (it can carry sensitive
  // values). The export writes its own audit row AFTER the data is
  // read, so an export never contains its own event. An over-cap
  // CSV is refused (413) instead of silently truncated; the XLSX
  // flags truncation on its Export info sheet.
  router.get(
    "/audit-logs/export",
    fullSession,
    requirePermission(deps.db, "audit.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const filters = auditLogQuerySchema.parse(req.query);
      const format = req.query.format === "xlsx" ? "xlsx" : "csv";
      const result = await listAuditLogs(deps.db, filters, {
        page: 1,
        pageSize: EXPORT_ROW_CAP + 1,
      });
      const truncated = result.total > EXPORT_ROW_CAP;
      const stamp = new Date().toISOString().slice(0, 10);

      if (format === "csv" && truncated) {
        // Refused exports are audited too (ChatGPT post-review R3).
        const authEarly = getAuthContext(req);
        await writeAudit(deps.db, {
          actorId: authEarly.userId,
          actorType: "ADMIN",
          actorEmail: authEarly.email,
          action: AUDIT_ACTIONS.auditExport,
          resourceType: "audit_log",
          result: "FAILURE",
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
          metadata: {
            format,
            rows: result.total,
            rejected: "EXPORT_TOO_LARGE",
          },
        });
        res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `The current filters match ${result.total} audit rows, over the ${EXPORT_ROW_CAP}-row CSV limit. Narrow the filters, or download the Excel file instead.`,
          },
          requestId: res.locals.requestId,
        });
        return;
      }

      const visible = truncated
        ? result.items.slice(0, EXPORT_ROW_CAP)
        : result.items;
      const headers = [
        "Time (UTC)",
        "Actor",
        "Actor email",
        "Role",
        "Action",
        "Target type",
        "Target ID",
        "Result",
        "IP address",
      ];
      const rows = visible.map((r) => [
        r.createdAt.toISOString(),
        r.actorId ?? "",
        r.actorEmail ?? "",
        r.actorRole ?? "",
        r.action,
        r.targetType ?? "",
        r.targetId ?? "",
        r.result,
        r.ipAddress ?? "",
      ]);

      const auth = getAuthContext(req);
      await writeAudit(deps.db, {
        actorId: auth.userId,
        actorType: "ADMIN",
        actorEmail: auth.email,
        action: AUDIT_ACTIONS.auditExport,
        resourceType: "audit_log",
        result: "SUCCESS",
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        metadata: {
          format,
          rows: visible.length,
          truncated,
          filters: {
            ...(filters.from ? { from: filters.from } : {}),
            ...(filters.to ? { to: filters.to } : {}),
            ...(filters.actor ? { actor: filters.actor } : {}),
            ...(filters.role ? { role: filters.role } : {}),
            ...(filters.action ? { action: filters.action } : {}),
            ...(filters.result ? { result: filters.result } : {}),
            ...(filters.targetType ? { targetType: filters.targetType } : {}),
          },
        },
      });

      if (format === "csv") {
        res.set(
          exportHeaders(
            "text/csv; charset=utf-8",
            `audit-log-${stamp}.csv`,
            false,
          ),
        );
        res.status(200).send(toCsv([headers, ...rows]));
        return;
      }
      const buffer = await toXlsx([
        {
          name: "Export info",
          headers: ["Field", "Value"],
          rows: [
            ["Report", "Audit log"],
            ["Generated at (UTC)", new Date().toISOString()],
            ["Rows matched by filters", result.total],
            ["Rows exported", visible.length],
            ["Truncated at 10000 rows", truncated ? "YES" : "No"],
            ["Columns note", "Allowlist only: no user agents, no raw metadata"],
          ],
        },
        { name: "Audit log", headers, rows },
      ]);
      res.set(exportHeaders(XLSX_CONTENT_TYPE, `audit-log-${stamp}.xlsx`, truncated));
      res.status(200).send(buffer);
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
