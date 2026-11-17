/**
 * Audit log query schema (Phase 7b, PERMISSIONS.md Part 14).
 *
 * The audit interface is read-only — there is intentionally no update
 * or delete surface for audit rows anywhere in the system.
 */
import { z } from "zod";

export const auditLogQuerySchema = z.object({
  // ISO dates (YYYY-MM-DD or full timestamps) bounding created_at.
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  // Numeric → actor id; anything else → substring of the actor email
  // snapshot (history survives account changes, §11.2).
  actor: z.string().trim().max(254).optional(),
  // Exact actor role snapshot (SUPER_ADMIN | ADMIN | STORE_ADMIN | CUSTOMER | SYSTEM).
  role: z.string().trim().max(40).optional(),
  // Action PREFIX — doubles as the module filter: "store.orders"
  // matches store.orders.approve / .cancel / .update, "auth" matches
  // every auth.* event.
  action: z.string().trim().max(80).optional(),
  result: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  targetType: z.string().trim().max(40).optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
