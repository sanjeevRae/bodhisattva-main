import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCustomer } from "../lib/customer";
import { AuthError, AuthNotice, AuthShell, authButtonCls, authInputCls, authLabelCls, useReturnParam } from "./auth-shared";

/**
 * Customer sign-in. On success, a stashed cart intent (spec §10.3) is
 * completed first — the shopper lands back on the page they were
 * shopping with the item in the cart and the drawer open. Admin
 * accounts stop at the MFA gate and are pointed at the admin sign-in.
 */
export default function LoginPage() {
  const { status, login, completePendingIntent } = useCustomer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = useReturnParam("/account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mfaNotice, setMfaNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "full") navigate(returnTo, { replace: true });
  }, [status, returnTo, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMfaNotice(false);
    const outcome = await login(email.trim(), password);
    setBusy(false);
    if (!outcome.ok) {
      if (outcome.reason === "mfa") setMfaNotice(true);
      else setError(outcome.message);
      return;
    }
    const intentPath = await completePendingIntent();
    navigate(intentPath ?? returnTo, { replace: true });
  };

  return (
    <AuthShell
      eyebrow="Bodhisattva Museum"
      heading="Welcome Back"
      intro="Sign in to shop the Gift Shop, track your orders and manage your delivery addresses."
    >
      {params.get("verified") && (
        <AuthNotice>Your email is verified. Sign in to continue.</AuthNotice>
      )}
      {params.get("reset") && (
        <AuthNotice>Your password has been reset. Sign in with the new password.</AuthNotice>
      )}
      <AuthError error={error} />
      {mfaNotice && (
        <AuthNotice>
          This account requires authenticator sign-in.{" "}
          <Link to="/admin/login" className="text-accent underline underline-offset-2">
            Continue to the admin sign-in
          </Link>
          .
        </AuthNotice>
      )}
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className={authLabelCls} htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            className={authInputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className={authLabelCls} htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            className={authInputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </div>
        <button type="submit" disabled={busy} className={authButtonCls}>
          {busy ? "Signing In…" : "Sign In"}
        </button>
      </form>
      <div className="mt-8 flex items-center justify-between font-sans text-sm font-light text-muted-foreground">
        <Link to={`/forgot-password`} className="transition-colors hover:text-accent">
          Forgot password?
        </Link>
        <Link
          to={`/register?return=${encodeURIComponent(returnTo)}`}
          className="transition-colors hover:text-accent"
        >
          Create an account
        </Link>
      </div>
    </AuthShell>
  );
}
