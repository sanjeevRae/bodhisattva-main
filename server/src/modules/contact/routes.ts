/**
 * Contact-module routes (migration 0012):
 *
 *   POST /api/contact — public, unauthenticated About-page form.
 *
 * Protection stack, in request order: the app's global Origin check
 * (state-changing requests must come from an allowlisted origin) →
 * this module's CSRF exemption is deliberate (see middleware/csrf.ts:
 * a pre-session public POST with no ambient authority; protections are
 * Origin + rate limits + honeypot + Turnstile) → strict Zod schema →
 * the service flow (honeypot, rate limits, subject allowlist,
 * Turnstile, persist, send).
 */
import type { Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import type { Mailer } from "../../services/mailer.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { contactSubmissionSchema } from "./schemas.js";
import { createContactService } from "./service.js";

export interface ContactRouterDeps {
  db: Database;
  config: AppConfig;
  mailer: Mailer;
  logger: Logger;
}

export function createContactRouter(deps: ContactRouterDeps): Router {
  const service = createContactService(deps);
  const router = Router();

  router.post(
    "/contact",
    asyncHandler(async (req: Request, res: Response) => {
      const input = contactSubmissionSchema.parse(req.body);
      const result = await service.submit(input, {
        ipAddress: req.ip ?? null,
      });
      res.status(200).json({
        success: true,
        data: result,
        requestId: res.locals.requestId,
      });
    }),
  );

  // Any other method on /contact answers 405 here instead of falling
  // through to the session-guarded routers mounted after this one at
  // /api (which misleadingly answered 401 — QA defect D-2).
  router.all("/contact", (_req: Request, res: Response) => {
    res.set("Allow", "POST");
    res.status(405).json({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      requestId: res.locals.requestId,
    });
  });

  return router;
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Path is the full public path (this router mounts at /api).
 * ======================================================================== */

/**
 * @openapi
 * /api/contact:
 *   post:
 *     tags: [Contact]
 *     summary: Submit the About-page contact form
 *     description: Public and unauthenticated, and deliberately CSRF-exempt (no session exists to protect). Protections, in order — the global Origin check (the Origin header must be allowlisted), strict validation, MySQL-backed rate limits (3 per 10 minutes and 5 per hour per IP, 5 per hour per email), a honeypot field that silently discards bot submissions while returning the normal success shape, and Cloudflare Turnstile server-side verification when TURNSTILE_SECRET_KEY is configured. The message is stored (contact_submissions) and emailed from the configured alerts@ identity to the configured info@ mailbox with the visitor address as Reply-To. Sender and recipient come from server configuration only — routing fields in the body are rejected.
 *     operationId: contactSubmit
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ContactRequest'
 *     responses:
 *       '200':
 *         description: Submission accepted (also the shape returned for honeypot-discarded bot submissions).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     submitted:
 *                       type: boolean
 *                       example: true
 *                   required: [submitted]
 *                 requestId:
 *                   type: string
 *               required: [success, data]
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '429':
 *         $ref: '#/components/responses/TooManyRequests'
 *       '503':
 *         $ref: '#/components/responses/ServiceUnavailable'
 */
