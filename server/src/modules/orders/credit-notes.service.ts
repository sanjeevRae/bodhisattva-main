/**
 * Credit notes service (Phase 8, Phase 7 review disposition 1).
 *
 * The lightweight reversal document for an order cancelled AFTER
 * approval: the original invoice stays issued and immutable (an
 * accounting record), and this note — created inside the cancellation
 * transaction, in the same commit as the ORDER_RESTORE movements and
 * the status change — reverses it in full.
 *
 *  - Numbers: the §10.2 sequence mechanism with its own scope
 *    ('CREDIT_NOTE:<year>'), formatted `CN-<year>-<5 digits>`. The
 *    scope row is locked FIRST in the cancellation transaction (the
 *    same global lock order as approval's INVOICE scope); the number
 *    is taken only once the order's state has been validated, so a
 *    rejected transition consumes no number.
 *  - At most one credit note per invoice (`uq_credit_notes_invoice`):
 *    a second cancel is already impossible (the state machine 422s),
 *    and the constraint makes the invariant structural.
 *  - The snapshot mirrors the invoice's (lines + totals as positive
 *    amounts) re-marked as a credit-note document; the PDF renders
 *    from it deterministically, exactly like invoices.
 *  - The customer email (outbox type CREDIT_NOTE, PDF attached) is
 *    enqueued in the same transaction; sending happens in the drain
 *    and can never roll back the cancellation.
 *
 * Scope note: this is an accounting reversal only. The seeded
 * template carries no tax registration number and the store tax rate
 * is 0%, so invoices charge no VAT and no VAT treatment is claimed;
 * how formal the note must be follows the client's VAT registration
 * (the owner's open invoice/VAT decision).
 */
import { AppError } from "@bodhisattva/shared/errors";
import { parseMoneyToMinorUnits } from "@bodhisattva/shared/money";
import { eq } from "drizzle-orm";
import {
  creditNotes,
  invoiceSequences,
  invoices,
} from "../../database/schema/index.js";
import type { DbLike, StoreActor } from "../store/service.js";
import {
  creditNotePdfStorageName,
  ensureCreditNotePdf,
  resolveInvoiceLogoImage,
} from "./invoice-files.js";
import type { CreditNoteSnapshot, InvoiceSnapshot } from "./invoice-pdf.js";
import { enqueueEmail, type OrdersDeps } from "./outbox.service.js";

type InvoiceRow = typeof invoices.$inferSelect;
export type CreditNoteRow = typeof creditNotes.$inferSelect;
type OrderRow = {
  id: number;
  orderNumber: string;
  userId: number;
  customerEmailSnapshot: string;
  shipRecipientName: string;
};

// ---------------------------------------------------------------------------
// Numbers (§10.2 mechanism, CREDIT_NOTE scope)
// ---------------------------------------------------------------------------

function sequenceScope(year: number): string {
  return `CREDIT_NOTE:${year}`;
}

/**
 * Lock the current year's CREDIT_NOTE sequence row. Called FIRST in a
 * cancellation transaction that may create a credit note (the global
 * lock order); the increment happens later, only after the order's
 * state validated and an invoice was found.
 */
export async function lockCreditNoteSequence(
  tx: DbLike,
  at: Date,
): Promise<void> {
  const scope = sequenceScope(at.getUTCFullYear());
  await tx
    .insert(invoiceSequences)
    .values({ scope, lastValue: 0 })
    .onDuplicateKeyUpdate({ set: { scope } });
  await tx
    .select({ lastValue: invoiceSequences.lastValue })
    .from(invoiceSequences)
    .where(eq(invoiceSequences.scope, scope))
    .for("update");
}

/** Increment the (already locked) sequence and format the number. */
async function takeCreditNoteNumber(tx: DbLike, at: Date): Promise<string> {
  const year = at.getUTCFullYear();
  const scope = sequenceScope(year);
  const [row] = await tx
    .select({ lastValue: invoiceSequences.lastValue })
    .from(invoiceSequences)
    .where(eq(invoiceSequences.scope, scope))
    .limit(1);
  const next = (row?.lastValue ?? 0) + 1;
  await tx
    .update(invoiceSequences)
    .set({ lastValue: next })
    .where(eq(invoiceSequences.scope, scope));
  return `CN-${year}-${String(next).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Snapshot + creation (inside the cancellation transaction)
// ---------------------------------------------------------------------------

export function buildCreditNoteSnapshot(
  invoice: InvoiceRow,
  creditNoteNumber: string,
  createdAt: Date,
  reason: string,
): CreditNoteSnapshot {
  const source = invoice.snapshot as InvoiceSnapshot;
  return {
    ...source,
    documentType: "CREDIT_NOTE",
    creditNoteNumber,
    creditNoteIssuedAt: createdAt.toISOString(),
    originalInvoiceNumber: invoice.invoiceNumber,
    originalInvoiceIssuedAt: source.issuedAt,
    reason,
  };
}

export interface CreatedCreditNote {
  creditNote: CreditNoteRow;
  snapshot: CreditNoteSnapshot;
}

/**
 * Create the full credit note for an invoice inside the caller's
 * transaction and enqueue its email (transactional outbox — the send
 * itself happens later in the drain).
 */
export async function createCreditNoteForInvoice(
  tx: DbLike,
  invoice: InvoiceRow,
  order: OrderRow,
  reason: string,
  actor: StoreActor,
  createdAt: Date,
): Promise<CreatedCreditNote> {
  const creditNoteNumber = await takeCreditNoteNumber(tx, createdAt);
  const snapshot = buildCreditNoteSnapshot(
    invoice,
    creditNoteNumber,
    createdAt,
    reason,
  );
  const pdfStorageName = creditNotePdfStorageName(snapshot);
  const [inserted] = await tx
    .insert(creditNotes)
    .values({
      creditNoteNumber,
      invoiceId: invoice.id,
      orderId: order.id,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      shippingFee: invoice.shippingFee,
      discountTotal: invoice.discountTotal,
      taxTotal: invoice.taxTotal,
      grandTotal: invoice.grandTotal,
      snapshot,
      pdfStorageName,
      reason,
      createdBy: actor.userId,
    })
    .$returningId();
  const [creditNote] = await tx
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, inserted.id))
    .limit(1);

  await enqueueEmail(tx, {
    type: "CREDIT_NOTE",
    recipientEmail: order.customerEmailSnapshot,
    recipientUserId: order.userId,
    subject:
      `Credit note ${creditNoteNumber} — invoice ${invoice.invoiceNumber} ` +
      `for order ${order.orderNumber} credited in full`,
    text:
      `Dear ${order.shipRecipientName},\n\n` +
      `Your order ${order.orderNumber} has been cancelled.\n` +
      `Reason: ${reason}\n\n` +
      `Invoice ${invoice.invoiceNumber} has been credited in full by credit ` +
      `note ${creditNoteNumber} for ${invoice.currency} ${invoice.grandTotal}, ` +
      `attached as a PDF. No payment is due for this order.\n\n` +
      `If you believe this is a mistake, please contact us.`,
    attachmentStorageName: pdfStorageName,
    relatedType: "credit_note",
    relatedId: creditNote.id,
  });

  return { creditNote, snapshot };
}

// ---------------------------------------------------------------------------
// Views + access
// ---------------------------------------------------------------------------

export interface CreditNoteSummary {
  id: number;
  creditNoteNumber: string;
  invoiceId: number;
  orderId: number;
  grandTotalPaisa: number;
  reason: string;
  createdAt: Date;
}

export function toCreditNoteSummary(row: CreditNoteRow): CreditNoteSummary {
  return {
    id: row.id,
    creditNoteNumber: row.creditNoteNumber,
    invoiceId: row.invoiceId,
    orderId: row.orderId,
    grandTotalPaisa: parseMoneyToMinorUnits(row.grandTotal),
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export async function getCreditNoteByInvoiceId(
  db: DbLike,
  invoiceId: number,
): Promise<CreditNoteRow | null> {
  const [row] = await db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.invoiceId, invoiceId))
    .limit(1);
  return row ?? null;
}

export async function getCreditNoteByOrderId(
  db: DbLike,
  orderId: number,
): Promise<CreditNoteRow | null> {
  const [row] = await db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.orderId, orderId))
    .limit(1);
  return row ?? null;
}

/** PDF bytes for a credit note row (stored file, or re-rendered cache). */
export async function getCreditNotePdfBuffer(
  deps: OrdersDeps,
  creditNote: CreditNoteRow,
): Promise<Buffer> {
  if (!creditNote.pdfStorageName) throw AppError.internal();
  const snapshot = creditNote.snapshot as CreditNoteSnapshot;
  const logoImage = await resolveInvoiceLogoImage(deps.db, deps.config, snapshot);
  return ensureCreditNotePdf(
    deps.config,
    creditNote.pdfStorageName,
    snapshot,
    logoImage,
  );
}
