/**
 * Roles routes (PERMISSIONS.md §8) — mount at `/api/admin`:
 *   GET /roles                  roles.read   → roles with their permissions
 *   GET /users                  roles.read   → paginated user directory
 *                               (Phase 4 delta for the admin SPA: id, email,
 *                               display name, status, roles, last login —
 *                               no credential or token material)
 *   PUT /users/:userId/roles    roles.manage + step-up → assign/replace the
 *                               target's administrative role
 */
import { AppError } from "@bodhisattva/shared/errors";
import { paginationQuerySchema } from "@bodhisattva/shared/pagination";
import { Router, type Request } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requirePermission,
  requireStepUp,
} from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { assignRoleSchema } from "./roles.schemas.js";
import {
  assignRole,
  listRoles,
  listUsers,
  type RequestMeta,
} from "./roles.service.js";

export interface RolesRouterDeps {
  db: Database;
  config: AppConfig;
}

function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

function parseUserIdParam(raw: string | string[]): number {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw AppError.notFound("User not found.");
  }
  return id;
}

export function createRolesRouter(deps: RolesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });

  router.get(
    "/roles",
    fullSession,
    requirePermission(deps.db, "roles.read"),
    asyncHandler(async (_req, res) => {
      const roles = await listRoles(deps.db);
      res.status(200).json({ items: roles });
    }),
  );

  router.get(
    "/users",
    fullSession,
    requirePermission(deps.db, "roles.read"),
    asyncHandler(async (req, res) => {
      const pagination = paginationQuerySchema.parse(req.query);
      const { items, total } = await listUsers(deps.db, pagination);
      res.status(200).json({
        items,
        meta: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
        },
      });
    }),
  );

  router.put(
    "/users/:userId/roles",
    fullSession,
    requirePermission(deps.db, "roles.manage"),
    requireStepUp(),
    asyncHandler(async (req, res) => {
      const { role } = assignRoleSchema.parse(req.body);
      const result = await assignRole(
        deps,
        getAuthContext(req),
        parseUserIdParam(req.params.userId),
        role,
        requestMeta(req),
      );
      res.status(200).json({
        ...result,
        message: result.changed
          ? "Role updated. The user's existing sessions were revoked."
          : "The user already holds this role; nothing changed.",
      });
    }),
  );

  return router;
}
