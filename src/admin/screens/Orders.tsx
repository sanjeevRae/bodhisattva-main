/**
 * Orders admin (Phase 7) — store.orders.read.
 *
 * The working view is the approval queue: PENDING_APPROVAL is the
 * default filter, the API returns it oldest-first, and each row shows
 * how long the order has been waiting (Phase 6 review disposition:
 * pending orders hold reserved stock, so age is the priority signal).
 * Status chips switch to the other lifecycle states / all orders.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { ordersApi } from "../api";
import type { AdminOrderListItem } from "../types";
import { Btn, ErrorBox, Spinner, cx, formatDateTime, inputCls } from "../ui";
import { formatRsPaisa } from "./module-shared";
import { ORDER_STATUSES, OrderStatusBadge, formatAge, orderStatusLabel } from "./order-shared";

const PAGE_SIZE = 50;

type Filter = "PENDING_APPROVAL" | "ALL" | (typeof ORDER_STATUSES)[number];

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "PENDING_APPROVAL", label: "Pending approval" },
  { key: "ALL", label: "All orders" },
  ...ORDER_STATUSES.filter((s) => s !== "PENDING_APPROVAL").map((s) => ({
    key: s as Filter,
    label: orderStatusLabel(s),
  })),
];

export default function OrdersScreen() {
  const [filter, setFilter] = useState<Filter>("PENDING_APPROVAL");
  const [items, setItems] = useState<AdminOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (pageNo: number, status: Filter, term: string, fromDate: string, toDate: string) => {
      try {
        const data = await ordersApi.list({
          page: pageNo,
          pageSize: PAGE_SIZE,
          status: status === "ALL" ? undefined : status,
          search: term.trim() || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        });
        setItems(data.items);
        setTotal(data.meta.total);
        setPage(pageNo);
        setError(null);
      } catch (err) {
        setError(err);
      }
    },
    [],
  );

  useEffect(() => {
    void load(1, filter, "", "", "");
  }, [load, filter]);

  useEffect(() => {
    const timer = setTimeout(() => void load(1, filter, search, from, to), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, from, to]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pending = filter === "PENDING_APPROVAL";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Orders</h1>
        <p className="text-sm text-muted-foreground">
          {pending
            ? "The approval queue, oldest first — pending orders hold reserved stock until they are approved or cancelled."
            : "Gift Shop orders across the lifecycle. Open an order to approve, process, ship, deliver or cancel it."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Order status filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex max-w-sm flex-1 items-center gap-2 rounded-sm border border-border bg-background px-3 focus-within:border-accent">
          <Search size={14} className="text-muted-foreground" />
          <input
            className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
            placeholder="Search order no, customer email or recipient…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search orders"
          />
        </label>
        <span className="w-44 shrink-0">
          <input
            type="date"
            className={inputCls}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Placed from"
          />
        </span>
        <span className="text-xs text-muted-foreground">to</span>
        <span className="w-44 shrink-0">
          <input
            type="date"
            className={inputCls}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Placed to"
          />
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {total} order{total === 1 ? "" : "s"}
        </span>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading orders…" />
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {pending && !search
            ? "The approval queue is empty — nothing is waiting."
            : "No orders match those filters."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Order</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Customer</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Items</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Total</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                {pending && (
                  <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Waiting</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <Link to={`/admin/orders/${order.id}`} className="font-medium hover:underline">
                      {order.orderNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{formatDateTime(order.placedAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {order.delivery.recipientName}
                    <span className="block text-xs text-muted-foreground">{order.customerEmail}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                    {formatRsPaisa(order.grandTotalPaisa)}
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  {pending && (
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[0.65rem] font-medium text-amber-700 dark:text-amber-400">
                        waiting {formatAge(order.ageMs)}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Btn size="sm" disabled={page <= 1} onClick={() => void load(page - 1, filter, search, from, to)}>
            Previous
          </Btn>
          <span className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Btn size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1, filter, search, from, to)}>
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}
