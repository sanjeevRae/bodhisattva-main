/**
 * Product editor (Phase 6) — store.products.manage (+ store.inventory
 * .manage for the inventory section).
 *
 * Route-based screen (/admin/products/new, /admin/products/:id): the
 * details form (prices are rupee inputs converted to the API's DECIMAL
 * strings), the images manager (media-library asset or legacy URL per
 * row, primary flag, sort-order buttons), the variants editor, and —
 * inside this screen rather than a separate one — the inventory
 * section: summary, an adjust form (signed delta or absolute set, per
 * product or per variant) and the movement ledger. A separate
 * inventory screen would duplicate the product context for no gain.
 *
 * Stock is NOT edited in the details form after creation: opening stock
 * is a create-time field; every later change is a ledger adjustment.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ImagePlus, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { ApiError, storeApi } from "../api";
import type {
  InventorySummaryAdmin,
  MediaAsset,
  ProductAdmin,
  ProductCategoryAdmin,
  ProductImageAdmin,
  ProductVariantAdmin,
} from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Notice, Spinner, Switch, formatDateTime, inputCls } from "../ui";
import MediaPicker from "../MediaPicker";
import { useAuth } from "../AdminApp";
import { formatRsDecimal, orNull, rupeeInputToDecimal, slugify, OrderButtons } from "./module-shared";

const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export default function ProductEditorScreen() {
  const params = useParams();
  const isNew = params.id === "new" || params.id === undefined;
  const productId = isNew ? null : Number(params.id);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canInventory = hasPermission("store.inventory.manage");

  const [product, setProduct] = useState<ProductAdmin | null>(null);
  const [categories, setCategories] = useState<ProductCategoryAdmin[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!isNew);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(isNew ? false : true);
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("DRAFT");
  const [isFeatured, setIsFeatured] = useState(false);
  const [trackInventory, setTrackInventory] = useState(true);
  const [openingStock, setOpeningStock] = useState("0");
  const [saveError, setSaveError] = useState<unknown>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [busy, setBusy] = useState(false);

  const fillForm = useCallback((p: ProductAdmin) => {
    setProduct(p);
    setName(p.name);
    setSlug(p.slug);
    setSlugTouched(true);
    setSku(p.sku ?? "");
    setCategoryId(p.categoryId != null ? String(p.categoryId) : "");
    setPrice(p.price);
    setSalePrice(p.salePrice ?? "");
    setShortDescription(p.shortDescription ?? "");
    setDescription(p.description ?? "");
    setStatus(p.status);
    setIsFeatured(p.isFeatured);
    setTrackInventory(p.trackInventory);
  }, []);

  useEffect(() => {
    let alive = true;
    storeApi
      .listCategories(1, 100)
      .then((data) => alive && setCategories(data.items))
      .catch(() => undefined);
    if (productId !== null) {
      storeApi
        .getProduct(productId)
        .then((p) => {
          if (!alive) return;
          fillForm(p);
          setLoading(false);
        })
        .catch((err) => {
          if (!alive) return;
          setLoadError(err);
          setLoading(false);
        });
    }
    return () => {
      alive = false;
    };
  }, [productId, fillForm]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const priceDecimal = rupeeInputToDecimal(price);
    if (priceDecimal === null) {
      setSaveError(new Error("Price must be a rupee amount like 4500 or 4500.50."));
      return;
    }
    let saleDecimal: string | null = null;
    if (salePrice.trim() !== "") {
      saleDecimal = rupeeInputToDecimal(salePrice);
      if (saleDecimal === null) {
        setSaveError(new Error("Sale price must be a rupee amount like 3999 or 3999.50."));
        return;
      }
    }
    if (categoryId === "") {
      setSaveError(new Error("Choose a category for this product."));
      return;
    }
    setBusy(true);
    setSaveError(null);
    setSavedNote(false);
    const body: Record<string, unknown> = {
      name: name.trim(),
      slug: slug.trim(),
      sku: orNull(sku),
      categoryId: Number(categoryId),
      shortDescription: orNull(shortDescription),
      description: orNull(description),
      price: priceDecimal,
      salePrice: saleDecimal,
      trackInventory,
      status,
      isFeatured,
    };
    try {
      if (isNew) {
        const opening = Number(openingStock);
        if (!Number.isInteger(opening) || opening < 0) {
          setSaveError(new Error("Opening stock must be a whole number of 0 or more."));
          setBusy(false);
          return;
        }
        body.stockQty = opening;
        const created = await storeApi.createProduct(body);
        navigate(`/admin/products/${created.id}`, { replace: true });
      } else if (productId !== null) {
        const updated = await storeApi.updateProduct(productId, body);
        fillForm(updated);
        setSavedNote(true);
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err : new Error("Could not save the product."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading product…" />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <BackLink />
        <ErrorBox error={loadError} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <BackLink />
        <div className="mt-3 flex items-center gap-3">
          <h1 className="font-display text-3xl tracking-wide">
            {isNew ? "New product" : product?.name}
          </h1>
          {!isNew && product && (
            <>
              {product.status === "ACTIVE" ? (
                <Badge tone="accent">Active</Badge>
              ) : product.status === "ARCHIVED" ? (
                <Badge tone="dark">Archived</Badge>
              ) : (
                <Badge>Draft</Badge>
              )}
              {product.isFeatured && <Badge tone="dark">Featured</Badge>}
            </>
          )}
        </div>
        {!isNew && product && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            /shop · {product.slug}
            {product.sku ? ` · SKU ${product.sku}` : ""}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-sm border border-border bg-background p-5">
        <h2 className="font-display text-xl">Details</h2>
        <ErrorBox error={saveError} />
        {savedNote && <Notice>Product saved.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
              autoFocus={isNew}
            />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers and hyphens; must be unique.">
            <input
              className={inputCls}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              required
            />
          </Field>
          <Field label="SKU" hint="Unique stock-keeping code, e.g. BOD-001.">
            <input className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price (Rs.)" hint="The regular price in rupees.">
            <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="4500.00" required />
          </Field>
          <Field label="Sale price (Rs.)" hint="Leave empty when not on sale. The sale price is what shoppers pay.">
            <input className={inputCls} inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="—" />
          </Field>
          <Field label="Status" hint="Only Active products appear in the shop.">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          {isNew && (
            <Field label="Opening stock" hint="Written as the opening entry in the inventory ledger.">
              <input className={inputCls} type="number" min={0} step={1} value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
            </Field>
          )}
          <div className="flex items-end gap-6 pb-1">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isFeatured} onChange={setIsFeatured} label="Featured" /> Featured
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={trackInventory} onChange={setTrackInventory} label="Track inventory" /> Track inventory
            </span>
          </div>
        </div>
        <Field label="Short description" hint="The card line shown under the product name in the shop.">
          <input className={inputCls} value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} />
        </Field>
        <Field label="Description" hint="Shown in the shop's quick view.">
          <textarea className={inputCls} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={() => navigate("/admin/products")} disabled={busy}>
            {isNew ? "Cancel" : "Back to products"}
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : isNew ? "Create product" : "Save changes"}
          </Btn>
        </div>
      </form>

      {!isNew && productId !== null && (
        <>
          <ImagesManager productId={productId} />
          <VariantsManager productId={productId} />
          {canInventory ? (
            <InventorySection productId={productId} trackInventory={trackInventory} />
          ) : (
            <p className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Inventory is managed under the store.inventory.manage permission.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/admin/products" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft size={14} /> Products
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function imageThumb(image: ProductImageAdmin): string | null {
  if (image.mediaId != null) return `/api/media/${image.mediaId}/file/thumb`;
  return image.imageUrl;
}

function ImagesManager({ productId }: { productId: number }) {
  const [images, setImages] = useState<ProductImageAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [legacyUrl, setLegacyUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ProductImageAdmin | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await storeApi.listImages(productId);
      setImages([...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addFromMedia = async (asset: MediaAsset) => {
    setPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      await storeApi.createImage(productId, {
        mediaId: asset.id,
        imageUrl: null,
        altText: altText.trim() === "" ? null : altText.trim(),
        isPrimary: makePrimary || (images?.length ?? 0) === 0,
        sortOrder: images?.length ?? 0,
      });
      setAltText("");
      setMakePrimary(false);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const addFromUrl = async () => {
    if (legacyUrl.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await storeApi.createImage(productId, {
        mediaId: null,
        imageUrl: legacyUrl.trim(),
        altText: altText.trim() === "" ? null : altText.trim(),
        isPrimary: makePrimary || (images?.length ?? 0) === 0,
        sortOrder: images?.length ?? 0,
      });
      setLegacyUrl("");
      setAltText("");
      setMakePrimary(false);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!images) return;
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setImages(next);
    try {
      await Promise.all(
        next.map((img, i) =>
          img.sortOrder !== i ? storeApi.updateImage(img.id, { sortOrder: i }) : Promise.resolve(),
        ),
      );
      await load();
    } catch (err) {
      setError(err);
      await load();
    }
  };

  const setPrimary = async (image: ProductImageAdmin) => {
    setError(null);
    try {
      await storeApi.updateImage(image.id, { isPrimary: true });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await storeApi.removeImage(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err);
      setDeleting(null);
    }
  };

  return (
    <section className="space-y-4 rounded-sm border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Images</h2>
        <span className="font-mono text-xs text-muted-foreground">
          The primary image leads the shop card and quick view.
        </span>
      </div>
      <ErrorBox error={error} />
      {images === null ? (
        <Spinner label="Loading images…" />
      ) : (
        <>
          {images.length === 0 ? (
            <p className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No images yet — the shop card will show an empty panel.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-sm border border-border">
              {images.map((image, i) => {
                const thumb = imageThumb(image);
                return (
                  <li key={image.id} className="flex items-center gap-3 px-3 py-2.5">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-11 w-11 rounded-sm border border-border object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground">
                        <ImagePlus size={15} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {image.mediaId != null ? `Media #${image.mediaId}` : image.imageUrl}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{image.altText ?? "No alt text"}</span>
                    </span>
                    {image.isPrimary ? (
                      <Badge tone="accent">Primary</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setPrimary(image)}
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Star size={12} /> Make primary
                      </button>
                    )}
                    <OrderButtons index={i} total={images.length} onMove={(idx, dir) => void move(idx, dir)} />
                    <button
                      type="button"
                      onClick={() => setDeleting(image)}
                      className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                      aria-label="Delete image"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-3 rounded-sm border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legacy image URL" hint="For imagery not yet in the media library.">
                <span className="flex gap-2">
                  <input className={inputCls} value={legacyUrl} onChange={(e) => setLegacyUrl(e.target.value)} placeholder="https://…" />
                  <Btn type="button" size="sm" onClick={() => void addFromUrl()} disabled={busy || legacyUrl.trim() === ""}>
                    Add
                  </Btn>
                </span>
              </Field>
              <Field label="Alt text" hint="Applied to the next image added.">
                <input className={inputCls} value={altText} onChange={(e) => setAltText(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Btn type="button" size="sm" onClick={() => setPickerOpen(true)} disabled={busy}>
                <ImagePlus size={14} /> Choose from media library…
              </Btn>
              <span className="flex items-center gap-2 text-sm">
                <Switch checked={makePrimary} onChange={setMakePrimary} label="Make primary" /> Make the added image primary
              </span>
            </div>
          </div>
        </>
      )}
      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(asset) => void addFromMedia(asset)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete image"
        danger
        confirmLabel="Delete image"
        body={<p>Remove this image from the product? The media asset itself (if any) stays in the library.</p>}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function VariantsManager({ productId }: { productId: number }) {
  const [variants, setVariants] = useState<ProductVariantAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<ProductVariantAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProductVariantAdmin | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await storeApi.listVariants(productId);
      setVariants([...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await storeApi.removeVariant(productId, deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err);
      setDeleting(null);
    }
  };

  return (
    <section className="space-y-4 rounded-sm border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Variants</h2>
        <Btn size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> New variant
        </Btn>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        Editions of this product (sizes, bindings…). A variant's price delta is added to the
        product's effective price; variants carry their own stock.
      </p>
      <ErrorBox error={error} />
      {variants === null ? (
        <Spinner label="Loading variants…" />
      ) : variants.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No variants — the product sells as a single edition.
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Variant</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">SKU</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Price delta</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Stock</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium">{variant.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{variant.sku ?? "—"}</td>
                  <td className="px-4 py-3">{formatRsDecimal(variant.priceDelta)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{variant.stockQty}</td>
                  <td className="px-4 py-3">{variant.isActive ? <Badge tone="accent">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                        onClick={() => setEditing(variant)}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                        onClick={() => setDeleting(variant)}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <VariantForm
          key={editing?.id ?? "new"}
          productId={productId}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete variant"
        danger
        confirmLabel="Delete variant"
        body={
          <p>
            Delete the variant <strong>{deleting?.name}</strong>? Carts holding it will drop the
            line on their next view.
          </p>
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function VariantForm({
  productId,
  initial,
  onClose,
  onSaved,
}: {
  productId: number;
  initial: ProductVariantAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [priceDelta, setPriceDelta] = useState(initial?.priceDelta ?? "0.00");
  const [stockQty, setStockQty] = useState("0");
  const [sortOrder, setSortOrder] = useState(initial != null ? String(initial.sortOrder) : "0");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const delta = rupeeInputToDecimal(priceDelta, true);
    if (delta === null) {
      setError(new Error("Price delta must be a rupee amount (it may be negative)."));
      return;
    }
    const parsedSort = Number(sortOrder);
    if (!Number.isInteger(parsedSort)) {
      setError(new Error("Sort order must be a whole number."));
      return;
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      sku: orNull(sku),
      priceDelta: delta,
      sortOrder: parsedSort,
      isActive,
    };
    try {
      if (initial) {
        await storeApi.updateVariant(productId, initial.id, body);
      } else {
        const opening = Number(stockQty);
        if (!Number.isInteger(opening) || opening < 0) {
          setError(new Error("Opening stock must be a whole number of 0 or more."));
          setBusy(false);
          return;
        }
        body.stockQty = opening;
        await storeApi.createVariant(productId, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the variant."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit variant — ${initial.name}` : "New variant"}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <Field label="Name" hint="e.g. “A2 Print”, “Hardcover”.">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU">
            <input className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label="Price delta (Rs.)" hint="Added to the product price; may be negative.">
            <input className={inputCls} inputMode="decimal" value={priceDelta} onChange={(e) => setPriceDelta(e.target.value)} required />
          </Field>
          {!initial && (
            <Field label="Opening stock">
              <input className={inputCls} type="number" min={0} step={1} value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
            </Field>
          )}
          <Field label="Sort order">
            <input className={inputCls} type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <div className="flex items-end pb-1">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isActive} onChange={setIsActive} label="Active" /> Active
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create variant"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inventory (inside the product editor — see the header note)
// ---------------------------------------------------------------------------

const MOVEMENT_PAGE_SIZE = 25;

function InventorySection({ productId, trackInventory }: { productId: number; trackInventory: boolean }) {
  const [summary, setSummary] = useState<InventorySummaryAdmin | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scope, setScope] = useState<string>("product");
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(false);
  const [movementPage, setMovementPage] = useState(1);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);

  const load = useCallback(
    async (page: number) => {
      try {
        const data = await storeApi.getInventory(productId, page, MOVEMENT_PAGE_SIZE);
        setSummary((prev) =>
          page > 1 && prev
            ? { ...data, items: [...(prev.items ?? []), ...(data.items ?? [])] }
            : data,
        );
        setHasMoreMovements((data.items ?? []).length === MOVEMENT_PAGE_SIZE);
        setMovementPage(page);
        setError(null);
      } catch (err) {
        setError(err);
      }
    },
    [productId],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const adjust = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value)) {
      setError(new Error("Enter a whole number of units."));
      return;
    }
    if (mode === "delta" && value === 0) {
      setError(new Error("An adjustment must not be zero."));
      return;
    }
    if (mode === "set" && value < 0) {
      setError(new Error("The set quantity cannot be negative."));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(false);
    const body: Record<string, unknown> = {
      variantId: scope === "product" ? null : Number(scope),
    };
    if (mode === "delta") body.quantity = value;
    else body.setQuantity = value;
    if (reason.trim() !== "") body.reason = reason.trim();
    try {
      await storeApi.adjustInventory(productId, body);
      setAmount("");
      setReason("");
      setNote(true);
      await load(1);
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("The adjustment failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-sm border border-border bg-background p-5">
      <h2 className="font-display text-xl">Inventory</h2>
      {!trackInventory && (
        <Notice tone="warn">
          This product does not track inventory — it always sells as available. Adjustments are
          still recorded in the ledger but do not gate checkout.
        </Notice>
      )}
      <ErrorBox error={error} />
      {summary === null ? (
        <Spinner label="Loading inventory…" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "On hand", value: summary.stockQty },
              { label: "Reserved", value: summary.reservedQty },
              { label: "Available", value: summary.availableQty },
            ].map((card) => (
              <div key={card.label} className="rounded-sm border border-border px-4 py-3">
                <p className="font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">{card.label}</p>
                <p className="mt-1 font-display text-2xl">{card.value}</p>
              </div>
            ))}
          </div>
          {summary.variants.length > 0 && (
            <div className="overflow-hidden rounded-sm border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-card text-left">
                    <th scope="col" className="px-4 py-2 font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Variant</th>
                    <th scope="col" className="px-4 py-2 text-right font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">On hand</th>
                    <th scope="col" className="px-4 py-2 text-right font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Reserved</th>
                    <th scope="col" className="px-4 py-2 text-right font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.variants.map((v) => (
                    <tr key={v.variantId} className="border-t border-border">
                      <td className="px-4 py-2">{v.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{v.stockQty}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{v.reservedQty}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-medium">{v.availableQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={adjust} className="space-y-3 rounded-sm border border-border p-3">
            <p className="text-sm font-medium">Adjust stock</p>
            {note && <Notice>Adjustment recorded in the ledger.</Notice>}
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Scope">
                <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="product">Whole product</option>
                  {summary.variants.map((v) => (
                    <option key={v.variantId} value={v.variantId}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mode">
                <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "delta" | "set")}>
                  <option value="delta">Adjust by (± units)</option>
                  <option value="set">Set on-hand to</option>
                </select>
              </Field>
              <Field label={mode === "delta" ? "Quantity (±)" : "On-hand quantity"}>
                <input className={inputCls} type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder={mode === "delta" ? "e.g. 10 or -2" : "e.g. 25"} />
              </Field>
              <Field label="Reason (optional)">
                <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Stocktake, delivery…" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Btn type="submit" variant="accent" size="sm" disabled={busy}>
                {busy ? "Recording…" : "Record adjustment"}
              </Btn>
            </div>
          </form>

          <div>
            <h3 className="mb-2 text-sm font-medium">Movement ledger</h3>
            {(summary.items ?? []).length === 0 ? (
              <p className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No movements recorded yet.
              </p>
            ) : (
              <div className="overflow-hidden rounded-sm border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-card text-left">
                      <th scope="col" className="px-4 py-2 font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">When</th>
                      <th scope="col" className="px-4 py-2 font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Movement</th>
                      <th scope="col" className="px-4 py-2 font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Variant</th>
                      <th scope="col" className="px-4 py-2 text-right font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Qty</th>
                      <th scope="col" className="px-4 py-2 text-right font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Balance</th>
                      <th scope="col" className="px-4 py-2 font-mono text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">Reason / order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.items ?? []).map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                        <td className="px-4 py-2">
                          <Badge>{m.movementType.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {m.variantId != null
                            ? (summary.variants.find((v) => v.variantId === m.variantId)?.name ?? `#${m.variantId}`)
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{m.balanceAfter ?? "—"}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {m.reason ?? (m.orderId != null ? `Order #${m.orderId}` : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hasMoreMovements && (
              <div className="mt-3 text-center">
                <Btn size="sm" onClick={() => void load(movementPage + 1)}>
                  Load older movements
                </Btn>
              </div>
            )}
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Reservations from carts and orders appear as RESERVE / RELEASE movements; checkout never
        edits on-hand stock directly.
      </p>
    </section>
  );
}
