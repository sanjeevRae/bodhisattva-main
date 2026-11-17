/**
 * Products admin (Phase 6) — store.products.manage.
 * List over /api/admin/products with search, status, and the stock
 * picture per product (on hand / reserved by open carts & orders /
 * available). Create + edit live on the product editor routes; the
 * delete action here archives (products are never hard-deleted).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Archive, Pencil, Plus, Search } from "lucide-react";
import { storeApi } from "../api";
import type { ProductAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Spinner, inputCls } from "../ui";
import { formatRsDecimal } from "./module-shared";

const PAGE_SIZE = 50;

export default function ProductsScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ProductAdmin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [archiving, setArchiving] = useState<ProductAdmin | null>(null);
  const [archiveError, setArchiveError] = useState<unknown>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const load = useCallback(async (pageNo: number, term: string) => {
    try {
      const data = await storeApi.listProducts(pageNo, PAGE_SIZE, term.trim() || undefined);
      setItems(data.items);
      setTotal(data.meta.total);
      setPage(pageNo);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load(1, "");
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(1, search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const confirmArchive = async () => {
    if (!archiving) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await storeApi.archiveProduct(archiving.id);
      setArchiving(null);
      await load(page, search);
    } catch (err) {
      setArchiveError(err);
    } finally {
      setArchiveBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-wide">Products</h1>
          <p className="text-sm text-muted-foreground">
            The Gift Shop catalogue. “Available” is on-hand stock minus quantities reserved by
            carts and unfulfilled orders.
          </p>
        </div>
        <Btn variant="accent" onClick={() => navigate("/admin/products/new")}>
          <Plus size={16} /> New product
        </Btn>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex max-w-sm flex-1 items-center gap-2 rounded-sm border border-border bg-background px-3 focus-within:border-accent">
          <Search size={14} className="text-muted-foreground" />
          <input
            className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
            placeholder="Search name, SKU or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {total} product{total === 1 ? "" : "s"}
        </span>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading products…" />
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {search ? "No products match that search." : "No products yet."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Product</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Category</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Price</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">On hand</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Reserved</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Available</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <tr key={product.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-3">
                      {product.image ? (
                        <img src={product.image.url} alt="" className="h-10 w-12 rounded-sm border border-border object-cover" />
                      ) : (
                        <span className="h-10 w-12 rounded-sm border border-dashed border-border" />
                      )}
                      <span>
                        <span className="font-medium">{product.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {product.sku ?? product.slug}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{product.categorySlug ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {product.salePrice != null ? (
                      <>
                        <span className="font-medium">{formatRsDecimal(product.salePrice)}</span>{" "}
                        <span className="text-xs text-muted-foreground line-through">{formatRsDecimal(product.price)}</span>
                      </>
                    ) : (
                      formatRsDecimal(product.price)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1.5">
                      {product.status === "ACTIVE" ? (
                        <Badge tone="accent">Active</Badge>
                      ) : product.status === "ARCHIVED" ? (
                        <Badge tone="dark">Archived</Badge>
                      ) : (
                        <Badge>Draft</Badge>
                      )}
                      {product.isFeatured && <Badge tone="dark">Featured</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{product.trackInventory ? product.stockQty : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{product.trackInventory ? product.reservedQty : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-medium">
                    {product.trackInventory ? product.availableQty : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Link
                        to={`/admin/products/${product.id}`}
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                      >
                        <Pencil size={13} /> Edit
                      </Link>
                      {product.status !== "ARCHIVED" && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                          onClick={() => {
                            setArchiveError(null);
                            setArchiving(product);
                          }}
                        >
                          <Archive size={13} /> Archive
                        </button>
                      )}
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
          <Btn size="sm" disabled={page <= 1} onClick={() => void load(page - 1, search)}>
            Previous
          </Btn>
          <span className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Btn size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1, search)}>
            Next
          </Btn>
        </div>
      )}

      <ConfirmDialog
        open={archiving !== null}
        title="Archive product"
        danger
        busy={archiveBusy}
        confirmLabel="Archive product"
        body={
          <div className="space-y-3">
            <p>
              Archive <strong>{archiving?.name}</strong>? It leaves the public shop immediately.
              Order history keeps its snapshot, and the product can be restored by setting its
              status back in the editor.
            </p>
            <ErrorBox error={archiveError} />
          </div>
        }
        onConfirm={() => void confirmArchive()}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}
