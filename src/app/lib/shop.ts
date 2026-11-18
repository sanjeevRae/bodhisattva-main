/**
 * Store client for the public site (Phase 6) — the ecommerce module's
 * public + customer endpoints (server/src/modules/store):
 *
 *   Public:   GET /api/shop/categories · /api/shop/products ·
 *             GET /api/shop/products/:slug · GET /api/shop/config
 *   Customer: /api/cart, /api/addresses, /api/checkout, /api/orders
 *             (full session; CSRF token required on mutations)
 *
 * This is deliberately separate code from the admin client
 * (src/admin/api.ts): same wire conventions (shared success envelope,
 * X-CSRF-Token header, `csrf` cookie fallback), but owned by the public
 * site and free of admin concerns. The customer session context in
 * lib/customer.tsx builds on the primitives exported here.
 */

export interface ShopImage {
  url: string;
  alt: string;
}

export interface ShopCategory {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  productCount: number;
}

export interface ShopProduct {
  id: number;
  slug: string;
  sku: string | null;
  name: string;
  detail: string | null;
  pricePaisa: number;
  salePricePaisa: number | null;
  effectivePricePaisa: number;
  categorySlug: string | null;
  image: ShopImage | null;
  availableQty: number;
  inStock: boolean;
  isFeatured: boolean;
}

export interface ShopVariant {
  id: number;
  name: string;
  sku: string | null;
  priceDeltaPaisa: number;
  effectivePricePaisa: number;
  availableQty: number;
  inStock: boolean;
}

export interface ShopProductDetail extends ShopProduct {
  description: string | null;
  categoryName: string | null;
  images: (ShopImage & { id: number; isPrimary: boolean })[];
  variants: ShopVariant[];
}

export interface ShopConfig {
  currency: "NPR";
  shippingFeePaisa: number;
  taxRatePercent: number;
  codEnabled: boolean;
}

export interface CartItem {
  id: number;
  productId: number;
  variantId: number | null;
  name: string;
  sku: string | null;
  variantName: string | null;
  image: ShopImage | null;
  unitPricePaisa: number;
  quantity: number;
  lineTotalPaisa: number;
  availableQty: number;
  productStatus: string;
}

export interface CartView {
  items: CartItem[];
  subtotalPaisa: number;
  itemCount: number;
}

export interface CustomerAddress {
  id: number;
  userId: number;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  district: string | null;
  postalCode: string | null;
  deliveryNotes: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput {
  label?: string | null;
  recipientName: string;
  phone: string;
  /** ISO country code for a national-format phone; omitted for "+…" input. */
  phoneCountry?: string;
  addressLine: string;
  city: string;
  district?: string | null;
  postalCode?: string | null;
  deliveryNotes?: string | null;
  isDefault?: boolean;
}

export interface OrderItem {
  id: number;
  productId: number | null;
  variantId: number | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  unitPricePaisa: number;
  quantity: number;
  lineTotalPaisa: number;
}

export interface CustomerOrder {
  id: number;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  currency: string;
  subtotalPaisa: number;
  shippingFeePaisa: number;
  discountTotalPaisa: number;
  taxTotalPaisa: number;
  grandTotalPaisa: number;
  customerEmail: string;
  delivery: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    district: string | null;
    postalCode: string | null;
    notes: string | null;
  };
  items: OrderItem[];
  placedAt: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Money formatting — the site's historical display strings are
// "Rs.4,500" / "Rs.18,000" (Indian digit grouping, no space, no decimals
// for whole rupees). Paisa are the API's unit; format from them exactly.
// ---------------------------------------------------------------------------

const inrGrouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatRs(paisa: number): string {
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = inrGrouping.format(rupees);
  return remainder === 0
    ? `${sign}Rs.${grouped}`
    : `${sign}Rs.${grouped}.${String(remainder).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Request plumbing (mirrors the admin client's conventions, public-owned)
// ---------------------------------------------------------------------------

export interface FieldIssue {
  field: string;
  issue: string;
}

export class ShopApiError extends Error {
  status: number;
  code: string;
  details: FieldIssue[];

  constructor(status: number, code: string, message: string, details: FieldIssue[] = []) {
    super(message);
    this.name = "ShopApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get detailText(): string {
    return this.details.map((d) => `${d.field}: ${d.issue}`).join("; ");
  }
}

let csrfToken: string | null = null;

export function setShopCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getShopCsrfToken(): string | null {
  if (csrfToken) return csrfToken;
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: PageMeta;
}

export async function shopRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const token = getShopCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "include",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ShopApiError(0, "NETWORK", "Could not reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ShopApiError(
      res.status,
      typeof err.code === "string" ? err.code : "UNKNOWN",
      typeof err.message === "string" ? err.message : `Request failed (${res.status}).`,
      Array.isArray(err.details) ? err.details : [],
    );
  }
  return data as T;
}

/** Unwrap the shared success envelope's `data`. */
async function dataOf<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const env = await shopRequest<Envelope<T>>(path, options);
  return env.data;
}

// ---------------------------------------------------------------------------
// Public shop
// ---------------------------------------------------------------------------

export async function getShopCategories(): Promise<ShopCategory[]> {
  const data = await dataOf<{ items: ShopCategory[] }>("/api/shop/categories");
  return data.items;
}

export interface ShopListParams {
  category?: string;
  search?: string;
  sort?: "featured" | "price-asc" | "price-desc" | "name";
  page?: number;
  pageSize?: number;
}

export async function getShopProducts(params: ShopListParams = {}): Promise<{ items: ShopProduct[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.search) query.set("search", params.search);
  if (params.sort) query.set("sort", params.sort);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 48));
  const env = await shopRequest<Envelope<ShopProduct[]>>(`/api/shop/products?${query.toString()}`);
  return {
    items: env.data,
    meta: env.meta ?? { page: 1, pageSize: env.data.length, total: env.data.length, totalPages: 1 },
  };
}

export function getShopProduct(slug: string): Promise<ShopProductDetail> {
  return dataOf<ShopProductDetail>(`/api/shop/products/${encodeURIComponent(slug)}`);
}

export function getShopConfig(): Promise<ShopConfig> {
  return dataOf<ShopConfig>("/api/shop/config");
}

// ---------------------------------------------------------------------------
// Cart (session required)
// ---------------------------------------------------------------------------

export function getCart(): Promise<CartView> {
  return dataOf<CartView>("/api/cart");
}

export function addCartItem(productId: number, variantId: number | null, quantity: number): Promise<CartView> {
  return dataOf<CartView>("/api/cart/items", {
    method: "POST",
    body: { productId, variantId, quantity },
  });
}

export function updateCartItem(itemId: number, quantity: number): Promise<CartView> {
  return dataOf<CartView>(`/api/cart/items/${itemId}`, { method: "PATCH", body: { quantity } });
}

export function removeCartItem(itemId: number): Promise<CartView> {
  return dataOf<CartView>(`/api/cart/items/${itemId}`, { method: "DELETE" });
}

export function clearCart(): Promise<CartView> {
  return dataOf<CartView>("/api/cart", { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Addresses, checkout, orders (session required)
// ---------------------------------------------------------------------------

export async function listAddresses(): Promise<CustomerAddress[]> {
  const data = await dataOf<{ items: CustomerAddress[] }>("/api/addresses");
  return data.items;
}

export function createAddress(input: AddressInput): Promise<CustomerAddress> {
  return dataOf<CustomerAddress>("/api/addresses", { method: "POST", body: input });
}

export function updateAddress(id: number, patch: Partial<AddressInput>): Promise<CustomerAddress> {
  return dataOf<CustomerAddress>(`/api/addresses/${id}`, { method: "PATCH", body: patch });
}

export function deleteAddress(id: number): Promise<{ deleted: boolean }> {
  return dataOf<{ deleted: boolean }>(`/api/addresses/${id}`, { method: "DELETE" });
}

export interface CheckoutInput {
  addressId?: number;
  address?: {
    recipientName: string;
    phone: string;
    phoneCountry?: string;
    addressLine: string;
    city: string;
    district?: string | null;
    postalCode?: string | null;
    deliveryNotes?: string | null;
  };
  idempotencyKey: string;
  notes?: string;
}

export async function checkout(input: CheckoutInput): Promise<CustomerOrder> {
  const data = await dataOf<{ order: CustomerOrder }>("/api/checkout", { method: "POST", body: input });
  return data.order;
}

export async function listOrders(page = 1, pageSize = 20): Promise<{ items: CustomerOrder[]; meta: PageMeta }> {
  const env = await shopRequest<Envelope<CustomerOrder[]>>(`/api/orders?page=${page}&pageSize=${pageSize}`);
  return {
    items: env.data,
    meta: env.meta ?? { page, pageSize, total: env.data.length, totalPages: 1 },
  };
}

export function getOrder(id: number): Promise<CustomerOrder> {
  return dataOf<CustomerOrder>(`/api/orders/${id}`);
}

// ---------------------------------------------------------------------------
// Invoices (Phase 7) — issued at approval; the metadata endpoint 404s
// until then, which simply means "no invoice yet" for the account UI.
// ---------------------------------------------------------------------------

export interface CustomerInvoice {
  id: number;
  invoiceNumber: string;
  orderId: number;
  orderNumber: string;
  currency: string;
  subtotalPaisa: number;
  shippingFeePaisa: number;
  discountTotalPaisa: number;
  taxTotalPaisa: number;
  grandTotalPaisa: number;
  /** PENDING | SENT | FAILED — delivery state of the invoice email. */
  emailStatus: string;
  issuedAt: string;
  /** Same-origin PDF download path (session cookie authorises it). */
  downloadPath: string;
}

/** The order's invoice, or null when none has been issued yet. */
export async function getOrderInvoice(orderId: number): Promise<CustomerInvoice | null> {
  try {
    return await dataOf<CustomerInvoice>(`/api/orders/${orderId}/invoice`);
  } catch (err) {
    if (err instanceof ShopApiError && err.status === 404) return null;
    throw err;
  }
}
