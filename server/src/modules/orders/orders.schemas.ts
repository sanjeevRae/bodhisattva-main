/**
 * Orders & invoices — request/config schemas (Phase 7).
 *
 * The invoice template configuration schema is the §10.3/spec §12.1
 * contract: validated configuration ONLY (company identity, prefix,
 * colours, footer/terms, field toggles). There is deliberately no field
 * that could carry markup or executable template code — admins
 * configure, they never supply templates.
 */
import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a #RRGGBB colour.");

export const invoiceTemplateConfigSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  companyAddress: z.string().trim().min(1).max(500),
  companyPhone: z.string().trim().max(40).nullable().optional(),
  companyEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .nullable()
    .optional(),
  // A legal identifier: optional, and only ever what the client
  // supplies — the seed leaves it NULL (see seed-data/invoice-content).
  taxRegistrationNumber: z.string().trim().max(60).nullable().optional(),
  logoMediaId: z.number().int().positive().nullable().optional(),
  invoicePrefix: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only."),
  primaryColor: hexColor,
  accentColor: hexColor,
  footerText: z.string().trim().max(500).nullable().optional(),
  termsText: z.string().trim().max(2000).nullable().optional(),
  show: z.object({
    logo: z.boolean(),
    companyPhone: z.boolean(),
    companyEmail: z.boolean(),
    taxRegistrationNumber: z.boolean(),
    deliveryAddress: z.boolean(),
    paymentMethod: z.boolean(),
    terms: z.boolean(),
    footer: z.boolean(),
  }),
});

export type InvoiceTemplateConfig = z.infer<typeof invoiceTemplateConfigSchema>;

export const updateInvoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: invoiceTemplateConfigSchema,
});

export type UpdateInvoiceTemplateInput = z.infer<
  typeof updateInvoiceTemplateSchema
>;

/** Body for every lifecycle transition POST. Reason is required by the
 * service for reject/cancel (validated there, where the action is known). */
export const orderTransitionSchema = z.object({
  reason: z.string().trim().min(1).max(255).optional(),
});

export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;

const orderStatusEnum = z.enum([
  "PENDING_APPROVAL",
  "APPROVED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);

export const adminOrderListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: orderStatusEnum.optional(),
  // ISO dates (YYYY-MM-DD or full timestamps) bounding placed_at.
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
