/**
 * Structured logging (ARCHITECTURE.md §4.2 `middleware/`).
 *
 * pino JSON logs with the request id on every line. These are diagnostic
 * logs, distinct from the append-only audit log (spec Part 14). Credentials
 * and credential-bearing headers are redacted.
 */
import pino, { type Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "../config/env.js";

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "*.password",
        "req.body.password",
        "req.body.currentPassword",
        "req.body.newPassword",
      ],
      censor: "[redacted]",
    },
  });
}

export function httpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as { id: string }).id,
    autoLogging: {
      // Liveness probes would drown the log; readiness stays logged.
      ignore: (req) => req.url === "/health",
    },
  });
}
