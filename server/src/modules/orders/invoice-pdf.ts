/**
 * Invoice PDF renderer (Phase 7, spec Part 12, DATABASE_DESIGN §10.1).
 *
 * Purity contract: this module renders ONLY from the invoice's stored
 * snapshot — which embeds the template configuration the invoice was
 * issued under. It never reads live order/product/template rows, so a
 * later template edit (or product rename, or price change) cannot
 * alter an already-issued invoice, and a re-render is byte-identical
 * to the original (the snapshot test in the Phase 7 suite proves it).
 *
 * Determinism: PDFKit embeds the current time in the document info
 * dictionary by default; both dates are pinned to the invoice's
 * `issuedAt`, and streams are left uncompressed (`compress: false`) so
 * the content stays inspectable. Identical snapshot in → identical
 * bytes out.
 *
 * Logo (Phase 7b): the renderer stays pure — callers resolve the
 * pinned template's `logoMediaId` to image bytes (see
 * `resolveInvoiceLogoImage` in invoice-files.ts) and pass them in as
 * `options.logoImage`. When bytes are supplied and the template's
 * `show.logo` toggle is on, the logo is drawn above the seller name;
 * absent or unreadable bytes fall back to the typographic header.
 * The stored-file cache freezes whichever bytes were rendered first
 * (the approval flow warms the cache at issue time), so a later media
 * replacement cannot change an issued invoice's PDF.
 */
import { formatMoney } from "@bodhisattva/shared/money";
import PDFDocument from "pdfkit";
import type { InvoiceTemplateConfig } from "./orders.schemas.js";

export interface InvoiceSnapshotLine {
  name: string;
  variantName: string | null;
  sku: string | null;
  quantity: number;
  /** Money strings (DECIMAL), exactly as charged at checkout. */
  unitPrice: string;
  lineTotal: string;
}

export interface InvoiceSnapshot {
  invoiceNumber: string;
  /** ISO timestamp of issue. */
  issuedAt: string;
  orderNumber: string;
  /** ISO timestamp the order was placed. */
  orderPlacedAt: string;
  currency: string;
  paymentMethod: string;
  seller: {
    name: string;
    address: string;
    phone: string | null;
    email: string | null;
    taxRegistrationNumber: string | null;
    logoMediaId: number | null;
  };
  buyer: {
    name: string;
    email: string;
    phone: string;
  };
  delivery: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    district: string | null;
    postalCode: string | null;
    notes: string | null;
  };
  lines: InvoiceSnapshotLine[];
  totals: {
    subtotal: string;
    shippingFee: string;
    discountTotal: string;
    taxTotal: string;
    grandTotal: string;
  };
  template: {
    versionId: number;
    versionNo: number;
    config: InvoiceTemplateConfig;
  };
}

/**
 * Credit-note snapshot (Phase 8, Phase 7 review disposition 1): the
 * invoice's snapshot re-marked as a reversal document. Lines and
 * totals stay POSITIVE — the document type carries the reversal
 * semantics — and the renderer pins its dates to
 * `creditNoteIssuedAt`, keeping credit-note PDFs deterministic too.
 */
export interface CreditNoteSnapshot extends InvoiceSnapshot {
  documentType: "CREDIT_NOTE";
  creditNoteNumber: string;
  /** ISO timestamp the credit note was created. */
  creditNoteIssuedAt: string;
  originalInvoiceNumber: string;
  /** ISO timestamp the original invoice was issued. */
  originalInvoiceIssuedAt: string;
  /** The cancellation reason, carried from the transition. */
  reason: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** '2026-01-15T10:30:00.000Z' → '15 Jan 2026' (UTC, locale-free). */
export function formatSnapshotDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const INK = "#1F2937";
const MUTED = "#6B7280";
const RULE = "#D1D5DB";

export interface RenderInvoicePdfOptions {
  /** Logo image bytes (PNG/JPEG), resolved by the caller from the
   * pinned template's logoMediaId. Null/absent → typographic header. */
  logoImage?: Buffer | null;
}

/** What distinguishes an INVOICE render from a CREDIT NOTE render:
 * the title, the document's own number/date (which also pin the PDF
 * metadata dates), and the reference block under the title. */
interface DocumentDescriptor {
  infoTitle: string;
  titleText: string;
  /** ISO timestamp pinned into the PDF info dictionary. */
  documentDate: string;
  references: { label: string; value: string }[];
  /** Extra lines under the references (credit note: reversal note,
   * reason). */
  notes: string[];
}

function renderDocumentPdf(
  snapshot: InvoiceSnapshot,
  descriptor: DocumentDescriptor,
  options: RenderInvoicePdfOptions = {},
): Promise<Buffer> {
  const cfg = snapshot.template.config;
  const show = cfg.show;
  return new Promise((resolve, reject) => {
    const issued = new Date(descriptor.documentDate);
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      compress: false,
      info: {
        Title: descriptor.infoTitle,
        Author: snapshot.seller.name,
        CreationDate: issued,
        ModDate: issued,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const right = left + width;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    // ---- Seller header -------------------------------------------------
    // Optional logo band above the seller name (template toggle +
    // caller-resolved bytes). PDFKit throws on undecodable image data;
    // that falls back to the plain typographic header.
    let headerTop = 50;
    if (show.logo && options.logoImage) {
      try {
        doc.image(options.logoImage, left, 46, { fit: [150, 44] });
        headerTop = 46 + 44 + 10;
      } catch {
        headerTop = 50;
      }
    }
    doc
      .fillColor(cfg.primaryColor)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(snapshot.seller.name, left, headerTop, { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(9.5);
    for (const line of snapshot.seller.address.split("\n")) {
      doc.text(line, { width });
    }
    if (show.companyPhone && snapshot.seller.phone) {
      doc.text(`Phone: ${snapshot.seller.phone}`, { width });
    }
    if (show.companyEmail && snapshot.seller.email) {
      doc.text(`Email: ${snapshot.seller.email}`, { width });
    }
    if (
      show.taxRegistrationNumber &&
      snapshot.seller.taxRegistrationNumber
    ) {
      doc.text(`VAT Reg. No: ${snapshot.seller.taxRegistrationNumber}`, { width });
    }
    doc.moveDown(0.4);
    doc
      .strokeColor(cfg.accentColor)
      .lineWidth(1.6)
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .stroke();
    doc.moveDown(0.8);

    // ---- Title + references --------------------------------------------
    doc
      .fillColor(cfg.primaryColor)
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(descriptor.titleText, { width });
    doc.fillColor(INK).font("Helvetica").fontSize(10);
    for (const ref of descriptor.references) {
      doc.text(`${ref.label}: ${ref.value}`, { width });
    }
    for (const note of descriptor.notes) {
      doc.text(note, { width });
    }
    doc.moveDown(0.8);

    // ---- Buyer / delivery ----------------------------------------------
    const blockTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Billed To", left, blockTop, { width: width / 2 });
    doc.font("Helvetica").fontSize(10);
    doc.text(snapshot.buyer.name, { width: width / 2 });
    doc.text(snapshot.buyer.email, { width: width / 2 });
    doc.text(snapshot.buyer.phone, { width: width / 2 });
    const afterBuyer = doc.y;
    if (show.deliveryAddress) {
      const d = snapshot.delivery;
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("Deliver To", left + width / 2 + 10, blockTop, { width: width / 2 - 10 });
      doc.font("Helvetica").fontSize(10);
      doc.text(d.recipientName, left + width / 2 + 10, doc.y, { width: width / 2 - 10 });
      doc.text(d.addressLine, { width: width / 2 - 10 });
      const cityLine = [d.city, d.district, d.postalCode]
        .filter((part): part is string => Boolean(part))
        .join(", ");
      doc.text(cityLine, { width: width / 2 - 10 });
      doc.text(`Phone: ${d.phone}`, { width: width / 2 - 10 });
      if (d.notes) doc.text(`Notes: ${d.notes}`, { width: width / 2 - 10 });
    }
    doc.y = Math.max(afterBuyer, doc.y);
    doc.moveDown(1);

    // ---- Items table -----------------------------------------------------
    const colItem = left;
    const colQty = left + width - 190;
    const colUnit = left + width - 140;
    const colAmount = left + width - 80;
    const itemWidth = colQty - left - 8;

    const drawTableHeader = () => {
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(cfg.primaryColor)
        .text("Item", colItem, doc.y, { width: itemWidth, lineBreak: false })
        .text("Qty", colQty, doc.y, { width: 42, align: "right", lineBreak: false })
        .text("Unit Price", colUnit, doc.y, { width: 72, align: "right", lineBreak: false })
        .text("Amount", colAmount, doc.y, { width: 80, align: "right", lineBreak: false });
      doc.y += 14;
      doc
        .strokeColor(RULE)
        .lineWidth(0.8)
        .moveTo(left, doc.y)
        .lineTo(right, doc.y)
        .stroke();
      doc.y += 6;
    };

    drawTableHeader();
    doc.fillColor(INK);
    for (const line of snapshot.lines) {
      // Variant + SKU ride in the item sub-line; both are part of the
      // line snapshot itself, not template toggles (§10.3's toggle set
      // covers seller contact fields, delivery block, payment, terms
      // and footer).
      const subLine = [line.variantName, line.sku ? `SKU: ${line.sku}` : null]
        .filter((part): part is string => Boolean(part))
        .join(" · ");
      const nameHeight = doc
        .font("Helvetica")
        .fontSize(10)
        .heightOfString(line.name, { width: itemWidth });
      const rowHeight = nameHeight + (subLine ? 11 : 0) + 6;
      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        drawTableHeader();
        doc.fillColor(INK);
      }
      const rowTop = doc.y;
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(line.name, colItem, rowTop, { width: itemWidth });
      if (subLine) {
        doc
          .fillColor(MUTED)
          .fontSize(8)
          .text(subLine, colItem, rowTop + nameHeight + 1, { width: itemWidth });
        doc.fillColor(INK);
      }
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(String(line.quantity), colQty, rowTop, { width: 42, align: "right", lineBreak: false })
        .text(formatMoney(line.unitPrice, { currency: snapshot.currency }), colUnit, rowTop, { width: 72, align: "right", lineBreak: false })
        .text(formatMoney(line.lineTotal, { currency: snapshot.currency }), colAmount, rowTop, { width: 80, align: "right", lineBreak: false });
      doc.y = rowTop + rowHeight;
    }
    doc
      .strokeColor(RULE)
      .lineWidth(0.8)
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .stroke();
    doc.moveDown(0.6);

    // ---- Totals ----------------------------------------------------------
    const totalsX = left + width - 230;
    const totalsWidth = 230;
    const totalRow = (label: string, value: string, bold = false) => {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(bold ? 11.5 : 10)
        .fillColor(bold ? cfg.primaryColor : INK)
        .text(label, totalsX, doc.y, { width: 120, lineBreak: false })
        .text(value, totalsX + 120, doc.y, { width: 110, align: "right", lineBreak: false });
      doc.y += bold ? 18 : 15;
    };
    totalRow("Subtotal", formatMoney(snapshot.totals.subtotal, { currency: snapshot.currency }));
    totalRow("Shipping", formatMoney(snapshot.totals.shippingFee, { currency: snapshot.currency }));
    if (snapshot.totals.discountTotal !== "0.00") {
      totalRow("Discount", `-${formatMoney(snapshot.totals.discountTotal, { currency: snapshot.currency })}`);
    }
    totalRow("VAT", formatMoney(snapshot.totals.taxTotal, { currency: snapshot.currency }));
    doc
      .strokeColor(cfg.accentColor)
      .lineWidth(1)
      .moveTo(totalsX, doc.y)
      .lineTo(right, doc.y)
      .stroke();
    doc.y += 4;
    totalRow("Grand Total", formatMoney(snapshot.totals.grandTotal, { currency: snapshot.currency }), true);
    doc.moveDown(0.8);

    // ---- Payment / terms ---------------------------------------------------
    doc.fillColor(INK).font("Helvetica").fontSize(10);
    if (show.paymentMethod) {
      const method =
        snapshot.paymentMethod === "COD"
          ? "Cash on Delivery (COD)"
          : snapshot.paymentMethod;
      doc.text(`Payment method: ${method}`, left, doc.y, { width });
      doc.moveDown(0.6);
    }
    if (show.terms && cfg.termsText) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(cfg.primaryColor).text("Terms", { width });
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(cfg.termsText, { width });
    }

    // ---- Footer --------------------------------------------------------------
    if (show.footer && cfg.footerText) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(MUTED)
        .text(cfg.footerText, left, doc.page.height - doc.page.margins.bottom - 14, {
          width,
          align: "center",
        });
    }

    doc.end();
  });
}

export function renderInvoicePdf(
  snapshot: InvoiceSnapshot,
  options: RenderInvoicePdfOptions = {},
): Promise<Buffer> {
  return renderDocumentPdf(
    snapshot,
    {
      infoTitle: `Invoice ${snapshot.invoiceNumber}`,
      titleText: "INVOICE",
      documentDate: snapshot.issuedAt,
      references: [
        { label: "Invoice No", value: snapshot.invoiceNumber },
        { label: "Issue Date", value: formatSnapshotDate(snapshot.issuedAt) },
        { label: "Order No", value: snapshot.orderNumber },
        { label: "Order Date", value: formatSnapshotDate(snapshot.orderPlacedAt) },
      ],
      notes: [],
    },
    options,
  );
}

/**
 * Render a credit note (Phase 8): same snapshot-driven body as the
 * invoice it reverses, re-titled, carrying its own number/date and a
 * reference back to the original invoice. Deterministic — the PDF
 * metadata dates pin to the credit note's creation timestamp.
 */
export function renderCreditNotePdf(
  snapshot: CreditNoteSnapshot,
  options: RenderInvoicePdfOptions = {},
): Promise<Buffer> {
  return renderDocumentPdf(
    snapshot,
    {
      infoTitle: `Credit Note ${snapshot.creditNoteNumber}`,
      titleText: "CREDIT NOTE",
      documentDate: snapshot.creditNoteIssuedAt,
      references: [
        { label: "Credit Note No", value: snapshot.creditNoteNumber },
        { label: "Issue Date", value: formatSnapshotDate(snapshot.creditNoteIssuedAt) },
        { label: "Original Invoice No", value: snapshot.originalInvoiceNumber },
        {
          label: "Original Invoice Date",
          value: formatSnapshotDate(snapshot.originalInvoiceIssuedAt),
        },
        { label: "Order No", value: snapshot.orderNumber },
        { label: "Order Date", value: formatSnapshotDate(snapshot.orderPlacedAt) },
      ],
      notes: [
        `This credit note reverses invoice ${snapshot.originalInvoiceNumber} in full.`,
        `Reason: ${snapshot.reason}`,
      ],
    },
    options,
  );
}
