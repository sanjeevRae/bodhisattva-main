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
 *   PUT    /settings                           settings.manage, or
 *                                              store.settings.manage for
 *                                              store.* keys only (Phase 6)
 */
import { AppError } from "@bodhisattva/shared/errors";
import { Router, type Request } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import { createRequireAuth } from "../../middleware/auth.js";
import {
  getAuthContext,
  requireAnyPermission,
  requirePermission,
} from "../../middleware/authorization.js";
import { getEffectivePermissions } from "../../services/permissions.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { lastGoodCacheDir, withLastGood } from "./last-good.js";
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
      // Last-good cache (Phase 8d): a database outage serves the most
      // recent successful payload, marked via X-Content-Source.
      const slug = String(req.params.slug);
      const { payload, source } = await withLastGood({
        cacheDir: lastGoodCacheDir(deps.config),
        name: `page-${slug}`,
        read: () => getPublishedPageBySlug(cms, slug),
      });
      if (source === "cache") res.set("X-Content-Source", "last-good-cache");
      res.status(200).json(payload);
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
      const { payload, source } = await withLastGood({
        cacheDir: lastGoodCacheDir(deps.config),
        name: "site",
        read: async () => ({ settings: await getPublicSettings(cms) }),
      });
      if (source === "cache") res.set("X-Content-Source", "last-good-cache");
      res.status(200).json(payload);
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
      const { expectedVersion, revisionId, sections } =
        saveDraftSchema.parse(req.body);
      const draft = await saveDraft(
        cms,
        actorOf(req),
        parseIdParam(req.params.id, "Page"),
        sections,
        expectedVersion,
        revisionId,
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

  // PUT /settings: settings.manage may write any key. Since Phase 6 a
  // caller holding only store.settings.manage may also use this route,
  // but ONLY for keys beginning "store." — all-or-nothing per request:
  // one non-store key in the payload rejects the whole update (403).
  router.put(
    "/settings",
    fullSession,
    requireAnyPermission(deps.db, "settings.manage", "store.settings.manage"),
    asyncHandler(async (req, res) => {
      const { settings } = updateSettingsSchema.parse(req.body);
      const actor = actorOf(req);
      const granted = await getEffectivePermissions(deps.db, actor.userId);
      if (!granted.has("settings.manage")) {
        const foreign = settings.find(
          (entry) => !entry.key.startsWith("store."),
        );
        if (foreign) {
          throw AppError.forbidden(
            "store.settings.manage allows updating store.* settings only.",
          );
        }
      }
      const items = await updateSettings(
        cms,
        actor,
        settings,
        requestMeta(req),
      );
      res.status(200).json({ items });
    }),
  );

  return router;
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. Paths are the full public paths (the public router mounts at
 * /api, the admin router at /api/admin). Public payloads return the
 * resource object directly (no envelope). Admin routes require a full
 * session plus the named permission; mutations also require the
 * X-CSRF-Token header.
 * ======================================================================== */

/**
 * @openapi
 * /api/pages/{slug}:
 *   get:
 *     tags: [CMS]
 *     summary: Get a published page by slug
 *     description: Returns the published page payload (sections included). During a database outage the last-good cached payload may be served, marked with the X-Content-Source response header.
 *     operationId: cmsGetPublicPage
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The published page payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Page object with its sections (shape defined by the CMS registry).
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/pages/{slug}/preview:
 *   get:
 *     tags: [CMS]
 *     summary: Preview an unpublished page revision
 *     description: Bearer-token preview of draft content. The token comes from POST /api/admin/pages/{id}/preview-token and is passed as the token query parameter. Responses are never cached or indexed.
 *     operationId: cmsPreviewPage
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: token
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *         description: The preview token issued by an admin.
 *     responses:
 *       '200':
 *         description: The draft page payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/menus/{code}:
 *   get:
 *     tags: [CMS]
 *     summary: Get a navigation menu by code
 *     operationId: cmsGetPublicMenu
 *     security: []
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Menu code, e.g. main or footer.
 *     responses:
 *       '200':
 *         description: The menu with its visible items.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/site:
 *   get:
 *     tags: [CMS]
 *     summary: Get the public site settings
 *     description: Returns the settings flagged public (contact details, social links and similar). During a database outage the last-good cached payload may be served.
 *     operationId: cmsGetSite
 *     security: []
 *     responses:
 *       '200':
 *         description: Public settings object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   type: object
 *               required: [settings]
 */

/**
 * @openapi
 * /api/admin/pages:
 *   get:
 *     tags: [CMS]
 *     summary: List CMS pages (admin)
 *     description: Requires the cms.pages.read permission.
 *     operationId: cmsAdminListPages
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: All pages.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ItemsResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [CMS]
 *     summary: Create a CMS page (admin)
 *     description: Requires the cms.pages.create permission.
 *     operationId: cmsAdminCreatePage
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePageRequest'
 *     responses:
 *       '201':
 *         description: Page created.
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
 * /api/admin/pages/{id}:
 *   get:
 *     tags: [CMS]
 *     summary: Get a CMS page (admin)
 *     description: Requires the cms.pages.read permission.
 *     operationId: cmsAdminGetPage
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
 *         description: The page with admin metadata.
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
 *     tags: [CMS]
 *     summary: Update page metadata (admin)
 *     description: Requires the cms.pages.update permission.
 *     operationId: cmsAdminUpdatePage
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
 *             $ref: '#/components/schemas/UpdatePageRequest'
 *     responses:
 *       '200':
 *         description: Page updated.
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
 *     tags: [CMS]
 *     summary: Delete a CMS page (admin)
 *     description: Requires the cms.pages.delete permission.
 *     operationId: cmsAdminDeletePage
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
 *         description: Page deleted.
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
 * /api/admin/pages/{id}/draft:
 *   get:
 *     tags: [CMS]
 *     summary: Get the working draft of a page (admin)
 *     description: Requires the cms.pages.read permission.
 *     operationId: cmsAdminGetDraft
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
 *         description: The draft revision with its sections.
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
 *   put:
 *     tags: [CMS]
 *     summary: Save the working draft of a page (admin)
 *     description: Optimistic concurrency — the save is refused with 409 when the draft pointer or version has moved since the editor loaded it. Requires the cms.pages.update permission.
 *     operationId: cmsAdminSaveDraft
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
 *             $ref: '#/components/schemas/SaveDraftRequest'
 *     responses:
 *       '200':
 *         description: Draft saved.
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
 */

/**
 * @openapi
 * /api/admin/pages/{id}/publish:
 *   post:
 *     tags: [CMS]
 *     summary: Publish the current draft (admin)
 *     description: Requires the cms.pages.publish permission.
 *     operationId: cmsAdminPublishPage
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
 *         description: Page published.
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
 * /api/admin/pages/{id}/rollback/{revisionId}:
 *   post:
 *     tags: [CMS]
 *     summary: Roll a page back to a previous revision (admin)
 *     description: Requires the cms.pages.restore permission.
 *     operationId: cmsAdminRollbackPage
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
 *       - name: revisionId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Page restored to the revision.
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
 * /api/admin/pages/{id}/revisions:
 *   get:
 *     tags: [CMS]
 *     summary: List a page's revisions (admin)
 *     description: Requires the cms.pages.read permission.
 *     operationId: cmsAdminListRevisions
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
 *         description: Revision history.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ItemsResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/pages/{id}/preview-token:
 *   post:
 *     tags: [CMS]
 *     summary: Create a page preview token (admin)
 *     description: Issues a short-lived bearer token for GET /api/pages/{slug}/preview. Requires the cms.pages.read permission.
 *     operationId: cmsAdminCreatePreviewToken
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
 *         description: Preview token created.
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
 * /api/admin/menus:
 *   get:
 *     tags: [CMS]
 *     summary: List menus (admin)
 *     description: Requires the cms.menus.manage permission.
 *     operationId: cmsAdminListMenus
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: All menus with their items.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ItemsResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/menus/{code}:
 *   put:
 *     tags: [CMS]
 *     summary: Replace a menu's items (admin)
 *     description: Requires the cms.menus.manage permission.
 *     operationId: cmsAdminReplaceMenuItems
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *       - name: code
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReplaceMenuItemsRequest'
 *     responses:
 *       '200':
 *         description: Menu items replaced.
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
 * /api/admin/settings:
 *   get:
 *     tags: [CMS]
 *     summary: List all site settings (admin)
 *     description: Requires the settings.manage permission.
 *     operationId: cmsAdminListSettings
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: All settings, public and private.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ItemsResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   put:
 *     tags: [CMS]
 *     summary: Update site settings (admin)
 *     description: Requires the settings.manage or store.settings.manage permission.
 *     operationId: cmsAdminUpdateSettings
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateSettingsRequest'
 *     responses:
 *       '200':
 *         description: Settings updated.
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
