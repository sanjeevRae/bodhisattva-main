import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import { getAuthContext, requirePermission } from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { createPopupSchema, updatePopupSchema } from "./schemas.js";
import * as service from "./service.js";

/**
 * Popup routes (owner feature, 2026-11-20).
 * Public: GET /api/popup — the single ACTIVE popup or null.
 * Admin (mounted at /api/admin): /popups CRUD + activate/deactivate,
 * all behind a full session + the popup.manage permission.
 */

export interface PopupRouteDeps {
  db: Database;
  config: AppConfig;
}

const idParamSchema = z.coerce.number().int().positive();

function requestMeta(req: Request): service.RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function actorOf(req: Request): service.PopupActor {
  const auth = getAuthContext(req);
  return { userId: auth.userId, email: auth.email };
}

function parseId(req: Request): number {
  return idParamSchema.parse(req.params.id);
}

export function createPopupPublicRouter(deps: PopupRouteDeps): Router {
  const router = Router();

  /**
   * @openapi
   * /api/popup:
   *   get:
   *     tags: [Popups]
   *     summary: The active website popup (public)
   *     description: Returns the single active announcement popup, or data:null when none is active. Inactive popups are never exposed. Sent with Cache-Control no-store so admin changes take effect immediately.
   *     operationId: popupPublicGet
   *     security: []
   *     responses:
   *       '200':
   *         description: The active popup (or null) in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.get(
    "/popup",
    asyncHandler(async (_req: Request, res: Response) => {
      const popup = await service.getPublicPopup({ db: deps.db });
      res.set("Cache-Control", "no-store, private");
      res.status(200).json({ success: true, data: popup, requestId: res.locals.requestId });
    }),
  );

  return router;
}

export function createPopupAdminRouter(deps: PopupRouteDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });
  const popupPerm = requirePermission(deps.db, "popup.manage");
  const svc = (): service.PopupDeps => ({ db: deps.db });

  /**
   * @openapi
   * /api/admin/popups:
   *   get:
   *     tags: [Popups]
   *     summary: List all popups (admin)
   *     operationId: popupAdminList
   *     responses:
   *       '200':
   *         description: All popups, newest first, in the success envelope.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   *   post:
   *     tags: [Popups]
   *     summary: Create a popup (admin)
   *     description: New popups start inactive at version 1; activate explicitly. Link URLs must be http(s) or a site-relative path.
   *     operationId: popupAdminCreate
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [heading, message]
   *             properties:
   *               heading: { type: string, maxLength: 160 }
   *               message: { type: string, maxLength: 2000 }
   *               imageMediaId: { type: integer, nullable: true }
   *               buttonLabel: { type: string, maxLength: 80, nullable: true }
   *               linkUrl: { type: string, maxLength: 500, nullable: true }
   *     responses:
   *       '201':
   *         description: The created popup.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.get(
    "/popups",
    fullSession,
    popupPerm,
    asyncHandler(async (_req: Request, res: Response) => {
      const items = await service.listAdminPopups(svc());
      res.status(200).json({ success: true, data: items, requestId: res.locals.requestId });
    }),
  );

  router.post(
    "/popups",
    fullSession,
    popupPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createPopupSchema.parse(req.body);
      const created = await service.createPopup(svc(), actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/popups/{id}:
   *   patch:
   *     tags: [Popups]
   *     summary: Edit a popup (admin)
   *     description: Changing visitor-facing content (heading, message, image, button label, link) increments the popup version, so visitors see the updated popup once more. Non-content edits do not.
   *     operationId: popupAdminUpdate
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       '200':
   *         description: The updated popup.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   *   delete:
   *     tags: [Popups]
   *     summary: Delete a popup (admin)
   *     operationId: popupAdminDelete
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       '200':
   *         description: Deleted.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.patch(
    "/popups/:id",
    fullSession,
    popupPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updatePopupSchema.parse(req.body);
      const updated = await service.updatePopup(svc(), actorOf(req), parseId(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );

  router.delete(
    "/popups/:id",
    fullSession,
    popupPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deletePopup(svc(), actorOf(req), parseId(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/popups/{id}/activate:
   *   post:
   *     tags: [Popups]
   *     summary: Activate a popup (admin)
   *     description: Atomically deactivates every other popup and activates this one; the database enforces at most one active popup. Activation alone does not change the version.
   *     operationId: popupAdminActivate
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       '200':
   *         description: The activated popup.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.post(
    "/popups/:id/activate",
    fullSession,
    popupPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await service.activatePopup(svc(), actorOf(req), parseId(req), requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );

  /**
   * @openapi
   * /api/admin/popups/{id}/deactivate:
   *   post:
   *     tags: [Popups]
   *     summary: Deactivate a popup (admin)
   *     operationId: popupAdminDeactivate
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       '200':
   *         description: The deactivated popup.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessEnvelope'
   */
  router.post(
    "/popups/:id/deactivate",
    fullSession,
    popupPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await service.deactivatePopup(svc(), actorOf(req), parseId(req), requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );

  return router;
}
