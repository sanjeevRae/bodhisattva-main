/**
 * Express application factory (ARCHITECTURE.md §4.3 request lifecycle).
 *
 * Wiring order: request id → structured logging → security headers (helmet)
 * → CORS allowlist → cookies → JSON body (size-limited) → CSRF enforcement
 * (Phase 2; pre-session auth posts exempt — see middleware/csrf.ts) →
 * routes → JSON 404 → central error handler (shared error envelope).
 *
 * The database-backed modules (auth; later CMS/store) mount only when the
 * caller supplies the full database handle (server.ts does). Tests that
 * pass just a readiness probe keep the Phase 1 behaviour: health only.
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import type { Database } from "./database/client.js";
import { csrfProtection } from "./middleware/csrf.js";
import { createOriginCheck } from "./middleware/origin.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createLogger, httpLogger } from "./middleware/logger.js";
import { mountSpa } from "./spa.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import { createContactRouter } from "./modules/contact/routes.js";
import {
  createAdminInvitationsRouter,
  createInvitationAcceptRouter,
} from "./modules/invitations/invitations.routes.js";
import {
  createAdminMfaRouter,
  createMfaRouter,
} from "./modules/mfa/mfa.routes.js";
import {
  createCmsAdminRouter,
  createCmsPublicRouter,
} from "./modules/cms/routes.js";
import { createMediaRouters } from "./modules/media/media.routes.js";
import {
  createMuseumAdminRouter,
  createMuseumPublicRouter,
} from "./modules/museum/routes.js";
import {
  createStoreAdminRouter,
  createStoreCustomerRouter,
  createStorePublicRouter,
} from "./modules/store/routes.js";
import {
  createOrdersAdminRouter,
  createOrdersCustomerRouter,
} from "./modules/orders/orders.routes.js";
import {
  createPopupAdminRouter,
  createPopupPublicRouter,
} from "./modules/popups/routes.js";
import {
  createPolicyAdminRouter,
  createPolicyPublicRouter,
} from "./modules/policies/routes.js";
import { createAuditRouter } from "./modules/audit/audit.routes.js";
import { createRolesRouter } from "./modules/roles/roles.routes.js";
import {
  createHealthRouter,
  type ReadinessProbe,
} from "./modules/health/health.routes.js";
import { getMailer, type Mailer } from "./services/mailer.js";
import { mountApiDocs } from "./config/swagger.js";

export interface AppDeps {
  config: AppConfig;
  /**
   * Database readiness probe; when the full handle is passed (it carries
   * `db`), the database-backed modules are mounted too. Omit to run
   * without a database (tests).
   */
  database?: ReadinessProbe & { db?: Database };
  logger?: Logger;
  /** Injectable mailer for tests; defaults to the SMTP mailer. */
  mailer?: Mailer;
  /**
   * SPA serving (share-preview metadata injection): when present, the
   * built frontend is served with per-page Open Graph tags. Driven by
   * the SERVE_SPA env flag in production; absent everywhere else.
   */
  spa?: { distDir?: string };
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const logger = deps.logger ?? createLogger(config);

  const app = express();
  app.disable("x-powered-by");
  // Behind the cPanel/Passenger proxy the client IP arrives via
  // X-Forwarded-For; req.ip feeds rate limiting and audit records.
  app.set("trust proxy", 1);

  app.use(requestIdMiddleware);
  app.use(httpLogger(logger));
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(createOriginCheck(config));
  app.use(csrfProtection(config));

  app.use("/health", createHealthRouter({ database: deps.database }));

  // Interactive API documentation (Swagger UI + raw OpenAPI JSON).
  // Gated by config.apiDocsEnabled (API_DOCS_ENABLED; off in production
  // unless explicitly enabled). Mounted BEFORE the database modules on
  // purpose: the customer routers mounted at /api guard every
  // fall-through path with a session check, which would otherwise answer
  // /api/docs with 401. The docs paths collide with no existing route,
  // and the docs routes are plain GETs, so CSRF/origin middleware pass
  // them without any exemption.
  mountApiDocs(app, config);

  if (deps.database?.db) {
    const db = deps.database.db;
    app.use(
      "/api/auth",
      createAuthRouter({
        db,
        config,
        logger,
        mailer: deps.mailer ?? getMailer(config),
      }),
    );
    app.use(
      "/api",
      createContactRouter({
        db,
        config,
        logger,
        mailer: deps.mailer ?? getMailer(config),
      }),
    );
    app.use("/api/admin/invitations", createAdminInvitationsRouter({ db, config }));
    app.use("/api/auth/invitations", createInvitationAcceptRouter({ db, config }));
    app.use("/api/auth/mfa", createMfaRouter({ db, config }));
    app.use("/api/admin/mfa", createAdminMfaRouter({ db, config }));
    app.use("/api/admin", createRolesRouter({ db, config }));
    app.use("/api", createCmsPublicRouter({ db, config }));
    app.use("/api/admin", createCmsAdminRouter({ db, config }));
    // The popup's public read must sit with the other PUBLIC routers:
    // the customer routers below guard every fall-through /api path
    // with a session check and would 401 anonymous visitors.
    app.use("/api", createPopupPublicRouter({ db, config }));
    app.use("/api", createPolicyPublicRouter({ db, config }));
    const media = createMediaRouters({ db, config });
    app.use("/api", media.publicRouter);
    app.use("/api/admin", media.adminRouter);
    app.use("/api", createMuseumPublicRouter({ db, config }));
    app.use("/api/admin", createMuseumAdminRouter({ db, config }));
    app.use("/api", createStorePublicRouter({ db, config }));
    app.use("/api", createStoreCustomerRouter({ db, config }));
    app.use("/api/admin", createStoreAdminRouter({ db, config }));
    app.use("/api", createOrdersCustomerRouter({ db, config }));
    app.use("/api/admin", createOrdersAdminRouter({ db, config }));
    app.use("/api/admin", createPopupAdminRouter({ db, config }));
    app.use("/api/admin", createPolicyAdminRouter({ db, config }));
    app.use("/api/admin", createAuditRouter({ db, config }));
  }

  if (deps.spa) {
    mountSpa(app, {
      config,
      db: deps.database?.db,
      distDir: deps.spa.distDir,
      logger,
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
