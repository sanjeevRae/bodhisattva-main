/**
 * Pagination contract (ARCHITECTURE.md §6.1).
 *
 * Lists are always paginated: `?page=1&pageSize=20` (pageSize max 100) and
 * list responses carry `meta: { page, pageSize, total, totalPages }`.
 */
import { z } from "zod";

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta extends PaginationParams {
  total: number;
  totalPages: number;
}

function clampPage(value: number): number {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PAGE;
  return Math.floor(value);
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(value));
}

/**
 * Lenient query-string schema: invalid or missing values fall back to the
 * defaults rather than failing the request (unknown/invalid pagination
 * params must never 500 a list endpoint). Out-of-range page sizes clamp
 * to MAX_PAGE_SIZE.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .transform((v) => clampPage(v))
    .catch(DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .transform((v) => clampPageSize(v))
    .catch(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Parse raw query values (strings from a query string, or numbers). */
export function parsePaginationParams(input: {
  page?: unknown;
  pageSize?: unknown;
}): PaginationParams {
  const page = typeof input.page === "string" ? Number(input.page) : (input.page as number);
  const pageSize =
    typeof input.pageSize === "string" ? Number(input.pageSize) : (input.pageSize as number);
  return { page: clampPage(page), pageSize: clampPageSize(pageSize) };
}

export function buildPaginationMeta(
  total: number,
  params: PaginationParams,
): PaginationMeta {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  return {
    page: params.page,
    pageSize: params.pageSize,
    total: safeTotal,
    totalPages: Math.ceil(safeTotal / params.pageSize),
  };
}

/** SQL LIMIT/OFFSET pair for a paginated query. */
export function toLimitOffset(params: PaginationParams): {
  limit: number;
  offset: number;
} {
  return { limit: params.pageSize, offset: (params.page - 1) * params.pageSize };
}
