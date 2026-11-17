/**
 * Order detail (Phase 7) — the Store Admin workspace for one order.
 *
 * Shows the customer + delivery snapshots, the line-item snapshots and
 * totals exactly as charged, the status-history timeline (actor, role,
 * reason), and the invoice card once approval has issued one. Lifecycle
 * actions are the server's state machine surfaced: only the transitions
 * valid for the current state are offered, each gated on the same
 * permission the API requires; reject/cancel demand a reason, every
 * action confirms first, and a 422 from the server is shown verbatim.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Download, MailPlus } from "lucide-react";
import { ordersApi, type OrderTransitionAction } from "../api";
import { useAuth } from "../AdminApp";
import type { AdminOrderDetail } from "../types";
import {
  Btn,
  ConfirmDialog,
  ErrorBox,
  Field,
  Modal,
  Notice,
  Spinner,
  formatDateTime,
  inputCls,
} from "../ui";
import { formatRsPaisa } from "./module-shared";
import { InvoiceEmailBadge, OrderStatusBadge, formatAge, orderStatusLabel } from "./order-shared";

interface ActionSpec {
  action: OrderTransitionAction;
  label: string;
  permission: string;
  variant: "accent" | "primary" | "outline" | "danger";
  needsReason?: boolean;
  blurb: string;
}

function actionsFor(status: string): ActionSpec[] {
  switch (status) {
    case "PENDING_APPROVAL":
      return [
        {
          action: "approve",
          label: "Approve order",
          permission: "store.orders.approve",
          variant: "accent",
          blurb:
            "Approving finalises the reserved stock, creates the invoice and emails it to the customer.",
        },
        {
          action: "reject",
          label: "Reject",
          permission: "store.orders.cancel",
          variant: "danger",
          needsReason: true,
          blurb: "Rejecting cancels the order and releases its reserved stock.",
        },
        {
          action: "cancel",
          label: "Cancel order",
          permission: "store.orders.cancel",
          variant: "danger",
          needsReason: true,
          blurb: "Cancelling releases the reserved stock. The customer is notified with the reason.",
        },
      ];
    case "APPROVED":
      return [
        {
          action: "process",
          label: "Start processing",
          permission: "store.orders.update",
          variant: "accent",
          blurb: "Marks the order as being prepared for dispatch.",
        },
        {
          action: "cancel",
          label: "Cancel order",
          permission: "store.orders.cancel",
          variant: "danger",
          needsReason: true,
          blurb: "Cancelling restores the deducted stock. The issued invoice stays on record.",
        },
      ];
    case "PROCESSING":
      return [
        {
          action: "ship",
          label: "Mark shipped",
          permission: "store.orders.update",
          variant: "accent",
          blurb: "Marks the order as dispatched to the customer.",
        },
        {
          action: "cancel",
          label: "Cancel order",
          permission: "store.orders.cancel",
          variant: "danger",
          needsReason: true,
          blurb: "Cancelling restores the deducted stock. The issued invoice stays on record.",
        },
      ];
    case "SHIPPED":
      return [
        {
          action: "deliver",
          label: "Mark delivered",
          permission: "store.orders.update",
          variant: "accent",
          blurb: "Marks the order as delivered — the lifecycle is complete.",
        },
      ];
    default:
      return [];
  }
}

export default function OrderDetailScreen() {
  const { id } = useParams();
  const orderId = Number(id);
  const { hasPermission } = useAuth();
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pending, setPending] = useState<ActionSpec | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<unknown>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [resendOpen, setResendOpen] = useState(false);
  const [resendError, setResendError] = useState<unknown>(null);
  const [resendBusy, setResendBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await ordersApi.get(orderId);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runTransition = async () => {
    if (!pending) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const next = await ordersApi.transition(
        orderId,
        pending.action,
        pending.needsReason ? reason.trim() : undefined,
      );
      setDetail(next);
      setNotice(`${pending.label.replace(/ order$/, "")} complete — the order is now ${orderStatusLabel(next.order.status).toLowerCase()}.`);
      setPending(null);
      setReason("");
    } catch (err) {
      // A 422 (stale state) surfaces the server's message verbatim.
      setActionError(err);
    } finally {
      setActionBusy(false);
    }
  };

  const runResend = async () => {
    setResendBusy(true);
    setResendError(null);
    try {
      const invoice = await ordersApi.resendInvoice(orderId);
      setDetail((prev) => (prev ? { ...prev, invoice } : prev));
      setNotice(`Invoice ${invoice.invoiceNumber} queued for re-delivery.`);
      setResendOpen(false);
    } catch (err) {
      setResendError(err);
    } finally {
      setResendBusy(false);
    }
  };

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <BackLink />
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl">
        <Spinner label="Loading order…" />
      </div>
    );
  }

  const { order, customer, history, invoice } = detail;
  const actions = actionsFor(order.status).filter((spec) => hasPermission(spec.permission));
  const reasonMissing = pending?.needsReason && reason.trim() === "";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-wide">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Placed {formatDateTime(order.placedAt)} · Payment:{" "}
            {order.paymentMethod === "COD" ? "Cash on Delivery" : order.paymentMethod}
            {order.status === "PENDING_APPROVAL" && (
              <> · <span className="text-amber-700 dark:text-amber-400">waiting {formatAge(Date.now() - new Date(order.placedAt).getTime())}</span></>
            )}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <Notice>{notice}</Notice>
      <ErrorBox error={error} />

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((spec) => (
            <Btn
              key={spec.action}
              variant={spec.variant}
              onClick={() => {
                setActionError(null);
                setReason("");
                setPending(spec);
              }}
            >
              {spec.label}
            </Btn>
          ))}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-sm border border-border">
            <h2 className="border-b border-border bg-card px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
              Items
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-4 py-2 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Item</th>
                  <th scope="col" className="px-4 py-2 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Qty</th>
                  <th scope="col" className="px-4 py-2 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Unit price</th>
                  <th scope="col" className="px-4 py-2 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <span className="font-medium">{item.name}</span>
                      {(item.variantName || item.sku) && (
                        <span className="block text-xs text-muted-foreground">
                          {[item.variantName, item.sku ? `SKU: ${item.sku}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{item.quantity}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{formatRsPaisa(item.unitPricePaisa)}</td>
                    <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{formatRsPaisa(item.lineTotalPaisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatRsPaisa(order.subtotalPaisa)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd>{formatRsPaisa(order.shippingFeePaisa)}</dd>
              </div>
              {order.discountTotalPaisa > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd>−{formatRsPaisa(order.discountTotalPaisa)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd>{formatRsPaisa(order.taxTotalPaisa)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <dt>Grand total</dt>
                <dd>{formatRsPaisa(order.grandTotalPaisa)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-sm border border-border">
            <h2 className="border-b border-border bg-card px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
              Status history
            </h2>
            <ol className="space-y-0 px-4 py-3">
              {history.map((entry, index) => (
                <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-1">
                  {index < history.length - 1 && (
                    <span className="absolute top-3 left-[5px] h-full w-px bg-border" aria-hidden />
                  )}
                  <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-accent bg-background" aria-hidden />
                  <div className="text-sm">
                    <p className="font-medium">
                      {entry.fromStatus ? `${orderStatusLabel(entry.fromStatus)} → ` : ""}
                      {orderStatusLabel(entry.toStatus)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)} ·{" "}
                      {entry.actorRole
                        ? `${entry.actorRole.replace(/_/g, " ")}${entry.actorId ? ` #${entry.actorId}` : ""}`
                        : "Customer / system"}
                    </p>
                    {entry.reason && (
                      <p className="mt-1 text-sm italic text-muted-foreground">“{entry.reason}”</p>
                    )}
                  </div>
                </li>
              ))}
              {history.length === 0 && (
                <li className="text-sm text-muted-foreground">No transitions recorded.</li>
              )}
            </ol>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-sm border border-border">
            <h2 className="border-b border-border bg-card px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
              Customer
            </h2>
            <div className="space-y-1 px-4 py-3 text-sm">
              <p className="font-medium">{order.delivery.recipientName}</p>
              <p className="text-muted-foreground">{customer.email}</p>
              <p className="text-muted-foreground">Account #{customer.userId}</p>
            </div>
          </section>

          <section className="rounded-sm border border-border">
            <h2 className="border-b border-border bg-card px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
              Delivery address
            </h2>
            <div className="space-y-1 px-4 py-3 text-sm">
              <p>{order.delivery.addressLine}</p>
              <p className="text-muted-foreground">
                {[order.delivery.city, order.delivery.district, order.delivery.postalCode]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="text-muted-foreground">Phone: {order.delivery.phone}</p>
              {order.delivery.notes && (
                <p className="pt-1 italic text-muted-foreground">“{order.delivery.notes}”</p>
              )}
            </div>
          </section>

          <section className="rounded-sm border border-border">
            <h2 className="border-b border-border bg-card px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
              Invoice
            </h2>
            {invoice ? (
              <div className="space-y-3 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{invoice.invoiceNumber}</span>
                  <InvoiceEmailBadge emailStatus={invoice.emailStatus} />
                </div>
                <p className="text-muted-foreground">
                  Issued {formatDateTime(invoice.issuedAt)} · {formatRsPaisa(invoice.grandTotalPaisa)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={ordersApi.invoiceDownloadUrl(invoice.id)}
                    className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-background px-3 text-xs font-medium hover:bg-secondary"
                  >
                    <Download size={13} /> Download PDF
                  </a>
                  {hasPermission("store.invoices.resend") && (
                    <Btn
                      size="sm"
                      onClick={() => {
                        setResendError(null);
                        setResendOpen(true);
                      }}
                    >
                      <MailPlus size={13} /> Resend email
                    </Btn>
                  )}
                </div>
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {order.status === "CANCELLED"
                  ? "No invoice was issued for this order."
                  : "The invoice is created automatically when the order is approved."}
              </p>
            )}
          </section>
        </div>
      </div>

      <Modal open={pending !== null} onClose={() => setPending(null)} title={pending?.label ?? ""}>
        <div className="space-y-4">
          <p className="text-sm">{pending?.blurb}</p>
          {pending?.needsReason && (
            <Field label="Reason (required — recorded in the order history)">
              <textarea
                className={inputCls}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this order being cancelled / rejected?"
                autoFocus
              />
            </Field>
          )}
          <ErrorBox error={actionError} />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setPending(null)} disabled={actionBusy}>
              Back
            </Btn>
            <Btn
              variant={pending?.variant ?? "accent"}
              onClick={() => void runTransition()}
              disabled={actionBusy || reasonMissing}
            >
              {actionBusy ? "Working…" : pending?.label}
            </Btn>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={resendOpen}
        title="Resend invoice email"
        busy={resendBusy}
        confirmLabel="Resend email"
        body={
          <div className="space-y-3">
            <p>
              Email invoice <strong>{invoice?.invoiceNumber}</strong> to {customer.email} again,
              with the same PDF attached? This never creates a second invoice.
            </p>
            <ErrorBox error={resendError} />
          </div>
        }
        onConfirm={() => void runResend()}
        onCancel={() => setResendOpen(false)}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/orders"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft size={14} /> Back to orders
    </Link>
  );
}
