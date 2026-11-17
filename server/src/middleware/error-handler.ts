/**
 * Central error handling (ARCHITECTURE.md §4.3, §6.2).
 *
 * Every error response uses the shared envelope from @bodhisattva/shared.
 * Known application errors keep their catalogue code/status; Zod validation
 * failures become VALIDATION_FAILED with per-field details; body-parser
 * failures map to VALIDATION_FAILED / PAYLOAD_TOO_LARGE; anything unknown
 * collapses to a generic 500 INTERNAL — internals are logged with the
 * request id, never leaked to the client.
 */
import {
  AppError,
  errorResponseFor,
  fieldIssuesFromIssues,
} from "@bodhisattva/shared/errors";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { getRequestId } from "./request-id.js";

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return AppError.validation(fieldIssuesFromIssues(err.issues));
  }
  const carrier = err as { status?: unknown; type?: unknown } | null;
  const status = typeof carrier?.status === "number" ? carrier.status : undefined;
  const type = typeof carrier?.type === "string" ? carrier.type : undefined;
  if (status === 413 || type === "entity.too.large") {
    return new AppError("PAYLOAD_TOO_LARGE");
  }
  if (status === 400 || type === "entity.parse.failed") {
    return AppError.validation([], "The request body is not valid JSON.");
  }
  return AppError.internal(err);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appError = toAppError(err);
  if (appError.httpStatus >= 500) {
    req.log?.error({ err }, "request failed");
  } else if (appError.httpStatus >= 400) {
    req.log?.warn({ errCode: appError.code }, "request rejected");
  }
  const { status, body } = errorResponseFor(appError, getRequestId(req));
  res.status(status).json(body);
};

/** Unknown routes are JSON 404s — API 404s never return the SPA shell. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}.`));
};
