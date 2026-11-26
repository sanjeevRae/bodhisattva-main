import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ShopApiError, shopRequest } from "../lib/shop";
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

const INVITE_TOKEN_KEY = "bi-invite-token";

/**
 * Accept invitation — the emailed admin-invitation link lands here
 * ({APP_URL}/accept-invitation?token=...). Until this page existed the
 * router's catch-all bounced invitees to the homepage.
 *
 * The token is a single-use bearer credential, so it does not stay in
 * the address bar: on arrival it moves into sessionStorage (this tab
 * only) and the URL is replaced with the bare path. A same-tab reload
 * recovers it from sessionStorage. It is cleared once the server
 * accepts it or definitively rejects it (any HTTP error answer), and
 * kept only across transport failures so a reload can retry. The
 * accept API creates the account WITHOUT a session — the new admin
 * then signs in at /admin and enrols in two-factor authentication.
 */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState<string>(() => {
    const fromUrl = params.get("token") ?? "";
    try {
      if (fromUrl) {
        sessionStorage.setItem(INVITE_TOKEN_KEY, fromUrl);
        return fromUrl;
      }
      return sessionStorage.getItem(INVITE_TOKEN_KEY) ?? "";
    } catch {
      return fromUrl;
    }
  });
  useEffect(() => {
    if (params.get("token")) navigate("/accept-invitation", { replace: true });
  }, [navigate, params]);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const clearStoredToken = () => {
    try {
      sessionStorage.removeItem(INVITE_TOKEN_KEY);
    } catch {
      // Storage unavailable — nothing to clear.
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (password.length < 12) {
      setError("Your password must be at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shopRequest("/api/auth/invitations/accept", {
        method: "POST",
        body: { token, name: trimmedName, password },
      });
      clearStoredToken();
      setDone(true);
    } catch (err) {
      if (err instanceof ShopApiError) clearStoredToken();
      setError(
        apiErrorText(
          err,
          "That invitation link is no longer valid. Please ask your administrator for a new invitation.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Bodhisattva Museum"
      heading="Accept Your Invitation"
      intro="Create your administrator account. After creating it, sign in to the admin area and set up two-factor authentication."
    >
      {done ? (
        <>
          <AuthNotice>
            Account created successfully. Sign in to the admin area using your new credentials,
            then complete two-factor authentication setup.
          </AuthNotice>
          <Link to="/admin" className={`${authButtonCls} block text-center`}>
            Go to Admin Sign In
          </Link>
        </>
      ) : !token ? (
        <>
          <AuthError error="This page needs the token from your invitation email." />
          <p className="text-center font-sans text-sm font-light text-muted-foreground">
            Ask your administrator to send a new invitation.
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <AuthError error={error} />
          <div>
            <label className={authLabelCls} htmlFor="invite-name">Full name</label>
            <input
              id="invite-name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              className={authInputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
            />
          </div>
          <div>
            <label className={authLabelCls} htmlFor="invite-password">Password</label>
            <input
              id="invite-password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className={authInputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
            />
          </div>
          <div>
            <label className={authLabelCls} htmlFor="invite-confirm">Confirm password</label>
            <input
              id="invite-confirm"
              type="password"
              required
              autoComplete="new-password"
              className={authInputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat the password"
            />
          </div>
          <button type="submit" disabled={busy} className={authButtonCls}>
            {busy ? "Creating…" : "Create Account"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
