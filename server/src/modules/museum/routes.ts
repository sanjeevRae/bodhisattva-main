/**
 * Museum-module routes (Phase 5, DEVELOPMENT_ROADMAP.md §7):
 *
 *  Public (no auth — published records only):
 *    GET /api/collections · /api/exhibitions · /api/news · /api/foundation
 *
 *  Admin (full session + the module's permission on every route):
 *    /api/admin/collections, /api/admin/exhibitions,
 *    /api/admin/news/categories, /api/admin/news (articles),
 *    /api/admin/foundation-programs, /api/admin/testimonials —
 *    list / create / get / patch / soft-delete, plus /reorder for every
 *    module except news articles (§8.4 has no sort_order for articles;
 *    public order is published_on DESC).
 *    Gallery items nest under exhibitions:
 *    GET/POST /api/admin/exhibitions/:id/gallery-items,
 *    PATCH/DELETE /api/admin/gallery-items/:id,
 *    POST /api/admin/gallery-items/reorder.
 *
 * Follows the CMS routes' shape exactly: handlers assume requireAuth ran
 * (req.auth), parse with the module schemas, and answer in the shared
 * envelope. Every write is audited in the service layer.
 */
import {
  buildPaginationMeta,
  paginationQuerySchema,
} from "@bodhisattva/shared/pagination";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requirePermission,
} from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  createCollectionSchema,
  createExhibitionSchema,
  createFoundationProgramSchema,
  createGalleryItemSchema,
  createNewsArticleSchema,
  createNewsCategorySchema,
  createTestimonialSchema,
  reorderSchema,
  updateCollectionSchema,
  updateExhibitionSchema,
  updateFoundationProgramSchema,
  updateGalleryItemSchema,
  updateNewsArticleSchema,
  updateNewsCategorySchema,
  updateTestimonialSchema,
} from "./museum.schemas.js";
import type { MuseumActor, MuseumDeps, RequestMeta } from "./service.js";
import * as service from "./service.js";

export interface MuseumRouteDeps {
  db: Database;
  config: AppConfig;
}

const idParamSchema = z.coerce.number().int().positive();
const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});
const newsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(120).optional(),
});

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function actorOf(req: Request): MuseumActor {
  const auth = getAuthContext(req);
  return { userId: auth.userId, email: auth.email };
}

function parseIdParam(req: Request, name = "id"): number {
  return idParamSchema.parse(req.params[name]);
}

function serviceDeps(deps: MuseumRouteDeps): MuseumDeps {
  return { db: deps.db, config: deps.config };
}

/** Paginated admin list answer in the shared envelope. */
function sendList(
  res: Response,
  pagination: { page: number; pageSize: number },
  result: { items: unknown[]; total: number },
): void {
  res.status(200).json({
    success: true,
    data: result.items,
    meta: buildPaginationMeta(result.total, pagination),
    requestId: res.locals.requestId,
  });
}

// ---------------------------------------------------------------------------
// Public router
// ---------------------------------------------------------------------------

export function createMuseumPublicRouter(deps: MuseumRouteDeps): Router {
  const svc = serviceDeps(deps);
  const router = Router();

  router.get(
    "/collections",
    asyncHandler(async (_req: Request, res: Response) => {
      const items = await service.listPublicCollections(svc);
      res.status(200).json({
        success: true,
        data: { items },
        requestId: res.locals.requestId,
      });
    }),
  );

  router.get(
    "/exhibitions",
    asyncHandler(async (_req: Request, res: Response) => {
      const items = await service.listPublicExhibitions(svc);
      res.status(200).json({
        success: true,
        data: { items },
        requestId: res.locals.requestId,
      });
    }),
  );

  router.get(
    "/news",
    asyncHandler(async (req: Request, res: Response) => {
      const query = newsQuerySchema.parse(req.query);
      const result = await service.getPublicNews(svc, query);
      res.status(200).json({
        success: true,
        data: result,
        requestId: res.locals.requestId,
      });
    }),
  );

  router.get(
    "/foundation",
    asyncHandler(async (_req: Request, res: Response) => {
      const result = await service.getPublicFoundation(svc);
      res.status(200).json({
        success: true,
        data: result,
        requestId: res.locals.requestId,
      });
    }),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Admin router
// ---------------------------------------------------------------------------

export function createMuseumAdminRouter(deps: MuseumRouteDeps): Router {
  const svc = serviceDeps(deps);
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });
  const collectionsPerm = requirePermission(deps.db, "museum.collections.manage");
  const exhibitionsPerm = requirePermission(deps.db, "museum.exhibitions.manage");
  const galleryPerm = requirePermission(deps.db, "museum.gallery.manage");
  const newsPerm = requirePermission(deps.db, "news.manage");
  const foundationPerm = requirePermission(deps.db, "foundation.manage");

  // ---- Collections -------------------------------------------------------
  router.get(
    "/collections",
    fullSession,
    collectionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listAdminCollections(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/collections/reorder",
    fullSession,
    collectionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = reorderSchema.parse(req.body);
      const items = await service.reorderCollections(svc, actorOf(req), body.ids, requestMeta(req));
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/collections",
    fullSession,
    collectionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createCollectionSchema.parse(req.body);
      const created = await service.createCollection(svc, actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.get(
    "/collections/:id",
    fullSession,
    collectionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const record = await service.getAdminCollection(svc, parseIdParam(req));
      res.status(200).json({ success: true, data: record, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/collections/:id",
    fullSession,
    collectionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateCollectionSchema.parse(req.body);
      const updated = await service.updateCollection(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/collections/:id",
    fullSession,
    collectionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteCollection(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  // ---- Exhibitions -------------------------------------------------------
  router.get(
    "/exhibitions",
    fullSession,
    exhibitionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listAdminExhibitions(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/exhibitions/reorder",
    fullSession,
    exhibitionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = reorderSchema.parse(req.body);
      const items = await service.reorderExhibitions(svc, actorOf(req), body.ids, requestMeta(req));
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/exhibitions",
    fullSession,
    exhibitionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createExhibitionSchema.parse(req.body);
      const created = await service.createExhibition(svc, actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.get(
    "/exhibitions/:id",
    fullSession,
    exhibitionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const record = await service.getAdminExhibition(svc, parseIdParam(req));
      res.status(200).json({ success: true, data: record, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/exhibitions/:id",
    fullSession,
    exhibitionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateExhibitionSchema.parse(req.body);
      const updated = await service.updateExhibition(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/exhibitions/:id",
    fullSession,
    exhibitionsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteExhibition(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  // ---- Gallery items (nested under exhibitions) ---------------------------
  router.get(
    "/exhibitions/:id/gallery-items",
    fullSession,
    galleryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationQuerySchema.parse(req.query);
      const result = await service.listAdminGalleryItems(svc, parseIdParam(req), query);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/exhibitions/:id/gallery-items",
    fullSession,
    galleryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createGalleryItemSchema.parse(req.body);
      const created = await service.createGalleryItem(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/gallery-items/reorder",
    fullSession,
    galleryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = reorderSchema.parse(req.body);
      const items = await service.reorderGalleryItems(svc, actorOf(req), body.ids, requestMeta(req));
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/gallery-items/:id",
    fullSession,
    galleryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateGalleryItemSchema.parse(req.body);
      const updated = await service.updateGalleryItem(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/gallery-items/:id",
    fullSession,
    galleryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteGalleryItem(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  // ---- News categories (registered before /news/:id) ----------------------
  router.get(
    "/news/categories",
    fullSession,
    newsPerm,
    asyncHandler(async (_req: Request, res: Response) => {
      const items = await service.listAdminNewsCategories(svc);
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/news/categories",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createNewsCategorySchema.parse(req.body);
      const created = await service.createNewsCategory(svc, actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/news/categories/:id",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateNewsCategorySchema.parse(req.body);
      const updated = await service.updateNewsCategory(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/news/categories/:id",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteNewsCategory(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  // ---- News articles ------------------------------------------------------
  router.get(
    "/news",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listAdminNewsArticles(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/news",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createNewsArticleSchema.parse(req.body);
      const created = await service.createNewsArticle(svc, actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.get(
    "/news/:id",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const record = await service.getAdminNewsArticle(svc, parseIdParam(req));
      res.status(200).json({ success: true, data: record, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/news/:id",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateNewsArticleSchema.parse(req.body);
      const updated = await service.updateNewsArticle(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/news/:id",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteNewsArticle(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  // ---- Foundation programs -------------------------------------------------
  router.get(
    "/foundation-programs",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listAdminFoundationPrograms(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/foundation-programs/reorder",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = reorderSchema.parse(req.body);
      const items = await service.reorderFoundationPrograms(svc, actorOf(req), body.ids, requestMeta(req));
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/foundation-programs",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createFoundationProgramSchema.parse(req.body);
      const created = await service.createFoundationProgram(svc, actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.get(
    "/foundation-programs/:id",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const record = await service.getAdminFoundationProgram(svc, parseIdParam(req));
      res.status(200).json({ success: true, data: record, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/foundation-programs/:id",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateFoundationProgramSchema.parse(req.body);
      const updated = await service.updateFoundationProgram(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/foundation-programs/:id",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteFoundationProgram(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  // ---- Testimonials ---------------------------------------------------------
  router.get(
    "/testimonials",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await service.listAdminTestimonials(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/testimonials/reorder",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = reorderSchema.parse(req.body);
      const items = await service.reorderTestimonials(svc, actorOf(req), body.ids, requestMeta(req));
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/testimonials",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createTestimonialSchema.parse(req.body);
      const created = await service.createTestimonial(svc, actorOf(req), body, requestMeta(req));
      res.status(201).json({ success: true, data: created, requestId: res.locals.requestId });
    }),
  );
  router.get(
    "/testimonials/:id",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const record = await service.getAdminTestimonial(svc, parseIdParam(req));
      res.status(200).json({ success: true, data: record, requestId: res.locals.requestId });
    }),
  );
  router.patch(
    "/testimonials/:id",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateTestimonialSchema.parse(req.body);
      const updated = await service.updateTestimonial(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/testimonials/:id",
    fullSession,
    foundationPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteTestimonial(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { deleted: true }, requestId: res.locals.requestId });
    }),
  );

  return router;
}
