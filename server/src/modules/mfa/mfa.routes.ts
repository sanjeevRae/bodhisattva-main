/**
 * MFA routes (PERMISSIONS.md §7–§8).
 *
 * Session router — mount at `/api/auth/mfa`:
 *   POST /enrol    session at enrolment_required or full (admin roles)
 *   POST /confirm  session at enrolment_required or full
 *   POST /verify   session at mfa_pending (post-password, pre-MFA)
 *   POST /recover  session at mfa_pending
 *
 * Admin router — mount at `/api/admin/mfa`:
 *   POST /reset/:userId   users.manage + step-up (Super Admin in practice)
 *
 * Limited sessions (mfa_pending / enrolment_required) may reach ONLY these
 * endpoints — every other route family requires auth_level "full".
 */
import { AppError } from "@bodhisattva/shared/errors";
import { Router, type Request } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import { sessionCookieName } from "../../services/session.js";
import {
  getAuthContext,
  requirePermission,
  requireStepUp,
} from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { recoveryCodeSchema, totpCodeSchema } from "./mfa.schemas.js";
import {
  confirmMfa,
  enrolMfa,
  recoverMfa,
  resetMfaForUser,
  verifyMfa,
  type RequestMeta,
} from "./mfa.service.js";

export interface MfaRouterDeps {
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

/** The caller's current raw session token (needed for rotation). */
function rawSessionToken(req: Request, deps: MfaRouterDeps): string {
  const raw = req.cookies?.[sessionCookieName(deps.config)];
  if (typeof raw !== "string" || raw.length === 0) {
    throw AppError.unauthenticated();
  }
  return raw;
}

export function createMfaRouter(deps: MfaRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const enrolmentSession = requireAuth({
    allowLevels: ["enrolment_required", "full"],
  });
  const pendingSession = requireAuth({ allowLevels: ["mfa_pending"] });

  router.post(
    "/enrol",
    enrolmentSession,
    asyncHandler(async (req, res) => {
      const result = await enrolMfa(deps, getAuthContext(req), requestMeta(req));
      res.status(200).json({
        ...result,
        message:
          "Scan the QR code (or enter the secret) in your authenticator app, then confirm with a code. The secret is shown only once.",
      });
    }),
  );

  router.post(
    "/confirm",
    enrolmentSession,
    asyncHandler(async (req, res) => {
      const { code } = totpCodeSchema.parse(req.body);
      const result = await confirmMfa(
        deps,
        getAuthContext(req),
        code,
        { rawToken: rawSessionToken(req, deps), res },
        requestMeta(req),
      );
      res.status(200).json({
        recoveryCodes: result.recoveryCodes,
        message:
          "Two-factor authentication is enabled. Store these recovery codes somewhere safe — each works once, and they are shown only once.",
      });
    }),
  );

  router.post(
    "/verify",
    pendingSession,
    asyncHandler(async (req, res) => {
      const { code } = totpCodeSchema.parse(req.body);
      const result = await verifyMfa(
        deps,
        getAuthContext(req),
        code,
        { rawToken: rawSessionToken(req, deps), res },
        requestMeta(req),
      );
      res.status(200).json(result);
    }),
  );

  router.post(
    "/recover",
    pendingSession,
    asyncHandler(async (req, res) => {
      const { recoveryCode } = recoveryCodeSchema.parse(req.body);
      const result = await recoverMfa(
        deps,
        getAuthContext(req),
        recoveryCode,
        { rawToken: rawSessionToken(req, deps), res },
        requestMeta(req),
      );
      res.status(200).json({
        ...result,
        message:
          "Recovery code accepted. This event has been flagged for administrator review.",
      });
    }),
  );

  return router;
}

export function createAdminMfaRouter(deps: MfaRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);

  router.post(
    "/reset/:userId",
    requireAuth({ allowLevels: ["full"] }),
    requirePermission(deps.db, "users.manage"),
    requireStepUp(),
    asyncHandler(async (req, res) => {
      const result = await resetMfaForUser(
        deps,
        getAuthContext(req),
        parseUserIdParam(req.params.userId),
        requestMeta(req),
      );
      res.status(200).json({
        ...result,
        message:
          "MFA has been reset. The user must enrol again at their next login; all their sessions were revoked.",
      });
    }),
  );

  return router;
}
