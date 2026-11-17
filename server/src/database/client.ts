/**
 * Database client (ARCHITECTURE.md §4.2 `database/`).
 *
 * A mysql2 connection pool plus the Drizzle instance bound to the full
 * schema (src/database/schema/index.ts). The pool connects lazily — creating
 * the handle never touches the database, so the API can boot and report
 * readiness honestly even while the database is down.
 *
 * Connections work in UTC (DATABASE_DESIGN.md §2.3): every pooled connection
 * gets `SET time_zone = '+00:00'` so DATETIME(3) values are UTC end to end.
 */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { AppConfig } from "../config/env.js";
import * as schema from "./schema/index.js";

export type Database = MySql2Database<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  /** Real readiness probe: executes `SELECT 1` against the pool. */
  ping: () => Promise<void>;
  /** Drain and close the pool (graceful shutdown). */
  close: () => Promise<void>;
}

export function createDatabase(config: AppConfig): DatabaseHandle {
  // Pool budget is per worker process; Passenger may run several workers,
  // so the limit is deliberately conservative and env-driven (ChatGPT F2).
  const poolOptions = {
    connectionLimit: config.db.poolLimit,
    connectTimeout: 5_000,
    queueLimit: 20,
    timezone: "+00:00",
  };
  const pool = config.databaseUrl
    ? mysql.createPool({ uri: config.databaseUrl, ...poolOptions })
    : mysql.createPool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.name,
        ...poolOptions,
      });

  pool.on("connection", (connection) => {
    // mysql2 quirk: the 'connection' event hands back the callback-style
    // connection even on a promise pool, so .query() there is NOT a promise
    // (awaiting it throws). Use the callback form, fire-and-forget.
    // Best effort only: a failure here surfaces properly via ping/queries.
    try {
      (connection as unknown as {
        query: (sql: string, cb: (err: unknown) => void) => void;
      }).query("SET time_zone = '+00:00'", () => undefined);
    } catch {
      // Never let session setup break connection creation.
    }
  });

  const db = drizzle(pool, { schema, mode: "default" });

  return {
    db,
    pool,
    ping: async () => {
      await pool.query("SELECT 1");
    },
    close: async () => {
      await pool.end();
    },
  };
}
