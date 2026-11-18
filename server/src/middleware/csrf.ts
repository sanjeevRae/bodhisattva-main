/**
 * CSRF protection — double-submit cookie (spec §15.5).
 *
 * Design: at login (and on demand via GET /api/auth/csrf-token) the server
 * issues a random token in a NON-HttpOnly `csrf` cookie — the SPA reads the
 * cookie (or the /csrf-token and /me responses) and must echo the value in
 * the `X-CSRF-Token` header on every state-changing /api request. The
 * middleware compares header and cookie in constant time. A cross-site
 * attacker can make the browser SEND the cookies but cannot READ the csrf
 * cookie (same-origin policy), so they cannot produce the header. The
 * session cookie's SameSite=Lax is defence in depth, not the mechanism.
 *
 * EXEMPTIONS (pre-session public auth posts): these run before any session
 * exists, so there is no ambient authority for CSRF to abuse; each is
 * protected by rate limits and by its own secret (OTP / reset token):
 *   POST /api/auth/register
 *   POST /api/auth/verify-email
 *   POST /api/auth/resend-verification
 *   POST /api/auth/login
 *   POST /api/auth/password-reset/request
 *   POST /api/auth/password-reset/confirm
 * Safe methods (GET/HEAD/OPTIONS) are never checked. Everything else under
 * /api/ that changes state — logout, MFA, invitations, admin, CMS, store —
 * requires the header. If you add a public pre-session POST endpoint, add
 * it here deliberately and document why.
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppConfig } from "../config/env.js";
import { constantTimeEqual, generateToken } from "../utils/tokens.js";

export const CSRF_COOKIE_NAME = "csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const EXEMPT_PATHS = new Set([
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/login",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/confirm",
  // Invitation acceptance is pre-session: the one-time invitation token is
  // the credential (same class as password-reset/confirm). Added by the lead
  // at Phase 2 integration — without it, a fresh invitee with no cookies
  // would be 403-blocked from ever accepting.
  "/api/auth/invitations/accept",
  // About-page contact form (migration 0012): a public, unauthenticated
  // endpoint by design — there is no session and no ambient authority for
  // CSRF to abuse (the request carries no credentials and can only send a
  // message to the site's own configured mailbox). Its protections are
  // the global Origin check, MySQL-backed rate limits, the honeypot and,
  // when configured, Turnstile server-side verification.
  "/api/contact",
]);

function csrfCookieOptions(config: AppConfig) {
  return {
    httpOnly: false, // the SPA must read it to echo it back as a header
    sameSite: "lax" as const,
    path: "/",
    secure: config.isProduction,
  };
}

/** Issue a fresh CSRF token: set the cookie and return the value. */
export function issueCsrfToken(res: Response, config: AppConfig): string {
  const { raw } = generateToken(32);
  res.cookie(CSRF_COOKIE_NAME, raw, {
    ...csrfCookieOptions(config),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return raw;
}

/** Return the request's CSRF cookie value, issuing one if absent. */
export function ensureCsrfToken(
  req: Request,
  res: Response,
  config: AppConfig,
): string {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  if (typeof existing === "string" && existing.length > 0) return existing;
  return issueCsrfToken(res, config);
}

export function clearCsrfCookie(res: Response, config: AppConfig): void {
  res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions(config));
}

export function csrfProtection(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      next();
      return;
    }
    const path = new URL(req.originalUrl, "http://internal").pathname;
    if (!path.startsWith("/api/") || EXEMPT_PATHS.has(path)) {
      next();
      return;
    }
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.header(CSRF_HEADER_NAME);
    if (
      typeof cookieToken !== "string" ||
      cookieToken.length === 0 ||
      typeof headerToken !== "string" ||
      !constantTimeEqual(headerToken, cookieToken)
    ) {
      next(
        new AppError(
          "FORBIDDEN",
          "Invalid or missing CSRF token. Refresh the page and try again.",
        ),
      );
      return;
    }
    next();
  };
}
