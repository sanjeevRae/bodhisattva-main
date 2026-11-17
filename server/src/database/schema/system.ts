import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * System tables in the Phase 1 foundation set — DATABASE_DESIGN.md §11.2
 * (`audit_logs`) and §11.4 (`rate_limits`).
 */

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // NULL for anonymous events (e.g. failed login on an unknown email).
    // Deliberately NO foreign key: audit rows must survive deletion/anonymisation
    // of the rows they describe (§11.2).
    actorId: bigint('actor_id', { mode: 'number', unsigned: true }),
    // Snapshot so history survives account changes.
    actorEmailSnapshot: varchar('actor_email_snapshot', { length: 254 }),
    actorRole: varchar('actor_role', { length: 40 }),
    // 'auth.login.success', 'cms.pages.publish', 'store.orders.approve', …
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: bigint('target_id', { mode: 'number', unsigned: true }),
    // SUCCESS | FAILURE | DENIED
    result: varchar('result', { length: 10 }).notNull().default('SUCCESS'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
    // Safe structured detail only — never passwords, OTPs, tokens, session ids
    // or MFA secrets (spec Part 14; enforced by the audit service allowlist).
    metadata: json('metadata'),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_audit_created').on(table.createdAt),
    index('idx_audit_actor').on(table.actorId, table.createdAt),
    index('idx_audit_action').on(table.action, table.createdAt),
    index('idx_audit_target').on(table.targetType, table.targetId),
    index('idx_audit_result').on(table.result, table.createdAt),
  ],
);

export const rateLimits = mysqlTable(
  'rate_limits',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // Policy+subject key, e.g. 'login:acct:42', 'login:ip:203.0.113.9',
    // 'otp_send:email:<hmac>'. Emails appear only as HMAC hashes (§11.4).
    scope: varchar('scope', { length: 80 }).notNull(),
    windowStart: datetime('window_start', { fsp: 3, mode: 'date' }).notNull(),
    windowEnd: datetime('window_end', { fsp: 3, mode: 'date' }).notNull(),
    hitCount: int('hit_count', { unsigned: true }).notNull().default(0),
    // Progressive-backoff marker; never a permanent lockout.
    blockedUntil: datetime('blocked_until', { fsp: 3, mode: 'date' }),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_rate_limits_scope_window').on(table.scope, table.windowStart),
    index('idx_rate_limits_expiry').on(table.windowEnd),
  ],
);
