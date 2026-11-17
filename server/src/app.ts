/**
 * Express application factory (ARCHITECTURE.md §4.3 request lifecycle).
 *
 * Wiring order: request id → structured logging → security headers (helmet)
 * → CORS allowlist → cookies → JSON body (size-limited) → routes → JSON 404
 * → central error handler (shared error envelope).
 *
 * Session resolution, CSRF, rate limiting and authorization join this chain
 * in Phase 2 (ARCHITECTURE.md §7, PERMISSIONS.md) — they are deliberately
 * absent from the Phase 1 skeleton.
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createLogger, httpLogger } from "./middleware/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import {
  createHealthRouter,
  type ReadinessProbe,
} from "./modules/health/health.routes.js";

export interface AppDeps {
  config: AppConfig;
  /** Database readiness probe; omit to run without a database (tests). */
  database?: ReadinessProbe;
  logger?: Logger;
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const logger = deps.logger ?? createLogger(config);

  const app = express();
  app.disable("x-powered-by");

  app.use(requestIdMiddleware);
  app.use(httpLogger(logger));
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", createHealthRouter({ database: deps.database }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
