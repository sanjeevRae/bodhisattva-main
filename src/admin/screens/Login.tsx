/**
 * Login + MFA gates.
 *
 * One screen, three states driven by the auth context:
 *  - anonymous: email + password (POST /api/auth/login)
 *  - mfa_pending: 6-digit TOTP (POST /api/auth/mfa/verify) or a recovery
 *    code (POST /api/auth/mfa/recover)
 *  - enrolment_required: POST /api/auth/mfa/enrol shows the secret once;
 *    POST /api/auth/mfa/confirm activates it and returns the one-time
 *    recovery codes, which the admin must acknowledge before continuing.
 *
 * Enrolment renders the otpauth URL as a QR code (qrcode package) for
 * one-scan setup, with the secret kept as copyable text for manual entry
 * — and as the fallback if QR rendering ever fails.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { ApiError, authApi } from "../api";
import { useAuth } from "../AdminApp";
import { Btn, ErrorBox, Field, Notice, inputCls } from "../ui";

export default function LoginScreen() {
  const { status, user } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="font-display text-3xl tracking-wide">Bodhisattva</p>
          <p className="font-mono text-[0.62rem] tracking-[0.24em] uppercase text-muted-foreground">
            Museum Admin
          </p>
        </div>
        <div className="rounded-sm border border-border bg-card p-6 shadow-sm">
          {status === "mfa_pending" ? (
            <MfaVerify email={user?.email} />
          ) : status === "enrolment_required" ? (
            <MfaEnrol email={user?.email} />
          ) : (
            <CredentialsForm />
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Authorised staff only. Sign-ins are logged.
        </p>
      </div>
    </div>
  );
}

function CredentialsForm() {
  const { applyLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.login(email.trim(), password);
      applyLogin(
        { id: result.user.id, name: result.user.name, email: result.user.email, roles: result.user.roles },
        result.authLevel,
      );
      if (result.authLevel === "full") navigate("/admin");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="font-display text-xl tracking-wide">Sign in</h1>
      <ErrorBox error={error} />
      <Field label="Email">
        <input
          className={inputCls}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <Field label="Password">
        <input
          className={inputCls}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <p className="-mt-2 text-right text-xs">
        {/* The recovery flow lives in the public app; a plain anchor
            (full-page navigation) is the correct route to it. The
            flow itself is role-agnostic and never bypasses MFA: a
            reset admin still completes TOTP at the next login. */}
        <a href="/forgot-password" className="text-muted-foreground transition-colors hover:text-accent">
          Forgot password?
        </a>
      </p>
      <Btn type="submit" variant="accent" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Btn>
    </form>
  );
}

function MfaVerify({ email }: { email?: string }) {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (useRecovery) await authApi.mfaRecover(recovery.trim());
      else await authApi.mfaVerify(code.trim());
      await refresh();
      navigate("/admin");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="flex items-center gap-2 font-display text-xl tracking-wide">
        <ShieldCheck size={20} /> Two-factor authentication
      </h1>
      <p className="text-sm text-muted-foreground">
        {email ? <>Signed in as {email}. </> : null}
        {useRecovery
          ? "Enter one of your recovery codes. Each code works once, and using one is flagged for administrator review."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      <ErrorBox error={error} />
      {useRecovery ? (
        <Field label="Recovery code">
          <input
            className={inputCls}
            type="text"
            autoComplete="one-time-code"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
            required
            autoFocus
          />
        </Field>
      ) : (
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
      )}
      <Btn type="submit" variant="accent" className="w-full" disabled={busy}>
        {busy ? "Verifying…" : "Verify"}
      </Btn>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-accent underline-offset-4 hover:underline" onClick={() => setUseRecovery((v) => !v)}>
          {useRecovery ? "Use authenticator code instead" : "Use a recovery code"}
        </button>
        <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </form>
  );
}

function MfaEnrol({ email }: { email?: string }) {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const enrolStarted = useRef(false);

  useEffect(() => {
    if (enrolStarted.current) return;
    enrolStarted.current = true;
    authApi
      .mfaEnrol()
      .then((result) => {
        setSecret(result.secret);
        setOtpauthUrl(result.otpauthUrl);
      })
      .catch((err) => setError(err));
  }, []);

  // QR rendering is best-effort: any failure leaves the text secret as
  // the (fully sufficient) manual-entry path.
  useEffect(() => {
    if (!otpauthUrl) return;
    let cancelled = false;
    QRCode.toDataURL(otpauthUrl, { width: 200, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions) — the secret is selectable text.
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.mfaConfirm(code.trim());
      setRecoveryCodes(result.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Confirmation failed."));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await refresh();
    navigate("/admin");
  };

  if (recoveryCodes) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 font-display text-xl tracking-wide">
          <KeyRound size={20} /> Save your recovery codes
        </h1>
        <Notice tone="warn">
          Two-factor authentication is now enabled. These recovery codes are shown <strong>only once</strong> — store
          them somewhere safe. Each code can be used once if you lose your authenticator.
        </Notice>
        <ul className="grid grid-cols-2 gap-2 rounded-sm border border-border bg-background p-4 font-mono text-sm" aria-label="Recovery codes">
          {recoveryCodes.map((code) => (
            <li key={code} className="text-center tracking-widest">
              {code}
            </li>
          ))}
        </ul>
        <Btn variant="accent" className="w-full" onClick={() => void finish()}>
          I have saved my recovery codes — continue
        </Btn>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4">
      <h1 className="flex items-center gap-2 font-display text-xl tracking-wide">
        <ShieldCheck size={20} /> Set up two-factor authentication
      </h1>
      <p className="text-sm text-muted-foreground">
        {email ? <>Welcome, {email}. </> : null}
        Administrator accounts must use an authenticator app. Scan the QR code with your app — or add the secret
        manually — then enter the 6-digit code it shows to confirm.
      </p>
      <ErrorBox error={error} />
      {qrDataUrl && (
        <div className="flex flex-col items-center gap-1.5">
          <img
            src={qrDataUrl}
            alt="QR code for authenticator setup"
            width={200}
            height={200}
            className="rounded-sm border border-border bg-white p-1"
          />
          <p className="text-xs text-muted-foreground">Scan with your authenticator app</p>
        </div>
      )}
      <Field label="Secret key (shown once)">
        <div className="flex gap-2">
          <input className={inputCls} type="text" readOnly value={secret ?? "Generating…"} aria-label="TOTP secret" onFocus={(e) => e.target.select()} />
          <Btn type="button" size="md" onClick={() => void copySecret()} disabled={!secret} aria-label="Copy secret">
            <Copy size={15} /> {copied ? "Copied" : "Copy"}
          </Btn>
        </div>
      </Field>
      {otpauthUrl && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">otpauth URL (for apps that accept one)</summary>
          <p className="mt-1 break-all rounded-sm bg-background p-2 font-mono">{otpauthUrl}</p>
        </details>
      )}
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
        />
      </Field>
      <Btn type="submit" variant="accent" className="w-full" disabled={busy || !secret}>
        {busy ? "Confirming…" : "Confirm and enable"}
      </Btn>
      <div className="text-right text-sm">
        <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </form>
  );
}
