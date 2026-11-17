/**
 * Shared order-display helpers for the Phase 7 admin screens
 * (Orders list + Order detail): lifecycle labels, badges, queue age.
 */
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
