import { Link } from "react-router";
import { useCustomer } from "../lib/customer";
import AccountLayout from "./AccountLayout";

/**
 * Account home — profile summary plus the two working areas (orders,
 * addresses) and the cart shortcut. Read-only: the API offers no
 * self-service profile edit in Phase 6.
 */
export default function AccountPage() {
  const { user, cartCount, setCartOpen } = useCustomer();

  const cards = [
    {
      title: "My Orders",
      text: "Follow your Gift Shop orders from placement to delivery.",
      to: "/account/orders",
      action: "View orders",
    },
    {
      title: "Delivery Addresses",
      text: "Save the addresses you use most so checkout takes seconds.",
      to: "/account/addresses",
      action: "Manage addresses",
    },
  ];

  return (
    <AccountLayout title="Profile">
      <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 className="mb-4 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
            Account details
          </h2>
          <dl className="space-y-4 border border-border bg-background p-6">
            <div>
              <dt className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">Name</dt>
              <dd className="mt-1 font-display text-lg font-medium">{user?.name}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">Email</dt>
              <dd className="mt-1 font-sans text-sm">{user?.email}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">Cart</dt>
              <dd className="mt-1 font-sans text-sm">
                {cartCount === 0 ? (
                  "Empty"
                ) : (
                  <button onClick={() => setCartOpen(true)} className="text-accent hover:underline">
                    {cartCount} {cartCount === 1 ? "item" : "items"} — review your cart
                  </button>
                )}
              </dd>
            </div>
          </dl>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.to} className="flex flex-col border border-border bg-background p-7">
              <h3 className="mb-2 font-display text-xl font-medium">{card.title}</h3>
              <p className="mb-6 font-sans text-sm font-light leading-relaxed text-muted-foreground">
                {card.text}
              </p>
              <Link
                to={card.to}
                className="mt-auto font-mono text-[0.66rem] uppercase tracking-[0.2em] text-accent transition-colors hover:text-foreground"
              >
                {card.action} →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </AccountLayout>
  );
}
