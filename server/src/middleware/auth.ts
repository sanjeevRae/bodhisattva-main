/**
 * Authentication middleware (spec §7.2, PERMISSIONS.md: backend
 * authorization on every endpoint — menu visibility is not authorization).
 *
 * `createRequireAuth(deps)` returns a `requireAuth(options?)` factory:
 *
 *   router.get("/me", requireAuth({ allowLevels: ALL_AUTH_LEVELS }), …)
 *   router.post("/orders", requireAuth(), …)            // default: full only
 *
 * Default `allowLevels` is ['full']: a session that is still gated
 * ('mfa_pending' — admin must submit TOTP; 'enrolment_required' — admin
 * must enrol MFA first) is authenticated but NOT authorised for general
 * endpoints, and receives 403 so the SPA can route the user to the right
 * step. The MFA module's own routes opt into the levels they serve:
 * enrolment routes allow 'enrolment_required' (+ 'full' for re-enrolment),
 * verification routes allow 'mfa_pending'.
 *
 * On success the handler attaches `req.auth` (see AuthContext). Use
 * getAuth(req) in controllers/services that run behind requireAuth.
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../database/client.js";
import {
  clearSessionCookie,
  createSessionService,
  sessionCookieName,
  type AuthLevel,
} from "../services/session.js";

export interface AuthContext {
  userId: number;
  sessionId: number;
  authLevel: string;
  roles: string[];
  isAdmin: boolean;
  email: string;
  fullName: string;
  stepUpAt: Date | null;
}

export const ALL_AUTH_LEVELS: AuthLevel[] = [
  "full",
  "mfa_pending",
  "enrolment_required",
];

export interface RequireAuthOptions {
  /** Session auth levels allowed on this route. Default: ['full']. */
  allowLevels?: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** The AuthContext attached by requireAuth; throws when absent. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

export function createRequireAuth(deps: {
  db: Database;
  config: AppConfig;
}): (options?: RequireAuthOptions) => RequestHandler {
  const sessions = createSessionService(deps);

  return function requireAuth(options?: RequireAuthOptions): RequestHandler {
    const allowLevels = options?.allowLevels ?? ["full"];
    return (req: Request, res: Response, next: NextFunction): void => {
      void (async () => {
        const rawToken = req.cookies?.[sessionCookieName(deps.config)];
        if (typeof rawToken !== "string" || rawToken.length === 0) {
          throw AppError.unauthenticated();
        }
        const validated = await sessions.validateSession(rawToken);
        if (!validated) {
          clearSessionCookie(res, deps.config);
          throw AppError.unauthenticated(
            "Your session has expired. Please sign in again.",
          );
        }
        req.auth = {
          userId: validated.userId,
          sessionId: validated.sessionId,
          authLevel: validated.authLevel,
          roles: validated.roles,
          isAdmin: validated.isAdmin,
          email: validated.user.email,
          fullName: validated.user.fullName,
          stepUpAt: validated.stepUpAt,
        };
        if (!allowLevels.includes(validated.authLevel)) {
          throw new AppError(
            "FORBIDDEN",
            validated.authLevel === "mfa_pending"
              ? "Multi-factor verification is required to continue."
              : "Multi-factor enrolment is required to continue.",
            [{ field: "auth_level", issue: validated.authLevel }],
          );
        }
        next();
      })().catch(next);
    };
  };
}
