/**
 * API entry point. In production this is the file Passenger starts
 * (compiled to dist/server.js — ARCHITECTURE.md §4.1, §5.2).
 *
 * Boot sequence: load server/.env (local development only; production env
 * comes from the cPanel app configuration) → validate config (fail fast) →
 * create the database pool (lazy; connects on first query) → listen.
 */
import dotenv from "dotenv";

dotenv.config();

import { ConfigError, loadConfig, type AppConfig } from "./config/env.js";
import { createDatabase } from "./database/client.js";
import { createLogger } from "./middleware/logger.js";
import { createApp } from "./app.js";

function main(): void {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
    } else {
      console.error("Failed to load configuration:", err);
    }
    process.exit(1);
  }

  const logger = createLogger(config);
  if (config.isProduction && !config.turnstileSecretKey) {
    // Deliberately a warning, never a boot failure: the contact form
    // keeps working on rate limits + honeypot, but the operator must
    // know bot protection is reduced (contact spec Phase 3/6.3).
    logger.warn(
      "TURNSTILE_SECRET_KEY is not set: contact-form bot protection is " +
        "reduced to rate limiting and the honeypot. Set it in the " +
        "production environment to enable Turnstile verification.",
    );
  }
  const database = createDatabase(config);
  const app = createApp({
    config,
    database,
    logger,
    // SERVE_SPA: also serve the built frontend with per-page share
    // metadata injected (see src/spa.ts). Off unless explicitly set.
    spa: config.serveSpa ? { distDir: config.spaDistDir } : undefined,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, nodeEnv: config.nodeEnv },
      "Bodhisattva API listening",
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      void database
        .close()
        .catch((err: unknown) => logger.error({ err }, "Error closing database pool"))
        .finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
