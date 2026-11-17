/**
 * Default invoice template (Phase 7, DATABASE_DESIGN.md §10.3).
 *
 * These are PLACEHOLDER DEFAULTS for the client to edit in the admin
 * invoice-template editor — the identity facts are the site's own
 * public contact details (the same ones the footer and About page
 * publish). The tax registration number is deliberately NULL: no VAT/PAN
 * number has ever been supplied for Bodhisattva International, and a
 * seed must never invent a legal identifier. While it is null the
 * renderer omits the line entirely.
 *
 * The shape is the invoice template configuration contract (validated
 * by the Zod schema in modules/orders/orders.schemas.ts on every read
 * and write): configuration only — company identity, number prefix,
 * colours, footer/terms text and field toggles. No markup, no code.
 */
export interface InvoiceTemplateConfigSeed {
  companyName: string;
  companyAddress: string;
  companyPhone: string | null;
  companyEmail: string | null;
  taxRegistrationNumber: string | null;
  logoMediaId: number | null;
  invoicePrefix: string;
  primaryColor: string;
  accentColor: string;
  footerText: string | null;
  termsText: string | null;
  show: {
    logo: boolean;
    companyPhone: boolean;
    companyEmail: boolean;
    taxRegistrationNumber: boolean;
    deliveryAddress: boolean;
    paymentMethod: boolean;
    terms: boolean;
    footer: boolean;
  };
}

export const DEFAULT_INVOICE_TEMPLATE_NAME = 'Default Museum Invoice';

export const DEFAULT_INVOICE_TEMPLATE_CONFIG: InvoiceTemplateConfigSeed = {
  companyName: 'Bodhisattva International',
  companyAddress:
    'Purna Museum of Newa Art & Bodhisattva Gallery\nHouse 91, Diamond Marg, Kupondole Heights\nLalitpur, Nepal',
  companyPhone: '+977-9851091255',
  companyEmail: 'info@bodhisattvainternational.com',
  taxRegistrationNumber: null,
  logoMediaId: null,
  invoicePrefix: 'INV',
  // The site's cream/ivory + gold identity, as printable ink colours.
  primaryColor: '#7C5C10',
  accentColor: '#C9A227',
  footerText: 'Thank you for supporting Bodhisattva International.',
  termsText:
    'Payment is collected on delivery (cash on delivery). Please inspect your items at the time of delivery.',
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
};
