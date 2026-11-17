/**
 * Admin UI primitives — thin, theme-token based controls (the site's
 * Tailwind v4 tokens: background/card/secondary/muted/accent/border), so
 * the admin reads as part of the same product as the public site.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ShieldCheck, X } from "lucide-react";
import { ApiError, authApi } from "./api";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const inputCls =
  "w-full rounded-sm border border-border bg-input-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export const labelCls =
  "block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground mb-1.5";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Btn({ variant = "outline", size = "md", className, ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-sm font-sans font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const variants: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    accent: "bg-accent text-accent-foreground hover:opacity-90",
    outline: "border border-border bg-background text-foreground hover:bg-secondary",
    ghost: "text-foreground hover:bg-secondary",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 text-sm",
    icon: "h-8 w-8 text-sm",
  };
  return <button className={cx(base, variants[variant], sizes[size], className)} {...rest} />;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.detailText
        ? `${error.message} (${error.detailText})`
        : error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div role="alert" className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

export function Notice({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "warn" }) {
  if (!children) return null;
  return (
    <div
      role="status"
      className={cx(
        "rounded-sm border px-3 py-2 text-sm",
        tone === "ok"
          ? "border-accent/40 bg-accent/10 text-foreground"
          : "border-amber-600/40 bg-amber-500/10 text-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent" aria-hidden />
      {label}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("w-full rounded-sm border border-border bg-background shadow-xl", wide ? "max-w-5xl" : "max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-lg tracking-wide text-foreground">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-foreground">{body}</div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant={danger ? "danger" : "accent"} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? "Working…" : confirmLabel}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/**
 * StepUpModal — in-place MFA re-verification for step-up-gated actions
 * (Phase 4 review fix). When a sensitive action is refused because the
 * session's last MFA verification is older than the step-up window, the
 * screen opens this modal instead of sending the admin back to sign in:
 * a fresh TOTP code re-stamps the session server-side, then `onVerified`
 * retries the original action once.
 */
export function StepUpModal({
  open,
  onCancel,
  onVerified,
}: {
  open: boolean;
  onCancel: () => void;
  onVerified: () => void | Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
    }
  }, [open ]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.stepUp(code.trim());
      await onVerified();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="Confirm it's you">
      <form onSubmit={submit} className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck size={18} className="mt-0.5 shrink-0" />
          This action needs a fresh two-factor check — your last verification
          was a while ago. Enter the 6-digit code from your authenticator app;
          there is no need to sign out.
        </p>
        <ErrorBox error={error} />
        <Field label="Authenticator code">
          <input
            className={inputCls}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-accent" : "bg-switch-background",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
          checked ? "left-[1.125rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "dark" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.14em] uppercase",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "accent" && "bg-accent text-accent-foreground",
        tone === "dark" && "bg-primary text-primary-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
