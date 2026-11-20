/**
 * Store routes (Phase 6, DEVELOPMENT_ROADMAP.md §8):
 *
 *  Public (no auth) — mount at /api:
 *    GET /shop/categories · /shop/products · /shop/products/:slug ·
 *    GET /shop/config
 *
 *  Customer (full session; resources scoped to the session user,
 *  cross-owner access is a 404 per PERMISSIONS.md §6) — mount at /api:
 *    GET /cart · POST /cart/items · PATCH/DELETE /cart/items/:id ·
 *    DELETE /cart
 *    GET/POST /addresses · PATCH/DELETE /addresses/:id
 *    POST /checkout · GET /orders · GET /orders/:id
 *
 *  Admin (full session + the module's permission on every route) —
 *  mount at /api/admin:
 *    /products (CRUD + archive), /products/:id/images,
 *    /products/images/:id, /products/:id/variants,
 *    /products/:id/inventory (+ /adjust), /product-categories.
 *
 * Admin order management is Phase 7 and deliberately absent.
 * Handlers follow the museum routes' shape: requireAuth ran first
 * (req.auth), bodies parse through the module schemas, answers use the
 * shared envelope.
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
import * as adminService from "./admin.service.js";
import type { StoreAdminDeps } from "./admin.service.js";
import * as service from "./service.js";
import type { StoreActor, StoreDeps, RequestMeta } from "./service.js";
import {
  addCartItemSchema,
  adjustInventorySchema,
  checkoutSchema,
  createAddressSchema,
  createProductCategorySchema,
  createProductImageSchema,
  createProductSchema,
  createVariantSchema,
  shopListQuerySchema,
  updateAddressSchema,
  updateCartItemSchema,
  updateProductCategorySchema,
  updateProductImageSchema,
  updateProductSchema,
  updateVariantSchema,
} from "./store.schemas.js";

export interface StoreRouteDeps {
  db: Database;
  config: AppConfig;
}

const idParamSchema = z.coerce.number().int().positive();
const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});
const shopQuerySchema = paginationQuerySchema.extend({
  category: shopListQuerySchema.shape.category,
  search: shopListQuerySchema.shape.search,
  sort: shopListQuerySchema.shape.sort,
});

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function actorOf(req: Request): StoreActor {
  const auth = getAuthContext(req);
  return { userId: auth.userId, email: auth.email };
}

function parseIdParam(req: Request, name = "id"): number {
  return idParamSchema.parse(req.params[name]);
}

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

function sendData(res: Response, status: number, data: unknown): void {
  res.status(status).json({ success: true, data, requestId: res.locals.requestId });
}

// ---------------------------------------------------------------------------
// Public shop router
// ---------------------------------------------------------------------------

export function createStorePublicRouter(deps: StoreRouteDeps): Router {
  const svc: StoreDeps = { db: deps.db, config: deps.config };
  const router = Router();

  router.get(
    "/shop/categories",
    asyncHandler(async (_req: Request, res: Response) => {
      const items = await service.listPublicCategories(svc);
      sendData(res, 200, { items });
    }),
  );

  router.get(
    "/shop/products",
    asyncHandler(async (req: Request, res: Response) => {
      const query = shopQuerySchema.parse(req.query);
      const result = await service.listPublicProducts(svc, query, query);
      sendList(res, query, result);
    }),
  );

  router.get(
    "/shop/products/:slug",
    asyncHandler(async (req: Request, res: Response) => {
      const product = await service.getPublicProductBySlug(
        svc,
        String(req.params.slug),
      );
      sendData(res, 200, product);
    }),
  );

  router.get(
    "/shop/config",
    asyncHandler(async (_req: Request, res: Response) => {
      // Read fresh from the DB on every request and marked no-store:
      // after an admin changes the shipping fee or VAT rate, the
      // product page, cart and checkout must never serve a stale mix.
      res.set("Cache-Control", "no-store");
      const config = await service.getStoreConfig(deps.db);
      sendData(res, 200, config);
    }),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Customer router (cart, addresses, checkout, own orders)
// ---------------------------------------------------------------------------

export function createStoreCustomerRouter(deps: StoreRouteDeps): Router {
  const svc: StoreDeps = { db: deps.db, config: deps.config };
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });
  router.use(fullSession);

  // ---- Cart ---------------------------------------------------------------
  router.get(
    "/cart",
    asyncHandler(async (req: Request, res: Response) => {
      const cart = await service.getCartView(svc, actorOf(req).userId);
      sendData(res, 200, cart);
    }),
  );
  router.post(
    "/cart/items",
    asyncHandler(async (req: Request, res: Response) => {
      const body = addCartItemSchema.parse(req.body);
      const cart = await service.addCartItem(svc, actorOf(req).userId, body);
      sendData(res, 200, cart);
    }),
  );
  router.patch(
    "/cart/items/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateCartItemSchema.parse(req.body);
      const cart = await service.updateCartItem(
        svc,
        actorOf(req).userId,
        parseIdParam(req),
        body,
      );
      sendData(res, 200, cart);
    }),
  );
  router.delete(
    "/cart/items/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const cart = await service.removeCartItem(
        svc,
        actorOf(req).userId,
        parseIdParam(req),
      );
      sendData(res, 200, cart);
    }),
  );
  router.delete(
    "/cart",
    asyncHandler(async (req: Request, res: Response) => {
      const cart = await service.clearCart(svc, actorOf(req).userId);
      sendData(res, 200, cart);
    }),
  );

  // ---- Addresses ------------------------------------------------------------
  router.get(
    "/addresses",
    asyncHandler(async (req: Request, res: Response) => {
      const items = await service.listAddresses(svc, actorOf(req).userId);
      sendData(res, 200, { items });
    }),
  );
  router.post(
    "/addresses",
    asyncHandler(async (req: Request, res: Response) => {
      const body = createAddressSchema.parse(req.body);
      const created = await service.createAddress(svc, actorOf(req).userId, body);
      sendData(res, 201, created);
    }),
  );
  router.patch(
    "/addresses/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateAddressSchema.parse(req.body);
      const updated = await service.updateAddress(
        svc,
        actorOf(req).userId,
        parseIdParam(req),
        body,
      );
      sendData(res, 200, updated);
    }),
  );
  router.delete(
    "/addresses/:id",
    asyncHandler(async (req: Request, res: Response) => {
      await service.deleteAddress(svc, actorOf(req).userId, parseIdParam(req));
      sendData(res, 200, { deleted: true });
    }),
  );

  // ---- Checkout + own orders --------------------------------------------------
  router.post(
    "/checkout",
    asyncHandler(async (req: Request, res: Response) => {
      const body = checkoutSchema.parse(req.body);
      const result = await service.checkout(
        svc,
        actorOf(req),
        body,
        requestMeta(req),
      );
      sendData(res, result.created ? 201 : 200, { order: result.order });
    }),
  );
  router.get(
    "/orders",
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationQuerySchema.parse(req.query);
      const result = await service.listOwnOrders(svc, actorOf(req).userId, query);
      sendList(res, query, result);
    }),
  );
  router.get(
    "/orders/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const order = await service.getOwnOrder(
        svc,
        actorOf(req).userId,
        parseIdParam(req),
      );
      sendData(res, 200, order);
    }),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Admin router
// ---------------------------------------------------------------------------

export function createStoreAdminRouter(deps: StoreRouteDeps): Router {
  const svc: StoreAdminDeps = { db: deps.db, config: deps.config };
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });
  const productsPerm = requirePermission(deps.db, "store.products.manage");
  const categoriesPerm = requirePermission(deps.db, "store.categories.manage");
  const inventoryPerm = requirePermission(deps.db, "store.inventory.manage");

  // ---- Product categories ---------------------------------------------------
  router.get(
    "/product-categories",
    fullSession,
    categoriesPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await adminService.listAdminCategories(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/product-categories",
    fullSession,
    categoriesPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createProductCategorySchema.parse(req.body);
      const created = await adminService.createCategory(svc, actorOf(req), body, requestMeta(req));
      sendData(res, 201, created);
    }),
  );
  router.get(
    "/product-categories/:id",
    fullSession,
    categoriesPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const category = await adminService.getAdminCategory(svc, parseIdParam(req));
      sendData(res, 200, category);
    }),
  );
  router.patch(
    "/product-categories/:id",
    fullSession,
    categoriesPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateProductCategorySchema.parse(req.body);
      const updated = await adminService.updateCategory(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      sendData(res, 200, updated);
    }),
  );
  router.delete(
    "/product-categories/:id",
    fullSession,
    categoriesPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await adminService.deleteCategory(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      sendData(res, 200, { deleted: true });
    }),
  );

  // ---- Product images (registered before /products/:id) ----------------------
  router.patch(
    "/products/images/:id",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateProductImageSchema.parse(req.body);
      const updated = await adminService.updateProductImage(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      sendData(res, 200, updated);
    }),
  );
  router.delete(
    "/products/images/:id",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await adminService.deleteProductImage(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      sendData(res, 200, { deleted: true });
    }),
  );

  // ---- Products ---------------------------------------------------------------
  router.get(
    "/products",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await adminService.listAdminProducts(svc, query, query.search);
      sendList(res, query, result);
    }),
  );
  router.post(
    "/products",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createProductSchema.parse(req.body);
      const created = await adminService.createProduct(svc, actorOf(req), body, requestMeta(req));
      sendData(res, 201, created);
    }),
  );
  router.get(
    "/products/:id",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const product = await adminService.getAdminProduct(svc, parseIdParam(req));
      sendData(res, 200, product);
    }),
  );
  router.patch(
    "/products/:id",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateProductSchema.parse(req.body);
      const updated = await adminService.updateProduct(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      sendData(res, 200, updated);
    }),
  );
  router.delete(
    "/products/:id",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const archived = await adminService.archiveProduct(svc, actorOf(req), parseIdParam(req), requestMeta(req));
      sendData(res, 200, archived);
    }),
  );

  // ---- Product images (nested) --------------------------------------------------
  router.get(
    "/products/:id/images",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const items = await adminService.listProductImages(svc, parseIdParam(req));
      sendData(res, 200, { items });
    }),
  );
  router.post(
    "/products/:id/images",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createProductImageSchema.parse(req.body);
      const created = await adminService.createProductImage(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      sendData(res, 201, created);
    }),
  );

  // ---- Variants -------------------------------------------------------------------
  router.get(
    "/products/:id/variants",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const items = await adminService.listVariants(svc, parseIdParam(req));
      sendData(res, 200, { items });
    }),
  );
  router.post(
    "/products/:id/variants",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createVariantSchema.parse(req.body);
      const created = await adminService.createVariant(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      sendData(res, 201, created);
    }),
  );
  router.patch(
    "/products/:id/variants/:variantId",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateVariantSchema.parse(req.body);
      const updated = await adminService.updateVariant(
        svc,
        actorOf(req),
        parseIdParam(req),
        parseIdParam(req, "variantId"),
        body,
        requestMeta(req),
      );
      sendData(res, 200, updated);
    }),
  );
  router.delete(
    "/products/:id/variants/:variantId",
    fullSession,
    productsPerm,
    asyncHandler(async (req: Request, res: Response) => {
      await adminService.deleteVariant(
        svc,
        actorOf(req),
        parseIdParam(req),
        parseIdParam(req, "variantId"),
        requestMeta(req),
      );
      sendData(res, 200, { deleted: true });
    }),
  );

  // ---- Inventory ---------------------------------------------------------------------
  router.get(
    "/products/:id/inventory",
    fullSession,
    inventoryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationQuerySchema.parse(req.query);
      const productId = parseIdParam(req);
      const summary = await adminService.getInventorySummary(svc, productId);
      const movements = await adminService.listInventoryMovements(svc, productId, query);
      res.status(200).json({
        success: true,
        data: { ...summary, items: movements.items },
        meta: buildPaginationMeta(movements.total, query),
        requestId: res.locals.requestId,
      });
    }),
  );
  router.post(
    "/products/:id/inventory/adjust",
    fullSession,
    inventoryPerm,
    asyncHandler(async (req: Request, res: Response) => {
      const body = adjustInventorySchema.parse(req.body);
      const summary = await adminService.adjustInventory(svc, actorOf(req), parseIdParam(req), body, requestMeta(req));
      sendData(res, 200, summary);
    }),
  );

  return router;
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. The public router mounts at /api (paths under /shop), the
 * customer router at /api (router-level full-session guard), the admin
 * router at /api/admin (store.products.manage / store.categories.manage /
 * store.inventory.manage). Prices are DECIMAL money strings ("4500.00"),
 * never numbers. Product status: DRAFT | ACTIVE | ARCHIVED.
 * ======================================================================== */

/**
 * @openapi
 * /api/shop/categories:
 *   get:
 *     tags: [Store]
 *     summary: List active product categories (public)
 *     operationId: storePublicCategories
 *     security: []
 *     responses:
 *       '200':
 *         description: Active categories in the success envelope (data.items).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 */

/**
 * @openapi
 * /api/shop/products:
 *   get:
 *     tags: [Store]
 *     summary: Browse the public shop (public)
 *     description: Only ACTIVE products are listed. Prices in responses are decimal money strings.
 *     operationId: storePublicProducts
 *     security: []
 *     parameters:
 *       - name: category
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 140
 *         description: Category slug filter.
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - name: sort
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [featured, price-asc, price-desc, name]
 *           default: featured
 *     responses:
 *       '200':
 *         description: Matching products with variants and computed availability.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */

/**
 * @openapi
 * /api/shop/products/{slug}:
 *   get:
 *     tags: [Store]
 *     summary: Read a product by slug (public)
 *     operationId: storePublicProductDetail
 *     security: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The product with images and variants.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/shop/config:
 *   get:
 *     tags: [Store]
 *     summary: Public storefront configuration (public)
 *     description: Storefront-safe configuration for the shop UI (currency and display settings). Internal configuration is never exposed.
 *     operationId: storePublicConfig
 *     security: []
 *     responses:
 *       '200':
 *         description: Storefront configuration.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 */

/**
 * @openapi
 * /api/cart:
 *   get:
 *     tags: [Store]
 *     summary: Read my cart (customer)
 *     description: Server-side cart with current prices, stock checks and computed totals (money strings).
 *     operationId: storeCustomerGetCart
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: The cart with lines and totals.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *   delete:
 *     tags: [Store]
 *     summary: Empty my cart (customer)
 *     operationId: storeCustomerClearCart
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     responses:
 *       '200':
 *         description: The emptied cart.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /api/cart/items:
 *   post:
 *     tags: [Store]
 *     summary: Add an item to my cart (customer)
 *     operationId: storeCustomerAddCartItem
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddCartItemRequest'
 *     responses:
 *       '200':
 *         description: The updated cart.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 */

/**
 * @openapi
 * /api/cart/items/{id}:
 *   patch:
 *     tags: [Store]
 *     summary: Change a cart line quantity (customer)
 *     operationId: storeCustomerUpdateCartItem
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
 *         description: Cart line id.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCartItemRequest'
 *     responses:
 *       '200':
 *         description: The updated cart.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *   delete:
 *     tags: [Store]
 *     summary: Remove a cart line (customer)
 *     operationId: storeCustomerRemoveCartItem
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
 *         description: Cart line id.
 *     responses:
 *       '200':
 *         description: The updated cart.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/addresses:
 *   get:
 *     tags: [Store]
 *     summary: List my delivery addresses (customer)
 *     operationId: storeCustomerListAddresses
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: The signed-in customer's addresses.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     tags: [Store]
 *     summary: Add a delivery address (customer)
 *     description: The phone number is validated against the numbering plan and stored in E.164 format; phoneCountry interprets a national-format number.
 *     operationId: storeCustomerCreateAddress
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddressRequest'
 *     responses:
 *       '201':
 *         description: Address created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /api/addresses/{id}:
 *   patch:
 *     tags: [Store]
 *     summary: Update one of my addresses (customer)
 *     operationId: storeCustomerUpdateAddress
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
 *             $ref: '#/components/schemas/AddressPatch'
 *     responses:
 *       '200':
 *         description: Address updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     tags: [Store]
 *     summary: Delete one of my addresses (customer)
 *     operationId: storeCustomerDeleteAddress
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
 *         description: Address deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/checkout:
 *   post:
 *     tags: [Store]
 *     summary: Place a cash-on-delivery order (customer)
 *     description: Converts the cart into an order in one transaction — totals are computed server-side from live product rows (the body deliberately has no price fields) and stock is reserved. The body idempotencyKey makes retries safe — a replay returns the original order with 200 instead of creating a duplicate.
 *     operationId: storeCustomerCheckout
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckoutRequest'
 *     responses:
 *       '201':
 *         description: Order placed (data.order).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '200':
 *         description: Idempotent replay — the original order for this idempotencyKey.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '409':
 *         $ref: '#/components/responses/Conflict'
 *       '422':
 *         $ref: '#/components/responses/UnprocessableEntity'
 */

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Store]
 *     summary: List my orders (customer)
 *     operationId: storeCustomerListOrders
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *     responses:
 *       '200':
 *         description: The customer's orders, newest first.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Store]
 *     summary: Read one of my orders (customer)
 *     description: Own orders only — another customer's order id answers 404.
 *     operationId: storeCustomerGetOrder
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
 *         description: The order with lines, totals and status.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/* --------------------------------------------------------------------------
 * OpenAPI documentation — admin store routes (same swagger-jsdoc block).
 * ------------------------------------------------------------------------ */

/**
 * @openapi
 * /api/admin/product-categories:
 *   get:
 *     tags: [Store]
 *     summary: List product categories (admin, store.categories.manage)
 *     operationId: storeAdminListCategories
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       '200':
 *         description: Paginated categories.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Store]
 *     summary: Create a product category (admin)
 *     operationId: storeAdminCreateCategory
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductCategoryRequest'
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
 * /api/admin/product-categories/{id}:
 *   get:
 *     tags: [Store]
 *     summary: Get a product category (admin)
 *     operationId: storeAdminGetCategory
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
 *         description: The category.
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
 *     tags: [Store]
 *     summary: Update a product category (admin)
 *     operationId: storeAdminUpdateCategory
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
 *             $ref: '#/components/schemas/ProductCategoryPatch'
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
 *     tags: [Store]
 *     summary: Delete a product category (admin)
 *     operationId: storeAdminDeleteCategory
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
 * /api/admin/products:
 *   get:
 *     tags: [Store]
 *     summary: List products (admin, store.products.manage)
 *     operationId: storeAdminListProducts
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - name: status
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [DRAFT, ACTIVE, ARCHIVED]
 *       - name: categoryId
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Paginated products in every status.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     tags: [Store]
 *     summary: Create a product (admin)
 *     description: Price and salePrice are decimal money strings. stockQty, when given, is written as an OPENING inventory ledger movement.
 *     operationId: storeAdminCreateProduct
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductRequest'
 *     responses:
 *       '201':
 *         description: Product created.
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
 * /api/admin/products/{id}:
 *   get:
 *     tags: [Store]
 *     summary: Get a product (admin)
 *     operationId: storeAdminGetProduct
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
 *         description: The product with images, variants and stock summary.
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
 *     tags: [Store]
 *     summary: Update a product (admin)
 *     description: Status changes (DRAFT / ACTIVE / ARCHIVED) are made through this patch — there are no separate publish endpoints.
 *     operationId: storeAdminUpdateProduct
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
 *             $ref: '#/components/schemas/ProductPatch'
 *     responses:
 *       '200':
 *         description: Product updated.
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
 *     tags: [Store]
 *     summary: Archive a product (admin)
 *     description: Soft delete — the product moves to ARCHIVED and leaves the public shop.
 *     operationId: storeAdminDeleteProduct
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
 *         description: Product archived.
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
 * /api/admin/products/{id}/images:
 *   get:
 *     tags: [Store]
 *     summary: List a product's images (admin)
 *     operationId: storeAdminListProductImages
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
 *         description: The product's images.
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
 *   post:
 *     tags: [Store]
 *     summary: Add a product image (admin)
 *     description: JSON body — reference an existing media asset by mediaId, or supply an external imageUrl (at least one of the two).
 *     operationId: storeAdminAddProductImage
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
 *             $ref: '#/components/schemas/ProductImageRequest'
 *     responses:
 *       '201':
 *         description: Image added.
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
 * /api/admin/products/images/{id}:
 *   patch:
 *     tags: [Store]
 *     summary: Update a product image (admin)
 *     operationId: storeAdminUpdateProductImage
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
 *             $ref: '#/components/schemas/ProductImagePatch'
 *     responses:
 *       '200':
 *         description: Image updated.
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
 *     tags: [Store]
 *     summary: Remove a product image (admin)
 *     operationId: storeAdminDeleteProductImage
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
 *         description: Image removed.
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
 * /api/admin/products/{id}/variants:
 *   get:
 *     tags: [Store]
 *     summary: List a product's variants (admin)
 *     operationId: storeAdminListVariants
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
 *         description: The product's variants.
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
 *   post:
 *     tags: [Store]
 *     summary: Add a product variant (admin)
 *     description: priceDelta is a signed decimal money string applied over the product price. stockQty, when given, is written as an OPENING ledger movement.
 *     operationId: storeAdminCreateVariant
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
 *             $ref: '#/components/schemas/VariantRequest'
 *     responses:
 *       '201':
 *         description: Variant created.
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
 * /api/admin/products/{id}/variants/{variantId}:
 *   patch:
 *     tags: [Store]
 *     summary: Update a variant (admin)
 *     operationId: storeAdminUpdateVariant
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
 *       - name: variantId
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
 *             $ref: '#/components/schemas/VariantPatch'
 *     responses:
 *       '200':
 *         description: Variant updated.
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
 *     tags: [Store]
 *     summary: Delete a variant (admin)
 *     operationId: storeAdminDeleteVariant
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
 *       - name: variantId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: Variant deleted.
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
 * /api/admin/products/{id}/inventory:
 *   get:
 *     tags: [Store]
 *     summary: Read a product's inventory ledger (admin, store.inventory.manage)
 *     description: Paginated stock movements (OPENING, RESERVATION, RELEASE, SALE, ADJUSTMENT) with running balances.
 *     operationId: storeAdminGetInventory
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
 *         description: Inventory ledger page.
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
 * /api/admin/products/{id}/inventory/adjust:
 *   post:
 *     tags: [Store]
 *     summary: Adjust stock (admin, store.inventory.manage)
 *     description: Writes an ADJUSTMENT ledger movement for the product or one variant. Provide exactly one of quantity (signed delta) or setQuantity (absolute on-hand).
 *     operationId: storeAdminAdjustInventory
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
 *             $ref: '#/components/schemas/AdjustInventoryRequest'
 *     responses:
 *       '200':
 *         description: Stock adjusted; returns the updated stock summary.
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
 *       '422':
 *         $ref: '#/components/responses/UnprocessableEntity'
 */
