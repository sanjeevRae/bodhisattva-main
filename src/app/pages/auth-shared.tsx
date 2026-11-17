import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ShopApiError } from "../lib/shop";

/**
 * Shared chrome for the customer auth/account pages (Phase 6) — styled
 * with the public site's design system (cream ground, serif display
 * headings, mono micro-labels, gold accent), NOT the admin UI.
 */

export const authInputCls =
  "w-full bg-background border border-border px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent placeholder:text-muted-foreground transition-colors";

export const authLabelCls =
  "block font-mono text-[0.55rem] tracking-[0.2em] uppercase text-muted-foreground mb-2";

export const authButtonCls =
  "w-full bg-accent text-accent-foreground py-3.5 text-[0.62rem] tracking-[0.2em] uppercase font-sans hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed";

export function AuthShell({
  eyebrow,
  heading,
  intro,
  children,
}: {
  eyebrow: string;
  heading: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="pt-16">
      <div className="mx-auto max-w-md px-6 py-20">
        <p className="mb-3 text-center font-mono text-[0.55rem] uppercase tracking-[0.28em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mb-4 text-center font-display text-4xl font-medium">{heading}</h1>
        {intro && (
          <p className="mb-10 text-center font-sans text-sm font-light leading-relaxed text-muted-foreground">
            {intro}
          </p>
        )}
        {!intro && <div className="mb-6" />}
        {children}
      </div>
    </div>
  );
}

export function AuthError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mb-5 border border-destructive/40 bg-destructive/5 px-4 py-3 text-center font-sans text-sm text-destructive">
      {error}
    </p>
  );
}

export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 border border-accent/40 bg-secondary px-4 py-3 text-center font-sans text-sm text-foreground">
      {children}
    </p>
  );
}

/** Readable message from a shop/auth API failure (server message + field details). */
export function apiErrorText(err: unknown, fallback: string): string {
  if (err instanceof ShopApiError) {
    return err.details.length > 0 ? `${err.message} (${err.detailText})` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

/** The ?return= target, restricted to local paths. */
export function useReturnParam(fallback = "/account"): string {
  const [params] = useSearchParams();
  const raw = params.get("return");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}
