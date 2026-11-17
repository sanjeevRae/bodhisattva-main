import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { shopRequest } from "../lib/shop";
import { apiErrorText, AuthError, AuthNotice, AuthShell, authButtonCls, authInputCls, authLabelCls } from "./auth-shared";

/**
 * Forgot password — the response is deliberately generic (the server
 * answers identically whether or not the account exists).
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await shopRequest("/api/auth/password-reset/request", {
        method: "POST",
        body: { email: email.trim() },
      });
    } catch {
      // Even a transport failure shows the same screen — the address may
      // still receive a link, and the wording must not leak account data.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <AuthShell
      eyebrow="Bodhisattva Museum"
      heading="Forgot Password"
      intro="Enter your account email and we will send you a link to set a new password."
    >
      {sent ? (
        <>
          <AuthNotice>
            If an account exists for that email, a password-reset link is on its way. The link
            expires in one hour.
          </AuthNotice>
          <p className="text-center font-sans text-sm font-light text-muted-foreground">
            <Link to="/login" className="text-accent transition-colors hover:underline">
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className={authLabelCls} htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              className={authInputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button type="submit" disabled={busy} className={authButtonCls}>
            {busy ? "Sending…" : "Send Reset Link"}
          </button>
          <p className="text-center font-sans text-sm font-light text-muted-foreground">
            <Link to="/login" className="transition-colors hover:text-accent">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * Reset password — the token arrives in the emailed link's ?token=
 * parameter and is single-use; a successful reset revokes all sessions.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shopRequest("/api/auth/password-reset/confirm", {
        method: "POST",
        body: { token, newPassword: password },
      });
      navigate("/login?reset=1", { replace: true });
    } catch (err) {
      setError(apiErrorText(err, "That reset link is no longer valid. Please request a new one."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Bodhisattva Museum"
      heading="Set a New Password"
      intro="Choose a new password for your account. All existing sessions will be signed out."
    >
      {!token ? (
        <>
          <AuthError error="This page needs the token from your reset email." />
          <p className="text-center font-sans text-sm font-light text-muted-foreground">
            <Link to="/forgot-password" className="text-accent transition-colors hover:underline">
              Request a new reset link
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <AuthError error={error} />
          <div>
            <label className={authLabelCls} htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className={authInputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 10 characters"
            />
          </div>
          <div>
            <label className={authLabelCls} htmlFor="reset-confirm">Confirm new password</label>
            <input
              id="reset-confirm"
              type="password"
              required
              autoComplete="new-password"
              className={authInputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat the new password"
            />
          </div>
          <button type="submit" disabled={busy} className={authButtonCls}>
            {busy ? "Saving…" : "Set New Password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
