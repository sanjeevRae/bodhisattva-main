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

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (the public router mounts at
 * /api, the admin router at /api/admin). Admin routes require a full
 * session plus the module permission (museum.collections.manage,
 * museum.exhibitions.manage, museum.gallery.manage, news.manage or
 * foundation.manage); mutations also require the X-CSRF-Token header.
 * ======================================================================== */

/**
 * @openapi
 * /api/collections:
 *   get:
 *     tags: [Museum & News]
 *     summary: List published collections (public)
 *     operationId: museumPublicCollections
 *     security: []
 *     responses:
 *       '200':
 *         description: Published collections in the success envelope (data.items).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 */

/**
 * @openapi
 * /api/exhibitions:
 *   get:
 *     tags: [Museum & News]
 *     summary: List published exhibitions (public)
 *     operationId: museumPublicExhibitions
 *     security: []
 *     responses:
 *       '200':
 *         description: Published exhibitions in the success envelope (data.items).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 */

/**
 * @openapi
 * /api/news:
 *   get:
 *     tags: [Museum & News]
 *     summary: Browse the News Clippings archive (public)
 *     description: Published articles only. Without a page parameter the legacy shape is returned (all matches with the category list); with page supplied, a pagination meta is added at the envelope level. Full-text search runs over title, summary, outlet, author and the plain-text body projection.
 *     operationId: newsPublicList
 *     security: []
 *     parameters:
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - name: category
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 120
 *         description: Category slug.
 *       - name: publication
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 160
 *         description: Outlet name filter (facet value).
 *       - name: year
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1900
 *           maximum: 2200
 *       - name: dateFrom
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *       - name: dateTo
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *       - name: type
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *         description: Article type filter (facet value).
 *       - name: hasPdf
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *       - name: featured
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *       - name: sort
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [newest, oldest, added, alpha]
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *     responses:
 *       '200':
 *         description: Matching published articles (list items never include the article body).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */

/**
 * @openapi
 * /api/news/facets:
 *   get:
 *     tags: [Museum & News]
 *     summary: News archive filter facets (public)
 *     description: Publications, years, types and categories with published-article counts, for building the archive filter UI.
 *     operationId: newsPublicFacets
 *     security: []
 *     responses:
 *       '200':
 *         description: Facet lists with counts.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 */

/**
 * @openapi
 * /api/news/preview/{token}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Preview a draft news article (token)
 *     description: Returns the full article detail for a draft behind a single-article preview token issued from the admin (POST /api/admin/news/{id}/preview). Tokens are stored hashed, expire after 30 minutes, and unknown tokens answer an oracle-free 404. The token authorizes the article text only — a draft PDF stays behind the admin endpoints. Responses carry no-store and no-referrer headers.
 *     operationId: newsPreviewByToken
 *     security: []
 *     parameters:
 *       - name: token
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The article detail, including body and related articles.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/news/{slug}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Read a published news article (public)
 *     description: Full detail — body, byline, tags, PDF descriptor and related articles. Reading increments the article view counter.
 *     operationId: newsPublicDetail
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The article detail.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/news/{slug}/attachments:
 *   get:
 *     tags: [Museum & News]
 *     summary: List a published article's public attachments
 *     operationId: newsPublicAttachments
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The article's active public PDF attachment descriptor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/news/{slug}/pdf/view:
 *   get:
 *     tags: [Museum & News]
 *     summary: View the original clipping PDF inline (public)
 *     description: Streams the stored PDF byte-identically with Content-Disposition inline. Only for published articles with an active public attachment. Supports single-range requests (206) for the in-browser viewer; responses carry X-Content-Type-Options nosniff and a sandboxed Content-Security-Policy.
 *     operationId: newsPublicPdfView
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: Range
 *         in: header
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional single byte range, e.g. bytes=0-1023.
 *     responses:
 *       '200':
 *         description: The PDF file (full body).
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '206':
 *         description: The requested byte range of the PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '416':
 *         description: Requested range not satisfiable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /api/news/{slug}/pdf/download:
 *   get:
 *     tags: [Museum & News]
 *     summary: Download the original clipping PDF (public)
 *     description: Same gating as the inline view, with Content-Disposition attachment and the original filename. Downloading increments the article PDF download counter.
 *     operationId: newsPublicPdfDownload
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: Range
 *         in: header
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The PDF file.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '206':
 *         description: The requested byte range of the PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '416':
 *         description: Requested range not satisfiable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /api/foundation:
 *   get:
 *     tags: [Museum & News]
 *     summary: Foundation page content (public)
 *     description: Published foundation programs and testimonials for the Foundation page.
 *     operationId: museumPublicFoundation
 *     security: []
 *     responses:
 *       '200':
 *         description: Foundation programs and testimonials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 */

/* --------------------------------------------------------------------------
 * OpenAPI documentation — admin museum routes (same swagger-jsdoc block;
 * permission for every route below is museum.collections.manage unless
 * another module permission is named in the summary).
 * ------------------------------------------------------------------------ */

/**
 * @openapi
 * /api/admin/collections:
 *   get:
 *     tags: [Museum & News]
 *     summary: List collections (admin)
 *     operationId: museumAdminListCollections
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       '200':
 *         description: Paginated collections, drafts included.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Museum & News]
 *     summary: Create a collection (admin)
 *     operationId: museumAdminCreateCollection
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CollectionRequest'
 *     responses:
 *       '201':
 *         description: Collection created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/collections/reorder:
 *   post:
 *     tags: [Museum & News]
 *     summary: Reorder collections (admin)
 *     operationId: museumAdminReorderCollections
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReorderRequest'
 *     responses:
 *       '200':
 *         description: Order saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/collections/{id}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Get a collection (admin)
 *     operationId: museumAdminGetCollection
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: The collection.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update a collection (admin)
 *     operationId: museumAdminUpdateCollection
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CollectionPatch'
 *     responses:
 *       '200':
 *         description: Collection updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete a collection (admin)
 *     operationId: museumAdminDeleteCollection
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Collection deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/exhibitions:
 *   get:
 *     tags: [Museum & News]
 *     summary: List exhibitions (admin, museum.exhibitions.manage)
 *     operationId: museumAdminListExhibitions
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       '200':
 *         description: Paginated exhibitions, drafts included.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Museum & News]
 *     summary: Create an exhibition (admin)
 *     operationId: museumAdminCreateExhibition
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ExhibitionRequest'
 *     responses:
 *       '201':
 *         description: Exhibition created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/exhibitions/reorder:
 *   post:
 *     tags: [Museum & News]
 *     summary: Reorder exhibitions (admin)
 *     operationId: museumAdminReorderExhibitions
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReorderRequest'
 *     responses:
 *       '200':
 *         description: Order saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/exhibitions/{id}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Get an exhibition (admin)
 *     operationId: museumAdminGetExhibition
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: The exhibition.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update an exhibition (admin)
 *     operationId: museumAdminUpdateExhibition
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ExhibitionPatch'
 *     responses:
 *       '200':
 *         description: Exhibition updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete an exhibition (admin)
 *     operationId: museumAdminDeleteExhibition
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Exhibition deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/exhibitions/{id}/gallery-items:
 *   get:
 *     tags: [Museum & News]
 *     summary: List an exhibition's gallery items (admin, museum.gallery.manage)
 *     operationId: museumAdminListGalleryItems
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *     responses:
 *       '200':
 *         description: Paginated gallery items.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   post:
 *     tags: [Museum & News]
 *     summary: Add a gallery item to an exhibition (admin)
 *     operationId: museumAdminCreateGalleryItem
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GalleryItemRequest'
 *     responses:
 *       '201':
 *         description: Gallery item created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/gallery-items/reorder:
 *   post:
 *     tags: [Museum & News]
 *     summary: Reorder gallery items (admin, museum.gallery.manage)
 *     operationId: museumAdminReorderGalleryItems
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReorderRequest'
 *     responses:
 *       '200':
 *         description: Order saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/gallery-items/{id}:
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update a gallery item (admin, museum.gallery.manage)
 *     operationId: museumAdminUpdateGalleryItem
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GalleryItemPatch'
 *     responses:
 *       '200':
 *         description: Gallery item updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete a gallery item (admin, museum.gallery.manage)
 *     operationId: museumAdminDeleteGalleryItem
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Gallery item deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/* --------------------------------------------------------------------------
 * OpenAPI documentation — admin News Clippings, foundation programs and
 * testimonials (permission news.manage for the news routes,
 * foundation.manage for the rest).
 * ------------------------------------------------------------------------ */

/**
 * @openapi
 * /api/admin/news/categories:
 *   get:
 *     tags: [Museum & News]
 *     summary: List news categories (admin)
 *     operationId: newsAdminListCategories
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: All news categories.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Museum & News]
 *     summary: Create a news category (admin)
 *     operationId: newsAdminCreateCategory
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewsCategoryRequest'
 *     responses:
 *       '201':
 *         description: Category created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/news/categories/{id}:
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update a news category (admin)
 *     operationId: newsAdminUpdateCategory
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewsCategoryPatch'
 *     responses:
 *       '200':
 *         description: Category updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete a news category (admin)
 *     description: Conflicts with 409 while articles still reference the category.
 *     operationId: newsAdminDeleteCategory
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Category deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/news:
 *   get:
 *     tags: [Museum & News]
 *     summary: List news articles (admin)
 *     description: Drafts included, with the PDF descriptor and authoring metadata the editor needs.
 *     operationId: newsAdminList
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - name: categoryId
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: status
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [published, draft, all]
 *       - name: featured
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *       - name: hasPdf
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *       - name: sort
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [updated, published, title]
 *     responses:
 *       '200':
 *         description: Paginated articles.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Museum & News]
 *     summary: Create a news article (admin)
 *     operationId: newsAdminCreate
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewsArticleRequest'
 *     responses:
 *       '201':
 *         description: Article created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/news/bulk:
 *   post:
 *     tags: [Museum & News]
 *     summary: Bulk publish, unpublish or archive articles (admin)
 *     operationId: newsAdminBulk
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewsBulkRequest'
 *     responses:
 *       '200':
 *         description: Per-article outcome of the bulk action.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/news/{id}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Get a news article for editing (admin)
 *     description: Full record including body, tags and the active PDF attachment.
 *     operationId: newsAdminGet
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: The article.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update a news article (admin)
 *     description: The body is sanitised on save and its plain-text projection is re-indexed for search. Sending tags replaces the tag set; omitting tags leaves them untouched.
 *     operationId: newsAdminUpdate
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewsArticlePatch'
 *     responses:
 *       '200':
 *         description: Article updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete a news article (admin)
 *     description: Soft delete; the stored PDF file is retained while any attachment record references it.
 *     operationId: newsAdminDelete
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Article deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/publish:
 *   post:
 *     tags: [Museum & News]
 *     summary: Publish a news article (admin)
 *     operationId: newsAdminPublish
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Article published.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/unpublish:
 *   post:
 *     tags: [Museum & News]
 *     summary: Unpublish a news article (admin)
 *     description: The article and its PDF immediately stop being served publicly.
 *     operationId: newsAdminUnpublish
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Article unpublished.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/duplicate:
 *   post:
 *     tags: [Museum & News]
 *     summary: Duplicate a news article (admin)
 *     description: Creates an unpublished copy. The copy references the same stored PDF file — no second copy is written.
 *     operationId: newsAdminDuplicate
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '201':
 *         description: The duplicated article.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/preview:
 *   post:
 *     tags: [Museum & News]
 *     summary: Create a draft preview token (admin)
 *     description: Issues a single-article preview token (30 minutes, stored hashed) for GET /api/news/preview/{token}.
 *     operationId: newsAdminCreatePreview
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '201':
 *         description: Preview token and path.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/pdf:
 *   post:
 *     tags: [Museum & News]
 *     summary: Upload or replace the article PDF (admin)
 *     description: Multipart upload of the original clipping PDF (max 25 MiB, signature and structure validated, SHA-256 recorded, stored unmodified). Replacement is serialised on the article row — the previous attachment becomes REPLACED and its file is kept for history.
 *     operationId: newsAdminUploadPdf
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/NewsPdfUploadRequest'
 *     responses:
 *       '201':
 *         description: The new active attachment.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Remove the article PDF (admin)
 *     description: Marks the active attachment REMOVED; the article keeps no public PDF afterwards.
 *     operationId: newsAdminRemovePdf
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Attachment removed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/pdf/view:
 *   get:
 *     tags: [Museum & News]
 *     summary: View an article PDF in the admin (works for drafts)
 *     description: Streams the active attachment regardless of publication state, behind the news.manage permission. Supports single-range requests.
 *     operationId: newsAdminPdfView
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: Range
 *         in: header
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The PDF file.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '206':
 *         description: The requested byte range of the PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/news/{id}/pdf/download:
 *   get:
 *     tags: [Museum & News]
 *     summary: Download an article PDF in the admin
 *     operationId: newsAdminPdfDownload
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: The PDF file as an attachment with its original filename.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/foundation-programs:
 *   get:
 *     tags: [Museum & News]
 *     summary: List foundation programs (admin, foundation.manage)
 *     operationId: museumAdminListFoundationPrograms
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       '200':
 *         description: Paginated programs.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Museum & News]
 *     summary: Create a foundation program (admin)
 *     operationId: museumAdminCreateFoundationProgram
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FoundationProgramRequest'
 *     responses:
 *       '201':
 *         description: Program created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/admin/foundation-programs/reorder:
 *   post:
 *     tags: [Museum & News]
 *     summary: Reorder foundation programs (admin)
 *     operationId: museumAdminReorderFoundationPrograms
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReorderRequest'
 *     responses:
 *       '200':
 *         description: Order saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/foundation-programs/{id}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Get a foundation program (admin)
 *     operationId: museumAdminGetFoundationProgram
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: The program.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update a foundation program (admin)
 *     operationId: museumAdminUpdateFoundationProgram
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FoundationProgramPatch'
 *     responses:
 *       '200':
 *         description: Program updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete a foundation program (admin)
 *     operationId: museumAdminDeleteFoundationProgram
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Program deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/testimonials:
 *   get:
 *     tags: [Museum & News]
 *     summary: List testimonials (admin, foundation.manage)
 *     operationId: museumAdminListTestimonials
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       '200':
 *         description: Paginated testimonials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Museum & News]
 *     summary: Create a testimonial (admin)
 *     operationId: museumAdminCreateTestimonial
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TestimonialRequest'
 *     responses:
 *       '201':
 *         description: Testimonial created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/testimonials/reorder:
 *   post:
 *     tags: [Museum & News]
 *     summary: Reorder testimonials (admin)
 *     operationId: museumAdminReorderTestimonials
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReorderRequest'
 *     responses:
 *       '200':
 *         description: Order saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/testimonials/{id}:
 *   get:
 *     tags: [Museum & News]
 *     summary: Get a testimonial (admin)
 *     operationId: museumAdminGetTestimonial
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: The testimonial.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     tags: [Museum & News]
 *     summary: Update a testimonial (admin)
 *     operationId: museumAdminUpdateTestimonial
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TestimonialPatch'
 *     responses:
 *       '200':
 *         description: Testimonial updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     tags: [Museum & News]
 *     summary: Delete a testimonial (admin)
 *     operationId: museumAdminDeleteTestimonial
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Testimonial deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
