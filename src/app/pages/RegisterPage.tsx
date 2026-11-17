import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { shopRequest } from "../lib/shop";
import { apiErrorText, AuthError, AuthShell, authButtonCls, authInputCls, authLabelCls, useReturnParam } from "./auth-shared";

/**
 * Customer registration — creates a PENDING_VERIFICATION account and
 * emails an 8-digit code; the verify page completes the flow. Any cart
 * intent stashed in sessionStorage survives registration + verification
 * and completes after the first sign-in.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const returnTo = useReturnParam("/account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim(), email: email.trim(), password };
      if (phone.trim()) body.phone = phone.trim();
      await shopRequest("/api/auth/register", { method: "POST", body });
      navigate(
        `/verify-email?email=${encodeURIComponent(email.trim())}&return=${encodeURIComponent(returnTo)}`,
      );
    } catch (err) {
      setError(apiErrorText(err, "Registration failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Bodhisattva Museum"
      heading="Create an Account"
      intro="Register to shop the Gift Shop and check out with cash on delivery. We will email you a short code to verify your address."
    >
      <AuthError error={error} />
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className={authLabelCls} htmlFor="reg-name">Full name</label>
          <input
            id="reg-name"
            required
            autoComplete="name"
            className={authInputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>
        <div>
          <label className={authLabelCls} htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
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
          <label className={authLabelCls} htmlFor="reg-phone">Phone (optional)</label>
          <input
            id="reg-phone"
            type="tel"
            autoComplete="tel"
            className={authInputCls}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+977 …"
          />
        </div>
        <div>
          <label className={authLabelCls} htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
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
        <button type="submit" disabled={busy} className={authButtonCls}>
          {busy ? "Creating…" : "Create Account"}
        </button>
      </form>
      <p className="mt-8 text-center font-sans text-sm font-light text-muted-foreground">
        Already registered?{" "}
        <Link to={`/login?return=${encodeURIComponent(returnTo)}`} className="text-accent transition-colors hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
