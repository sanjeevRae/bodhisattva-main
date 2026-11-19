import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { CheckCircle2 } from "lucide-react";
import type { CountryCode } from "libphonenumber-js/min";
import {
  buildPhonePayload,
  DEFAULT_PHONE_COUNTRY,
  isValidPhoneValue,
  PhoneField,
} from "../components/PhoneField";
import { useCustomer } from "../lib/customer";
import { authInputCls, authLabelCls, apiErrorText } from "./auth-shared";
import { formatPlacedAt, statusLabel } from "./AccountOrdersPage";
import {
  createAddress,
  formatRs,
  getShopConfig,
  listAddresses,
  checkout,
  ShopApiError,
  type CheckoutInput,
  type CustomerAddress,
  type AddressInput,
  type CustomerOrder,
  type ShopConfig,
} from "../lib/shop";

const EMPTY_ADDRESS: AddressInput = {
  recipientName: "",
  phone: "",
  addressLine: "",
  city: "",
  district: "",
  postalCode: "",
  deliveryNotes: "",
};

/**
 * Checkout (Phase 6, spec §10.3) — login-gated; the order is priced
 * entirely by the server. The summary mirrors the server's arithmetic
 * from /api/shop/config for display only; the placed order's own totals
 * are what the success screen shows. The idempotency key is generated
 * once per checkout attempt and held in a ref, so a retry after a
 * network failure replays the same order instead of duplicating it.
 * Payment is cash on delivery; new orders start as PENDING_APPROVAL.
 */
export default function CheckoutPage() {
  const { status, user, cart, refreshCart } = useCustomer();
  const navigate = useNavigate();
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<AddressInput>(EMPTY_ADDRESS);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [saveNew, setSaveNew] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  if (idempotencyKey.current === null) {
    idempotencyKey.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    if (status !== "full") return;
    void refreshCart();
    getShopConfig().then(setConfig).catch(() => setConfig(null));
    listAddresses()
      .then((items) => {
        setAddresses(items);
        const def = items.find((a) => a.isDefault) ?? items[0];
        setSelected(def ? def.id : "new");
      })
      .catch(() => {
        setAddresses([]);
        setSelected("new");
      });
  }, [status, refreshCart]);

  if (status === "anonymous") return <Navigate to="/login?return=/checkout" replace />;
  if (status !== "full") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center pt-16">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (cart !== null && cart.items.length === 0 && !order) {
    return <Navigate to="/shop" replace />;
  }

  if (order) {
    return (
      <div className="pt-16">
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <CheckCircle2 size={44} className="mx-auto mb-6 text-accent" strokeWidth={1.25} />
          <p className="mb-3 font-mono text-[0.63rem] uppercase tracking-[0.28em] text-muted-foreground">
            Order Placed · {formatPlacedAt(order.placedAt)}
          </p>
          <h1 className="mb-4 font-display text-4xl font-medium md:text-5xl">Thank You</h1>
          <p className="mb-2 font-display text-2xl font-medium text-accent">{order.orderNumber}</p>
          <p className="mx-auto mb-10 max-w-md font-sans text-sm font-light leading-relaxed text-muted-foreground">
            Your order is <span className="text-foreground">{statusLabel(order.status).toLowerCase()}</span>.
            The museum will confirm it before dispatch. Please keep{" "}
            <span className="font-medium text-foreground">{formatRs(order.grandTotalPaisa)}</span> ready
            in cash for delivery to {order.delivery.recipientName} in {order.delivery.city}.
          </p>
          <div className="mb-10 border border-border bg-background px-6 py-5 text-left">
            <ul className="divide-y divide-border">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between py-2.5 text-sm">
                  <span>
                    <span className="font-display font-medium">{item.name}</span>
                    {item.variantName && (
                      <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                        {item.variantName}
                      </span>
                    )}
                    <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                      ×{item.quantity}
                    </span>
                  </span>
                  <span>{formatRs(item.lineTotalPaisa)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/account/orders"
              className="bg-accent px-8 py-3.5 font-sans text-[0.68rem] uppercase tracking-[0.2em] text-accent-foreground transition-opacity hover:opacity-90"
            >
              View My Orders
            </Link>
            <Link
              to="/shop"
              className="border border-border px-8 py-3.5 font-sans text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const subtotal = cart?.subtotalPaisa ?? 0;
  const shipping = config && subtotal > 0 ? config.shippingFeePaisa : 0;
  const tax = config ? Math.round((subtotal * config.taxRatePercent) / 100) : 0;
  const total = subtotal + shipping + tax;

  const set = (key: keyof AddressInput) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cart || cart.items.length === 0) return;
    if (selected === "new" && !isValidPhoneValue(form.phone, phoneCountry)) {
      setError("Enter a valid phone number, including the country code.");
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      let partial: Omit<CheckoutInput, "idempotencyKey" | "notes">;
      if (selected === "new") {
        const inline: NonNullable<CheckoutInput["address"]> = {
          recipientName: form.recipientName.trim(),
          ...buildPhonePayload(form.phone, phoneCountry),
          addressLine: form.addressLine.trim(),
          city: form.city.trim(),
          district: form.district?.trim() ? form.district : null,
          postalCode: form.postalCode?.trim() ? form.postalCode : null,
          deliveryNotes: form.deliveryNotes?.trim() ? form.deliveryNotes : null,
        };
        if (saveNew) {
          const saved = await createAddress({ ...inline, label: "Delivery" });
          partial = { addressId: saved.id };
        } else {
          partial = { address: inline };
        }
      } else {
        partial = { addressId: selected as number };
      }
      const placed = await checkout({
        ...partial,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        idempotencyKey: idempotencyKey.current as string,
      });
      await refreshCart();
      setOrder(placed);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ShopApiError && err.code === "INSUFFICIENT_STOCK") {
        setError("Some items just sold out — your cart has been updated to the latest availability. Please review it and try again.");
        void refreshCart();
      } else if (err instanceof ShopApiError && err.code === "EMPTY_CART") {
        navigate("/shop");
      } else {
        setError(apiErrorText(err, "The order could not be placed. Please try again."));
      }
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="pt-16">
      <div className="border-b border-border bg-secondary">
        <div className="mx-auto max-w-screen-xl px-6 py-14 lg:px-10">
          <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.28em] text-muted-foreground">
            Gift Shop
          </p>
          <h1 className="font-display text-4xl font-medium md:text-5xl">Checkout</h1>
          <p className="mt-3 font-sans text-sm font-light text-muted-foreground">
            Signed in as {user?.name} · {user?.email}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mx-auto grid max-w-screen-xl gap-12 px-6 py-14 lg:grid-cols-[3fr_2fr] lg:px-10">
        <div>
          <h2 className="mb-5 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
            Delivery address
          </h2>
          {error && (
            <p className="mb-6 border border-destructive/40 bg-destructive/5 px-4 py-3 font-sans text-sm text-destructive">
              {error}
            </p>
          )}
          {addresses === null ? (
            <p className="font-mono text-[0.63rem] uppercase tracking-widest text-muted-foreground">Loading addresses…</p>
          ) : (
            <div className="space-y-3">
              {addresses.map((a) => (
                <label
                  key={a.id}
                  className={`flex cursor-pointer gap-4 border p-5 transition-colors ${
                    selected === a.id ? "border-accent bg-secondary/60" : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={selected === a.id}
                    onChange={() => setSelected(a.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#B08D46]"
                  />
                  <span className="font-sans text-sm leading-relaxed">
                    <span className="font-display text-base font-medium">{a.recipientName}</span>
                    {a.isDefault && (
                      <span className="ml-2 font-mono text-[0.58rem] uppercase tracking-widest text-accent">Default</span>
                    )}
                    <br />
                    {a.addressLine}, {a.city}
                    {a.district ? `, ${a.district}` : ""}
                    {a.postalCode ? ` ${a.postalCode}` : ""}
                    <br />
                    <span className="text-muted-foreground">{a.phone}</span>
                  </span>
                </label>
              ))}
              <label
                className={`flex cursor-pointer gap-4 border p-5 transition-colors ${
                  selected === "new" ? "border-accent bg-secondary/60" : "border-border hover:border-muted-foreground"
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={selected === "new"}
                  onChange={() => setSelected("new")}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#B08D46]"
                />
                <span className="font-display text-base font-medium">Deliver to a new address</span>
              </label>
            </div>
          )}

          {selected === "new" && (
            <div className="mt-6 grid gap-5 border border-border bg-background p-6 sm:grid-cols-2">
              <div>
                <label className={authLabelCls} htmlFor="co-name">Recipient name</label>
                <input id="co-name" required={selected === "new"} className={authInputCls} value={form.recipientName} onChange={set("recipientName")} placeholder="Who receives the parcel" />
              </div>
              <PhoneField
                id="co-phone"
                label="Phone"
                required={selected === "new"}
                country={phoneCountry}
                onCountryChange={setPhoneCountry}
                value={form.phone}
                onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
              />
              <div className="sm:col-span-2">
                <label className={authLabelCls} htmlFor="co-line">Address line</label>
                <input id="co-line" required={selected === "new"} className={authInputCls} value={form.addressLine} onChange={set("addressLine")} placeholder="Street, ward, landmark" />
              </div>
              <div>
                <label className={authLabelCls} htmlFor="co-city">City</label>
                <input id="co-city" required={selected === "new"} className={authInputCls} value={form.city} onChange={set("city")} placeholder="Kathmandu" />
              </div>
              <div>
                <label className={authLabelCls} htmlFor="co-district">District (optional)</label>
                <input id="co-district" className={authInputCls} value={form.district ?? ""} onChange={set("district")} placeholder="Lalitpur" />
              </div>
              <div>
                <label className={authLabelCls} htmlFor="co-postal">Postal code (optional)</label>
                <input id="co-postal" className={authInputCls} value={form.postalCode ?? ""} onChange={set("postalCode")} placeholder="44700" />
              </div>
              <div>
                <label className={authLabelCls} htmlFor="co-delnotes">Delivery notes (optional)</label>
                <input id="co-delnotes" className={authInputCls} value={form.deliveryNotes ?? ""} onChange={set("deliveryNotes")} placeholder="Call on arrival…" />
              </div>
              <label className="flex items-center gap-2.5 font-sans text-sm font-light text-muted-foreground sm:col-span-2">
                <input type="checkbox" checked={saveNew} onChange={(e) => setSaveNew(e.target.checked)} className="h-4 w-4 accent-[#B08D46]" />
                Save this address to my account
              </label>
            </div>
          )}

          <h2 className="mb-4 mt-12 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
            Order notes (optional)
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            className={`${authInputCls} resize-none`}
            placeholder="Anything the museum should know about this order…"
          />

          <h2 className="mb-4 mt-12 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
            Payment
          </h2>
          <div className="border border-border bg-background p-6">
            <p className="font-display text-base font-medium">Cash on Delivery</p>
            <p className="mt-2 font-sans text-sm font-light leading-relaxed text-muted-foreground">
              Pay in cash when your order arrives. Orders are placed for approval first — the
              museum confirms stock and delivery details before dispatch, and will call you if
              anything needs clarifying. No payment is taken now.
            </p>
          </div>
        </div>

        <div>
          <div className="border border-border bg-background p-7 lg:sticky lg:top-24">
            <h2 className="mb-5 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
              Order summary
            </h2>
            {!cart ? (
              <p className="font-mono text-[0.63rem] uppercase tracking-widest text-muted-foreground">Loading…</p>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {cart.items.map((item) => (
                    <li key={item.id} className="flex gap-4 py-3.5">
                      <div className="h-14 w-11 shrink-0 overflow-hidden bg-muted">
                        {item.image && <img src={item.image.url} alt={item.image.alt} className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-sm font-medium leading-snug">{item.name}</p>
                        <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                          {item.variantName ? `${item.variantName} · ` : ""}×{item.quantity} · {formatRs(item.unitPricePaisa)}
                        </p>
                      </div>
                      <span className="font-sans text-sm">{formatRs(item.lineTotalPaisa)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-5 space-y-2 border-t border-border pt-5 font-sans text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd>{formatRs(subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Shipping</dt>
                    <dd>{shipping === 0 ? "Free" : formatRs(shipping)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Tax{config && config.taxRatePercent > 0 ? ` (${config.taxRatePercent}%)` : ""}
                    </dt>
                    <dd>{tax === 0 ? "—" : formatRs(tax)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-3">
                    <dt className="font-medium">Total on delivery</dt>
                    <dd className="font-display text-xl font-medium text-accent">{formatRs(total)}</dd>
                  </div>
                </dl>
                <button
                  type="submit"
                  disabled={placing || !cart || cart.items.length === 0}
                  className="mt-7 w-full bg-accent py-4 font-sans text-[0.7rem] uppercase tracking-[0.22em] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {placing ? "Placing Order…" : "Place Order — Cash on Delivery"}
                </button>
                <p className="mt-4 text-center font-sans text-xs font-light leading-relaxed text-muted-foreground">
                  Totals are confirmed by the museum's system when the order is placed; the
                  confirmed total appears on your order.
                </p>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
