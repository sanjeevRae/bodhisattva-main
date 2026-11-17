/**
 * Customer session + cart context for the public site (Phase 6).
 *
 * Session: probed from GET /api/auth/me on mount (the server session
 * cookie is the source of truth). Only the `full` auth level counts as
 * signed in here — admin accounts that stop at the MFA gate
 * (mfa_pending / enrolment_required) are directed to the admin sign-in
 * instead; customers never see those states.
 *
 * Cart: the server cart (GET /api/cart) is authoritative — this context
 * only mirrors it. Prices are never held client-side beyond what the
 * cart payload itself carries.
 *
 * Login-gated add-to-cart (spec §10.3): adding while signed out stashes
 * the intent in sessionStorage and routes to /login?return=<path>;
 * after a successful login the intent is posted to the cart, cleared,
 * and the shopper lands back where they were with the cart drawer open.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import {
  addCartItem,
  clearCart as apiClearCart,
  getCart,
  removeCartItem as apiRemoveCartItem,
  setShopCsrfToken,
  shopRequest,
  updateCartItem as apiUpdateCartItem,
  type CartView,
} from "./shop";

export interface CustomerUser {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  roles: string[];
}

export type CustomerStatus = "loading" | "anonymous" | "full";

export interface CartIntent {
  productId: number;
  variantId: number | null;
  quantity: number;
  returnTo: string;
}

const INTENT_KEY = "bodhi.cartIntent";

export function stashCartIntent(intent: CartIntent): void {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Private-mode storage failures: the shopper just signs in without
    // the round-trip — never block the flow on storage.
  }
}

export function readCartIntent(): CartIntent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CartIntent;
    if (typeof parsed.productId !== "number") return null;
    return {
      productId: parsed.productId,
      variantId: parsed.variantId ?? null,
      quantity: typeof parsed.quantity === "number" ? parsed.quantity : 1,
      returnTo: typeof parsed.returnTo === "string" ? parsed.returnTo : "/shop",
    };
  } catch {
    return null;
  }
}

export function clearCartIntent(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // ignore
  }
}

interface MeResponse {
  user: CustomerUser;
  authLevel: string;
  csrfToken: string;
}

interface LoginResponse extends MeResponse {
  mfaRequired?: boolean;
  mfaEnrolmentRequired?: boolean;
}

export type LoginOutcome =
  | { ok: true }
  | { ok: false; reason: "mfa" | "error"; message: string };

export interface CustomerContextValue {
  status: CustomerStatus;
  user: CustomerUser | null;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  cart: CartView | null;
  cartCount: number;
  refreshCart: () => Promise<void>;
  addToCart: (productId: number, variantId: number | null, quantity: number) => Promise<CartView>;
  updateCartItem: (itemId: number, quantity: number) => Promise<CartView>;
  removeCartItem: (itemId: number) => Promise<CartView>;
  clearCart: () => Promise<CartView>;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  /**
   * The spec §10.3 add-to-cart gate. Signed in: posts the add, opens the
   * drawer, returns true. Signed out: stashes the intent and navigates
   * to the login page, returns false.
   */
  addToCartGated: (intent: CartIntent) => Promise<boolean>;
  /**
   * After a successful login: if a stashed intent exists, post it to the
   * cart, clear it and open the drawer. Returns the path to land on
   * (the intent's returnTo), or null when there was no intent.
   */
  completePendingIntent: () => Promise<string | null>;
}

const CustomerContext = createContext<CustomerContextValue | null>(null);

export function useCustomer(): CustomerContextValue {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error("useCustomer must be used inside CustomerProvider");
  return ctx;
}

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CustomerStatus>("loading");
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [cart, setCart] = useState<CartView | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const navigate = useNavigate();
  const statusRef = useRef(status);
  statusRef.current = status;

  const refreshCart = useCallback(async () => {
    try {
      const view = await getCart();
      setCart(view);
    } catch {
      // Session expired between probe and cart fetch — leave the last
      // known cart; the next session refresh resets it.
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const me = await shopRequest<MeResponse>("/api/auth/me");
      setShopCsrfToken(me.csrfToken);
      if (me.authLevel === "full") {
        setUser(me.user);
        setStatus("full");
        void refreshCart();
      } else {
        // MFA-gated (admin) session: not a shopper sign-in.
        setUser(null);
        setStatus("anonymous");
        setCart(null);
      }
    } catch {
      setUser(null);
      setStatus("anonymous");
      setCart(null);
    }
  }, [refreshCart]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      let data: LoginResponse;
      try {
        data = await shopRequest<LoginResponse>("/api/auth/login", {
          method: "POST",
          body: { email, password },
        });
      } catch (err) {
        return {
          ok: false,
          reason: "error",
          message: err instanceof Error ? err.message : "Sign-in failed. Please try again.",
        };
      }
      setShopCsrfToken(data.csrfToken);
      if (data.mfaRequired || data.mfaEnrolmentRequired || data.authLevel !== "full") {
        return {
          ok: false,
          reason: "mfa",
          message:
            "This account requires authenticator sign-in. Please use the admin sign-in instead.",
        };
      }
      setUser(data.user);
      setStatus("full");
      void refreshCart();
      return { ok: true };
    },
    [refreshCart],
  );

  const logout = useCallback(async () => {
    try {
      await shopRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // Session already gone — the local reset is what matters.
    }
    setShopCsrfToken(null);
    setUser(null);
    setStatus("anonymous");
    setCart(null);
    setCartOpen(false);
  }, []);

  const addToCart = useCallback(
    async (productId: number, variantId: number | null, quantity: number) => {
      const view = await addCartItem(productId, variantId, quantity);
      setCart(view);
      return view;
    },
    [],
  );

  const updateCartItem = useCallback(async (itemId: number, quantity: number) => {
    const view = await apiUpdateCartItem(itemId, quantity);
    setCart(view);
    return view;
  }, []);

  const removeCartItem = useCallback(async (itemId: number) => {
    const view = await apiRemoveCartItem(itemId);
    setCart(view);
    return view;
  }, []);

  const clearCart = useCallback(async () => {
    const view = await apiClearCart();
    setCart(view);
    return view;
  }, []);

  const addToCartGated = useCallback(
    async (intent: CartIntent): Promise<boolean> => {
      if (statusRef.current === "full") {
        await addToCart(intent.productId, intent.variantId, intent.quantity);
        setCartOpen(true);
        return true;
      }
      stashCartIntent(intent);
      navigate(`/login?return=${encodeURIComponent(intent.returnTo)}`);
      return false;
    },
    [addToCart, navigate],
  );

  const completePendingIntent = useCallback(async (): Promise<string | null> => {
    const intent = readCartIntent();
    if (!intent) return null;
    clearCartIntent();
    try {
      await addToCart(intent.productId, intent.variantId, intent.quantity);
      setCartOpen(true);
    } catch {
      // The product sold out / was archived while signing in — land on
      // the return path anyway; the shop page shows its live state.
    }
    return intent.returnTo;
  }, [addToCart]);

  const value = useMemo<CustomerContextValue>(
    () => ({
      status,
      user,
      login,
      logout,
      refreshSession,
      cart,
      cartCount: cart?.itemCount ?? 0,
      refreshCart,
      addToCart,
      updateCartItem,
      removeCartItem,
      clearCart,
      cartOpen,
      setCartOpen,
      addToCartGated,
      completePendingIntent,
    }),
    [
      status,
      user,
      login,
      logout,
      refreshSession,
      cart,
      refreshCart,
      addToCart,
      updateCartItem,
      removeCartItem,
      clearCart,
      cartOpen,
      addToCartGated,
      completePendingIntent,
    ],
  );

  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}
