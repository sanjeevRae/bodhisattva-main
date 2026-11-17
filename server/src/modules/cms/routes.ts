/**
 * CMS routes (PERMISSIONS.md §8, DATABASE_DESIGN.md §7).
 *
 * Public router — mount at `/api`:
 *   GET /pages/:slug           published page content (drafts never leak)
 *   GET /pages/:slug/preview   draft content via a preview token (A4);
 *                              every failure is the same 404
 *   GET /menus/:code           visible menu items, PAGE links resolved
 *   GET /site                  public site settings as an object
 *
 * Admin router — mount at `/api/admin` (full session + permissions):
 *   GET    /pages                              cms.pages.read
 *   POST   /pages                              cms.pages.create
 *   GET    /pages/:id                          cms.pages.read
 *   PATCH  /pages/:id                          cms.pages.update
 *   DELETE /pages/:id                          cms.pages.delete
 *   GET    /pages/:id/draft                    cms.pages.read (clone-on-edit)
 *   PUT    /pages/:id/draft                    cms.pages.update
 *   POST   /pages/:id/publish                  cms.pages.publish
 *   POST   /pages/:id/rollback/:revisionId     cms.pages.restore
 *   GET    /pages/:id/revisions                cms.pages.read
 *   POST   /pages/:id/preview-token            cms.pages.read
 *   GET    /menus                              cms.menus.manage
 *   PUT    /menus/:code                        cms.menus.manage
 *   GET    /settings                           settings.manage
 *   PUT    /settings                           settings.manage
 */
import { AppError } from "@bodhisattva/shared/errors";
import { Router, type Request } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requirePermission,
} from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  createPageSchema,
  replaceMenuItemsSchema,
  saveDraftSchema,
  updatePageSchema,
  updateSettingsSchema,
} from "./cms.schemas.js";
import {
  createPage,
  createPagePreviewToken,
  deletePage,
  getDraft,
  getMenuByCode,
  getPageAdmin,
  getPreviewPageBySlug,
  getPublishedPageBySlug,
  getPublicSettings,
  listMenusAdmin,
  listPages,
  listRevisions,
  listSettingsAdmin,
  publishPage,
  replaceMenuItems,
  rollbackPage,
  saveDraft,
  updatePageMetadata,
  updateSettings,
  type CmsActor,
  type CmsDeps,
  type RequestMeta,
} from "./service.js";

export interface CmsRouterDeps {
  db: Database;
  config: AppConfig;
}

function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

function actorOf(req: Request): CmsActor {
  const auth = getAuthContext(req);
  return { userId: auth.userId, email: auth.email };
}

function parseIdParam(raw: string | string[], label: string): number {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw AppError.notFound(`${label} not found.`);
  }
  return id;
}

export function createCmsPublicRouter(deps: CmsRouterDeps): Router {
  const router = Router();
  const cms: CmsDeps = { db: deps.db, config: deps.config };

  router.get(
    "/pages/:slug",
    asyncHandler(async (req, res) => {
      const page = await getPublishedPageBySlug(cms, String(req.params.slug));
      res.status(200).json(page);
    }),
  );

  router.get(
    "/pages/:slug/preview",
    asyncHandler(async (req, res) => {
      // Preview responses carry unpublished content behind a bearer token:
      // never cache, never index, never leak the referrer (Phase 3 review).
      res.set({
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      });
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const page = await getPreviewPageBySlug(cms, String(req.params.slug), token);
      res.status(200).json(page);
    }),
  );

  router.get(
    "/menus/:code",
    asyncHandler(async (req, res) => {
      const menu = await getMenuByCode(cms, String(req.params.code));
      res.status(200).json(menu);
    }),
  );

  router.get(
    "/site",
    asyncHandler(async (_req, res) => {
      const settings = await getPublicSettings(cms);
      res.status(200).json({ settings });
    }),
  );

  return router;
}

export function createCmsAdminRouter(deps: CmsRouterDeps): Router {
  const router = Router();
  const cms: CmsDeps = { db: deps.db, config: deps.config };
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });

  router.get(
    "/pages",
    fullSession,
    requirePermission(deps.db, "cms.pages.read"),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ items: await listPages(cms) });
    }),
  );

  router.post(
    "/pages",
    fullSession,
    requirePermission(deps.db, "cms.pages.create"),
    asyncHandler(async (req, res) => {
      const input = createPageSchema.parse(req.body);
      const page = await createPage(cms, actorOf(req), input, requestMeta(req));
      res.status(201).json(page);
    }),
  );

  router.get(
    "/pages/:id",
    fullSession,
    requirePermission(deps.db, "cms.pages.read"),
    asyncHandler(async (req, res) => {
      const page = await getPageAdmin(cms, parseIdParam(req.params.id, "Page"));
      res.status(200).json(page);
    }),
  );

  router.patch(
    "/pages/:id",
    fullSession,
    requirePermission(deps.db, "cms.pages.update"),
    asyncHandler(async (req, res) => {
      const input = updatePageSchema.parse(req.body);
      const page = await updatePageMetadata(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
        input,
        requestMeta(req),
      );
      res.status(200).json(page);
    }),
  );

  router.delete(
    "/pages/:id",
    fullSession,
    requirePermission(deps.db, "cms.pages.delete"),
    asyncHandler(async (req, res) => {
      await deletePage(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
        requestMeta(req),
      );
      res.status(200).json({ message: "Page deleted." });
    }),
  );

  router.get(
    "/pages/:id/draft",
    fullSession,
    requirePermission(deps.db, "cms.pages.read"),
    asyncHandler(async (req, res) => {
      const draft = await getDraft(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
      );
      res.status(200).json(draft);
    }),
  );

  router.put(
    "/pages/:id/draft",
    fullSession,
    requirePermission(deps.db, "cms.pages.update"),
    asyncHandler(async (req, res) => {
      const { expectedVersion, sections } = saveDraftSchema.parse(req.body);
      const draft = await saveDraft(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
        sections,
        expectedVersion,
        requestMeta(req),
      );
      res.status(200).json(draft);
    }),
  );

  router.post(
    "/pages/:id/publish",
    fullSession,
    requirePermission(deps.db, "cms.pages.publish"),
    asyncHandler(async (req, res) => {
      const page = await publishPage(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
        requestMeta(req),
      );
      res.status(200).json(page);
    }),
  );

  router.post(
    "/pages/:id/rollback/:revisionId",
    fullSession,
    requirePermission(deps.db, "cms.pages.restore"),
    asyncHandler(async (req, res) => {
      const page = await rollbackPage(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
        parseIdParam(req.params.revisionId, "Revision"),
        requestMeta(req),
      );
      res.status(200).json(page);
    }),
  );

  router.get(
    "/pages/:id/revisions",
    fullSession,
    requirePermission(deps.db, "cms.pages.read"),
    asyncHandler(async (req, res) => {
      const revisions = await listRevisions(
        cms,
        parseIdParam(req.params.id, "Page"),
      );
      res.status(200).json({ items: revisions });
    }),
  );

  router.post(
    "/pages/:id/preview-token",
    fullSession,
    requirePermission(deps.db, "cms.pages.read"),
    asyncHandler(async (req, res) => {
      const created = await createPagePreviewToken(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
      );
      res.status(201).json(created);
    }),
  );

  router.get(
    "/menus",
    fullSession,
    requirePermission(deps.db, "cms.menus.manage"),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ items: await listMenusAdmin(cms) });
    }),
  );

  router.put(
    "/menus/:code",
    fullSession,
    requirePermission(deps.db, "cms.menus.manage"),
    asyncHandler(async (req, res) => {
      const { items } = replaceMenuItemsSchema.parse(req.body);
      const menu = await replaceMenuItems(
        cms,
        actorOf(req),
        String(req.params.code),
        items,
        requestMeta(req),
      );
      res.status(200).json(menu);
    }),
  );

  router.get(
    "/settings",
    fullSession,
    requirePermission(deps.db, "settings.manage"),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ items: await listSettingsAdmin(cms) });
    }),
  );

  router.put(
    "/settings",
    fullSession,
    requirePermission(deps.db, "settings.manage"),
    asyncHandler(async (req, res) => {
      const { settings } = updateSettingsSchema.parse(req.body);
      const items = await updateSettings(
        cms,
        actorOf(req),
        settings,
        requestMeta(req),
      );
      res.status(200).json({ items });
    }),
  );

  return router;
}
