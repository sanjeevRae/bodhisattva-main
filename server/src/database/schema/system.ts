import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';

/**
 * System tables — DATABASE_DESIGN.md §11. Phase 1 authored §11.2
 * (`audit_logs`) and §11.4 (`rate_limits`); Phase 7 adds §11.1
 * (`email_outbox`), the transactional-outbox queue.
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

/**
 * Transactional email outbox (§11.1, ARCHITECTURE.md §10, Phase 0
 * amendment A8). Rows are written in the SAME transaction as the
 * business event (order approval, cancellation, …) and drained later by
 * the outbox worker — an email failure can never roll back the business
 * event, and a retry can never duplicate the business artefact (the
 * invoice PDF is rendered once from its snapshot and re-attached).
 *
 * Delivery protocol (A8 lease): the worker claims due PENDING rows by
 * flipping them to PROCESSING with `claimed_by` + `claimed_at` under
 * `SELECT … FOR UPDATE SKIP LOCKED`; a claim whose `claimed_at` is
 * older than the lease TTL is stale (the worker died mid-send) and is
 * recovered to PENDING without consuming the send. `attempts` counts
 * completed send attempts; failures reschedule with the §11.1 backoff
 * (1m/5m/30m/2h) and the row goes DEAD after 5 attempts — the
 * dead-letter state an admin can manually retry (audited).
 *
 * `claimed_at` is the one column beyond the §11.1 listing: A8 requires
 * stale-lease recovery, which is impossible without a claim timestamp.
 *
 * Bodies are rendered at enqueue time into `template_data`
 * ({ text, html?, … }) by the calling service (§11.1 note); order and
 * invoice mail carries no secrets.
 */
export const emailOutbox = mysqlTable(
  'email_outbox',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // ORDER_APPROVED | ORDER_CANCELLED | ORDER_SHIPPED | ORDER_DELIVERED |
    // INVOICE | … (§11.1 catalogue; VARCHAR by design, not an enum).
    type: varchar('type', { length: 40 }).notNull(),
    recipientEmail: varchar('recipient_email', { length: 254 }).notNull(),
    recipientUserId: bigint('recipient_user_id', { mode: 'number', unsigned: true }),
    subject: varchar('subject', { length: 255 }).notNull(),
    // Render inputs + the rendered body ({ text, html? }) — see header.
    templateData: json('template_data').notNull(),
    // Invoice PDF for INVOICE rows (name under <uploadDirectory>/invoices/).
    attachmentStorageName: varchar('attachment_storage_name', { length: 120 }),
    // 'order' | 'invoice' | 'user' | 'invitation'
    relatedType: varchar('related_type', { length: 40 }),
    relatedId: bigint('related_id', { mode: 'number', unsigned: true }),
    // PENDING | PROCESSING | SENT | FAILED | DEAD (§11.1). FAILED is
    // retained in the design's vocabulary; the drain's terminal
    // dead-letter state is DEAD.
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    attempts: int('attempts', { unsigned: true }).notNull().default(0),
    nextAttemptAt: datetime('next_attempt_at', { fsp: 3, mode: 'date' }),
    // Sanitised SMTP error summary — never credentials (§11.1).
    lastError: varchar('last_error', { length: 500 }),
    // Worker instance id while PROCESSING (the A8 lease owner).
    claimedBy: varchar('claimed_by', { length: 64 }),
    claimedAt: datetime('claimed_at', { fsp: 3, mode: 'date' }),
    // Lease fencing token (Phase 8, Phase 7 review disposition 2):
    // incremented on every claim AND on every stale-lease recovery, so
    // a worker's completion/failure write — conditional on the version
    // it claimed — can never clobber a newer claim's state.
    leaseVersion: int('lease_version', { unsigned: true }).notNull().default(0),
    sentAt: datetime('sent_at', { fsp: 3, mode: 'date' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_outbox_drain').on(table.status, table.nextAttemptAt),
    index('idx_outbox_related').on(table.relatedType, table.relatedId),
    foreignKey({
      columns: [table.recipientUserId],
      foreignColumns: [users.id],
      name: 'fk_outbox_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);

/**
 * Website contact-form submissions (migration 0012; the CMS seed's
 * ContactFormConfig has anticipated this table since Phase 4). Every
 * accepted About-page message is persisted BEFORE the email send is
 * attempted, so an SMTP outage never loses a visitor's message.
 *
 * Status vocabulary (VARCHAR by design, like the outbox):
 *   RECEIVED  persisted; the send has not completed yet (transient)
 *   SENT      the mailer accepted the message; `emailMessageId` holds
 *             the SMTP message id. This is acceptance, NOT delivery —
 *             no stronger signal exists, and none is claimed.
 *   FAILED    the send failed; the visitor was told to try again.
 *
 * Deliberately minimal (§Phase 7 data minimisation): no IP address, no
 * user agent, no headers — the sender's name/email/subject/message and
 * the delivery outcome are all the site needs to answer enquiries.
 */
export const contactSubmissions = mysqlTable(
  'contact_submissions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    subject: varchar('subject', { length: 120 }).notNull(),
    message: text('message').notNull(),
    // RECEIVED | SENT | FAILED (see header).
    status: varchar('status', { length: 16 }).notNull().default('RECEIVED'),
    emailMessageId: varchar('email_message_id', { length: 255 }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_contact_submissions_created').on(table.createdAt),
    index('idx_contact_submissions_status').on(table.status, table.createdAt),
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
