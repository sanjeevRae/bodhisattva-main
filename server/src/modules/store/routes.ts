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
