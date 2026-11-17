import { useEffect, useState } from "react";
import { Link } from "react-router";
import AccountLayout from "./AccountLayout";
import { formatRs, getOrder, listOrders, type CustomerOrder } from "../lib/shop";

/**
 * Order history — the customer's own orders from GET /api/orders with
 * an expandable detail (items snapshot, totals, delivery address) from
 * GET /api/orders/:id. Status labels are friendly renderings of the
 * server's order lifecycle.
 */

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting Approval",
  APPROVED: "Approved",
  PREPARING: "Preparing",
  DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return Requested",
  RETURNED: "Returned",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
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
                          </div>
                        </div>
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
