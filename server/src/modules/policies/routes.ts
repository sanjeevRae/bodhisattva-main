import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "@bodhisattva/shared/errors";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import { getAuthContext, requirePermission } from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  policySlugSchema,
  restorePolicySchema,
  updatePolicySchema,
  type PolicySlug,
} from "./schemas.js";
import * as service from "./service.js";

/**
 * Policy routes (legal pages feature, 2026-11-20).
 * Public: GET /api/policies/:slug — one of the three fixed pages.
 * Admin (mounted at /api/admin): list/get/update + revision history
 * and restore, behind a full (MFA-completed) session + the
 * policy.manage permission. CSRF + origin checks are the platform's
 * global middleware, as for every admin write.
 */

export interface PolicyRouteDeps {
  db: Database;
  config: AppConfig;
}

const revisionIdSchema = z.coerce.number().int().positive();

function requestMeta(req: Request): service.RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function actorOf(req: Request): service.PolicyActor {
  const auth = getAuthContext(req);
  return { userId: auth.userId, email: auth.email };
}

function parseSlug(req: Request): PolicySlug {
  const parsed = policySlugSchema.safeParse(req.params.slug);
  if (!parsed.success) throw AppError.notFound("Policy page not found.");
  return parsed.data;
}

export function createPolicyPublicRouter(deps: PolicyRouteDeps): Router {
  const router = Router();

  /**
   * @openapi
   * /api/policies/{slug}:
   *   get:
   *     tags: [Policies]
   *     summary: One legal policy page (public)
   *     description: Returns one of the three fixed policy pages (privacy-policy, terms-of-use, accessibility) with its body HTML sanitized. Unknown slugs are 404. Sent with Cache-Control no-store so admin edits take effect immediately.
   *     operationId: policyPublicGet
   *     security: []
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, enum: [privacy-policy, terms-of-use, accessibility] }
   *     responses:
   *       '200':
   *         description: The policy page in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   *       '404':
   *         description: Unknown slug.
   */
  router.get(
    "/policies/:slug",
    asyncHandler(async (req: Request, res: Response) => {
      const policy = await service.getPublicPolicy({ db: deps.db }, parseSlug(req));
      res.set("Cache-Control", "no-store");
      res.status(200).json({ success: true, data: policy, requestId: res.locals.requestId });
    }),
  );

  return router;
}

export function createPolicyAdminRouter(deps: PolicyRouteDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });
  const policyPerm = requirePermission(deps.db, "policy.manage");
  const svc = (): service.PolicyDeps => ({ db: deps.db });

  /**
   * @openapi
   * /api/admin/policies:
   *   get:
   *     tags: [Policies]
   *     summary: List the three policy pages (admin)
   *     operationId: policyAdminList
   *     responses:
   *       '200':
   *         description: The three policy pages in fixed order, in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.get(
    "/policies",
    fullSession,
    policyPerm,
    asyncHandler(async (_req: Request, res: Response) => {
      const policies = await service.listAdminPolicies(svc());
      res.status(200).json({ success: true, data: policies, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/policies/{slug}:
   *   get:
   *     tags: [Policies]
   *     summary: Get one policy page for editing (admin)
   *     operationId: policyAdminGet
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, enum: [privacy-policy, terms-of-use, accessibility] }
   *     responses:
   *       '200':
   *         description: The policy page in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   *   put:
   *     tags: [Policies]
   *     summary: Update and publish a policy page (admin)
   *     description: Saving publishes immediately. The previous content is snapshotted as a revision in the same transaction. The body's version must match the version the editor loaded, or the update is a 409 conflict.
   *     operationId: policyAdminUpdate
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, enum: [privacy-policy, terms-of-use, accessibility] }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [title, bodyHtml, version]
   *             additionalProperties: false
   *             properties:
   *               title: { type: string, maxLength: 160 }
   *               bodyHtml: { type: string, maxLength: 500000 }
   *               version: { type: integer, minimum: 1 }
   *     responses:
   *       '200':
   *         description: The updated policy page in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   *       '409':
   *         description: The page changed since it was loaded (optimistic concurrency).
   */
  router.get(
    "/policies/:slug",
    fullSession,
    policyPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const policy = await service.getAdminPolicy(svc(), parseSlug(req));
      res.status(200).json({ success: true, data: policy, requestId: res.locals.requestId });
    }),
  );

  router.put(
    "/policies/:slug",
    fullSession,
    policyPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const input = updatePolicySchema.parse(req.body);
      const policy = await service.updatePolicy(
        svc(),
        actorOf(req),
        requestMeta(req),
        parseSlug(req),
        input,
      );
      res.status(200).json({ success: true, data: policy, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/policies/{slug}/revisions:
   *   get:
   *     tags: [Policies]
   *     summary: Revision history of a policy page (admin)
   *     description: Previous contents, newest first (at most 50). Each entry is the content that was replaced by a later save or restore.
   *     operationId: policyAdminRevisions
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, enum: [privacy-policy, terms-of-use, accessibility] }
   *     responses:
   *       '200':
   *         description: Revision summaries in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.get(
    "/policies/:slug/revisions",
    fullSession,
    policyPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const revisions = await service.listRevisions(svc(), parseSlug(req));
      res.status(200).json({ success: true, data: revisions, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/policies/{slug}/revisions/{revisionId}:
   *   get:
   *     tags: [Policies]
   *     summary: One revision with its full content (admin)
   *     operationId: policyAdminRevisionGet
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, enum: [privacy-policy, terms-of-use, accessibility] }
   *       - in: path
   *         name: revisionId
   *         required: true
   *         schema: { type: integer, minimum: 1 }
   *     responses:
   *       '200':
   *         description: The revision, body included, in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.get(
    "/policies/:slug/revisions/:revisionId",
    fullSession,
    policyPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const revision = await service.getRevision(
        svc(),
        parseSlug(req),
        revisionIdSchema.parse(req.params.revisionId),
      );
      res.status(200).json({ success: true, data: revision, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/policies/{slug}/restore:
   *   post:
   *     tags: [Policies]
   *     summary: Restore a previous revision as the live page (admin)
   *     description: The current content is snapshotted as a new revision first, so a restore is itself reversible. The body's version must match the current version, or the restore is a 409 conflict.
   *     operationId: policyAdminRestore
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, enum: [privacy-policy, terms-of-use, accessibility] }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [revisionId, version]
   *             additionalProperties: false
   *             properties:
   *               revisionId: { type: integer, minimum: 1 }
   *               version: { type: integer, minimum: 1 }
   *     responses:
   *       '200':
   *         description: The restored policy page in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   *       '409':
   *         description: The page changed since it was loaded (optimistic concurrency).
   */
  router.post(
    "/policies/:slug/restore",
    fullSession,
    policyPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const input = restorePolicySchema.parse(req.body);
      const policy = await service.restoreRevision(
        svc(),
        actorOf(req),
        requestMeta(req),
        parseSlug(req),
        input,
      );
      res.status(200).json({ success: true, data: policy, requestId: res.locals.requestId });
    }),
  );

  return router;
}
