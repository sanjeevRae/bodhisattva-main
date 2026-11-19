import type { ReactNode } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate } from "react-router";
import { useCustomer } from "../lib/customer";

/**
 * Account area chrome (Phase 6) — the site's design language: a quiet
 * header band with the customer's name and a mono sub-nav. All account
 * routes require a full session; anything less is sent to sign-in with
 * the current path preserved as the return target.
 */
export default function AccountLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { status, user, logout } = useCustomer();
  const location = useLocation();
  const navigate = useNavigate();

  if (status === "anonymous") {
    return <Navigate to={`/login?return=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (status !== "full" || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center pt-16">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const tabCls = ({ isActive }: { isActive: boolean }) =>
    `font-mono text-[0.63rem] tracking-[0.2em] uppercase px-5 py-3.5 border-b-2 transition-colors ${
      isActive
        ? "border-accent text-accent"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="pt-16">
      <div className="border-b border-border bg-secondary">
        <div className="mx-auto max-w-screen-xl px-6 py-14 lg:px-10">
          <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.28em] text-muted-foreground">
            My Account
          </p>
          <h1 className="font-display text-4xl font-medium md:text-5xl">{title}</h1>
          <p className="mt-3 font-sans text-sm font-light text-muted-foreground">
            {user.name} · {user.email}
          </p>
        </div>
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 lg:px-10">
          <nav className="flex">
            <NavLink to="/account" end className={tabCls}>
              Profile
            </NavLink>
            <NavLink to="/account/orders" className={tabCls}>
              Orders
            </NavLink>
            <NavLink to="/account/addresses" className={tabCls}>
              Addresses
            </NavLink>
          </nav>
          <button
            onClick={() => {
              void logout().then(() => navigate("/"));
            }}
            className="font-mono text-[0.63rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign Out
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-screen-xl px-6 py-14 lg:px-10">{children}</div>
      <div className="mx-auto max-w-screen-xl px-6 pb-16 lg:px-10">
        <Link
          to="/shop"
          className="font-mono text-[0.63rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-accent"
        >
          ← Continue to the Gift Shop
        </Link>
      </div>
    </div>
  );
}
