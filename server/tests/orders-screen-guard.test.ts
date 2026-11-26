/**
 * Source guards for the Orders list status dropdown (2026-11-26).
 *
 * The admin SPA has no component-test framework, so — like the
 * accept-invitation and users-screen guards — these tests pin the
 * wiring that matters:
 *  - the lifecycle action model lives ONCE, in order-shared.tsx, and
 *    the detail page imports it instead of keeping a private copy;
 *  - the list renders the dropdown only on the All-orders view, gates
 *    it on the shared model + permissions, and runs transitions
 *    through ordersApi.transition with the reason dialog.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("orders screen guards", () => {
  it("actionsFor lives in order-shared and the detail page imports it", () => {
    const shared = read("src/admin/screens/order-shared.tsx");
    expect(shared).toContain("export function actionsFor");
    expect(shared).toContain("export interface ActionSpec");
    const detail = read("src/admin/screens/OrderDetail.tsx");
    expect(detail).toContain("actionsFor");
    expect(detail).toContain('from "./order-shared"');
    expect(detail).not.toContain("function actionsFor");
  });

  it("the list dropdown is All-orders-only and permission-filtered", () => {
    const orders = read("src/admin/screens/Orders.tsx");
    expect(orders).toContain('filter === "ALL"');
    expect(orders).toContain("actionsFor(order.status)");
    expect(orders).toContain("hasPermission(spec.permission)");
    expect(orders).toContain('aria-haspopup="menu"');
    expect(orders).toContain("createPortal");
    expect(orders).toContain('"ArrowDown"');
    expect(orders).toContain('"Escape"');
    expect(orders).toContain("aria-controls");
    expect(orders).toContain('"focusin"');
  });

  it("list transitions reuse the detail page's endpoint + reason dialog", () => {
    const orders = read("src/admin/screens/Orders.tsx");
    expect(orders).toContain("ordersApi.transition");
    expect(orders).toContain("spec.needsReason ? reason.trim() : undefined");
    expect(orders).toContain("order.orderNumber");
  });
});
