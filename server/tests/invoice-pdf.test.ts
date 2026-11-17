/**
 * Invoice PDF renderer unit tests (Phase 7).
 *
 * The renderer must be DETERMINISTIC — the same stored snapshot always
 * produces the same bytes — because an issued invoice's PDF is an
 * accounting artefact: template edits later must never change what a
 * re-download yields (exit-gate test 6 in the integration suite proves
 * it end-to-end; here the property is pinned at the unit level).
 * PDFKit pins its trailer ID and dates from the document info, which
 * the renderer sets from the invoice's issuedAt.
 */
import { formatMoney } from "@bodhisattva/shared/money";
import { describe, expect, it } from "vitest";
import {
  renderCreditNotePdf,
  renderInvoicePdf,
  type CreditNoteSnapshot,
  type InvoiceSnapshot,
} from "../src/modules/orders/invoice-pdf.js";

const SNAPSHOT: InvoiceSnapshot = {
  invoiceNumber: "INV-2026-00042",
  issuedAt: "2026-11-17T10:15:00.000Z",
  orderNumber: "ORD-2026-000123",
  orderPlacedAt: "2026-11-17T09:00:00.000Z",
  currency: "NPR",
  paymentMethod: "COD",
  seller: {
    name: "Bodhisattva International",
    address: "House 91, Diamond Marg, Kupondole Heights\nLalitpur, Nepal",
    phone: "+977-9851091255",
    email: "info@bodhisattvainternational.com",
    taxRegistrationNumber: null,
    logoMediaId: null,
  },
  buyer: { name: "Test Buyer", email: "buyer@example.com", phone: "9800000001" },
  delivery: {
    recipientName: "Test Buyer",
    phone: "9800000001",
    addressLine: "Kupondole Heights",
    city: "Lalitpur",
    district: null,
    postalCode: null,
    notes: null,
  },
  lines: [
    {
      name: "Green Tara Thangka",
      variantName: null,
      sku: "BOD-001",
      quantity: 2,
      unitPrice: "4500.00",
      lineTotal: "9000.00",
    },
  ],
  totals: {
    subtotal: "9000.00",
    shippingFee: "0.00",
    discountTotal: "0.00",
    taxTotal: "0.00",
    grandTotal: "9000.00",
  },
  template: {
    versionId: 1,
    versionNo: 1,
    config: {
      companyName: "Bodhisattva International",
      companyAddress: "House 91, Diamond Marg",
      companyPhone: "+977-9851091255",
      companyEmail: "info@bodhisattvainternational.com",
      taxRegistrationNumber: null,
      logoMediaId: null,
      invoicePrefix: "INV",
      primaryColor: "#7C5C10",
      accentColor: "#C9A227",
      footerText: "Thank you for supporting Bodhisattva International.",
      termsText: "Payment is collected in cash on delivery.",
      show: {
        logo: true,
        companyPhone: true,
        companyEmail: true,
        taxRegistrationNumber: true,
        deliveryAddress: true,
        paymentMethod: true,
        terms: true,
        footer: true,
      },
    },
  },
};

/**
 * Decode the renderer's uncompressed hex-TJ text runs back to text.
 * Segments are concatenated WITHOUT separators: PDFKit splits runs at
 * kerning boundaries, even mid-word, and the characters themselves
 * (including spaces) are all present in order.
 */
function extractText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = match[1];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
  }
  return text;
}

describe("renderInvoicePdf", () => {
  it("is deterministic: identical snapshots render byte-identical PDFs", async () => {
    const first = await renderInvoicePdf(SNAPSHOT);
    const second = await renderInvoicePdf(SNAPSHOT);
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders the full Part 12 field set from the snapshot", async () => {
    const text = extractText(await renderInvoicePdf(SNAPSHOT));
    expect(text).toContain("INV-2026-00042"); // invoice number
    expect(text).toContain("ORD-2026-000123"); // order number
    expect(text).toContain("Bodhisattva International"); // seller
    expect(text).toContain("Green Tara Thangka"); // line item
    expect(text).toContain("BOD-001"); // SKU from the line snapshot
    expect(text).toContain(formatMoney("9000.00")); // grand total "Rs. 9,000.00"
    expect(text).toContain("Cash on Delivery"); // payment method
    expect(text).toContain("Thank you for supporting Bodhisattva International.");
  });

  it("honours the field toggles of the pinned template version", async () => {
    const toggled: InvoiceSnapshot = {
      ...SNAPSHOT,
      template: {
        ...SNAPSHOT.template,
        config: {
          ...SNAPSHOT.template.config,
          termsText: "UNIQUE TERMS MARKER",
          show: {
            ...SNAPSHOT.template.config.show,
            terms: false,
            deliveryAddress: false,
          },
        },
      },
    };
    const text = extractText(await renderInvoicePdf(toggled));
    expect(text).not.toContain("UNIQUE TERMS MARKER");
    expect(text).not.toContain("Deliver To");
    // The untoggled baseline does carry both.
    const baseline = extractText(await renderInvoicePdf(SNAPSHOT));
    expect(baseline).toContain("Deliver To");
  });

  // A 1×1 transparent PNG — the smallest image PDFKit can embed.
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  it("embeds the logo image when bytes are supplied and the toggle is on", async () => {
    const withLogo = await renderInvoicePdf(SNAPSHOT, { logoImage: TINY_PNG });
    const plain = await renderInvoicePdf(SNAPSHOT);
    expect(withLogo.toString("latin1")).toContain("/Subtype /Image");
    expect(plain.toString("latin1")).not.toContain("/Subtype /Image");
    expect(withLogo.equals(plain)).toBe(false);
    // Deterministic with the same logo bytes, too.
    const again = await renderInvoicePdf(SNAPSHOT, { logoImage: TINY_PNG });
    expect(again.equals(withLogo)).toBe(true);
    // The rest of the document is unaffected.
    expect(extractText(withLogo)).toContain("INV-2026-00042");
  });

  it("falls back to the typographic header for unreadable logo bytes", async () => {
    const garbage = await renderInvoicePdf(SNAPSHOT, {
      logoImage: Buffer.from("this is not an image"),
    });
    const plain = await renderInvoicePdf(SNAPSHOT);
    expect(garbage.equals(plain)).toBe(true);
  });

  it("ignores supplied logo bytes when the template hides the logo", async () => {
    const hidden: InvoiceSnapshot = {
      ...SNAPSHOT,
      template: {
        ...SNAPSHOT.template,
        config: {
          ...SNAPSHOT.template.config,
          show: { ...SNAPSHOT.template.config.show, logo: false },
        },
      },
    };
    const rendered = await renderInvoicePdf(hidden, { logoImage: TINY_PNG });
    expect(rendered.toString("latin1")).not.toContain("/Subtype /Image");
  });
});

describe("renderCreditNotePdf (Phase 8)", () => {
  const CREDIT_NOTE: CreditNoteSnapshot = {
    ...SNAPSHOT,
    documentType: "CREDIT_NOTE",
    creditNoteNumber: "CN-2026-00007",
    creditNoteIssuedAt: "2026-11-18T08:30:00.000Z",
    originalInvoiceNumber: SNAPSHOT.invoiceNumber,
    originalInvoiceIssuedAt: SNAPSHOT.issuedAt,
    reason: "Customer asked to cancel",
  };

  it("is deterministic and carries the credit-note identity", async () => {
    const first = await renderCreditNotePdf(CREDIT_NOTE);
    const second = await renderCreditNotePdf(CREDIT_NOTE);
    expect(first.equals(second)).toBe(true);
    const text = extractText(first);
    expect(text).toContain("CREDIT NOTE");
    expect(text).toContain("CN-2026-00007");
    // References the original invoice it reverses, in full.
    expect(text).toContain("INV-2026-00042");
    expect(text).toContain("reverses invoice INV-2026-00042 in full");
    expect(text).toContain("Customer asked to cancel");
    // Totals stay positive — the document type carries the reversal.
    expect(text).toContain(formatMoney("9000.00"));
    // And it is NOT the invoice: the uppercase INVOICE title block
    // never appears ("Original Invoice No" is title-case).
    expect(text).not.toContain("INVOICE");
  });
});
