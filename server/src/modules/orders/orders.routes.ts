/**
 * Orders & invoices routes (Phase 7, PERMISSIONS.md §8).
 *
 * Admin — mount at /api/admin (full session + permission per route):
 *   GET  /orders                              store.orders.read
 *   GET  /orders/:id                          store.orders.read
 *   POST /orders/:id/approve                  store.orders.approve
 *   POST /orders/:id/reject                   store.orders.cancel
 *   POST /orders/:id/cancel                   store.orders.cancel
 *   POST /orders/:id/process|ship|deliver     store.orders.update
 *   POST /orders/:id/invoice/resend           store.invoices.resend
 *   GET  /invoices · /invoices/:id            store.invoices.manage
 *   GET  /invoices/:id/download               store.invoices.manage
 *   GET  /invoices/:id/credit-note.pdf        store.invoices.manage (Phase 8)
 *   GET|PUT /invoice-template                 store.invoice_templates.manage
 *   GET  /invoice-template/preview.pdf        store.invoice_templates.manage
 *
 * Step-up: PERMISSIONS.md §7's step-up list does not include order
 * actions, so transitions are permission-gated only (the Phase 2
 * pattern — see orders.service header).
 *
 * Customer — mount at /api (full session, ownership-scoped; another
 * customer's order/invoice is a 404 per PERMISSIONS.md §6):
 *   GET /orders/:id/invoice · GET /orders/:id/invoice.pdf
 *   GET /orders/:id/credit-note.pdf           (Phase 8)
 */
import { AppError } from "@bodhisattva/shared/errors";
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
import * as creditNotesService from "./credit-notes.service.js";
import { resolveInvoiceLogoImage } from "./invoice-files.js";
import { renderInvoicePdf, type InvoiceSnapshot } from "./invoice-pdf.js";
import * as invoicesService from "./invoices.service.js";
import {
  adminOrderListQuerySchema,
  orderTransitionSchema,
  updateInvoiceTemplateSchema,
  type InvoiceTemplateConfig,
} from "./orders.schemas.js";
import * as ordersService from "./orders.service.js";
import type { OrdersActor } from "./orders.service.js";
import type { OrdersDeps } from "./outbox.service.js";
import type { RequestMeta } from "../store/service.js";

export interface OrdersRouteDeps {
  db: Database;
  config: AppConfig;
}

const idParamSchema = z.coerce.number().int().positive();
const listQuerySchema = paginationQuerySchema.extend(
  adminOrderListQuerySchema.shape,
);

const ROLE_PRECEDENCE = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN", "CUSTOMER"];

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function actorOf(req: Request): OrdersActor {
  const auth = getAuthContext(req);
  const role =
    ROLE_PRECEDENCE.find((candidate) => auth.roles.includes(candidate)) ??
    auth.roles[0] ??
    null;
  return { userId: auth.userId, email: auth.email, role };
}

function parseIdParam(req: Request, name = "id"): number {
  return idParamSchema.parse(req.params[name]);
}

function sendData(res: Response, status: number, data: unknown): void {
  res.status(status).json({ success: true, data, requestId: res.locals.requestId });
}

function sendPdf(res: Response, buffer: Buffer, filename: string, inline = false): void {
  res
    .status(200)
    .setHeader("Content-Type", "application/pdf")
    .setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    )
    .send(buffer);
}

// ---------------------------------------------------------------------------
// Admin router
// ---------------------------------------------------------------------------

export function createOrdersAdminRouter(deps: OrdersRouteDeps): Router {
  const svc: OrdersDeps = { db: deps.db, config: deps.config };
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  const fullSession = requireAuth({ allowLevels: ["full"] });
  const ordersRead = requirePermission(deps.db, "store.orders.read");
  const ordersApprove = requirePermission(deps.db, "store.orders.approve");
  const ordersCancel = requirePermission(deps.db, "store.orders.cancel");
  const ordersUpdate = requirePermission(deps.db, "store.orders.update");
  const invoicesManage = requirePermission(deps.db, "store.invoices.manage");
  const invoicesResend = requirePermission(deps.db, "store.invoices.resend");
  const templatesManage = requirePermission(
    deps.db,
    "store.invoice_templates.manage",
  );

  // ---- Orders ---------------------------------------------------------
  router.get(
    "/orders",
    fullSession,
    ordersRead,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listQuerySchema.parse(req.query);
      const result = await ordersService.listAdminOrders(svc, query, query);
      res.status(200).json({
        success: true,
        data: result.items,
        meta: buildPaginationMeta(result.total, query),
        requestId: res.locals.requestId,
      });
    }),
  );
  router.get(
    "/orders/:id",
    fullSession,
    ordersRead,
    asyncHandler(async (req: Request, res: Response) => {
      const detail = await ordersService.getAdminOrderDetail(svc, parseIdParam(req));
      if (!detail) throw AppError.notFound("Order not found.");
      sendData(res, 200, detail);
    }),
  );

  const transition = (action: ordersService.OrderAction) =>
    asyncHandler(async (req: Request, res: Response) => {
      const body = orderTransitionSchema.parse(req.body ?? {});
      const result = await ordersService.transitionOrder(
        svc,
        parseIdParam(req),
        action,
        actorOf(req),
        body.reason,
        requestMeta(req),
      );
      sendData(res, 200, result.detail);
    });

  router.post("/orders/:id/approve", fullSession, ordersApprove, transition("approve"));
  router.post("/orders/:id/reject", fullSession, ordersCancel, transition("reject"));
  router.post("/orders/:id/cancel", fullSession, ordersCancel, transition("cancel"));
  router.post("/orders/:id/process", fullSession, ordersUpdate, transition("process"));
  router.post("/orders/:id/ship", fullSession, ordersUpdate, transition("ship"));
  router.post("/orders/:id/deliver", fullSession, ordersUpdate, transition("deliver"));

  router.post(
    "/orders/:id/invoice/resend",
    fullSession,
    invoicesResend,
    asyncHandler(async (req: Request, res: Response) => {
      const view = await invoicesService.resendInvoiceEmail(
        svc,
        parseIdParam(req),
        actorOf(req),
        requestMeta(req),
      );
      sendData(res, 200, view);
    }),
  );

  // ---- Invoices ---------------------------------------------------------
  router.get(
    "/invoices",
    fullSession,
    invoicesManage,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationQuerySchema.parse(req.query);
      const result = await invoicesService.listAdminInvoices(deps.db, query);
      res.status(200).json({
        success: true,
        data: result.items,
        meta: buildPaginationMeta(result.total, query),
        requestId: res.locals.requestId,
      });
    }),
  );
  router.get(
    "/invoices/:id",
    fullSession,
    invoicesManage,
    asyncHandler(async (req: Request, res: Response) => {
      const found = await invoicesService.getAdminInvoice(deps.db, parseIdParam(req));
      if (!found) throw AppError.notFound("Invoice not found.");
      sendData(res, 200, {
        view: found.view,
        snapshot: found.snapshot,
        creditNote: found.creditNote,
      });
    }),
  );
  router.get(
    "/invoices/:id/download",
    fullSession,
    invoicesManage,
    asyncHandler(async (req: Request, res: Response) => {
      const found = await invoicesService.getAdminInvoice(deps.db, parseIdParam(req));
      if (!found) throw AppError.notFound("Invoice not found.");
      const buffer = await invoicesService.getInvoicePdfBuffer(svc, found.invoice);
      sendPdf(res, buffer, `${found.view.invoiceNumber}.pdf`);
    }),
  );
  // Phase 8: the credit note reversing this invoice, as a PDF.
  router.get(
    "/invoices/:id/credit-note.pdf",
    fullSession,
    invoicesManage,
    asyncHandler(async (req: Request, res: Response) => {
      const invoiceId = parseIdParam(req);
      const creditNote = await creditNotesService.getCreditNoteByInvoiceId(
        deps.db,
        invoiceId,
      );
      if (!creditNote) throw AppError.notFound("Credit note not found.");
      const buffer = await creditNotesService.getCreditNotePdfBuffer(svc, creditNote);
      sendPdf(res, buffer, `${creditNote.creditNoteNumber}.pdf`);
    }),
  );

  // ---- Invoice template ---------------------------------------------------
  router.get(
    "/invoice-template",
    fullSession,
    templatesManage,
    asyncHandler(async (_req: Request, res: Response) => {
      const state = await invoicesService.getTemplateState(deps.db);
      sendData(res, 200, state);
    }),
  );
  router.put(
    "/invoice-template",
    fullSession,
    templatesManage,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateInvoiceTemplateSchema.parse(req.body);
      const state = await invoicesService.updateTemplate(
        svc,
        actorOf(req),
        body,
        requestMeta(req),
      );
      sendData(res, 200, state);
    }),
  );
  router.get(
    "/invoice-template/preview.pdf",
    fullSession,
    templatesManage,
    asyncHandler(async (_req: Request, res: Response) => {
      const state = await invoicesService.getTemplateState(deps.db);
      if (!state.activeVersion) throw AppError.internal();
      const snapshot = sampleSnapshot(
        state.activeVersion.config,
        state.activeVersion.id,
        state.activeVersion.versionNo,
      );
      const logoImage = await resolveInvoiceLogoImage(deps.db, deps.config, snapshot);
      const buffer = await renderInvoicePdf(snapshot, { logoImage });
      sendPdf(res, buffer, "invoice-preview.pdf", true);
    }),
  );

  return router;
}

/** A clearly-marked sample invoice rendered from the CURRENT template
 * version's configuration — the editor's preview (Phase 7 brief). */
function sampleSnapshot(
  config: InvoiceTemplateConfig,
  versionId: number,
  versionNo: number,
): InvoiceSnapshot {
  const now = new Date().toISOString();
  return {
    invoiceNumber: `${config.invoicePrefix}-SAMPLE`,
    issuedAt: now,
    orderNumber: "ORD-SAMPLE",
    orderPlacedAt: now,
    currency: "NPR",
    paymentMethod: "COD",
    seller: {
      name: config.companyName,
      address: config.companyAddress,
      phone: config.companyPhone ?? null,
      email: config.companyEmail ?? null,
      taxRegistrationNumber: config.taxRegistrationNumber ?? null,
      logoMediaId: config.logoMediaId ?? null,
    },
    buyer: {
      name: "Sample Customer",
      email: "sample@example.com",
      phone: "+977-9800000000",
    },
    delivery: {
      recipientName: "Sample Customer",
      phone: "+977-9800000000",
      addressLine: "Sample Street 1",
      city: "Lalitpur",
      district: "Lalitpur",
      postalCode: null,
      notes: null,
    },
    lines: [
      {
        name: "Sample Thangka Painting",
        variantName: null,
        sku: "SAMPLE-001",
        quantity: 1,
        unitPrice: "4500.00",
        lineTotal: "4500.00",
      },
      {
        name: "Sample Museum Catalogue",
        variantName: null,
        sku: "SAMPLE-002",
        quantity: 2,
        unitPrice: "1200.00",
        lineTotal: "2400.00",
      },
    ],
    totals: {
      subtotal: "6900.00",
      shippingFee: "0.00",
      discountTotal: "0.00",
      taxTotal: "0.00",
      grandTotal: "6900.00",
    },
    template: { versionId, versionNo, config },
  };
}

// ---------------------------------------------------------------------------
// Customer router
// ---------------------------------------------------------------------------

export function createOrdersCustomerRouter(deps: OrdersRouteDeps): Router {
  const svc: OrdersDeps = { db: deps.db, config: deps.config };
  const router = Router();
  const requireAuth = createRequireAuth(deps);
  router.use(requireAuth({ allowLevels: ["full"] }));

  router.get(
    "/orders/:id/invoice",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = getAuthContext(req);
      const { invoice, order } = await ordersService.getOwnInvoice(
        svc,
        auth.userId,
        parseIdParam(req),
      );
      // Phase 8: a credit note reversing this invoice, when present.
      const creditNote = await creditNotesService.getCreditNoteByOrderId(
        svc.db,
        order.id,
      );
      sendData(res, 200, {
        ...invoicesService.toInvoiceView(invoice, order.orderNumber),
        downloadPath: `/api/orders/${order.id}/invoice.pdf`,
        creditNote: creditNote
          ? {
              ...creditNotesService.toCreditNoteSummary(creditNote),
              downloadPath: `/api/orders/${order.id}/credit-note.pdf`,
            }
          : null,
      });
    }),
  );
  router.get(
    "/orders/:id/invoice.pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = getAuthContext(req);
      const { invoice } = await ordersService.getOwnInvoice(
        svc,
        auth.userId,
        parseIdParam(req),
      );
      const buffer = await invoicesService.getInvoicePdfBuffer(svc, invoice);
      sendPdf(res, buffer, `${invoice.invoiceNumber}.pdf`);
    }),
  );
  // Phase 8: the owner's credit-note PDF (another customer's order,
  // or an order without a credit note, is a 404 — getOwnCreditNote).
  router.get(
    "/orders/:id/credit-note.pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = getAuthContext(req);
      const { creditNote } = await ordersService.getOwnCreditNote(
        svc,
        auth.userId,
        parseIdParam(req),
      );
      const buffer = await creditNotesService.getCreditNotePdfBuffer(svc, creditNote);
      sendPdf(res, buffer, `${creditNote.creditNoteNumber}.pdf`);
    }),
  );

  return router;
}

/* ==========================================================================
 * OpenAPI documentation (swagger-jsdoc) — documentation only, no runtime
 * behaviour. The customer router mounts at /api (full session; documents
 * are scoped to the signed-in customer's own orders — foreign ids answer
 * 404). The admin router mounts at /api/admin behind store.orders.* /
 * store.invoices.* / store.invoice_templates.manage permissions.
 * Order lifecycle: PENDING_APPROVAL → APPROVED → PROCESSING → SHIPPED →
 * DELIVERED, with reject/cancel exits; each step is its own POST below.
 * ======================================================================== */

/**
 * @openapi
 * /api/orders/{id}/invoice:
 *   get:
 *     tags: [Orders]
 *     summary: Read my order's invoice (customer)
 *     description: The invoice view for an order the signed-in customer owns, once approval has issued it.
 *     operationId: ordersCustomerGetInvoice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Order id.
 *     responses:
 *       '200':
 *         description: The invoice.
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
 * /api/orders/{id}/invoice.pdf:
 *   get:
 *     tags: [Orders]
 *     summary: Download my order's invoice PDF (customer)
 *     operationId: ordersCustomerDownloadInvoice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Order id.
 *     responses:
 *       '200':
 *         description: The invoice PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/orders/{id}/credit-note.pdf:
 *   get:
 *     tags: [Orders]
 *     summary: Download my order's credit note PDF (customer)
 *     description: Answers 404 when the order has no credit note.
 *     operationId: ordersCustomerDownloadCreditNote
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Order id.
 *     responses:
 *       '200':
 *         description: The credit note PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /api/admin/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List orders (admin, store.orders.read)
 *     operationId: ordersAdminList
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
 *           enum: [PENDING_APPROVAL, APPROVED, PROCESSING, SHIPPED, DELIVERED, CANCELLED]
 *       - name: from
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *         description: Placed-at lower bound (YYYY-MM-DD or ISO timestamp).
 *       - name: to
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 40
 *         description: Placed-at upper bound (YYYY-MM-DD or ISO timestamp).
 *     responses:
 *       '200':
 *         description: Paginated orders.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Read an order (admin, store.orders.read)
 *     description: Full order detail — lines, totals, address snapshot, status history and invoice state.
 *     operationId: ordersAdminDetail
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
 *         description: The order detail.
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
 * /api/admin/orders/{id}/approve:
 *   post:
 *     tags: [Orders]
 *     summary: Approve a pending order (admin, store.orders.approve)
 *     description: Approval issues exactly one invoice for the order; the transition is guarded so a repeat can never create a second invoice.
 *     operationId: ordersAdminApprove
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderTransitionRequest'
 *     responses:
 *       '200':
 *         description: The updated order detail.
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
 * /api/admin/orders/{id}/reject:
 *   post:
 *     tags: [Orders]
 *     summary: Reject a pending order (admin, store.orders.cancel)
 *     description: A reason is required. Rejection releases the order's stock reservations exactly once.
 *     operationId: ordersAdminReject
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderTransitionRequest'
 *     responses:
 *       '200':
 *         description: The updated order detail.
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
 * /api/admin/orders/{id}/cancel:
 *   post:
 *     tags: [Orders]
 *     summary: Cancel an order (admin, store.orders.cancel)
 *     description: A reason is required. Cancellation restores reserved stock exactly once.
 *     operationId: ordersAdminCancel
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderTransitionRequest'
 *     responses:
 *       '200':
 *         description: The updated order detail.
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
 * /api/admin/orders/{id}/process:
 *   post:
 *     tags: [Orders]
 *     summary: Move an approved order to PROCESSING (admin, store.orders.update)
 *     operationId: ordersAdminProcess
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderTransitionRequest'
 *     responses:
 *       '200':
 *         description: The updated order detail.
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
 * /api/admin/orders/{id}/ship:
 *   post:
 *     tags: [Orders]
 *     summary: Mark an order SHIPPED (admin, store.orders.update)
 *     operationId: ordersAdminShip
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderTransitionRequest'
 *     responses:
 *       '200':
 *         description: The updated order detail.
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
 * /api/admin/orders/{id}/deliver:
 *   post:
 *     tags: [Orders]
 *     summary: Mark an order DELIVERED (admin, store.orders.update)
 *     description: Delivery completes the COD order; payment collection is reflected on the order/invoice state.
 *     operationId: ordersAdminDeliver
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderTransitionRequest'
 *     responses:
 *       '200':
 *         description: The updated order detail.
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
 * /api/admin/orders/{id}/invoice/resend:
 *   post:
 *     tags: [Orders]
 *     summary: Resend an order's invoice email (admin, store.invoices.resend)
 *     operationId: ordersAdminResendInvoice
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
 *         description: Order id.
 *     responses:
 *       '200':
 *         description: The invoice view after queueing the resend.
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
 * /api/admin/invoices:
 *   get:
 *     tags: [Orders]
 *     summary: List invoices (admin, store.invoices.manage)
 *     operationId: ordersAdminListInvoices
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *     responses:
 *       '200':
 *         description: Paginated invoices.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /api/admin/invoices/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Read an invoice (admin, store.invoices.manage)
 *     operationId: ordersAdminGetInvoice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Invoice id.
 *     responses:
 *       '200':
 *         description: The invoice.
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
 * /api/admin/invoices/{id}/download:
 *   get:
 *     tags: [Orders]
 *     summary: Download an invoice PDF (admin, store.invoices.manage)
 *     operationId: ordersAdminDownloadInvoice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Invoice id.
 *     responses:
 *       '200':
 *         description: The invoice PDF.
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
 * /api/admin/invoices/{id}/credit-note.pdf:
 *   get:
 *     tags: [Orders]
 *     summary: Download an invoice's credit note PDF (admin, store.invoices.manage)
 *     description: Answers 404 when the invoice has no credit note.
 *     operationId: ordersAdminDownloadCreditNote
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Invoice id.
 *     responses:
 *       '200':
 *         description: The credit note PDF.
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
 * /api/admin/invoice-template:
 *   get:
 *     tags: [Orders]
 *     summary: Read the invoice template (admin, store.invoice_templates.manage)
 *     description: The active invoice template — validated configuration only (company identity, prefix, colours, footer/terms, field toggles). Admins configure; they never supply markup or template code.
 *     operationId: ordersAdminGetInvoiceTemplate
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: The template state (name + config).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *   put:
 *     tags: [Orders]
 *     summary: Replace the invoice template configuration (admin)
 *     operationId: ordersAdminUpdateInvoiceTemplate
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CsrfToken'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateInvoiceTemplateRequest'
 *     responses:
 *       '200':
 *         description: The updated template state.
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
 * /api/admin/invoice-template/preview.pdf:
 *   get:
 *     tags: [Orders]
 *     summary: Preview the invoice template as a PDF (admin, store.invoice_templates.manage)
 *     description: Renders a sample invoice with the current template configuration.
 *     operationId: ordersAdminPreviewInvoiceTemplate
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: The preview PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 */
