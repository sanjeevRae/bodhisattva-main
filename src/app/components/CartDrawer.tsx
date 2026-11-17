import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useCustomer } from "../lib/customer";
import { formatRs, ShopApiError } from "../lib/shop";

/**
 * Cart drawer (Phase 6) — a slide-over in the site's visual language
 * (the quick-view modal's backdrop/serif/mono idiom). The cart itself is
 * the server's; every mutation goes through the customer context and the
 * drawer re-renders from the returned CartView. Stock rejections (422
 * INSUFFICIENT_STOCK) surface as an inline note and the cart refreshes
 * to the server's truth.
 */
export default function CartDrawer() {
  const {
    status,
    cart,
    cartOpen,
    setCartOpen,
    updateCartItem,
    removeCartItem,
    clearCart,
    refreshCart,
  } = useCustomer();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!cartOpen) return;
    setNote(null);
    if (status === "full") void refreshCart();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCartOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [cartOpen, status, refreshCart, setCartOpen]);

  const signedIn = status === "full";

  const mutate = async (itemId: number, run: () => Promise<unknown>) => {
    setBusyId(itemId);
    setNote(null);
    try {
      await run();
    } catch (err) {
      if (err instanceof ShopApiError && err.code === "INSUFFICIENT_STOCK") {
        setNote("Only the available quantity can be added — the cart has been updated to the latest stock.");
      } else {
        setNote(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      void refreshCart();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AnimatePresence>
      {cartOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Shopping cart">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <div className="flex items-center gap-3">
                <ShoppingBag size={18} className="text-accent" />
                <h2 className="font-display text-xl font-medium">Your Cart</h2>
                {signedIn && cart && cart.itemCount > 0 && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
                  </span>
                )}
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close cart"
              >
                <X size={20} />
              </button>
            </div>

            {!signedIn ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                <p className="mb-3 font-display text-lg font-medium">Your cart lives in your account</p>
                <p className="mb-8 font-sans text-sm font-light leading-relaxed text-muted-foreground">
                  Sign in to add pieces to your cart and check out. Anything you pick will be
                  waiting here when you return.
                </p>
                <button
                  onClick={() => {
                    setCartOpen(false);
                    navigate(`/login?return=${encodeURIComponent(location.pathname)}`);
                  }}
                  className="bg-accent px-8 py-3.5 font-sans text-[0.58rem] uppercase tracking-[0.2em] text-accent-foreground transition-opacity hover:opacity-90"
                >
                  Sign In
                </button>
              </div>
            ) : cart === null ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading cart…</p>
              </div>
            ) : cart.items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                <p className="mb-3 font-display text-lg font-medium">Your cart is empty</p>
                <p className="mb-8 font-sans text-sm font-light leading-relaxed text-muted-foreground">
                  Prints, books, ceramics and keepsakes from the museum shop.
                </p>
                <button
                  onClick={() => {
                    setCartOpen(false);
                    navigate("/shop");
                  }}
                  className="bg-accent px-8 py-3.5 font-sans text-[0.58rem] uppercase tracking-[0.2em] text-accent-foreground transition-opacity hover:opacity-90"
                >
                  Browse the Gift Shop
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {note && (
                    <p className="mb-4 border border-accent/40 bg-secondary px-4 py-3 font-sans text-xs leading-relaxed text-foreground">
                      {note}
                    </p>
                  )}
                  <ul className="divide-y divide-border">
                    {cart.items.map((item) => (
                      <li key={item.id} className="flex gap-4 py-4">
                        <div className="h-20 w-16 shrink-0 overflow-hidden bg-muted">
                          {item.image && (
                            <img src={item.image.url} alt={item.image.alt} className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-display text-sm font-medium leading-snug">{item.name}</p>
                            <button
                              onClick={() => void mutate(item.id, () => removeCartItem(item.id))}
                              disabled={busyId === item.id}
                              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                              aria-label={`Remove ${item.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {item.variantName && (
                            <p className="mt-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-muted-foreground">
                              {item.variantName}
                            </p>
                          )}
                          <p className="mt-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-muted-foreground">
                            {formatRs(item.unitPricePaisa)} each
                          </p>
                          <div className="mt-auto flex items-center justify-between pt-2">
                            <div className="flex items-center border border-border">
                              <button
                                onClick={() =>
                                  void mutate(item.id, () =>
                                    item.quantity <= 1
                                      ? removeCartItem(item.id)
                                      : updateCartItem(item.id, item.quantity - 1),
                                  )
                                }
                                disabled={busyId === item.id}
                                className="flex h-8 w-8 items-center justify-center transition-colors hover:bg-secondary disabled:opacity-40"
                                aria-label="Decrease quantity"
                              >
                                <Minus size={12} />
                              </button>
                              <span className="w-8 text-center font-mono text-xs">{item.quantity}</span>
                              <button
                                onClick={() => void mutate(item.id, () => updateCartItem(item.id, item.quantity + 1))}
                                disabled={busyId === item.id || item.quantity >= item.availableQty}
                                className="flex h-8 w-8 items-center justify-center transition-colors hover:bg-secondary disabled:opacity-40"
                                aria-label="Increase quantity"
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                            <span className="font-display text-sm font-medium text-accent">
                              {formatRs(item.lineTotalPaisa)}
                            </span>
                          </div>
                          {item.quantity >= item.availableQty && (
                            <p className="mt-1.5 font-mono text-[0.52rem] uppercase tracking-wider text-muted-foreground">
                              All available stock is in your cart
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => void mutate(-1, () => clearCart())}
                    className="mt-2 font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear cart
                  </button>
                </div>
                <div className="border-t border-border px-6 py-5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">Subtotal</span>
                    <span className="font-display text-xl font-medium">{formatRs(cart.subtotalPaisa)}</span>
                  </div>
                  <p className="mb-5 font-sans text-xs font-light text-muted-foreground">
                    Shipping and any taxes are calculated at checkout. Payment is cash on delivery.
                  </p>
                  <button
                    onClick={() => {
                      setCartOpen(false);
                      navigate("/checkout");
                    }}
                    className="w-full bg-accent py-4 font-sans text-[0.6rem] uppercase tracking-[0.22em] text-accent-foreground transition-opacity hover:opacity-90"
                  >
                    Proceed to Checkout
                  </button>
                  <Link
                    to="/shop"
                    onClick={() => setCartOpen(false)}
                    className="mt-3 block text-center font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Continue shopping
                  </Link>
                </div>
              </>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
