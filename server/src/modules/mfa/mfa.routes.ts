/**
 * MFA routes (PERMISSIONS.md §7–§8).
 *
 * Session router — mount at `/api/auth/mfa`:
 *   POST /enrol    session at enrolment_required or full (admin roles)
 *   POST /confirm  session at enrolment_required or full
 *   POST /verify   session at mfa_pending (post-password, pre-MFA)
 *   POST /recover  session at mfa_pending
 *   POST /step-up  session at full (admin roles) — refresh the step-up
 *                  stamp in place when requireStepUp's window has lapsed
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
  stepUpMfa,
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
  const fullSession = requireAuth({ allowLevels: ["full"] });

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

  router.post(
    "/step-up",
    fullSession,
    asyncHandler(async (req, res) => {
      const { code } = totpCodeSchema.parse(req.body);
      const result = await stepUpMfa(
        deps,
        getAuthContext(req),
        code,
        requestMeta(req),
      );
      res.status(200).json({
        ...result,
        message:
          "Verification complete. Your session is refreshed for sensitive actions — you can retry the action now.",
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

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (the user router mounts at
 * /api/auth/mfa and the admin router at /api/admin/mfa in src/app.ts).
 * Every route here requires the session cookie and the X-CSRF-Token
 * header; each route also pins the session auth levels it serves.
 * ======================================================================== */

/**
 * @openapi
 * /api/auth/mfa/enrol:
 *   post:
 *     tags: [MFA]
 *     summary: Begin TOTP enrolment
 *     description: Generates a fresh TOTP secret for the signed-in admin (session level enrolment_required, or full for re-enrolment) and returns it with the otpauth URL for the authenticator app. Confirm with POST /api/auth/mfa/confirm.
 *     operationId: mfaEnrol
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     responses:
 *       '200':
 *         description: Enrolment secret issued.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MfaEnrolResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/auth/mfa/confirm:
 *   post:
 *     tags: [MFA]
 *     summary: Confirm TOTP enrolment with a code
 *     description: Verifies the first code from the authenticator app, activates MFA and returns the one-time recovery codes.
 *     operationId: mfaConfirm
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TotpCodeRequest'
 *     responses:
 *       '200':
 *         description: MFA active; recovery codes issued once.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MfaConfirmResponse'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/mfa/verify:
 *   post:
 *     tags: [MFA]
 *     summary: Verify a TOTP code at login
 *     description: Completes the MFA step for a session at level mfa_pending, raising it to full.
 *     operationId: mfaVerify
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TotpCodeRequest'
 *     responses:
 *       '200':
 *         description: Session raised to full.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authLevel:
 *                   type: string
 *                   example: full
 *               required: [authLevel]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/mfa/recover:
 *   post:
 *     tags: [MFA]
 *     summary: Recover a session with a recovery code
 *     description: Alternative to TOTP verification for a session at level mfa_pending. The recovery code is consumed on use.
 *     operationId: mfaRecover
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RecoveryCodeRequest'
 *     responses:
 *       '200':
 *         description: Session raised to full.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authLevel:
 *                   type: string
 *                   example: full
 *               required: [authLevel]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/mfa/step-up:
 *   post:
 *     tags: [MFA]
 *     summary: Step-up verification for sensitive admin actions
 *     description: Re-verifies the TOTP code on a full session and stamps the step-up time; privileged routes (role assignment, invitation create, MFA reset) require a recent step-up.
 *     operationId: mfaStepUp
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TotpCodeRequest'
 *     responses:
 *       '200':
 *         description: Step-up recorded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stepUpAt:
 *                   type: string
 *                   format: date-time
 *               required: [stepUpAt]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/admin/mfa/reset/{userId}:
 *   post:
 *     tags: [MFA]
 *     summary: Reset another user's MFA (admin)
 *     description: Clears the target user's TOTP credential and recovery codes so they must re-enrol at next login. Requires a full session, the users.manage permission and a recent step-up.
 *     operationId: mfaAdminReset
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
 *         description: MFA reset for the target user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: integer
 *                 mfaReset:
 *                   type: boolean
 *                   example: true
 *               required: [userId, mfaReset]
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
