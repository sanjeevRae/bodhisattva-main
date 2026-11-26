/**
 * Orders admin (Phase 7) — store.orders.read.
 *
 * The working view is the approval queue: PENDING_APPROVAL is the
 * default filter, the API returns it oldest-first, and each row shows
 * how long the order has been waiting (Phase 6 review disposition:
 * pending orders hold reserved stock, so age is the priority signal).
 * Status chips switch to the other lifecycle states / all orders.
 *
 * On the ALL-orders view only (owner request, 2026-11-26), the status
 * badge is a dropdown: it offers exactly the lifecycle actions the
 * shared actionsFor model allows from that status, filtered by the
 * signed-in admin's permissions, and runs them through the same
 * transition endpoints + confirm dialog as the order detail page.
 * The server state machine remains the only authority.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { ChevronDown, Search } from "lucide-react";
import { ordersApi } from "../api";
import { useAuth } from "../AdminApp";
import type { AdminOrderListItem } from "../types";
import { Btn, ErrorBox, Field, Modal, Notice, Spinner, cx, formatDateTime, inputCls } from "../ui";
import { formatRsPaisa } from "./module-shared";
import {
  ORDER_STATUSES,
  OrderStatusBadge,
  actionsFor,
  formatAge,
  orderStatusLabel,
  type ActionSpec,
} from "./order-shared";

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
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<Filter>("PENDING_APPROVAL");
  const [items, setItems] = useState<AdminOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Inline status editing (All-orders view only): the open menu, and
  // the pending action awaiting confirmation in the dialog.
  const [menu, setMenu] = useState<{ order: AdminOrderListItem; rect: DOMRect } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pendingAction, setPendingAction] = useState<{ order: AdminOrderListItem; spec: ActionSpec } | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<unknown>(null);
  const [actionBusy, setActionBusy] = useState(false);

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

  // Close the status menu on outside interaction, Escape (returning
  // focus to its button), any scroll (capture phase — table containers
  // scroll too) or resize: a fixed-position menu must never be left
  // floating detached from its row.
  useEffect(() => {
    if (!menu) return;
    const close = (refocus: boolean) => {
      setMenu(null);
      if (refocus) menuButtonRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (menuButtonRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onFocusIn = (e: FocusEvent) => {
      // Tabbing away from the menu closes it and lets focus move on
      // normally (the menu pattern's Tab contract).
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (menuButtonRef.current?.contains(target)) return;
      close(false);
    };
    const onScrollOrResize = () => close(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    menuRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [menu]);

  const runTransition = async () => {
    if (!pendingAction) return;
    const { order, spec } = pendingAction;
    setActionBusy(true);
    setActionError(null);
    try {
      const next = await ordersApi.transition(
        order.id,
        spec.action,
        spec.needsReason ? reason.trim() : undefined,
      );
      setNotice(
        `${spec.label.replace(/ order$/, "")} complete — ${order.orderNumber} is now ${orderStatusLabel(next.order.status).toLowerCase()}.`,
      );
      setPendingAction(null);
      setReason("");
    } catch (err) {
      // The server's typed message (e.g. a stale-state 422) shows in
      // the dialog; the list also reloads so the row can never sit
      // there displaying a status another admin has already changed.
      setActionError(err);
    } finally {
      setActionBusy(false);
      void load(page, filter, search, from, to);
    }
  };

  const reasonMissing = pendingAction?.spec.needsReason && reason.trim() === "";
  const editable = filter === "ALL";

  /** The status cell: a dropdown on the All-orders view when the
   * signed-in admin holds at least one of the status's action
   * permissions; the plain badge everywhere else. */
  const statusCell = (order: AdminOrderListItem) => {
    const specs = editable
      ? actionsFor(order.status).filter((spec) => hasPermission(spec.permission))
      : [];
    if (specs.length === 0) return <OrderStatusBadge status={order.status} />;
    const tone =
      order.status === "PENDING_APPROVAL" || order.status === "CANCELLED"
        ? "bg-primary text-primary-foreground"
        : order.status === "DELIVERED" || order.status === "APPROVED"
          ? "bg-accent text-accent-foreground"
          : "bg-muted text-muted-foreground";
    return (
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu?.order.id === order.id}
        aria-controls={menu?.order.id === order.id ? `status-menu-${order.id}` : undefined}
        aria-label={`Change status of ${order.orderNumber}, currently ${orderStatusLabel(order.status)}`}
        disabled={actionBusy && pendingAction?.order.id === order.id}
        onClick={(e) => {
          if (menu?.order.id === order.id) {
            setMenu(null);
            return;
          }
          menuButtonRef.current = e.currentTarget;
          setMenu({ order, rect: e.currentTarget.getBoundingClientRect() });
        }}
        className={cx(
          "inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.14em] uppercase transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone,
        )}
      >
        {orderStatusLabel(order.status)}
        <ChevronDown size={11} aria-hidden />
      </button>
    );
  };

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
      {notice && <Notice>{notice}</Notice>}

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
                  <td className="px-4 py-3">{statusCell(order)}</td>
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

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            id={`status-menu-${menu.order.id}`}
            role="menu"
            aria-label={`Change status of ${menu.order.orderNumber}`}
            onKeyDown={(e) => {
              // Arrow/Home/End navigation between menu items (the
              // menu pattern's keyboard contract; Tab also works —
              // the items are native buttons).
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
              const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [],
              );
              if (items.length === 0) return;
              e.preventDefault();
              const idx = items.indexOf(document.activeElement as HTMLButtonElement);
              let next = 0;
              if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % items.length;
              else if (e.key === "ArrowUp")
                next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
              else if (e.key === "End") next = items.length - 1;
              items[next]?.focus();
            }}
            className="fixed z-50 min-w-44 overflow-hidden rounded-sm border border-border bg-background shadow-lg"
            style={(() => {
              const specs = actionsFor(menu.order.status).filter((spec) =>
                hasPermission(spec.permission),
              );
              const height = specs.length * 37 + 8;
              const below = menu.rect.bottom + 4;
              const top =
                below + height > window.innerHeight - 8
                  ? Math.max(8, menu.rect.top - height - 4)
                  : below;
              const left = Math.min(menu.rect.left, window.innerWidth - 184);
              return { top, left };
            })()}
          >
            {actionsFor(menu.order.status)
              .filter((spec) => hasPermission(spec.permission))
              .map((spec) => (
                <button
                  key={spec.action}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setReason("");
                    setActionError(null);
                    setPendingAction({ order: menu.order, spec });
                  }}
                  className={cx(
                    "block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-secondary focus:bg-secondary focus:outline-none",
                    spec.variant === "danger" && "text-destructive",
                  )}
                >
                  {spec.label}
                </button>
              ))}
          </div>,
          document.body,
        )}

      <Modal
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title={pendingAction?.spec.label ?? ""}
      >
        <div className="space-y-4">
          <p className="text-sm font-medium">
            {pendingAction?.order.orderNumber} — {pendingAction?.order.delivery.recipientName} ·{" "}
            {pendingAction ? formatRsPaisa(pendingAction.order.grandTotalPaisa) : ""}
          </p>
          <p className="text-sm">{pendingAction?.spec.blurb}</p>
          {pendingAction?.spec.needsReason && (
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
            <Btn onClick={() => setPendingAction(null)} disabled={actionBusy}>
              Back
            </Btn>
            <Btn
              variant={pendingAction?.spec.variant ?? "accent"}
              onClick={() => void runTransition()}
              disabled={actionBusy || !!reasonMissing}
            >
              {actionBusy ? "Working…" : pendingAction?.spec.label}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
