/**
 * Roles routes (PERMISSIONS.md §8) — mount at `/api/admin`:
 *   GET /roles                  roles.read   → roles with their permissions
 *   GET /users                  roles.read   → paginated user directory
 *                               (Phase 4 delta for the admin SPA: id, email,
 *                               display name, status, roles, last login —
 *                               no credential or token material)
 *   PUT /users/:userId/roles    roles.manage + step-up → assign/replace the
 *                               target's administrative role
 *   DELETE /users/:userId       users.manage + step-up → delete the account
 *                               (tombstone + pseudonymization; see
 *                               roles.service deleteUser)
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
  deleteUser,
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

  router.delete(
    "/users/:userId",
    fullSession,
    requirePermission(deps.db, "users.manage"),
    requireStepUp(),
    asyncHandler(async (req, res) => {
      const result = await deleteUser(
        deps,
        getAuthContext(req),
        parseUserIdParam(req.params.userId),
        requestMeta(req),
      );
      res.status(200).json({
        ...result,
        message:
          "User deleted. The account can no longer sign in and its email address is free to use again.",
      });
    }),
  );

  return router;
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (this router mounts at
 * /api/admin in src/app.ts). All routes require a full admin session;
 * the mutation also requires the X-CSRF-Token header and a recent
 * step-up.
 * ======================================================================== */

/**
 * @openapi
 * /api/admin/roles:
 *   get:
 *     tags: [Roles & Users]
 *     summary: List roles and their permissions
 *     description: Requires the roles.read permission.
 *     operationId: rolesList
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: Roles with their permission sets.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ItemsResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Roles & Users]
 *     summary: List users
 *     description: Requires the roles.read permission.
 *     operationId: usersList
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *     responses:
 *       '200':
 *         description: Paginated users.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ItemsResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/users/{userId}/roles:
 *   put:
 *     tags: [Roles & Users]
 *     summary: Assign a user's role
 *     description: Replaces the user's role and revokes their existing sessions. Requires the roles.manage permission and a recent step-up. The Super Admin cap (3) applies — promoting beyond it conflicts.
 *     operationId: usersAssignRole
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssignRoleRequest'
 *     responses:
 *       '200':
 *         description: Role assignment result, with a human-readable message.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/users/{userId}:
 *   delete:
 *     tags: [Roles & Users]
 *     summary: Delete a user account
 *     description: Tombstones and pseudonymizes the account (the row is kept for order and audit history; the identity, credentials, roles, cart and saved addresses are removed and all sessions are revoked). Requires the users.manage permission and a recent step-up. An account cannot delete itself, a lower-ranked actor cannot delete a higher-ranked account, and the last active Super Admin cannot be deleted.
 *     operationId: usersDelete
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Deletion result, with a human-readable message.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */
