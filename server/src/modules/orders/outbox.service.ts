/**
 * Email outbox service (Phase 7, DATABASE_DESIGN.md §11.1,
 * ARCHITECTURE.md §10, Phase 0 amendment A8).
 *
 * Transactional outbox: `enqueueEmail` runs inside the caller's
 * transaction, so the email intent commits or rolls back WITH the
 * business event; sending happens later in `drainOutbox` and can never
 * roll the event back. The drain is invoked by the `outbox:drain` CLI
 * (the cPanel-cron path, ARCHITECTURE.md §10) and opportunistically
 * after an enqueue (`drainOutboxSoon`) — the CLI remains the reliable
 * path.
 *
 * Claim protocol (A8 lease): a due PENDING row is claimed by an atomic
 * conditional UPDATE (status + claimed_by + claimed_at + attempts+1) —
 * the fallback claim ARCHITECTURE.md §10 specifies, race-safe without
 * SKIP LOCKED. A PROCESSING row whose claim is older than the lease
 * TTL is stale (its worker died mid-send) and is recovered to PENDING
 * before claiming. Failures reschedule with the §11.1 backoff
 * (1m/5m/30m/2h); the 5th failed attempt dead-letters the row (DEAD),
 * which an admin can manually retry — a DEAD invoice email never
 * blocks or duplicates the invoice itself.
 *
 * `invoices.email_status` mirrors the invoice's INVOICE row: SENT on
 * delivery, FAILED only when the row dead-letters, PENDING otherwise.
 */
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import pino from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  emailOutbox,
  invoices,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { getMailer } from "../../services/mailer.js";
import type { DbLike } from "../store/service.js";
import { ensureInvoicePdf, resolveInvoiceLogoImage } from "./invoice-files.js";
import type { InvoiceSnapshot } from "./invoice-pdf.js";

const log = pino({ name: "outbox", level: process.env.LOG_LEVEL ?? "info" });

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_SECONDS = [60, 300, 1800, 7200];
const LEASE_TTL_MS = 5 * 60 * 1000;

export interface OrdersDeps {
  db: Database;
  config: AppConfig;
}

export interface EnqueueEmailInput {
  type: string;
  recipientEmail: string;
  recipientUserId?: number | null;
  subject: string;
  text: string;
  html?: string;
  attachmentStorageName?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
}

/**
 * Insert one outbox row. Accepts the caller's transaction handle — the
 * row is part of the business transaction (§11.1).
 */
export async function enqueueEmail(
  db: DbLike,
  input: EnqueueEmailInput,
): Promise<number> {
  const [inserted] = await db
    .insert(emailOutbox)
    .values({
      type: input.type,
      recipientEmail: input.recipientEmail,
      recipientUserId: input.recipientUserId ?? null,
      subject: input.subject,
      templateData: {
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      },
      attachmentStorageName: input.attachmentStorageName ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: null,
    })
    .$returningId();
  return inserted.id;
}

export interface DrainOptions {
  workerId?: string;
  batchSize?: number;
  /** Clock override — tests simulate the passage of backoff time. */
  now?: Date;
  maxAttempts?: number;
}

export interface DrainResult {
  recovered: number;
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
}

type OutboxRow = typeof emailOutbox.$inferSelect;

/** Drizzle/mysql2 update results are [header, fields] — same defensive
 * reader as invitations/mfa services. */
function affectedRowsOf(result: unknown): number {
  const header = (result as [{ affectedRows?: unknown }] | null)?.[0];
  return typeof header?.affectedRows === "number" ? header.affectedRows : 0;
}

function sanitiseError(config: AppConfig, err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  if (config.smtp.password) {
    message = message.split(config.smtp.password).join("***");
  }
  return message.slice(0, 500);
}

async function loadAttachment(
  deps: OrdersDeps,
  row: OutboxRow,
): Promise<{ filename: string; content: Buffer } | null> {
  if (!row.attachmentStorageName) return null;
  let filename = row.attachmentStorageName.split("/").pop() ?? "invoice.pdf";
  let snapshot: InvoiceSnapshot | null = null;
  if (row.relatedType === "invoice" && row.relatedId !== null) {
    const [invoice] = await deps.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, row.relatedId))
      .limit(1);
    if (invoice) {
      filename = `${invoice.invoiceNumber}.pdf`;
      snapshot = invoice.snapshot as InvoiceSnapshot;
    }
  }
  if (!snapshot) return null;
  const logoImage = await resolveInvoiceLogoImage(deps.db, deps.config, snapshot);
  const content = await ensureInvoicePdf(
    deps.config,
    row.attachmentStorageName,
    snapshot,
    logoImage,
  );
  return { filename, content };
}

export async function drainOutbox(
  deps: OrdersDeps,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const { db, config } = deps;
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 20;
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;
  const workerId = options.workerId ?? `worker-${process.pid}`;
  const result: DrainResult = { recovered: 0, claimed: 0, sent: 0, failed: 0, dead: 0 };

  // 1. Recover stale leases (worker died mid-send). Attempts were
  //    already counted at claim time; a row that has exhausted its
  //    attempts dead-letters instead of looping forever.
  const staleBefore = new Date(now.getTime() - LEASE_TTL_MS);
  const recoveredDead = await db
    .update(emailOutbox)
    .set({ status: "DEAD", claimedBy: null, claimedAt: null })
    .where(
      and(
        eq(emailOutbox.status, "PROCESSING"),
        lt(emailOutbox.claimedAt, staleBefore),
        sql`${emailOutbox.attempts} >= ${maxAttempts}`,
      ),
    );
  const recoveredPending = await db
    .update(emailOutbox)
    .set({
      status: "PENDING",
      claimedBy: null,
      claimedAt: null,
      nextAttemptAt: now,
    })
    .where(
      and(
        eq(emailOutbox.status, "PROCESSING"),
        lt(emailOutbox.claimedAt, staleBefore),
        sql`${emailOutbox.attempts} < ${maxAttempts}`,
      ),
    );
  result.recovered = affectedRowsOf(recoveredDead) + affectedRowsOf(recoveredPending);
  result.dead += affectedRowsOf(recoveredDead);

  // 2. Claim due rows one by one with the atomic conditional UPDATE.
  const candidates = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        or(
          isNull(emailOutbox.nextAttemptAt),
          lte(emailOutbox.nextAttemptAt, now),
        ),
      ),
    )
    .orderBy(asc(emailOutbox.id))
    .limit(batchSize);
  const claimedIds: number[] = [];
  for (const candidate of candidates) {
    const claim = await db
      .update(emailOutbox)
      .set({
        status: "PROCESSING",
        claimedBy: workerId,
        claimedAt: now,
        attempts: sql`${emailOutbox.attempts} + 1`,
      })
      .where(
        and(
          eq(emailOutbox.id, candidate.id),
          eq(emailOutbox.status, "PENDING"),
        ),
      );
    if (affectedRowsOf(claim) === 1) claimedIds.push(candidate.id);
  }
  result.claimed = claimedIds.length;
  if (claimedIds.length === 0) return result;

  const rows = await db
    .select()
    .from(emailOutbox)
    .where(inArray(emailOutbox.id, claimedIds))
    .orderBy(asc(emailOutbox.id));

  // 3. Send each claimed row; the outcome update is per-row and never
  //    touches the business artefact (the invoice stays issued).
  const mailer = getMailer(config);
  for (const row of rows) {
    const data = (row.templateData ?? {}) as { text?: string; html?: string };
    try {
      const attachment = await loadAttachment(deps, row);
      await mailer.sendMail({
        to: row.recipientEmail,
        subject: row.subject,
        text: data.text ?? "",
        ...(data.html ? { html: data.html } : {}),
        ...(attachment
          ? {
              attachments: [
                {
                  filename: attachment.filename,
                  content: attachment.content,
                  contentType: "application/pdf",
                },
              ],
            }
          : {}),
      });
      await db
        .update(emailOutbox)
        .set({ status: "SENT", sentAt: now, claimedBy: null, claimedAt: null })
        .where(eq(emailOutbox.id, row.id));
      if (row.type === "INVOICE" && row.relatedType === "invoice" && row.relatedId !== null) {
        await db
          .update(invoices)
          .set({ emailStatus: "SENT" })
          .where(eq(invoices.id, row.relatedId));
      }
      result.sent += 1;
    } catch (err) {
      const error = sanitiseError(config, err);
      if (row.attempts >= maxAttempts) {
        await db
          .update(emailOutbox)
          .set({
            status: "DEAD",
            lastError: error,
            claimedBy: null,
            claimedAt: null,
          })
          .where(eq(emailOutbox.id, row.id));
        if (row.type === "INVOICE" && row.relatedType === "invoice" && row.relatedId !== null) {
          await db
            .update(invoices)
            .set({ emailStatus: "FAILED" })
            .where(eq(invoices.id, row.relatedId));
          await writeAudit(db, {
            actorType: "SYSTEM",
            action: AUDIT_ACTIONS.storeInvoicesEmailDead,
            resourceType: "invoice",
            resourceId: row.relatedId,
            result: "FAILURE",
            metadata: { outboxId: row.id, attempts: row.attempts, error },
          });
        }
        result.dead += 1;
      } else {
        const backoffSeconds =
          OUTBOX_BACKOFF_SECONDS[
            Math.min(row.attempts - 1, OUTBOX_BACKOFF_SECONDS.length - 1)
          ] ?? 60;
        await db
          .update(emailOutbox)
          .set({
            status: "PENDING",
            lastError: error,
            claimedBy: null,
            claimedAt: null,
            nextAttemptAt: new Date(now.getTime() + backoffSeconds * 1000),
          })
          .where(eq(emailOutbox.id, row.id));
        result.failed += 1;
      }
      log.warn(
        { outboxId: row.id, type: row.type, attempts: row.attempts, error },
        "outbox send failed",
      );
    }
  }
  return result;
}

/**
 * Fire-and-forget drain after an enqueue. Errors are swallowed by
 * design: the CLI/cron drain is the reliable path, and a failed
 * opportunistic pass simply leaves rows for it.
 */
export function drainOutboxSoon(deps: OrdersDeps): void {
  void drainOutbox(deps).catch((err: unknown) => {
    log.warn({ err }, "opportunistic outbox drain failed");
  });
}
