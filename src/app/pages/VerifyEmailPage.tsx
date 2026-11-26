import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { extractVerificationCode } from "../lib/clipboard-code";
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
  const [canPaste, setCanPaste] = useState(false);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  // Monotonic edit sequence: bumped by every manual edit and every
  // Paste click, so a late clipboard result can only land when
  // NOTHING has happened since its own click — a value snapshot
  // would miss the type-and-revert case (ChatGPT post-review).
  const editSeqRef = useRef(0);

  useEffect(() => {
    setCanPaste(
      window.isSecureContext && typeof navigator.clipboard?.readText === "function",
    );
  }, []);

  /**
   * "Paste code" — the copy button an email cannot contain, on the
   * page where it can exist. readText() is called directly from the
   * tap (the Clipboard API needs the live user gesture). Fill-only:
   * it never submits, so a stale clipboard cannot burn a limited
   * verification attempt. A result that arrives after any manual
   * edit or a newer Paste click is dropped (edit-sequence guard).
   * Clipboard contents are never logged, stored or sent anywhere
   * but this field.
   */
  const pasteFromClipboard = () => {
    const seq = ++editSeqRef.current;
    setPasteHint(null);
    void navigator.clipboard.readText().then(
      (text) => {
        if (editSeqRef.current !== seq) return;
        const found = extractVerificationCode(text ?? "");
        if (found) {
          setPasteHint(null);
          setCode(found);
          codeInputRef.current?.focus();
        } else {
          setPasteHint(
            "No verification code found in the clipboard. You can paste it into the field manually.",
          );
        }
      },
      () => {
        if (editSeqRef.current !== seq) return;
        setPasteHint(
          "Couldn't access the clipboard. Allow paste access in your browser, or paste the code into the field manually.",
        );
      },
    );
  };

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
            ref={codeInputRef}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{8}"
            maxLength={8}
            className={`${authInputCls} text-center font-mono text-lg tracking-[0.5em]`}
            value={code}
            onChange={(e) => {
              editSeqRef.current += 1;
              setPasteHint(null);
              setCode(e.target.value.replace(/\D/g, ""));
            }}
            placeholder="········"
          />
          {canPaste && (
            <div className="mt-2 flex items-start justify-between gap-3">
              <p aria-live="polite" className="font-sans text-xs font-light text-muted-foreground">
                {pasteHint ?? ""}
              </p>
              <button
                type="button"
                onClick={pasteFromClipboard}
                className="shrink-0 font-sans text-sm font-light text-muted-foreground transition-colors hover:text-accent"
              >
                Paste code
              </button>
            </div>
          )}
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
