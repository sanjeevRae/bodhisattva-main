/**
 * Store insights (2026-11-27) — the Store dashboard.
 *
 * Every number comes from GET /api/admin/store/insights (definitions
 * live server-side in insights.service.ts): order value counts
 * APPROVED+ orders by order date in Asia/Kathmandu; snapshot cards
 * are labelled "current" because they don't follow the range.
 * Conversion rate is deliberately absent — the site tracks no
 * visits, so it cannot be computed honestly.
 *
 * Downloads go through downloadExport (fetch + blob) so a server
 * refusal (e.g. the over-cap CSV 413) shows here as an error with
 * the server's message. Quick-manage buttons respect the target
 * screens' own permissions.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  ClipboardList,
  Download,
  Package,
} from "lucide-react";
import {
  downloadExport,
  storeInsightsApi,
  type InsightsRange,
  type StoreInsights as Insights,
} from "../api";
import { useAuth } from "../AdminApp";
import { Badge, Btn, ErrorBox, Notice, Spinner, formatDateTime } from "../ui";
import { formatRsPaisa } from "./module-shared";

const RANGES: Array<{ key: InsightsRange; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "12m", label: "12 months" },
  { key: "all", label: "All time" },
];

function Delta({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-700" : "text-red-700"}`}
      title="Change vs the previous period"
    >
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {up ? "+" : ""}
      {value}
      {suffix} vs prev.
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {delta}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

function SalesChart({ series }: { series: Insights["series"] }) {
  const max = Math.max(...series.map((s) => s.orderValuePaisa), 0);
  if (series.length === 0 || max === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No qualifying orders in this period yet.
      </p>
    );
  }
  const width = 720;
  const height = 180;
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (series.length - 1)) / series.length);
  return (
    <svg
      viewBox={`0 0 ${width} ${height + 22}`}
      className="w-full"
      role="img"
      aria-label="Order value per period"
    >
      {series.map((s, i) => {
        const h = Math.max(1, (s.orderValuePaisa / max) * height);
        const x = i * (barWidth + gap);
        const showLabel = series.length <= 12 || i % Math.ceil(series.length / 12) === 0;
        return (
          <g key={s.bucket}>
            <rect x={x} y={height - h} width={barWidth} height={h} className="fill-accent">
              <title>{`${s.bucket}: ${formatRsPaisa(s.orderValuePaisa)} · ${s.orders} order(s)`}</title>
            </rect>
            {showLabel ? (
              <text x={x + barWidth / 2} y={height + 14} textAnchor="middle" fontSize="9" className="fill-muted-foreground">
                {s.bucket.slice(series.length > 40 ? 5 : 0)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

const STATUS_TONE: Record<string, "muted" | "accent" | "dark"> = {
  PENDING_APPROVAL: "accent",
  APPROVED: "dark",
  PROCESSING: "dark",
  SHIPPED: "dark",
  DELIVERED: "muted",
  CANCELLED: "muted",
};

export default function StoreInsights() {
  const { hasPermission } = useAuth();
  const [range, setRange] = useState<InsightsRange>("30d");
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const canExport = hasPermission("store.reports.export");

  const load = useCallback((r: InsightsRange) => {
    setError(null);
    storeInsightsApi
      .get(r)
      .then(setData)
      .catch((e) => {
        setData(null);
        setError(e);
      });
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const download = async (format: "csv" | "xlsx") => {
    setDownloadError(null);
    setDownloading(format);
    try {
      await downloadExport(
        storeInsightsApi.exportUrl(range, format),
        format === "csv" ? "store-orders.csv" : "store-report.xlsx",
      );
    } catch (e) {
      setDownloadError(e);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-wide">Store</h1>
          <p className="text-sm text-muted-foreground">
            How the gift shop is doing — orders, customers and stock, straight from the live data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPermission("store.products.manage") ? (
            <Link to="/admin/products">
              <Btn variant="outline">
                <Package size={15} /> Manage products
              </Btn>
            </Link>
          ) : null}
          {hasPermission("store.orders.read") ? (
            <Link to="/admin/orders">
              <Btn variant="outline">
                <ClipboardList size={15} /> Manage orders
              </Btn>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-sm border px-3 py-1.5 text-sm transition-colors ${
                range === r.key
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-card hover:border-accent/60"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {canExport ? (
          <div className="flex gap-2">
            <Btn variant="outline" disabled={downloading !== null} onClick={() => void download("xlsx")}>
              <Download size={15} /> {downloading === "xlsx" ? "Preparing…" : "Download full report (Excel)"}
            </Btn>
            <Btn variant="outline" disabled={downloading !== null} onClick={() => void download("csv")}>
              <Download size={15} /> {downloading === "csv" ? "Preparing…" : "Download orders (CSV)"}
            </Btn>
          </div>
        ) : null}
      </div>

      {downloadError ? <ErrorBox error={downloadError} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {!data && !error ? <Spinner label="Loading store insights…" /> : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Order value"
              value={formatRsPaisa(data.kpis.orderValuePaisa)}
              hint="Approved+ orders, incl. shipping + tax"
              delta={data.deltas ? <Delta value={data.deltas.orderValuePct} /> : undefined}
            />
            <KpiCard
              label="Orders"
              value={String(data.kpis.orders)}
              hint="Qualifying orders in period"
              delta={data.deltas ? <Delta value={data.deltas.ordersPct} /> : undefined}
            />
            <KpiCard
              label="Average order value"
              value={formatRsPaisa(data.kpis.aovPaisa)}
              delta={data.deltas ? <Delta value={data.deltas.aovPct} /> : undefined}
            />
            <KpiCard
              label="Delivered sales"
              value={formatRsPaisa(data.kpis.deliveredSalesPaisa)}
              hint="Delivered orders only"
              delta={data.deltas ? <Delta value={data.deltas.deliveredSalesPct} /> : undefined}
            />
            <KpiCard
              label="New customer accounts"
              value={String(data.kpis.newCustomerAccounts)}
              hint="Registered in period"
              delta={data.deltas ? <Delta value={data.deltas.newCustomerAccountsPct} /> : undefined}
            />
            <KpiCard
              label="Repeat purchase rate"
              value={data.kpis.repeatPurchaseRatePct === null ? "—" : `${data.kpis.repeatPurchaseRatePct}%`}
              hint="Buyers with 2+ lifetime orders"
              delta={
                data.deltas ? (
                  <Delta value={data.deltas.repeatPurchaseRatePoints} suffix=" pts" />
                ) : undefined
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Pending approvals" value={String(data.kpis.pendingApprovals)} hint="Current — needs review" />
            <KpiCard label="Active products" value={String(data.kpis.activeProducts)} hint="Current catalogue" />
            <KpiCard
              label="Retail stock value"
              value={formatRsPaisa(data.kpis.retailStockValuePaisa)}
              hint="Current — at selling prices"
            />
          </div>

          <div className="rounded-sm border border-border bg-card p-5">
            <h2 className="font-display text-xl tracking-wide">Sales summary</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Order value per {data.range === "12m" || data.range === "all" ? "month" : "day"} · hover a bar for exact figures
            </p>
            <SalesChart series={data.series} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-sm border border-border bg-card p-5">
              <h2 className="font-display text-xl tracking-wide">Top products</h2>
              {data.topProducts.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No product sales in this period.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {data.topProducts.map((p) => (
                    <li key={p.productId ?? p.name} className="flex items-center justify-between py-2.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {p.units} sold · {formatRsPaisa(p.revenuePaisa)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-sm border border-border bg-card p-5">
              <h2 className="font-display text-xl tracking-wide">Top customers</h2>
              {data.topCustomers.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No customers in this period.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {data.topCustomers.map((c) => (
                    <li key={c.name} className="flex items-center justify-between py-2.5">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {c.orders} order(s) · {formatRsPaisa(c.spendPaisa)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-sm border border-border bg-card p-5">
            <h2 className="font-display text-xl tracking-wide">Recent orders</h2>
            {data.recentOrders.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Order</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Customer</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-2.5 pr-3 font-medium">{o.orderNumber}</td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(o.placedAt)}</td>
                        <td className="py-2.5 pr-3">{o.customerName}</td>
                        <td className="py-2.5 pr-3">
                          <Badge tone={STATUS_TONE[o.status] ?? "muted"}>{o.status.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">{formatRsPaisa(o.grandTotalPaisa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Notice tone="ok">
            Periods run by order date in Asia/Kathmandu. Order value covers approved, processing,
            shipped and delivered orders (cancelled orders never count). A conversion rate isn't
            shown — the site doesn't track visits, so it can't be computed honestly.
          </Notice>
        </>
      ) : null}
    </div>
  );
}
