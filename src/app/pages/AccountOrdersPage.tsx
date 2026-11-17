import { useEffect, useState } from "react";
import { Link } from "react-router";
import AccountLayout from "./AccountLayout";
import {
  formatRs,
  getOrder,
  getOrderInvoice,
  listOrders,
  type CustomerInvoice,
  type CustomerOrder,
} from "../lib/shop";

/**
 * Order history — the customer's own orders from GET /api/orders with
 * an expandable detail (items snapshot, totals, delivery address) from
 * GET /api/orders/:id. The detail also carries a progress timeline in
 * customer language and, once the museum has approved the order, the
 * invoice card (GET /api/orders/:id/invoice + its PDF download).
 * Status labels are friendly renderings of the server's lifecycle
 * (PENDING_APPROVAL → APPROVED → PROCESSING → SHIPPED → DELIVERED).
 */

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting Approval",
  APPROVED: "Approved",
  PROCESSING: "Being Prepared",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

/** Progress steps in customer language; the index is the lifecycle order. */
const PROGRESS_STEPS: Array<{ status: string; label: string }> = [
  { status: "PENDING_APPROVAL", label: "Order placed" },
  { status: "APPROVED", label: "Approved" },
  { status: "PROCESSING", label: "Being prepared" },
  { status: "SHIPPED", label: "Shipped" },
  { status: "DELIVERED", label: "Delivered" },
];

/** An invoice exists from approval onwards (it also survives a later
 * cancellation, which the detail fetch confirms). */
const INVOICED_STATUSES = new Set(["APPROVED", "PROCESSING", "SHIPPED", "DELIVERED"]);

function ProgressTimeline({ status }: { status: string }) {
  if (status === "CANCELLED") {
    return (
      <p className="mb-6 border border-destructive/40 bg-destructive/5 px-4 py-3 font-sans text-sm text-destructive">
        This order was cancelled. If you were expecting it, please contact the museum.
      </p>
    );
  }
  const current = PROGRESS_STEPS.findIndex((step) => step.status === status);
  return (
    <ol className="mb-7 flex flex-wrap items-start gap-y-3" aria-label="Order progress">
      {PROGRESS_STEPS.map((step, index) => {
        const done = current >= 0 && index <= current;
        return (
          <li key={step.status} className="flex items-center">
            <span className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full border ${
                  done ? "border-accent bg-accent" : "border-border bg-background"
                }`}
                aria-hidden
              />
              <span
                className={`font-mono text-[0.52rem] uppercase tracking-widest ${
                  done ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </span>
            {index < PROGRESS_STEPS.length - 1 && (
              <span
                className={`mx-3 h-px w-6 sm:w-10 ${current > index ? "bg-accent" : "bg-border"}`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function formatPlacedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, CustomerOrder>>({});
  const [invoices, setInvoices] = useState<Record<number, CustomerInvoice | null>>({});

  useEffect(() => {
    let alive = true;
    listOrders(1, 20)
      .then(({ items, meta }) => {
        if (!alive) return;
        setOrders(items);
        setTotal(meta.total);
        setPage(1);
      })
      .catch(() => alive && setError("Your orders could not be loaded. Please try again shortly."));
    return () => {
      alive = false;
    };
  }, []);

  const loadMore = () => {
    const next = page + 1;
    listOrders(next, 20)
      .then(({ items, meta }) => {
        setOrders((prev) => [...(prev ?? []), ...items]);
        setTotal(meta.total);
        setPage(next);
      })
      .catch(() => setError("More orders could not be loaded."));
  };

  const toggle = (order: CustomerOrder) => {
    if (openId === order.id) {
      setOpenId(null);
      return;
    }
    setOpenId(order.id);
    if (!details[order.id]) {
      getOrder(order.id)
        .then((detail) => setDetails((prev) => ({ ...prev, [order.id]: detail })))
        .catch(() => setError("That order's details could not be loaded."));
    }
    if (!(order.id in invoices)) {
      getOrderInvoice(order.id)
        .then((invoice) => setInvoices((prev) => ({ ...prev, [order.id]: invoice })))
        .catch(() => setInvoices((prev) => ({ ...prev, [order.id]: null })));
    }
  };

  return (
    <AccountLayout title="My Orders">
      {error && (
        <p className="mb-6 border border-destructive/40 bg-destructive/5 px-4 py-3 font-sans text-sm text-destructive">
          {error}
        </p>
      )}
      {orders === null ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading orders…</p>
      ) : orders.length === 0 ? (
        <div className="border border-border bg-background p-10 text-center">
          <p className="mb-3 font-display text-xl font-medium">No orders yet</p>
          <p className="mb-8 font-sans text-sm font-light text-muted-foreground">
            When you place an order in the Gift Shop it will appear here.
          </p>
          <Link
            to="/shop"
            className="inline-block bg-accent px-8 py-3.5 font-sans text-[0.58rem] uppercase tracking-[0.2em] text-accent-foreground transition-opacity hover:opacity-90"
          >
            Browse the Gift Shop
          </Link>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border border border-border bg-background">
            {orders.map((order) => {
              const detail = details[order.id];
              const open = openId === order.id;
              return (
                <div key={order.id}>
                  <button
                    onClick={() => toggle(order)}
                    className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-6 py-5 text-left transition-colors hover:bg-secondary/60"
                    aria-expanded={open}
                  >
                    <span className="font-display text-base font-medium">{order.orderNumber}</span>
                    <span className="font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground">
                      {formatPlacedAt(order.placedAt)}
                    </span>
                    <span className="border border-accent/50 px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-widest text-accent">
                      {statusLabel(order.status)}
                    </span>
                    {INVOICED_STATUSES.has(order.status) && (
                      <span className="border border-border px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-widest text-muted-foreground">
                        Invoice available
                      </span>
                    )}
                    <span className="ml-auto font-display text-base font-medium">
                      {formatRs(order.grandTotalPaisa)}
                    </span>
                    <span className="font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground">
                      {open ? "Hide" : "Details"}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-border bg-secondary/40 px-6 py-6">
                      {!detail ? (
                        <p className="font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground">
                          Loading details…
                        </p>
                      ) : (
                        <>
                        <ProgressTimeline status={detail.status} />
                        <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
                          <div>
                            <table className="w-full text-sm">
                              <tbody>
                                {detail.items.map((item) => (
                                  <tr key={item.id} className="border-b border-border/60 last:border-0">
                                    <td className="py-2.5 pr-4">
                                      <span className="font-display font-medium">{item.name}</span>
                                      {item.variantName && (
                                        <span className="ml-2 font-mono text-[0.52rem] uppercase tracking-wider text-muted-foreground">
                                          {item.variantName}
                                        </span>
                                      )}
                                      <span className="block font-mono text-[0.52rem] uppercase tracking-wider text-muted-foreground">
                                        {item.sku} · ×{item.quantity}
                                      </span>
                                    </td>
                                    <td className="py-2.5 text-right font-sans">{formatRs(item.lineTotalPaisa)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <dl className="mt-5 space-y-1.5 font-sans text-sm">
                              <div className="flex justify-between">
                                <dt className="text-muted-foreground">Subtotal</dt>
                                <dd>{formatRs(detail.subtotalPaisa)}</dd>
                              </div>
                              <div className="flex justify-between">
                                <dt className="text-muted-foreground">Shipping</dt>
                                <dd>{detail.shippingFeePaisa === 0 ? "Free" : formatRs(detail.shippingFeePaisa)}</dd>
                              </div>
                              {detail.taxTotalPaisa > 0 && (
                                <div className="flex justify-between">
                                  <dt className="text-muted-foreground">Tax</dt>
                                  <dd>{formatRs(detail.taxTotalPaisa)}</dd>
                                </div>
                              )}
                              <div className="flex justify-between border-t border-border pt-2 font-medium">
                                <dt>Total (cash on delivery)</dt>
                                <dd className="font-display text-base">{formatRs(detail.grandTotalPaisa)}</dd>
                              </div>
                            </dl>
                          </div>
                          <div>
                            <h3 className="mb-2 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-muted-foreground">
                              Delivery
                            </h3>
                            <p className="font-sans text-sm leading-relaxed">
                              {detail.delivery.recipientName}
                              <br />
                              {detail.delivery.phone}
                              <br />
                              {detail.delivery.addressLine}
                              <br />
                              {detail.delivery.city}
                              {detail.delivery.district ? `, ${detail.delivery.district}` : ""}
                              {detail.delivery.postalCode ? ` ${detail.delivery.postalCode}` : ""}
                            </p>
                            {detail.delivery.notes && (
                              <p className="mt-3 font-sans text-sm font-light italic text-muted-foreground">
                                “{detail.delivery.notes}”
                              </p>
                            )}
                            <p className="mt-4 font-sans text-xs font-light leading-relaxed text-muted-foreground">
                              Payment: cash on delivery. The museum confirms each order before
                              dispatch — we will call if anything needs clarifying.
                            </p>
                            {invoices[order.id] && (
                              <div className="mt-6 border border-border bg-background p-4">
                                <h3 className="mb-1 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-muted-foreground">
                                  Invoice
                                </h3>
                                <p className="font-display text-base font-medium">
                                  {invoices[order.id]!.invoiceNumber}
                                </p>
                                <p className="mb-4 font-sans text-xs font-light text-muted-foreground">
                                  Issued {formatPlacedAt(invoices[order.id]!.issuedAt)} ·{" "}
                                  {formatRs(invoices[order.id]!.grandTotalPaisa)} · also emailed
                                  to you
                                </p>
                                <a
                                  href={invoices[order.id]!.downloadPath}
                                  className="inline-block border border-foreground px-5 py-2.5 font-mono text-[0.55rem] uppercase tracking-[0.2em] transition-colors hover:bg-foreground hover:text-background"
                                >
                                  Download PDF
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {orders.length < total && (
            <div className="mt-8 text-center">
              <button
                onClick={loadMore}
                className="border border-border px-8 py-3 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                Load More ({orders.length} of {total})
              </button>
            </div>
          )}
        </>
      )}
    </AccountLayout>
  );
}
