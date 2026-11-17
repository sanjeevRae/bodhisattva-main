/**
 * Authorization middleware (PERMISSIONS.md §1, §6–§8; ARCHITECTURE.md §7).
 *
 * `requireAuth` (middleware/auth.ts) authenticates the session and attaches
 * `req.auth` (the AuthContext defined there — this module builds on that
 * exact shape). This module authorizes:
 *
 *  - `requirePermission(db, permission)` — 401 when unauthenticated, 403
 *    FORBIDDEN (shared envelope) when the permission is absent. Effective
 *    permissions are resolved fresh from the database per request (no
 *    cross-request caching — Passenger multi-process rule, amendment A6)
 *    and memoised per auth-context object for that request only.
 *    Denials are written to the audit log (result DENIED, §11.2 rule 4).
 *  - `requireAnyPermission(db, ...permissions)` — any-of variant.
 *  - `requireStepUp()` — PERMISSIONS.md §7 step-up rule: sensitive actions
 *    (invitations, role assignment, MFA reset, settings) require an MFA
 *    verification within the current session no older than the window
 *    (default 15 minutes, from `user_sessions.step_up_at`).
 *  - `assertOwnership(resourceUserId, sessionUserId)` — ownership is
 *    structural (amendment A6): cross-owner access is a 404, never a 403,
 *    so resource existence is not leaked (PERMISSIONS.md §6).
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { Permission } from "@bodhisattva/shared/permissions";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Database } from "../database/client.js";
import { AUDIT_ACTIONS, writeAudit } from "../services/audit.js";
import { getEffectivePermissions } from "../services/permissions.js";
import type { AuthContext } from "./auth.js";

export type { AuthContext } from "./auth.js";
export type { AuthLevel } from "../services/session.js";

/** The request's auth context, or a 401. Use after `requireAuth`. */
export function getAuthContext(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

/** Per-request memo of resolved permission sets, keyed by auth context. */
const permissionMemo = new WeakMap<
  AuthContext,
  ReadonlySet<Permission>
>();

export type PermissionResolver = (
  userId: number,
) => Promise<ReadonlySet<Permission>>;

export interface RequirePermissionHooks {
  /** Called (fire-and-forget) whenever access is denied for a missing permission. */
  onDenied?: (req: Request, permission: Permission) => void;
}

function permissionMiddleware(
  resolve: PermissionResolver,
  hooks: RequirePermissionHooks | undefined,
  required: readonly Permission[],
  mode: "all" | "any",
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      const auth = req.auth;
      if (!auth) throw AppError.unauthenticated();

      let granted = permissionMemo.get(auth);
      if (!granted) {
        granted = await resolve(auth.userId);
        permissionMemo.set(auth, granted);
      }

      const ok =
        mode === "all"
          ? required.every((p) => granted.has(p))
          : required.some((p) => granted.has(p));
      if (!ok) {
        for (const permission of required) {
          if (!granted.has(permission)) hooks?.onDenied?.(req, permission);
        }
        throw AppError.forbidden();
      }
      next();
    })().catch(next);
  };
}

/**
 * Factory form with an injectable resolver (used by tests and by
 * `requirePermission`). The returned factory builds one middleware per
 * permission.
 */
export function createRequirePermission(
  resolve: PermissionResolver,
  hooks?: RequirePermissionHooks,
): (permission: Permission) => RequestHandler {
  return (permission) => permissionMiddleware(resolve, hooks, [permission], "all");
}

function deniedAuditHook(db: Database): RequirePermissionHooks {
  return {
    onDenied: (req, permission) => {
      const auth = req.auth;
      void writeAudit(db, {
        actorId: auth?.userId ?? null,
        actorType: "ADMIN",
        actorEmail: auth?.email ?? null,
        action: AUDIT_ACTIONS.authorizationDenied,
        resourceType: "permission",
        result: "DENIED",
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        metadata: {
          permission,
          method: req.method,
          path: req.originalUrl.slice(0, 200),
        },
      });
    },
  };
}

/** Gate a route on one permission, resolved fresh from the database. */
export function requirePermission(
  db: Database,
  permission: Permission,
): RequestHandler {
  return createRequirePermission(
    (userId) => getEffectivePermissions(db, userId),
    deniedAuditHook(db),
  )(permission);
}

/** Gate a route on holding at least one of the given permissions. */
export function requireAnyPermission(
  db: Database,
  ...permissions: Permission[]
): RequestHandler {
  return permissionMiddleware(
    (userId) => getEffectivePermissions(db, userId),
    deniedAuditHook(db),
    permissions,
    "any",
  );
}

/**
 * Step-up gate (PERMISSIONS.md §7): the session must carry an MFA
 * verification no older than `maxAgeMinutes` (default 15). Applies to
 * invitation creation, role assignment and admin MFA reset.
 */
export function requireStepUp(maxAgeMinutes = 15): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = getAuthContext(req);
      const stepUpAt = auth.stepUpAt;
      const fresh =
        stepUpAt !== null &&
        Date.now() - stepUpAt.getTime() <= maxAgeMinutes * 60_000;
      if (!fresh) {
        throw AppError.forbidden(
          "This action requires a recent MFA verification. Please complete MFA verification and try again.",
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Ownership assertion (amendment A6): when the resource belongs to someone
 * else, the correct response is 404 — the API must not confirm that the
 * resource exists. Accepts numbers or numeric strings (BIGINT ids).
 */
export function assertOwnership(
  resourceUserId: number | string,
  sessionUserId: number | string,
): void {
  if (String(resourceUserId) !== String(sessionUserId)) {
    throw AppError.notFound();
  }
}
