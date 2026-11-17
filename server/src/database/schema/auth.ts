import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Authentication tables — DATABASE_DESIGN.md §4.1 (`users`) and §4.2 (`user_sessions`).
 *
 * Global conventions (§2): BIGINT UNSIGNED surrogate PKs, DATETIME(3) UTC
 * timestamps, snake_case names, `idx_`/`uq_`/`fk_` constraint naming,
 * ON DELETE RESTRICT / ON UPDATE RESTRICT unless a table states otherwise.
 */

export const users = mysqlTable(
  'users',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    // Lowercased, trimmed copy; uniqueness lives here so it never depends on collation (§2.10).
    emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    // NULL until an invitation is accepted; registration sets it while PENDING_VERIFICATION.
    passwordHash: varchar('password_hash', { length: 255 }),
    emailVerifiedAt: datetime('email_verified_at', { fsp: 3, mode: 'date' }),
    // PENDING_VERIFICATION | ACTIVE | SUSPENDED | INVITED | DEACTIVATED (app-level enum, §2.12)
    status: varchar('status', { length: 20 }).notNull().default('PENDING_VERIFICATION'),
    lastLoginAt: datetime('last_login_at', { fsp: 3, mode: 'date' }),
    // PHASE0_REVIEW.md amendment A9: revocation generation, incremented on password
    // change/reset, MFA reset, suspension and security-relevant role change; sessions
    // validate against it. (Added by amendment — not present in the §4.1 DDL.)
    sessionVersion: int('session_version', { unsigned: true }).notNull().default(0),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    deletedAt: datetime('deleted_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_users_email_normalized').on(table.emailNormalized),
    index('idx_users_status').on(table.status),
    index('idx_users_phone').on(table.phone),
  ],
);

export const userSessions = mysqlTable(
  'user_sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // SHA-256 hex of the cookie value; the raw session id is never stored (§2.11).
    sessionIdHash: char('session_id_hash', { length: 64 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    // Snapshot of users.session_version at creation (amendment A9): a version
    // bump (logout-all, password reset, privilege change) invalidates every
    // session whose snapshot no longer matches, even if its row was missed.
    sessionVersion: int('session_version', { unsigned: true }).notNull().default(0),
    // PASSWORD | MFA_VERIFIED
    authLevel: varchar('auth_level', { length: 20 }).notNull().default('PASSWORD'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    // Idle expiry is enforced against this column; updated by the session layer, not ON UPDATE.
    lastSeenAt: datetime('last_seen_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    // Absolute expiry.
    expiresAt: datetime('expires_at', { fsp: 3, mode: 'date' }).notNull(),
    revokedAt: datetime('revoked_at', { fsp: 3, mode: 'date' }),
    // LOGOUT | LOGOUT_ALL | PASSWORD_CHANGE | ROLE_CHANGE | ADMIN_ACTION | EXPIRED
    revokeReason: varchar('revoke_reason', { length: 40 }),
    // Last fresh-MFA time, for step-up checks on sensitive actions.
    stepUpAt: datetime('step_up_at', { fsp: 3, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_sessions_hash').on(table.sessionIdHash),
    index('idx_sessions_user').on(table.userId, table.revokedAt),
    index('idx_sessions_expiry').on(table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_sessions_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
