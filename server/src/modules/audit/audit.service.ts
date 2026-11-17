/**
 * Audit log reads (Phase 7b, PERMISSIONS.md Part 14 + §8 route table).
 *
 * The write side lives in services/audit.ts (append-only, sanitised);
 * this module is the Super Admin module's read side: filter + paginate
 * over `audit_logs`. Rows are returned newest-first. The metadata JSON
 * is passed through as stored — the write path's allowlist sanitiser
 * has already stripped anything sensitive before it landed.
 */
import type { PaginationParams } from "@bodhisattva/shared/pagination";
import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { auditLogs } from "../../database/schema/index.js";
import type { AuditLogQuery } from "./audit.schemas.js";

export interface AuditLogView {
  id: number;
  actorId: number | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  result: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
}

/** Escape LIKE wildcards in user input, then wrap for a prefix match. */
function likePrefix(term: string): string {
  return `${term.replace(/[%_\\]/g, "\\$&")}%`;
}

function likeContains(term: string): string {
  return `%${term.replace(/[%_\\]/g, "\\$&")}%`;
}

export async function listAuditLogs(
  db: Database,
  query: AuditLogQuery,
  pagination: PaginationParams,
): Promise<{ items: AuditLogView[]; total: number }> {
  const conditions = [];
  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(auditLogs.createdAt, from));
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime())) {
      // A bare date means "through the end of that day" (orders list rule).
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setUTCDate(to.getUTCDate() + 1);
      conditions.push(lte(auditLogs.createdAt, to));
    }
  }
  if (query.actor) {
    if (/^\d+$/.test(query.actor)) {
      conditions.push(eq(auditLogs.actorId, Number(query.actor)));
    } else {
      conditions.push(like(auditLogs.actorEmailSnapshot, likeContains(query.actor)));
    }
  }
  if (query.role) conditions.push(eq(auditLogs.actorRole, query.role));
  if (query.action) conditions.push(like(auditLogs.action, likePrefix(query.action)));
  if (query.result) conditions.push(eq(auditLogs.result, query.result));
  if (query.targetType) conditions.push(eq(auditLogs.targetType, query.targetType));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize);
  const [totalRow] = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(where);

  return {
    items: rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorEmail: row.actorEmailSnapshot,
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      result: row.result,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
    })),
    total: Number(totalRow?.value ?? 0),
  };
}
