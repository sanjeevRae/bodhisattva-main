/**
 * Media routes (DATABASE_DESIGN.md §7.7, ARCHITECTURE.md §9).
 *
 * Exported as two routers for the lead to mount in app.ts:
 *   adminRouter  → mount at `/api/admin`:
 *     POST   /media                 media.create  (multipart, field "file")
 *     GET    /media                 media.read    (paginated library)
 *     GET    /media/folders         media.read
 *     POST   /media/folders         media.update
 *     PATCH  /media/folders/:id     media.update
 *     DELETE /media/folders/:id     media.update
 *     PATCH  /media/:id             media.update
 *     DELETE /media/:id             media.delete  (soft, reference-blocked)
 *   publicRouter → mount at `/api`:
 *     GET    /media/:id/file/:variant   master | thumb | medium, public —
 *                                   site pages render images through it;
 *                                   files live outside any web root and
 *                                   are reachable only through this route.
 */
import { createReadStream } from "node:fs";
import { AppError } from "@bodhisattva/shared/errors";
import { paginationQuerySchema } from "@bodhisattva/shared/pagination";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requirePermission,
} from "../../middleware/authorization.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  createFolderSchema,
  listMediaQuerySchema,
  updateAssetSchema,
  updateFolderSchema,
  uploadFieldsSchema,
} from "./media.schemas.js";
import {
  MAX_UPLOAD_BYTES,
  MEDIA_VARIANTS,
  createFolder,
  deleteAsset,
  deleteFolder,
  listFolders,
  listMedia,
  resolveMediaFile,
  updateAsset,
  updateFolder,
  uploadMedia,
  type MediaVariant,
  type RequestMeta,
} from "./media.service.js";

export interface MediaRouterDeps {
  db: Database;
  config: AppConfig;
  logger?: Logger;
}

function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

function parseIdParam(raw: string | string[], message: string): number {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw AppError.notFound(message);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Multipart parsing. Memory storage: the buffer is sniffed and re-encoded
// by the service, never written to disk as-supplied. Multer's own errors
// are converted to the shared error envelope here (the central handler
// does not know MulterError).
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function parseUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          next(
            new AppError(
              "PAYLOAD_TOO_LARGE",
              `The file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB upload limit.`,
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

export function createMediaRouters(deps: MediaRouterDeps): {
  adminRouter: Router;
  publicRouter: Router;
} {
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });

  // ------------------------------------------------------------- admin ---
  const adminRouter = Router();

  adminRouter.post(
    "/media",
    fullSession,
    requirePermission(deps.db, "media.create"),
    parseUpload,
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw AppError.validation(
          [{ field: "file", issue: "A file is required." }],
          "A file is required.",
        );
      }
      const fields = uploadFieldsSchema.parse(req.body ?? {});
      const view = await uploadMedia(
        deps,
        getAuthContext(req),
        {
          buffer: req.file.buffer,
          originalName: req.file.originalname ?? null,
          folderId: fields.folderId,
          altText: fields.altText ? fields.altText : null,
          caption: fields.caption ? fields.caption : null,
        },
        requestMeta(req),
      );
      res.status(201).json(view);
    }),
  );

  adminRouter.get(
    "/media",
    fullSession,
    requirePermission(deps.db, "media.read"),
    asyncHandler(async (req, res) => {
      const pagination = paginationQuerySchema.parse(req.query);
      const filters = listMediaQuerySchema.parse(req.query);
      const { items, total } = await listMedia(deps, pagination, {
        search: filters.search,
        folderId: filters.folderId,
      });
      res.status(200).json({
        items,
        meta: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
        },
      });
    }),
  );

  adminRouter.get(
    "/media/folders",
    fullSession,
    requirePermission(deps.db, "media.read"),
    asyncHandler(async (_req, res) => {
      const folders = await listFolders(deps);
      res.status(200).json({ items: folders });
    }),
  );

  adminRouter.post(
    "/media/folders",
    fullSession,
    requirePermission(deps.db, "media.update"),
    asyncHandler(async (req, res) => {
      const input = createFolderSchema.parse(req.body);
      const view = await createFolder(
        deps,
        getAuthContext(req),
        input,
        requestMeta(req),
      );
      res.status(201).json(view);
    }),
  );

  adminRouter.patch(
    "/media/folders/:folderId",
    fullSession,
    requirePermission(deps.db, "media.update"),
    asyncHandler(async (req, res) => {
      const patch = updateFolderSchema.parse(req.body);
      const view = await updateFolder(
        deps,
        getAuthContext(req),
        parseIdParam(req.params.folderId, "Media folder not found."),
        patch,
        requestMeta(req),
      );
      res.status(200).json(view);
    }),
  );

  adminRouter.delete(
    "/media/folders/:folderId",
    fullSession,
    requirePermission(deps.db, "media.update"),
    asyncHandler(async (req, res) => {
      const folderId = parseIdParam(
        req.params.folderId,
        "Media folder not found.",
      );
      await deleteFolder(deps, getAuthContext(req), folderId, requestMeta(req));
      res
        .status(200)
        .json({ id: folderId, message: "Media folder deleted." });
    }),
  );

  adminRouter.patch(
    "/media/:id",
    fullSession,
    requirePermission(deps.db, "media.update"),
    asyncHandler(async (req, res) => {
      const patch = updateAssetSchema.parse(req.body);
      const view = await updateAsset(
        deps,
        getAuthContext(req),
        parseIdParam(req.params.id, "Media asset not found."),
        patch,
        requestMeta(req),
      );
      res.status(200).json(view);
    }),
  );

  adminRouter.delete(
    "/media/:id",
    fullSession,
    requirePermission(deps.db, "media.delete"),
    asyncHandler(async (req, res) => {
      const assetId = parseIdParam(req.params.id, "Media asset not found.");
      await deleteAsset(deps, getAuthContext(req), assetId, requestMeta(req));
      res.status(200).json({ id: assetId, message: "Media asset deleted." });
    }),
  );

  // ------------------------------------------------------------ public ---
  const publicRouter = Router();

  publicRouter.get(
    "/media/:id/file/:variant",
    asyncHandler(async (req, res) => {
      const variant = Array.isArray(req.params.variant)
        ? req.params.variant[0]
        : req.params.variant;
      if (!MEDIA_VARIANTS.includes(variant as MediaVariant)) {
        throw AppError.notFound("Media file not found.");
      }
      const assetId = parseIdParam(req.params.id, "Media file not found.");
      const resolved = await resolveMediaFile(
        deps,
        assetId,
        variant as MediaVariant,
      );
      if (!resolved) throw AppError.notFound("Media file not found.");
      res.status(200);
      res.setHeader("Content-Type", resolved.mimeType);
      res.setHeader("Content-Length", String(resolved.size));
      // Storage names are random and change on replace: cache hard (§9).
      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
      const stream = createReadStream(resolved.filePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(404).json({
            error: { code: "NOT_FOUND", message: "Media file not found." },
          });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
    }),
  );

  return { adminRouter, publicRouter };
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (the public router mounts at
 * /api, the admin router at /api/admin). Admin routes require a full
 * session plus the named permission; mutations also require the
 * X-CSRF-Token header.
 * ======================================================================== */

/**
 * @openapi
 * /api/media/{id}/file/{variant}:
 *   get:
 *     tags: [Media]
 *     summary: Serve a media file variant (public)
 *     description: Streams the stored image for the asset. Variants are master (original), thumb and medium. PDF document assets are deliberately NOT served here — they return 404 and are only available through the gated News PDF endpoints.
 *     operationId: mediaGetFile
 *     security: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: variant
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [master, thumb, medium]
 *     responses:
 *       '200':
 *         description: The image file.
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/webp:
 *             schema:
 *               type: string
 *               format: binary
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/media:
 *   post:
 *     tags: [Media]
 *     summary: Upload an image (admin)
 *     description: Multipart upload; the file is stored unmodified as the master and thumb/medium variants are derived for images. Requires the media.create permission.
 *     operationId: mediaUpload
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/MediaUploadRequest'
 *     responses:
 *       '201':
 *         description: Asset created.
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
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *   get:
 *     tags: [Media]
 *     summary: List media assets (admin)
 *     description: Requires the media.read permission.
 *     operationId: mediaList
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - name: folderId
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Paginated media assets.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/media/folders:
 *   get:
 *     tags: [Media]
 *     summary: List media folders (admin)
 *     description: Requires the media.read permission.
 *     operationId: mediaListFolders
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: The folder tree.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Media]
 *     summary: Create a media folder (admin)
 *     description: Requires the media.update permission.
 *     operationId: mediaCreateFolder
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateFolderRequest'
 *     responses:
 *       '201':
 *         description: Folder created.
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
 * /api/admin/media/folders/{folderId}:
 *   patch:
 *     tags: [Media]
 *     summary: Update a media folder (admin)
 *     description: Requires the media.update permission.
 *     operationId: mediaUpdateFolder
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: folderId
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
 *             $ref: '#/components/schemas/UpdateFolderRequest'
 *     responses:
 *       '200':
 *         description: Folder updated.
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
 *     tags: [Media]
 *     summary: Delete a media folder (admin)
 *     description: Requires the media.update permission.
 *     operationId: mediaDeleteFolder
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: folderId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Folder deleted.
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
 * /api/admin/media/{id}:
 *   patch:
 *     tags: [Media]
 *     summary: Update a media asset (admin)
 *     description: Requires the media.update permission.
 *     operationId: mediaUpdateAsset
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
 *             $ref: '#/components/schemas/UpdateMediaAssetRequest'
 *     responses:
 *       '200':
 *         description: Asset updated.
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
 *     tags: [Media]
 *     summary: Delete a media asset (admin)
 *     description: Blocked with 409 while the asset is still referenced (page covers, product images, news covers or PDF attachments — including replaced news PDFs). Requires the media.delete permission.
 *     operationId: mediaDeleteAsset
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
 *         description: Asset and its stored files deleted.
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
