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
  parsePaginationParams,
} from "@bodhisattva/shared/pagination";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { createReadStream } from "node:fs";
import multer from "multer";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requirePermission,
} from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { AppError } from "@bodhisattva/shared/errors";
import { PDF_MAX_BYTES } from "../media/media.service.js";
import {
  createCollectionSchema,
  createExhibitionSchema,
  createFoundationProgramSchema,
  createGalleryItemSchema,
  createNewsArticleSchema,
  createNewsCategorySchema,
  createTestimonialSchema,
  newsBulkSchema,
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
  publication: z.string().trim().max(160).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.string().trim().max(40).optional(),
  hasPdf: z.enum(["true", "false"]).optional(),
  featured: z.enum(["true", "false"]).optional(),
  sort: z.enum(["newest", "oldest", "added", "alpha"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const adminNewsListQuerySchema = listQuerySchema.extend({
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(["published", "draft", "all"]).optional(),
  featured: z.enum(["true", "false"]).optional(),
  hasPdf: z.enum(["true", "false"]).optional(),
  sort: z.enum(["updated", "published", "title"]).optional(),
});

// ---------------------------------------------------------------------------
// PDF streaming (public + admin): single-range support, no paths exposed.
// ---------------------------------------------------------------------------

function safeDownloadName(name: string | null): string {
  const cleaned = (name ?? "")
    .replace(/["\\\r\n]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim();
  return cleaned.length > 0 ? cleaned : "document.pdf";
}

interface PdfFileTarget {
  filePath: string;
  size: number;
  originalName: string | null;
}

function sendPdfFile(
  req: Request,
  res: Response,
  target: PdfFileTarget,
  disposition: "inline" | "attachment",
): void {
  const { size } = target;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Uploaded documents render in a fully sandboxed, origin-less context:
  // a PDF (or anything mislabelled as one) can never run script in the
  // site's origin. Overrides helmet's global CSP for these responses.
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader(
    "Content-Disposition",
    disposition === "attachment"
      ? `attachment; filename="${safeDownloadName(target.originalName)}"`
      : "inline",
  );
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = -1;
    let end = -1;
    if (match) {
      const startRaw = match[1] ?? "";
      const endRaw = match[2] ?? "";
      if (startRaw === "" && endRaw !== "") {
        const suffix = Number(endRaw);
        if (suffix > 0) {
          start = Math.max(0, size - suffix);
          end = size - 1;
        }
      } else if (startRaw !== "") {
        start = Number(startRaw);
        end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
      }
    }
    if (start < 0 || end < start || start >= size) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.status(416).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(target.filePath, { start, end }).pipe(res);
    return;
  }
  res.status(200);
  res.setHeader("Content-Length", String(size));
  createReadStream(target.filePath).pipe(res);
}

// Multipart parsing for PDF uploads (memory storage; the service
// validates the bytes — multer only enforces the size ceiling).
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_MAX_BYTES, files: 1 },
});

function parsePdfUpload(req: Request, res: Response, next: NextFunction): void {
  pdfUpload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          next(
            new AppError(
              "PAYLOAD_TOO_LARGE",
              `The file exceeds the ${PDF_MAX_BYTES / (1024 * 1024)} MiB PDF upload limit.`,
            ),
          );
          return;
        }
        next(
          AppError.validation([
            { field: "file", issue: `Upload rejected (${err.code}).` },
          ]),
        );
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

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
      const paginated = req.query.page !== undefined;
      const paging = paginated
        ? parsePaginationParams({ page: query.page, pageSize: query.pageSize })
        : undefined;
      const result = await service.getPublicNews(svc, {
        search: query.search,
        category: query.category,
        publication: query.publication,
        year: query.year,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        type: query.type,
        hasPdf: query.hasPdf === undefined ? undefined : query.hasPdf === "true",
        featured: query.featured === undefined ? undefined : query.featured === "true",
        sort: query.sort,
        page: paging?.page,
        pageSize: paging?.pageSize,
      });
      if (result.meta) {
        res.status(200).json({
          success: true,
          data: { categories: result.categories, items: result.items },
          meta: result.meta,
          requestId: res.locals.requestId,
        });
      } else {
        res.status(200).json({
          success: true,
          data: result,
          requestId: res.locals.requestId,
        });
      }
    }),
  );

  router.get(
    "/news/facets",
    asyncHandler(async (_req: Request, res: Response) => {
      const facets = await service.getPublicNewsFacets(svc);
      res.status(200).json({ success: true, data: facets, requestId: res.locals.requestId });
    }),
  );

  // Token preview (draft or published) — same no-leak hardening as the CMS
  // preview route: no-store, no referrer, noindex, oracle-free 404s.
  router.get(
    "/news/preview/:token",
    asyncHandler(async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store, private");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      const token = typeof req.params.token === "string" ? req.params.token : "";
      const detail = await service.getNewsPreviewArticle(svc, token);
      res.status(200).json({ success: true, data: detail, requestId: res.locals.requestId });
    }),
  );

  router.get(
    "/news/:slug",
    asyncHandler(async (req: Request, res: Response) => {
      const slug = typeof req.params.slug === "string" ? req.params.slug : "";
      const detail = await service.getPublicNewsArticle(svc, slug);
      res.status(200).json({ success: true, data: detail, requestId: res.locals.requestId });
    }),
  );

  router.get(
    "/news/:slug/attachments",
    asyncHandler(async (req: Request, res: Response) => {
      const slug = typeof req.params.slug === "string" ? req.params.slug : "";
      const items = await service.listPublicNewsAttachments(svc, slug);
      res.status(200).json({ success: true, data: { items }, requestId: res.locals.requestId });
    }),
  );

  router.get(
    "/news/:slug/pdf/view",
    asyncHandler(async (req: Request, res: Response) => {
      const slug = typeof req.params.slug === "string" ? req.params.slug : "";
      const resolved = await service.resolvePublicNewsPdf(svc, slug);
      sendPdfFile(req, res, resolved, "inline");
    }),
  );

  router.get(
    "/news/:slug/pdf/download",
    asyncHandler(async (req: Request, res: Response) => {
      const slug = typeof req.params.slug === "string" ? req.params.slug : "";
      const resolved = await service.resolvePublicNewsPdf(svc, slug);
      await service.incrementNewsPdfDownloadCount(svc, resolved.article.id);
      sendPdfFile(req, res, resolved, "attachment");
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
      const query = adminNewsListQuerySchema.parse(req.query);
      const result = await service.listAdminNewsArticles(svc, query, {
        search: query.search,
        categoryId: query.categoryId,
        status: query.status,
        featured: query.featured === undefined ? undefined : query.featured === "true",
        hasPdf: query.hasPdf === undefined ? undefined : query.hasPdf === "true",
        sort: query.sort,
      });
      sendList(res, query, result);
    }),
  );
  router.post(
    "/news/bulk",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = newsBulkSchema.parse(req.body);
      const result = await service.bulkNewsArticles(svc, actorOf(req), body.ids, body.action, requestMeta(req));
      res.status(200).json({ success: true, data: result, requestId: res.locals.requestId });
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
  router.post(
    "/news/:id/publish",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await service.setNewsArticlePublished(svc, actorOf(req), parseIdParam(req), true, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/news/:id/unpublish",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await service.setNewsArticlePublished(svc, actorOf(req), parseIdParam(req), false, requestMeta(req));
      res.status(200).json({ success: true, data: updated, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/news/:id/duplicate",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const copy = await service.duplicateNewsArticle(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(201).json({ success: true, data: copy, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/news/:id/preview",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const preview = await service.createNewsPreview(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(201).json({ success: true, data: preview, requestId: res.locals.requestId });
    }),
  );
  router.post(
    "/news/:id/pdf",
    fullSession,
    newsPerm,
    parsePdfUpload,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.file) {
        throw AppError.validation([{ field: "file", issue: "A PDF file is required." }]);
      }
      const attachment = await service.uploadNewsPdf(
        svc,
        actorOf(req),
        parseIdParam(req),
        { buffer: req.file.buffer, originalName: req.file.originalname },
        requestMeta(req),
      );
      res.status(201).json({ success: true, data: attachment, requestId: res.locals.requestId });
    }),
  );
  router.delete(
    "/news/:id/pdf",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await service.removeNewsPdf(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      res.status(200).json({ success: true, data: { removed: true }, requestId: res.locals.requestId });
    }),
  );
  router.get(
    "/news/:id/pdf/view",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = await service.resolveAdminNewsPdf(svc, parseIdParam(req));
      sendPdfFile(req, res, resolved, "inline");
    }),
  );
  router.get(
    "/news/:id/pdf/download",
    fullSession,
    newsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const id = parseIdParam(req);
      const resolved = await service.resolveAdminNewsPdf(svc, id);
      await service.recordNewsPdfDownloadAudit(svc, actorOf(req), id, resolved.attachment.id, requestMeta(req));
      sendPdfFile(req, res, resolved, "attachment");
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
