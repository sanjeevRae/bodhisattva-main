/**
 * Invitations routes (PERMISSIONS.md §8).
 *
 * Admin router — mount at `/api/admin/invitations`:
 *   POST /            invitations.create + step-up (Super Admin in practice)
 *   GET  /            invitations.read
 *   POST /:id/revoke  invitations.revoke
 *
 * Accept router — mount at `/api/auth/invitations`:
 *   POST /accept      public (the emailed token is the credential)
 *
 * All `/api/admin/*` routes require an MFA-completed session, which
 * `requireAuth({ allowLevels: ["full"] })` enforces for admin roles.
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
import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "./invitations.schemas.js";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
  type RequestMeta,
} from "./invitations.service.js";

export interface InvitationsRouterDeps {
  db: Database;
  config: AppConfig;
}

function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

function parseIdParam(raw: string | string[]): number {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw AppError.notFound("Invitation not found.");
  }
  return id;
}

export function createAdminInvitationsRouter(
  deps: InvitationsRouterDeps,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });

  router.post(
    "/",
    fullSession,
    requirePermission(deps.db, "invitations.create"),
    requireStepUp(),
    asyncHandler(async (req, res) => {
      const input = createInvitationSchema.parse(req.body);
      const view = await createInvitation(
        deps,
        getAuthContext(req),
        input,
        requestMeta(req),
      );
      res.status(201).json(view);
    }),
  );

  router.get(
    "/",
    fullSession,
    requirePermission(deps.db, "invitations.read"),
    asyncHandler(async (req, res) => {
      const pagination = paginationQuerySchema.parse(req.query);
      const { items, total } = await listInvitations(deps, pagination);
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

  router.post(
    "/:id/revoke",
    fullSession,
    requirePermission(deps.db, "invitations.revoke"),
    asyncHandler(async (req, res) => {
      const view = await revokeInvitation(
        deps,
        getAuthContext(req),
        parseIdParam(req.params.id),
        requestMeta(req),
      );
      res.status(200).json(view);
    }),
  );

  return router;
}

export function createInvitationAcceptRouter(
  deps: InvitationsRouterDeps,
): Router {
  const router = Router();

  router.post(
    "/accept",
    asyncHandler(async (req, res) => {
      const input = acceptInvitationSchema.parse(req.body);
      const result = await acceptInvitation(deps, input, requestMeta(req));
      res.status(201).json({
        ...result,
        message:
          "Account created. Please log in — you will be asked to enrol in two-factor authentication.",
      });
    }),
  );

  return router;
}
