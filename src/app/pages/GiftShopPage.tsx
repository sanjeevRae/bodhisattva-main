import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { X, Search, ShoppingBag, Heart, Minus, Plus } from "lucide-react";
import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";
import { useCustomer } from "../lib/customer";
import {
  formatRs,
  getShopCategories,
  getShopProduct,
  getShopProducts,
  type ShopCategory,
  type ShopProduct,
  type ShopProductDetail,
} from "../lib/shop";

/**
 * Gift Shop — the page's only CMS section is the header band (hero),
 * rendered from GET /api/pages/shop via PageRenderer with the cart-count
 * badge injected from the server cart. The category tabs, product grid
 * and quick-preview modal below are ecommerce module surface (mapping
 * §6): since Phase 6 they run on the real store APIs
 * (GET /api/shop/categories, /api/shop/products, /api/shop/products/:slug)
 * and the login-gated server cart (spec §10.3) — browsing is public,
 * adding to the cart requires sign-in (see lib/customer.tsx).
 */
type SortKey = "featured" | "price-asc" | "price-desc" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "price-asc", label: "Price · Low to High" },
  { key: "price-desc", label: "Price · High to Low" },
  { key: "name", label: "Name" },
];

export default function GiftShopPage() {
  const { data: page, error } = usePage("shop");
  const { status, cart, cartCount, addToCartGated, setCartOpen } = useCustomer();
  const [categories, setCategories] = useState<ShopCategory[] | null>(null);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [listError, setListError] = useState(false);
  const [wishlist, setWishlist] = useState<number[]>([]);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getShopCategories()
      .then((items) => alive && setCategories(items))
      .catch(() => alive && setCategories([]));
    return () => {
      alive = false;
    };
  }, []);

  // Product list — refetched (debounced for search) whenever the tab,
  // search term or sort changes; "Load more" appends the next page.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () => {
        getShopProducts({
          category: tab === "all" ? undefined : tab,
          search: search.trim() || undefined,
          sort,
          page: 1,
          pageSize: 48,
        })
          .then(({ items, meta }) => {
            if (!alive) return;
            setProducts(items);
            setTotal(meta.total);
            setPageNo(1);
            setListError(false);
          })
          .catch(() => alive && setListError(true));
      },
      search ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tab, search, sort]);

  const loadMore = () => {
    const next = pageNo + 1;
    getShopProducts({
      category: tab === "all" ? undefined : tab,
      search: search.trim() || undefined,
      sort,
      page: next,
      pageSize: 48,
    })
      .then(({ items, meta }) => {
        setProducts((prev) => [...prev, ...items]);
        setTotal(meta.total);
        setPageNo(next);
      })
      .catch(() => setListError(true));
  };

  const tabs = useMemo(
    () => [
      { key: "all", label: "All" },
      ...(categories ?? []).map((c) => ({ key: c.slug, label: c.name })),
    ],
    [categories],
  );

  const inCartQty = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart?.items ?? []) {
      map.set(`${item.productId}:${item.variantId ?? 0}`, item.quantity);
    }
    return map;
  }, [cart]);

  const toggleWishlist = (id: number) =>
    setWishlist((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));

  const handleAdd = async (product: ShopProduct) => {
    if (status === "full" && inCartQty.has(`${product.id}:0`)) {
      setCartOpen(true);
      return;
    }
    setAddingId(product.id);
    try {
      await addToCartGated({ productId: product.id, variantId: null, quantity: 1, returnTo: "/shop" });
    } catch {
      // Stock rejection — the product card re-renders from the refreshed
      // cart/list state; nothing else to do here.
    } finally {
      setAddingId(null);
    }
  };

  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;

  return (
    <div className="pt-16">
      <PageRenderer
        page={page}
        renderSection={(section) => {
          if (section.type !== "hero") return undefined;
          return (
            <div className="bg-secondary border-b border-border py-20">
              <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
                <p className="font-mono text-[0.6rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">{section.config.eyebrow}</p>
                <div className="flex items-end justify-between">
                  <h1 className="font-display text-5xl md:text-6xl font-medium">{section.config.heading}</h1>
                  <div className="flex items-center gap-2 ml-4">
                    <ShoppingBag size={17} className="text-accent" />
                    <span className="font-mono text-sm text-accent font-medium">{status === "full" ? cartCount : 0}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />

      <div className="border-b border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 flex items-center justify-between gap-4">
          <div className="flex gap-0 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`font-mono text-[0.6rem] tracking-widest uppercase px-6 py-4 whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3 shrink-0 py-2">
            <label className="flex items-center gap-2 border border-border px-3 py-1.5 focus-within:border-accent transition-colors">
              <Search size={12} className="text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="SEARCH"
                aria-label="Search products"
                className="w-28 bg-transparent font-mono text-[0.63rem] tracking-widest uppercase placeholder:text-muted-foreground focus:outline-none"
              />
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort products"
              className="bg-transparent border border-border px-2.5 py-1.5 font-mono text-[0.63rem] tracking-widest uppercase text-muted-foreground focus:outline-none focus:border-accent cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="md:hidden max-w-screen-xl mx-auto px-6 pb-3 flex items-center gap-3">
          <label className="flex flex-1 items-center gap-2 border border-border px-3 py-2 focus-within:border-accent transition-colors">
            <Search size={12} className="text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH"
              aria-label="Search products"
              className="flex-1 bg-transparent font-mono text-[0.63rem] tracking-widest uppercase placeholder:text-muted-foreground focus:outline-none"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort products"
            className="bg-transparent border border-border px-2.5 py-2 font-mono text-[0.63rem] tracking-widest uppercase text-muted-foreground focus:outline-none focus:border-accent cursor-pointer"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-16">
        {listError ? (
          <p className="text-center font-sans text-sm text-muted-foreground py-10">
            The shop could not be loaded. Please try again shortly.
          </p>
        ) : products.length === 0 ? (
          <p className="text-center font-sans text-sm text-muted-foreground py-10">
            {search ? `No pieces match “${search}”.` : "No pieces here yet."}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {products.map((product) => {
              const inCart = status === "full" && inCartQty.has(`${product.id}:0`);
              return (
                <motion.div key={product.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group">
                  <div className="relative aspect-[3/4] overflow-hidden bg-muted mb-4">
                    {product.image && (
                      <img src={product.image.url} alt={product.image.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                    )}
                    <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/8 transition-colors" />
                    {!product.inStock && (
                      <span className="absolute left-3 top-3 bg-background/85 backdrop-blur-sm px-2.5 py-1 font-mono text-[0.58rem] tracking-[0.18em] uppercase text-foreground">
                        Out of Stock
                      </span>
                    )}
                    <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => toggleWishlist(product.id)} className={`w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors ${wishlist.includes(product.id) ? "bg-accent text-accent-foreground" : "bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground"}`} aria-label="Wishlist">
                        <Heart size={12} fill={wishlist.includes(product.id) ? "currentColor" : "none"} />
                      </button>
                      <button onClick={() => setPreviewSlug(product.slug)} className="w-8 h-8 flex items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-foreground hover:text-background backdrop-blur-sm transition-colors" aria-label="Quick preview">
                        <Search size={12} />
                      </button>
                    </div>
                    <div className="absolute bottom-0 inset-x-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                      <button
                        onClick={() => void handleAdd(product)}
                        disabled={!product.inStock || addingId === product.id}
                        className={`w-full py-3 text-[0.64rem] tracking-[0.2em] uppercase font-sans transition-colors disabled:cursor-not-allowed ${inCart ? "bg-foreground text-primary-foreground" : "bg-accent text-accent-foreground disabled:bg-muted disabled:text-muted-foreground"}`}
                      >
                        {!product.inStock ? "Out of Stock" : inCart ? "In Cart ✓ — View" : addingId === product.id ? "Adding…" : "Add to Cart"}
                      </button>
                    </div>
                  </div>
                  <h3 className="font-display text-sm font-medium leading-snug mb-1">{product.name}</h3>
                  <p className="font-mono text-[0.58rem] tracking-wider text-muted-foreground mb-2">{product.detail}</p>
                  <span className="font-display text-base font-medium text-accent">{formatRs(product.effectivePricePaisa)}</span>
                  {product.salePricePaisa != null && (
                    <span className="ml-2 font-display text-sm text-muted-foreground line-through">{formatRs(product.pricePaisa)}</span>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
        {products.length < total && (
          <div className="mt-14 text-center">
            <button
              onClick={loadMore}
              className="border border-border px-8 py-3.5 font-mono text-[0.66rem] tracking-[0.2em] uppercase text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
            >
              Load More ({products.length} of {total})
            </button>
          </div>
        )}
      </div>

      {previewSlug && <QuickView slug={previewSlug} onClose={() => setPreviewSlug(null)} />}
    </div>
  );
}

function QuickView({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { status, cart, addToCartGated, setCartOpen } = useCustomer();
  const [detail, setDetail] = useState<ShopProductDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [imageIdx, setImageIdx] = useState(0);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    getShopProduct(slug)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        setVariantId(data.variants.find((v) => v.inStock)?.id ?? data.variants[0]?.id ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  const variant = detail?.variants.find((v) => v.id === variantId) ?? null;
  const pricePaisa = variant ? variant.effectivePricePaisa : detail?.effectivePricePaisa ?? 0;
  const available = variant ? variant.availableQty : detail?.availableQty ?? 0;
  const inStock = variant ? variant.inStock : detail?.inStock ?? false;
  const inCartQty = detail
    ? (cart?.items ?? [])
        .filter((i) => i.productId === detail.id && i.variantId === (variant?.id ?? null))
        .reduce((sum, i) => sum + i.quantity, 0)
    : 0;
  const mainImage = detail?.images[imageIdx] ?? detail?.image ?? null;

  const handleAdd = async () => {
    if (!detail) return;
    setAdding(true);
    try {
      const added = await addToCartGated({
        productId: detail.id,
        variantId: variant?.id ?? null,
        quantity: qty,
        returnTo: "/shop",
      });
      if (added) onClose();
    } catch {
      // Stock changed under us — stay open; the stock note reflects the
      // refreshed availability after the cart context reloads.
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground/60 backdrop-blur-sm" />
      <div className="relative bg-background max-w-2xl w-full grid sm:grid-cols-2 overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="aspect-square sm:aspect-auto overflow-hidden bg-muted relative">
          {mainImage && <img src={mainImage.url} alt={mainImage.alt} className="w-full h-full object-cover" />}
          {detail && detail.images.length > 1 && (
            <div className="absolute bottom-3 left-3 flex gap-2">
              {detail.images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setImageIdx(i)}
                  className={`h-10 w-8 overflow-hidden border-2 transition-colors ${i === imageIdx ? "border-accent" : "border-transparent opacity-70 hover:opacity-100"}`}
                  aria-label={`Image ${i + 1}`}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="p-8 flex flex-col justify-between">
          <div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground mb-6 block"><X size={18} /></button>
            {failed ? (
              <p className="font-sans text-sm text-muted-foreground">This piece could not be loaded.</p>
            ) : !detail ? (
              <p className="font-mono text-[0.63rem] tracking-widest uppercase text-muted-foreground">Loading…</p>
            ) : (
              <>
                <p className="font-mono text-[0.58rem] tracking-widest uppercase text-accent mb-2">{detail.categoryName ?? detail.categorySlug ?? ""}</p>
                <h3 className="font-display text-xl font-medium mb-2">{detail.name}</h3>
                <p className="font-mono text-[0.6rem] tracking-wider text-muted-foreground mb-4">{detail.detail}</p>
                {detail.description && (
                  <p className="font-sans text-sm font-light leading-relaxed text-muted-foreground mb-6">{detail.description}</p>
                )}
                {detail.variants.length > 0 && (
                  <div className="mb-6">
                    <p className="font-mono text-[0.58rem] tracking-widest uppercase text-muted-foreground mb-2">Edition</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => setVariantId(v.id)}
                          disabled={!v.inStock}
                          className={`border px-3 py-2 font-mono text-[0.63rem] tracking-wider uppercase transition-colors disabled:opacity-40 ${v.id === variantId ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {v.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <span className="font-display text-3xl font-medium text-accent">{formatRs(pricePaisa)}</span>
                {detail.salePricePaisa != null && !variant && (
                  <span className="ml-3 font-display text-lg text-muted-foreground line-through">{formatRs(detail.pricePaisa)}</span>
                )}
                <p className="mt-3 font-mono text-[0.6rem] tracking-wider uppercase text-muted-foreground">
                  {!inStock ? "Out of stock" : available <= 5 ? `Only ${available} available` : "In stock"}
                  {inCartQty > 0 && status === "full" ? ` · ${inCartQty} in your cart` : ""}
                </p>
              </>
            )}
          </div>
          {detail && (
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center border border-border">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-10 w-10 items-center justify-center hover:bg-secondary transition-colors" aria-label="Decrease quantity">
                    <Minus size={13} />
                  </button>
                  <span className="w-10 text-center font-mono text-sm">{qty}</span>
                  <button onClick={() => setQty((q) => Math.min(Math.max(available, 1), q + 1))} className="flex h-10 w-10 items-center justify-center hover:bg-secondary transition-colors" aria-label="Increase quantity">
                    <Plus size={13} />
                  </button>
                </div>
                {inCartQty > 0 && status === "full" && (
                  <button
                    onClick={() => { onClose(); setCartOpen(true); }}
                    className="font-mono text-[0.63rem] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View Cart
                  </button>
                )}
              </div>
              <button
                onClick={() => void handleAdd()}
                disabled={!inStock || adding}
                className="w-full bg-accent text-accent-foreground py-3.5 text-[0.66rem] tracking-[0.2em] uppercase font-sans hover:opacity-90 transition-opacity disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
              >
                {!inStock ? "Out of Stock" : adding ? "Adding…" : status === "full" ? "Add to Cart" : "Sign In to Add"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
