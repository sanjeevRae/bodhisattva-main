/**
 * Shared order-display helpers for the Phase 7 admin screens
 * (Orders list + Order detail): lifecycle labels, badges, queue age —
 * and THE lifecycle action model (actionsFor), the single source of
 * truth both screens render, so the list's status dropdown and the
 * detail page can never disagree about what may happen to an order.
 * The server enforces the same machine independently; this model is
 * presentation only.
 */
import type { OrderTransitionAction } from "../api";
import { Badge } from "../ui";

export const ORDER_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function orderStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function OrderStatusBadge({ status }: { status: string }) {
  if (status === "PENDING_APPROVAL") return <Badge tone="dark">Pending approval</Badge>;
  if (status === "DELIVERED" || status === "APPROVED") return <Badge tone="accent">{orderStatusLabel(status)}</Badge>;
  if (status === "CANCELLED") return <Badge tone="dark">Cancelled</Badge>;
  return <Badge>{orderStatusLabel(status)}</Badge>;
}

export function InvoiceEmailBadge({ emailStatus }: { emailStatus: string }) {
  if (emailStatus === "SENT") return <Badge tone="accent">Email sent</Badge>;
  if (emailStatus === "FAILED") return <Badge tone="dark">Email failed</Badge>;
  return <Badge>Email pending</Badge>;
}

/** Queue age for the pending list: "12m", "3h 12m", "2d 4h". */
export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export interface ActionSpec {
  action: OrderTransitionAction;
  label: string;
  permission: string;
  variant: "accent" | "primary" | "outline" | "danger";
  needsReason?: boolean;
  blurb: string;
}

/** The actions the lifecycle allows from `status` (mirror of the
 * server's ORDER_TRANSITIONS). Callers filter by permission. */
export function actionsFor(status: string): ActionSpec[] {
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
