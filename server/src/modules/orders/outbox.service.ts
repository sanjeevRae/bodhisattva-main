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
 * Fencing (Phase 8, Phase 7 review disposition 2): every claim and
 * every stale-lease recovery increments `lease_version`, and a
 * worker's completion/failure write is conditional on the exact
 * (status, claimed_by, lease_version) it claimed. A worker whose send
 * outlived its lease therefore cannot clobber the newer claim's
 * state — its late write affects 0 rows and is only logged. Delivery
 * stays at-least-once (an SMTP-accepted send whose worker died before
 * recording SENT will be re-sent by the next claim), bounded by the
 * deterministic Message-ID each row carries: retries of a row reuse
 * `<outbox-<id>@<app-host>`, so downstream systems can dedupe; a
 * manual resend is a NEW row and gets a new Message-ID.
 *
 * `invoices.email_status` mirrors the invoice's INVOICE row: SENT on
 * delivery, FAILED only when the row dead-letters, PENDING otherwise.
 */
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import pino from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  creditNotes,
  emailOutbox,
  invoices,
} from "../../database/schema/index.js";
import { AUDIT_ACTIONS, writeAudit } from "../../services/audit.js";
import { getMailer } from "../../services/mailer.js";
import type { DbLike } from "../store/service.js";
import {
  ensureCreditNotePdf,
  ensureInvoicePdf,
  resolveInvoiceLogoImage,
} from "./invoice-files.js";
import type { CreditNoteSnapshot, InvoiceSnapshot } from "./invoice-pdf.js";

const log = pino({ name: "outbox", level: process.env.LOG_LEVEL ?? "info" });

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_SECONDS = [60, 300, 1800, 7200];
const LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * Deterministic RFC 5322 Message-ID for an outbox row (Phase 8):
 * stable across the row's retries so a downstream system can dedupe
 * an at-least-once redelivery; a resend creates a new row and
 * therefore a new id. The host comes from APP_URL, falling back to
 * 'bodhisattva.local' when APP_URL is unparseable.
 */
export function outboxMessageId(config: AppConfig, rowId: number): string {
  let host = "bodhisattva.local";
  try {
    host = new URL(config.appUrl).hostname || host;
  } catch {
    // Keep the fallback host.
  }
  return `<outbox-${rowId}@${host}>`;
}

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

/** Credit-note attachments (Phase 8) resolve against the credit_notes
 * row the outbox row points at, mirroring the invoice branch above. */
async function loadCreditNoteAttachment(
  deps: OrdersDeps,
  row: OutboxRow,
): Promise<{ filename: string; content: Buffer } | null> {
  if (!row.attachmentStorageName || row.relatedId === null) return null;
  const [creditNote] = await deps.db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, row.relatedId))
    .limit(1);
  if (!creditNote) return null;
  const snapshot = creditNote.snapshot as CreditNoteSnapshot;
  const logoImage = await resolveInvoiceLogoImage(deps.db, deps.config, snapshot);
  const content = await ensureCreditNotePdf(
    deps.config,
    row.attachmentStorageName,
    snapshot,
    logoImage,
  );
  return { filename: `${creditNote.creditNoteNumber}.pdf`, content };
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
  // Recovery also bumps lease_version: the dead worker's fencing token
  // is invalidated before anyone can claim the row again.
  const recoveredDead = await db
    .update(emailOutbox)
    .set({
      status: "DEAD",
      claimedBy: null,
      claimedAt: null,
      leaseVersion: sql`${emailOutbox.leaseVersion} + 1`,
    })
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
      leaseVersion: sql`${emailOutbox.leaseVersion} + 1`,
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
        // Every claim takes a fresh fencing token (Phase 8).
        leaseVersion: sql`${emailOutbox.leaseVersion} + 1`,
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
  //    touches the business artefact (the invoice stays issued). Every
  //    outcome write is FENCED on the claim this worker took (Phase 8):
  //    if the row's lease was recovered and re-claimed while this send
  //    was in flight, the write matches 0 rows and the newer claim's
  //    state stands — the late outcome is logged, never applied.
  const mailer = getMailer(config);
  const fencedOnClaim = (row: OutboxRow) =>
    and(
      eq(emailOutbox.id, row.id),
      eq(emailOutbox.status, "PROCESSING"),
      eq(emailOutbox.claimedBy, workerId),
      eq(emailOutbox.leaseVersion, row.leaseVersion),
    );
  for (const row of rows) {
    const data = (row.templateData ?? {}) as { text?: string; html?: string };
    try {
      const attachment =
        row.relatedType === "credit_note"
          ? await loadCreditNoteAttachment(deps, row)
          : await loadAttachment(deps, row);
      await mailer.sendMail({
        to: row.recipientEmail,
        subject: row.subject,
        text: data.text ?? "",
        // Deterministic per-row Message-ID (Phase 8): a redelivery of
        // THIS row carries the same id; a resend (new row) does not.
        messageId: outboxMessageId(config, row.id),
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
      const sentUpdate = await db
        .update(emailOutbox)
        .set({ status: "SENT", sentAt: now, claimedBy: null, claimedAt: null })
        .where(fencedOnClaim(row));
      if (affectedRowsOf(sentUpdate) !== 1) {
        log.warn(
          { outboxId: row.id, workerId, leaseVersion: row.leaseVersion },
          "outbox SENT write fenced out — a newer claim owns this row",
        );
        continue;
      }
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
        const deadUpdate = await db
          .update(emailOutbox)
          .set({
            status: "DEAD",
            lastError: error,
            claimedBy: null,
            claimedAt: null,
          })
          .where(fencedOnClaim(row));
        if (affectedRowsOf(deadUpdate) !== 1) {
          log.warn(
            { outboxId: row.id, workerId, leaseVersion: row.leaseVersion },
            "outbox DEAD write fenced out — a newer claim owns this row",
          );
          continue;
        }
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
        const retryUpdate = await db
          .update(emailOutbox)
          .set({
            status: "PENDING",
            lastError: error,
            claimedBy: null,
            claimedAt: null,
            nextAttemptAt: new Date(now.getTime() + backoffSeconds * 1000),
          })
          .where(fencedOnClaim(row));
        if (affectedRowsOf(retryUpdate) !== 1) {
          log.warn(
            { outboxId: row.id, workerId, leaseVersion: row.leaseVersion },
            "outbox retry write fenced out — a newer claim owns this row",
          );
          continue;
        }
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

/** Single-flight guard for the in-process opportunistic drain
 * (Phase 8): never two passes at once — concurrent triggers coalesce.
 * A trigger that arrives while a pass is running sets the rerun flag
 * instead of being dropped: a pass snapshots its candidates once, so
 * a row enqueued mid-pass (the classic approve→cancel-in-quick-
 * succession case) would otherwise be stranded until the next
 * enqueue. The follow-up pass runs with the first trigger's deps
 * (the same app instance in practice). The CLI drain is unaffected. */
let soonDrainInFlight = false;
let soonDrainRerunRequested = false;

/**
 * Fire-and-forget drain after an enqueue. Errors are swallowed by
 * design: the CLI/cron drain is the reliable path, and a failed
 * opportunistic pass simply leaves rows for it.
 */
export function drainOutboxSoon(deps: OrdersDeps): void {
  if (soonDrainInFlight) {
    soonDrainRerunRequested = true;
    return;
  }
  soonDrainInFlight = true;
  void (async () => {
    try {
      do {
        soonDrainRerunRequested = false;
        await drainOutbox(deps);
      } while (soonDrainRerunRequested);
    } catch (err) {
      log.warn({ err }, "opportunistic outbox drain failed");
    } finally {
      soonDrainInFlight = false;
    }
  })();
}
