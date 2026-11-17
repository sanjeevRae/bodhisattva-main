/**
 * Invoices admin (Phase 7) — store.invoices.manage.
 * Every invoice ever issued, newest first. Invoices are accounting
 * records: they are never edited or deleted here — the PDF download
 * renders from the invoice's frozen snapshot.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Download } from "lucide-react";
import { invoicesApi } from "../api";
import type { InvoiceAdmin } from "../types";
import { Btn, ErrorBox, Spinner, formatDateTime } from "../ui";
import { formatRsPaisa } from "./module-shared";
import { InvoiceEmailBadge } from "./order-shared";

const PAGE_SIZE = 50;

export default function InvoicesScreen() {
  const [items, setItems] = useState<InvoiceAdmin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (pageNo: number) => {
    try {
      const data = await invoicesApi.list(pageNo, PAGE_SIZE);
      setItems(data.items);
      setTotal(data.meta.total);
      setPage(pageNo);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Issued automatically when an order is approved — one per order, numbered from the
          invoice sequence. Downloads render from the invoice's frozen snapshot, so they never
          change after issue.
        </p>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading invoices…" />
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No invoices yet — approve an order to issue the first one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Invoice</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Order</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Issued</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Total</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Email</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((invoice) => (
                <tr key={invoice.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/orders/${invoice.orderId}`} className="hover:underline">
                      {invoice.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(invoice.issuedAt)}</td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                    {formatRsPaisa(invoice.grandTotalPaisa)}
                  </td>
                  <td className="px-4 py-3">
                    <InvoiceEmailBadge emailStatus={invoice.emailStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <a
                        href={invoicesApi.downloadUrl(invoice.id)}
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                      >
                        <Download size={13} /> PDF
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Btn size="sm" disabled={page <= 1} onClick={() => void load(page - 1)}>
            Previous
          </Btn>
          <span className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Btn size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1)}>
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}
