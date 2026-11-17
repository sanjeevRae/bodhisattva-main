import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  tinyint,
  uniqueIndex,
  varbinary,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';
import { roles } from './authorization.js';

/**
 * Identity challenge & administrative-security tables — DATABASE_DESIGN.md
 * §4.3 (`email_verification_codes`), §4.4 (`password_reset_tokens`),
 * §6.1 (`invitations`), §6.2 (`mfa_credentials`), §6.3 (`mfa_recovery_codes`).
 *
 * Global conventions (§2): BIGINT UNSIGNED surrogate PKs, DATETIME(3) UTC
 * timestamps, snake_case names, `idx_`/`uq_`/`fk_` constraint naming,
 * ON DELETE RESTRICT / ON UPDATE RESTRICT. No plaintext secret is ever
 * stored (§2.11): codes are HMACs, tokens are SHA-256 hashes, TOTP secrets
 * are AES-256-GCM ciphertext, recovery codes are password-style hashes.
 *
 * DEVIATION (binding amendment wins): PHASE0_REVIEW.md amendment A3 requires
 * recovery codes to be *individually Argon2id-hashed*. An Argon2id encoded
 * hash (~97 chars) cannot fit §6.3's `code_hash CHAR(64)` (sized for a
 * SHA-256 hex digest), so `mfa_recovery_codes.code_hash` is VARCHAR(255).
 * Everything else in this module follows the §4.3–§6.3 DDL exactly.
 */

export const emailVerificationCodes = mysqlTable(
  'email_verification_codes',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    // HMAC-SHA-256(OTP secret, purpose:email:code) — the 8-digit code itself
    // is never stored or logged (§4.3, §2.11).
    codeHmac: char('code_hmac', { length: 64 }).notNull(),
    // Failed-verify counter; at max_attempts the code is dead even if unexpired.
    attempts: tinyint('attempts', { unsigned: true }).notNull().default(0),
    maxAttempts: tinyint('max_attempts', { unsigned: true }).notNull().default(5),
    // Issue + 10 minutes (AppConfig.otpPolicy at issue time).
    expiresAt: datetime('expires_at', { fsp: 3, mode: 'date' }).notNull(),
    // Set on successful verify, and on supersession by a newer code.
    consumedAt: datetime('consumed_at', { fsp: 3, mode: 'date' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_evc_user_active').on(table.userId, table.consumedAt, table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_evc_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const passwordResetTokens = mysqlTable(
  'password_reset_tokens',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    // SHA-256 hex of the 256-bit token carried by the email link (§4.4).
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    // Issue + 60 minutes (config).
    expiresAt: datetime('expires_at', { fsp: 3, mode: 'date' }).notNull(),
    // Single-use: set by the successful reset, which also revokes all sessions.
    consumedAt: datetime('consumed_at', { fsp: 3, mode: 'date' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    requestIp: varchar('request_ip', { length: 45 }),
  },
  (table) => [
    uniqueIndex('uq_prt_token_hash').on(table.tokenHash),
    index('idx_prt_user').on(table.userId, table.consumedAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_prt_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const invitations = mysqlTable(
  'invitations',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
    // Role the account will receive (never CUSTOMER — service-layer rule, §6.1).
    roleId: bigint('role_id', { mode: 'number', unsigned: true }).notNull(),
    // SHA-256 hex; the raw token exists only in the invitation email/link.
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    // The Super Admin who issued the invitation.
    invitedBy: bigint('invited_by', { mode: 'number', unsigned: true }).notNull(),
    // Issue + 72 hours (config).
    expiresAt: datetime('expires_at', { fsp: 3, mode: 'date' }).notNull(),
    // Terminal states: accepted (accepted_at set), revoked, expired.
    acceptedAt: datetime('accepted_at', { fsp: 3, mode: 'date' }),
    acceptedUserId: bigint('accepted_user_id', { mode: 'number', unsigned: true }),
    revokedAt: datetime('revoked_at', { fsp: 3, mode: 'date' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uq_invitations_token').on(table.tokenHash),
    index('idx_invitations_email').on(table.emailNormalized, table.revokedAt, table.acceptedAt),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'fk_inv_role',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: 'fk_inv_by',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.acceptedUserId],
      foreignColumns: [users.id],
      name: 'fk_inv_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const mfaCredentials = mysqlTable(
  'mfa_credentials',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    // TOTP (only type in the design; one credential per user per type).
    type: varchar('type', { length: 20 }).notNull().default('TOTP'),
    // AES-256-GCM(secret, TOTP_ENCRYPTION_KEY) — never plaintext (§6.2).
    secretEncrypted: varbinary('secret_encrypted', { length: 512 }).notNull(),
    // Set after the first successful verification during enrolment.
    confirmedAt: datetime('confirmed_at', { fsp: 3, mode: 'date' }),
    lastUsedAt: datetime('last_used_at', { fsp: 3, mode: 'date' }),
    // TOTP time-step counter of the last accepted code. Login verification
    // rejects any step <= this value — replay protection (amendment A3).
    // Signed BIGINT per §6.2 DDL (a counter, not a row reference).
    lastUsedCounter: bigint('last_used_counter', { mode: 'number' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uq_mfa_user_type').on(table.userId, table.type),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_mfa_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

export const mfaRecoveryCodes = mysqlTable(
  'mfa_recovery_codes',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    // Argon2id hash of the normalised code (amendment A3 — see module header
    // for why this is VARCHAR(255), not §6.3's CHAR(64)). 10 codes are issued
    // at enrolment, shown once, each single-use; regeneration deletes all
    // previous rows in the same audited action.
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    usedAt: datetime('used_at', { fsp: 3, mode: 'date' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('idx_mrc_user').on(table.userId, table.usedAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_mrc_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
