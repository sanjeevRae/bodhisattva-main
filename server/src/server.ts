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
  const database = createDatabase(config);
  const app = createApp({ config, database, logger });

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
