/**
 * Auth routes — mounted at /api/auth by app.ts.
 *
 * Public (pre-session, CSRF-exempt by design — see middleware/csrf.ts):
 *   POST /register, /verify-email, /resend-verification, /login,
 *   POST /password-reset/request, /password-reset/confirm,
 *   GET  /csrf-token
 * Session-required (any level — a gated admin must be able to see /me and
 * to log out; general endpoints elsewhere default to 'full' only):
 *   POST /logout, /logout-all, GET /me
 */
import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { ALL_AUTH_LEVELS, createRequireAuth } from "../../middleware/auth.js";
import type { Mailer } from "../../services/mailer.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { createAuthController } from "./controller.js";
import { createAuthService } from "./service.js";
import type { Logger } from "pino";

export interface AuthRouterDeps {
  db: Database;
  config: AppConfig;
  mailer: Mailer;
  logger: Logger;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const service = createAuthService(deps);
  const controller = createAuthController({ service, config: deps.config });
  const requireAuth = createRequireAuth(deps);
  const anyLevel = requireAuth({ allowLevels: ALL_AUTH_LEVELS });

  const router = Router();

  router.post("/register", asyncHandler(controller.register));
  router.post("/verify-email", asyncHandler(controller.verifyEmail));
  router.post(
    "/resend-verification",
    asyncHandler(controller.resendVerification),
  );
  router.post("/login", asyncHandler(controller.login));
  router.post(
    "/password-reset/request",
    asyncHandler(controller.passwordResetRequest),
  );
  router.post(
    "/password-reset/confirm",
    asyncHandler(controller.passwordResetConfirm),
  );
  router.get("/csrf-token", asyncHandler(controller.csrfToken));

  router.post("/logout", anyLevel, asyncHandler(controller.logout));
  router.post("/logout-all", anyLevel, asyncHandler(controller.logoutAll));
  router.get("/me", anyLevel, asyncHandler(controller.me));

  return router;
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (this router mounts at
 * /api/auth in src/app.ts). Served at /api/docs when API docs are enabled.
 *
 * The pre-session posts (register, verify-email, resend-verification,
 * login, password-reset) are deliberately CSRF-exempt — see
 * middleware/csrf.ts — and are protected by rate limits and their own
 * secrets instead. Logout and logout-all require the session cookie and
 * the X-CSRF-Token header.
 * ======================================================================== */

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a customer account
 *     description: Creates an unverified customer account and emails an 8-digit verification code. The response is identical whether or not the email was already registered (no account enumeration). CSRF-exempt pre-session post. Phone is required and is validated against the real numbering plan, then stored in E.164 form.
 *     operationId: authRegister
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       '200':
 *         description: Registration accepted; verification code sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verificationRequired:
 *                   type: boolean
 *                   example: true
 *                 email:
 *                   type: string
 *                   format: email
 *               required: [verificationRequired, email]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/verify-email:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify an email address with the emailed code
 *     operationId: authVerifyEmail
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyEmailRequest'
 *     responses:
 *       '200':
 *         description: Email verified.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified:
 *                   type: boolean
 *                   example: true
 *               required: [verified]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/resend-verification:
 *   post:
 *     tags: [Authentication]
 *     summary: Resend the email verification code
 *     description: Always answers the same body whether or not the email maps to an account.
 *     operationId: authResendVerification
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmailOnlyRequest'
 *     responses:
 *       '200':
 *         description: A new code was sent if the account needs one.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verificationRequired:
 *                   type: boolean
 *                   example: true
 *               required: [verificationRequired]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Log in with email and password
 *     description: On success the API sets the HttpOnly session cookie and the readable csrf cookie, and returns the user, the session authLevel and the csrfToken. Admin accounts may come back with authLevel mfa_pending or enrolment_required plus the matching mfa flag — complete the MFA step before calling general endpoints. CSRF-exempt pre-session post.
 *     operationId: authLogin
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       '200':
 *         description: Logged in; session and CSRF cookies set.
 *         headers:
 *           Set-Cookie:
 *             description: The session cookie (HttpOnly) and the csrf cookie.
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/password-reset/request:
 *   post:
 *     tags: [Authentication]
 *     summary: Request a password reset email
 *     description: Always answers the same body whether or not the email maps to an account. The email links to the website reset page (APP_URL) with a single-use token valid for 60 minutes.
 *     operationId: authPasswordResetRequest
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmailOnlyRequest'
 *     responses:
 *       '200':
 *         description: Reset email sent if the account exists.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 resetRequested:
 *                   type: boolean
 *                   example: true
 *               required: [resetRequested]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @openapi
 * /api/auth/password-reset/confirm:
 *   post:
 *     tags: [Authentication]
 *     summary: Confirm a password reset with the emailed token
 *     description: Sets a new password and revokes all existing sessions for the account.
 *     operationId: authPasswordResetConfirm
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PasswordResetConfirmRequest'
 *     responses:
 *       '200':
 *         description: Password reset completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 passwordReset:
 *                   type: boolean
 *                   example: true
 *               required: [passwordReset]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */

/**
 * @openapi
 * /api/auth/csrf-token:
 *   get:
 *     tags: [Authentication]
 *     summary: Get (or refresh) the CSRF token
 *     description: Returns the current csrf cookie value, issuing a fresh cookie when absent. The SPA echoes this value in the X-CSRF-Token header on state-changing requests.
 *     operationId: authCsrfToken
 *     security: []
 *     responses:
 *       '200':
 *         description: The CSRF token for this browser.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 csrfToken:
 *                   type: string
 *               required: [csrfToken]
 */

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Log out the current session
 *     operationId: authLogout
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     responses:
 *       '200':
 *         description: Session revoked; session and CSRF cookies cleared.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 loggedOut:
 *                   type: boolean
 *                   example: true
 *               required: [loggedOut]
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/auth/logout-all:
 *   post:
 *     tags: [Authentication]
 *     summary: Log out all sessions for the current user
 *     operationId: authLogoutAll
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     responses:
 *       '200':
 *         description: All sessions revoked; session and CSRF cookies cleared.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 loggedOut:
 *                   type: boolean
 *                   example: true
 *               required: [loggedOut]
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Current session identity
 *     description: Returns the signed-in user, the session authLevel and a CSRF token. Accepts any auth level, so the SPA can route MFA-gated sessions to the right step.
 *     operationId: authMe
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: The current user and session state.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MeResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 */
