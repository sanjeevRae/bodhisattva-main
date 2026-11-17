/**
 * ID conventions (ARCHITECTURE.md §6.1, §8.4).
 *
 * - Admin APIs address resources by numeric primary key (`EntityId`).
 * - Public page/product access is by slug (`Slug`).
 * - Customer-owned resources are always scoped by the session user id in
 *   the query itself — IDs are never authorization (PERMISSIONS.md §6).
 * - Public business references (orders, invoices) use the formatted,
 *   non-sequential-looking numbers below in addition to internal IDs.
 */
import { z } from "zod";

/** Numeric primary key, as used in admin API URLs. */
export type EntityId = number;

/** URL slug for public pages and products. */
export type Slug = string;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(SLUG_PATTERN, "Slug must be lowercase letters, numbers and single hyphens");

export function isValidSlug(value: string): value is Slug {
  return SLUG_PATTERN.test(value) && value.length <= 120;
}

/**
 * Reserved slugs (ARCHITECTURE.md §8.4): the CMS API rejects creating or
 * renaming a page to any of these, and the seven system pages cannot be
 * deleted or re-slugged.
 */
export const RESERVED_SLUGS = [
  "login",
  "register",
  "verify-email",
  "forgot-password",
  "reset-password",
  "accept-invitation",
  "mfa-setup",
  "admin",
  "account",
  "cart",
  "checkout",
  "products",
  "api",
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

export function isReservedSlug(value: string): value is ReservedSlug {
  return (RESERVED_SLUGS as readonly string[]).includes(value);
}

/** Invoice number: `INV-<year>-<5-digit sequence>`, e.g. INV-2026-00042. */
export const INVOICE_NUMBER_PATTERN = /^INV-\d{4}-\d{5}$/;

/** Order number: `ORD-<year>-<6-digit sequence>`, e.g. ORD-2026-000123. */
export const ORDER_NUMBER_PATTERN = /^ORD-\d{4}-\d{6}$/;
