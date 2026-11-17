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
