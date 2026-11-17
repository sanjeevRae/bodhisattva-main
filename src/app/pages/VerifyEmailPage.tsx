import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { shopRequest } from "../lib/shop";
import { apiErrorText, AuthError, AuthNotice, AuthShell, authButtonCls, authInputCls, authLabelCls, useReturnParam } from "./auth-shared";

/**
 * Email verification — the 8-digit code from the registration email.
 * Verification does not create a session; on success the shopper is
 * sent to sign in (where any stashed cart intent completes).
 */
export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = useReturnParam("/account");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await shopRequest("/api/auth/verify-email", {
        method: "POST",
        body: { email: email.trim(), code: code.trim() },
      });
      navigate(`/login?verified=1&return=${encodeURIComponent(returnTo)}`, { replace: true });
    } catch (err) {
      setError(apiErrorText(err, "That code did not work. Please check it and try again."));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    try {
      await shopRequest("/api/auth/resend-verification", {
        method: "POST",
        body: { email: email.trim() },
      });
      setNotice("A new code is on its way to your email.");
      setResendIn(60);
    } catch (err) {
      setError(apiErrorText(err, "Could not resend the code. Please try again shortly."));
    }
  };

  return (
    <AuthShell
      eyebrow="Bodhisattva Museum"
      heading="Verify Your Email"
      intro="Enter the 8-digit code we emailed you. It expires shortly and can be used only once."
    >
      <AuthError error={error} />
      {notice && <AuthNotice>{notice}</AuthNotice>}
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className={authLabelCls} htmlFor="verify-email">Email</label>
          <input
            id="verify-email"
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
          <label className={authLabelCls} htmlFor="verify-code">Verification code</label>
          <input
            id="verify-code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{8}"
            maxLength={8}
            className={`${authInputCls} text-center font-mono text-lg tracking-[0.5em]`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="········"
          />
        </div>
        <button type="submit" disabled={busy || code.length !== 8} className={authButtonCls}>
          {busy ? "Verifying…" : "Verify Email"}
        </button>
      </form>
      <div className="mt-8 flex items-center justify-between font-sans text-sm font-light text-muted-foreground">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resendIn > 0 || !email.trim()}
          className="transition-colors hover:text-accent disabled:opacity-50"
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </button>
        <Link to={`/login?return=${encodeURIComponent(returnTo)}`} className="transition-colors hover:text-accent">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
