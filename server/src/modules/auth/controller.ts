/**
 * Auth controller — HTTP concerns only: DTO parsing (strict Zod schemas;
 * failures become VALIDATION_FAILED via the central error handler), cookie
 * issuance/clearing, and response shapes. All logic lives in service.ts.
 *
 * Response-shape discipline (T-22): register / resend-verification /
 * password-reset request always answer with the same body, whether or not
 * the email maps to an account.
 */
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/env.js";
import { getAuth } from "../../middleware/auth.js";
import {
  clearCsrfCookie,
  ensureCsrfToken,
  issueCsrfToken,
} from "../../middleware/csrf.js";
import {
  clearSessionCookie,
  sessionCookieName,
  setSessionCookie,
} from "../../services/session.js";
import type { AuthService, RequestContext } from "./service.js";
import {
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from "./schemas.js";

export interface AuthControllerDeps {
  service: AuthService;
  config: AppConfig;
}

function requestContext(req: Request): RequestContext {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export function createAuthController(deps: AuthControllerDeps) {
  const { service, config } = deps;

  return {
    async register(req: Request, res: Response): Promise<void> {
      const input = registerSchema.parse(req.body);
      const { email } = await service.register(input, requestContext(req));
      res.status(200).json({ verificationRequired: true, email });
    },

    async verifyEmail(req: Request, res: Response): Promise<void> {
      const input = verifyEmailSchema.parse(req.body);
      await service.verifyEmail(input.email, input.code, requestContext(req));
      res.status(200).json({ verified: true });
    },

    async resendVerification(req: Request, res: Response): Promise<void> {
      const input = resendVerificationSchema.parse(req.body);
      await service.resendVerification(input.email, requestContext(req));
      res.status(200).json({ verificationRequired: true });
    },

    async login(req: Request, res: Response): Promise<void> {
      const input = loginSchema.parse(req.body);
      const result = await service.login(input, requestContext(req));
      setSessionCookie(res, config, result.session.rawToken, result.session.expiresAt);
      const csrfToken = issueCsrfToken(res, config);
      res.status(200).json({
        user: result.user,
        authLevel: result.authLevel,
        ...(result.mfaRequired ? { mfaRequired: true } : {}),
        ...(result.mfaEnrolmentRequired ? { mfaEnrolmentRequired: true } : {}),
        csrfToken,
      });
    },

    async logout(req: Request, res: Response): Promise<void> {
      const auth = getAuth(req);
      const rawToken = req.cookies?.[sessionCookieName(config)] ?? "";
      await service.logout(
        rawToken,
        { userId: auth.userId, email: auth.email, isAdmin: auth.isAdmin },
        requestContext(req),
      );
      clearSessionCookie(res, config);
      clearCsrfCookie(res, config);
      res.status(200).json({ loggedOut: true });
    },

    async logoutAll(req: Request, res: Response): Promise<void> {
      const auth = getAuth(req);
      await service.logoutAll(
        { userId: auth.userId, email: auth.email, isAdmin: auth.isAdmin },
        requestContext(req),
      );
      clearSessionCookie(res, config);
      clearCsrfCookie(res, config);
      res.status(200).json({ loggedOut: true });
    },

    async me(req: Request, res: Response): Promise<void> {
      const auth = getAuth(req);
      const csrfToken = ensureCsrfToken(req, res, config);
      res.status(200).json({
        user: {
          id: auth.userId,
          name: auth.fullName,
          email: auth.email,
          roles: auth.roles,
        },
        authLevel: auth.authLevel,
        csrfToken,
      });
    },

    async csrfToken(req: Request, res: Response): Promise<void> {
      const csrfToken = ensureCsrfToken(req, res, config);
      res.status(200).json({ csrfToken });
    },

    async passwordResetRequest(req: Request, res: Response): Promise<void> {
      const input = passwordResetRequestSchema.parse(req.body);
      await service.requestPasswordReset(input.email, requestContext(req));
      res.status(200).json({ resetRequested: true });
    },

    async passwordResetConfirm(req: Request, res: Response): Promise<void> {
      const input = passwordResetConfirmSchema.parse(req.body);
      await service.confirmPasswordReset(input, requestContext(req));
      res.status(200).json({ passwordReset: true });
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
