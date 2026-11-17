/**
 * API envelope types (ARCHITECTURE.md §6.2).
 *
 * Success responses are the resource object directly, or a list envelope
 * `{ data: [...], meta: {...} }`. There are no mixed envelopes. Error
 * responses always use the `ApiErrorResponse` shape from errors.ts.
 */
import type { PaginationMeta } from "./pagination.js";

export type { ApiErrorBody, ApiErrorResponse } from "./errors.js";

/** Single-resource success envelope used by typed clients. */
export interface DataResponse<T> {
  data: T;
}

/** Paginated list response: `{ data: [...], meta: {...} }`. */
export interface ListResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
