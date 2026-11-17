/**
 * Wrap an async route handler so rejected promises reach the central error
 * handler. (Express 5 forwards rejections automatically; this wrapper keeps
 * handlers correct regardless of framework version.)
 */
import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
