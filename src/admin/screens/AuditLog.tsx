/**
 * Audit log (Phase 7b, spec Part 14) — audit.read, Super Admin only.
 *
 * Read-only by design: the platform defines no audit update/delete.
 * Filters map to GET /api/admin/audit-logs — date range, actor (id or
 * email substring), role, action prefix (the module filter: e.g.
 * "store.orders" or "auth"), and result (SUCCESS / FAILURE / DENIED —
 * permission denials are audited too).
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Filter } from "lucide-react";
import { auditApi, downloadExport } from "../api";
import type { AuditLogAdmin } from "../types";
import { Badge, Btn, ErrorBox, Spinner, cx, formatDateTime, inputCls } from "../ui";

const PAGE_SIZE = 50;

const ROLES = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN", "CUSTOMER", "SYSTEM"];
const RESULTS = ["SUCCESS", "FAILURE", "DENIED"];

interface Filters {
  from: string;
  to: string;
  actor: string;
  role: string;
  action: string;
  result: string;
}

const EMPTY: Filters = { from: "", to: "", actor: "", role: "", action: "", result: "" };

function ResultBadge({ result }: { result: string }) {
  if (result === "SUCCESS") return <Badge tone="accent">Success</Badge>;
  if (result === "DENIED") return <Badge tone="dark">Denied</Badge>;
  return <Badge>Failure</Badge>;
}

export default function AuditLogScreen() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [items, setItems] = useState<AuditLogAdmin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Downloads carry the APPLIED filters (what the table shows), not
  // the un-applied draft. Fetch-based so an over-cap refusal (413)
  // surfaces here with the server's message.
  const download = async (format: "csv" | "xlsx") => {
    setDownloadError(null);
    setDownloading(format);
    try {
      await downloadExport(
        auditApi.exportUrl(
          {
            from: applied.from || undefined,
            to: applied.to || undefined,
            actor: applied.actor.trim() || undefined,
            role: applied.role || undefined,
            action: applied.action.trim() || undefined,
            result: applied.result || undefined,
          },
          format,
        ),
        format === "csv" ? "audit-log.csv" : "audit-log.xlsx",
      );
    } catch (e) {
      setDownloadError(e);
    } finally {
      setDownloading(null);
    }
  };

  const load = useCallback(async (pageNo: number, filters: Filters) => {
    try {
      const data = await auditApi.list({
        page: pageNo,
        pageSize: PAGE_SIZE,
        from: filters.from || undefined,
        to: filters.to || undefined,
        actor: filters.actor.trim() || undefined,
        role: filters.role || undefined,
        action: filters.action.trim() || undefined,
        result: filters.result || undefined,
      });
      setItems(data.items);
      setTotal(data.meta.total);
      setPage(pageNo);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load(1, EMPTY);
  }, [load]);

  const apply = () => {
    setApplied(draft);
    void load(1, draft);
  };

  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    void load(1, EMPTY);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Every significant action and every permission denial, append-only. This log cannot be
          edited or deleted from the admin.
        </p>
      </div>

      <div className="space-y-3 rounded-sm border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">From</span>
            <input type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">To</span>
            <input type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actor (id or email)</span>
            <input
              className={inputCls}
              value={draft.actor}
              onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
              placeholder="e.g. 12 or admin@…"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Role</span>
            <select className={inputCls} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              <option value="">All roles</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Action / module prefix</span>
            <input
              className={inputCls}
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              placeholder="e.g. store.orders, cms.pages, auth"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Result</span>
            <select className={inputCls} value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value })}>
              <option value="">All results</option>
              {RESULTS.map((result) => (
                <option key={result} value={result}>
                  {result.charAt(0) + result.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="accent" size="sm" onClick={apply} disabled={!dirty}>
            <Filter size={13} /> Apply filters
          </Btn>
          <Btn size="sm" onClick={clear}>
            Clear
          </Btn>
          <span className="font-mono text-xs text-muted-foreground">
            {total} entr{total === 1 ? "y" : "ies"}
          </span>
          <span className="ml-auto flex gap-2">
            <Btn size="sm" disabled={downloading !== null} onClick={() => void download("xlsx")}>
              <Download size={13} /> {downloading === "xlsx" ? "Preparing…" : "Download Excel"}
            </Btn>
            <Btn size="sm" disabled={downloading !== null} onClick={() => void download("csv")}>
              <Download size={13} /> {downloading === "csv" ? "Preparing…" : "Download CSV"}
            </Btn>
          </span>
        </div>
      </div>

      <ErrorBox error={downloadError} />
      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading audit log…" />
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No audit entries match those filters.
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="w-8 px-2 py-2.5" />
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Time</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actor</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Action</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Target</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Result</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => {
                const open = expanded === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <tr
                      className={cx("border-t border-border bg-background hover:bg-secondary/40", open && "bg-secondary/40")}
                      onClick={() => setExpanded(open ? null : entry.id)}
                    >
                      <td className="px-2 py-3 text-muted-foreground">
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDateTime(entry.createdAt)}</td>
                      <td className="px-4 py-3">
                        {entry.actorEmail ?? (entry.actorId ? `#${entry.actorId}` : "Anonymous")}
                        {entry.actorRole && (
                          <span className="block text-xs text-muted-foreground">
                            {entry.actorRole.replace(/_/g, " ")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {entry.targetType
                          ? `${entry.targetType}${entry.targetId ? ` #${entry.targetId}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ResultBadge result={entry.result} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.ipAddress ?? "—"}</td>
                    </tr>
                    {open && (
                      <tr className="border-t border-border bg-secondary/30">
                        <td colSpan={7} className="px-6 py-3">
                          <div className="grid gap-3 text-xs sm:grid-cols-2">
                            <div>
                              <p className="mb-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Metadata</p>
                              <pre className="overflow-x-auto rounded-sm border border-border bg-background p-2 font-mono text-[0.7rem]">
                                {entry.metadata != null
                                  ? JSON.stringify(entry.metadata, null, 2)
                                  : "—"}
                              </pre>
                            </div>
                            <div>
                              <p className="mb-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">User agent</p>
                              <p className="font-mono text-[0.7rem] break-all text-muted-foreground">
                                {entry.userAgent ?? "—"}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Btn size="sm" disabled={page <= 1} onClick={() => void load(page - 1, applied)}>
            Previous
          </Btn>
          <span className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Btn size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1, applied)}>
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}
