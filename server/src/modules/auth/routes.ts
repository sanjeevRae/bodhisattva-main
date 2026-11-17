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
