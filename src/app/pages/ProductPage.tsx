import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useCustomer } from "../lib/customer";
import { setPageMeta } from "../lib/meta";
import {
  formatRs,
  getShopConfig,
  getShopProduct,
  ShopApiError,
  type ShopConfig,
  type ShopProductDetail,
} from "../lib/shop";
import { useProductPurchase } from "../lib/use-product-purchase";

type LoadState = "loading" | "ready" | "notfound" | "error";

/**
 * The dedicated product page (/shop/:slug) — the primary purchase
 * surface, and the only full one on mobile (the grid's card actions
 * are hover-driven). It promotes the QuickView detail experience to
 * a real, shareable route using the SAME public endpoints and the
 * SAME purchase-state hook, and adds Buy Now.
 *
 * Buy Now rides the one gated cart path with a checkout intent:
 * signed in, the add posts and — only on success — the shopper goes
 * to /checkout (no cart drawer); signed out, the intent is stashed,
 * sign-in replays it exactly once and lands on /checkout. A failed
 * add shows its error here and never navigates. Checkout always
 * recomputes prices and totals server-side.
 */
export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { status, cartCount, addToCartGated, setCartOpen } = useCustomer();
  const [detail, setDetail] = useState<ShopProductDetail | null>(null);
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [imageIdx, setImageIdx] = useState(0);
  const [adding, setAdding] = useState(false);
  const [buying, setBuying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { variant, variantId, setVariant, qty, setQty, pricePaisa, available, inStock, inCartQty } =
    useProductPurchase(detail);

  const load = useCallback(() => {
    if (!slug) return;
    let alive = true;
    setLoadState("loading");
    setDetail(null);
    setImageIdx(0);
    getShopProduct(slug)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        setLoadState("ready");
        setPageMeta({
          title: `${data.name} — Bodhisattva International`,
          description: data.description ?? data.detail ?? undefined,
          image: data.image?.url,
          path: `/shop/${data.slug}`,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // A genuine 404 is a missing piece; anything else is a
        // retryable failure — never conflate the two.
        setLoadState(err instanceof ShopApiError && err.status === 404 ? "notfound" : "error");
      });
    getShopConfig()
      .then((cfg) => alive && setConfig(cfg))
      .catch(() => {
        // The delivery/VAT note is informational — its failure never
        // blocks the product itself.
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(load, [load]);

  const mainImage = detail?.images[imageIdx] ?? detail?.image ?? null;

  const handleAdd = async () => {
    if (!detail || adding || buying) return;
    setAdding(true);
    setActionError(null);
    try {
      await addToCartGated({
        productId: detail.id,
        variantId: variant?.id ?? null,
        quantity: qty,
        returnTo: `/shop/${detail.slug}`,
      });
      // Signed in: the gated helper opened the cart drawer. Signed
      // out: it navigated to sign-in and this page is unmounting.
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "This piece could not be added. Please try again.",
      );
    } finally {
      setAdding(false);
    }
  };

  const handleBuyNow = async () => {
    if (!detail || adding || buying) return;
    setBuying(true);
    setActionError(null);
    try {
      const added = await addToCartGated({
        productId: detail.id,
        variantId: variant?.id ?? null,
        quantity: qty,
        returnTo: "/checkout",
        checkout: true,
      });
      // Navigate ONLY after the add succeeded. Signed out, `added`
      // is false: the helper already routed to sign-in, and the
      // replayed intent lands the shopper on /checkout.
      if (added) navigate("/checkout");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "This piece could not be added. Please try again.",
      );
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="pt-16 min-h-screen bg-background">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-10 lg:py-14">
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 font-mono text-[0.63rem] tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={13} /> Back to Gift Shop
        </Link>

        {loadState === "loading" ? (
          <p className="py-20 text-center font-mono text-[0.63rem] tracking-widest uppercase text-muted-foreground">
            Loading…
          </p>
        ) : loadState === "notfound" ? (
          <div className="py-20 text-center">
            <p className="font-display text-2xl font-medium mb-3">This piece could not be found</p>
            <p className="font-sans text-sm font-light text-muted-foreground mb-8">
              It may have been sold or moved. The rest of the Gift Shop is still here.
            </p>
            <Link
              to="/shop"
              className="border border-border px-8 py-3.5 font-mono text-[0.66rem] tracking-[0.2em] uppercase text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
            >
              Browse the Gift Shop
            </Link>
          </div>
        ) : loadState === "error" || !detail ? (
          <div className="py-20 text-center">
            <p className="font-display text-2xl font-medium mb-3">This piece could not be loaded</p>
            <p className="font-sans text-sm font-light text-muted-foreground mb-8">
              Something went wrong on our side. Please try again.
            </p>
            <button
              onClick={load}
              className="border border-border px-8 py-3.5 font-mono text-[0.66rem] tracking-[0.2em] uppercase text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Gallery — main image with a thumbnail strip below. */}
            <div>
              <div className="aspect-[3/4] overflow-hidden bg-muted">
                {mainImage && (
                  <img src={mainImage.url} alt={mainImage.alt} className="w-full h-full object-cover" />
                )}
              </div>
              {detail.images.length > 1 && (
                <div className="mt-3 flex gap-2">
                  {detail.images.map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() => setImageIdx(i)}
                      className={`h-16 w-12 overflow-hidden border-2 transition-colors ${i === imageIdx ? "border-accent" : "border-transparent opacity-70 hover:opacity-100"}`}
                      aria-label={`Image ${i + 1}`}
                    >
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details — the QuickView content rules, at page scale. */}
            <div>
              <p className="font-mono text-[0.58rem] tracking-widest uppercase text-accent mb-2">
                {detail.categoryName ?? detail.categorySlug ?? ""}
              </p>
              <h1 className="font-display text-3xl font-medium mb-2">{detail.name}</h1>
              <p className="font-mono text-[0.6rem] tracking-wider text-muted-foreground mb-4">{detail.detail}</p>
              {detail.description && (
                <p className="font-sans text-sm font-light leading-relaxed text-muted-foreground mb-6">
                  {detail.description}
                </p>
              )}
              {detail.variants.length > 0 && (
                <div className="mb-6">
                  <p className="font-mono text-[0.58rem] tracking-widest uppercase text-muted-foreground mb-2">Edition</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.variants.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setVariant(v.id)}
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
                <span className="ml-3 font-display text-lg text-muted-foreground line-through">
                  {formatRs(detail.pricePaisa)}
                </span>
              )}
              <p className="mt-3 font-mono text-[0.6rem] tracking-wider uppercase text-muted-foreground">
                {!inStock ? "Out of stock" : available <= 5 ? `Only ${available} available` : "In stock"}
                {inCartQty > 0 && status === "full" ? ` · ${inCartQty} in your cart` : ""}
              </p>
              {config && (
                <div className="mt-5 border-t border-border pt-4 space-y-1.5">
                  <p className="font-mono text-[0.58rem] tracking-widest uppercase text-muted-foreground">
                    Delivery &amp; VAT
                  </p>
                  <p className="font-sans text-[0.83rem] font-light text-muted-foreground">
                    {config.shippingFeePaisa > 0
                      ? `Delivery ${formatRs(config.shippingFeePaisa)} — one flat fee per order, however many pieces.`
                      : "Free delivery on every order."}
                  </p>
                  {config.taxRatePercent > 0 && (
                    <p className="font-sans text-[0.83rem] font-light text-muted-foreground">
                      Plus VAT ({config.taxRatePercent}%) at checkout — prices shown exclude VAT.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-8">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center border border-border">
                    <button onClick={() => setQty(qty - 1)} className="flex h-10 w-10 items-center justify-center hover:bg-secondary transition-colors" aria-label="Decrease quantity">
                      <Minus size={13} />
                    </button>
                    <span className="w-10 text-center font-mono text-sm">{qty}</span>
                    <button onClick={() => setQty(qty + 1)} className="flex h-10 w-10 items-center justify-center hover:bg-secondary transition-colors" aria-label="Increase quantity">
                      <Plus size={13} />
                    </button>
                  </div>
                  {inCartQty > 0 && status === "full" && (
                    <button
                      onClick={() => setCartOpen(true)}
                      className="font-mono text-[0.63rem] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View Cart
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => void handleAdd()}
                    disabled={!inStock || adding || buying}
                    className="flex-1 border border-foreground py-3.5 text-[0.66rem] tracking-[0.2em] uppercase font-sans text-foreground hover:bg-foreground hover:text-background transition-colors disabled:border-muted disabled:text-muted-foreground disabled:hover:bg-transparent disabled:cursor-not-allowed"
                  >
                    {!inStock ? "Out of Stock" : adding ? "Adding…" : status === "full" ? "Add to Cart" : "Sign In to Add"}
                  </button>
                  <button
                    onClick={() => void handleBuyNow()}
                    disabled={!inStock || adding || buying}
                    className="flex-1 bg-accent text-accent-foreground py-3.5 text-[0.66rem] tracking-[0.2em] uppercase font-sans hover:opacity-90 transition-opacity disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                  >
                    {buying ? "Adding…" : status === "full" ? "Buy Now" : "Sign In to Buy"}
                  </button>
                </div>
                {status === "full" && cartCount > 0 && (
                  <p className="mt-3 font-sans text-[0.8rem] font-light text-muted-foreground">
                    Buy Now adds this piece and takes you to checkout with everything in your cart.
                  </p>
                )}
                {actionError && (
                  <p role="alert" className="mt-3 font-sans text-[0.83rem] text-destructive">
                    {actionError}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
