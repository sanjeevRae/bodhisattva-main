import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CountryCode } from "libphonenumber-js/min";
import { shopRequest } from "../lib/shop";
import {
  buildPhonePayload,
  DEFAULT_PHONE_COUNTRY,
  isValidPhoneValue,
  PhoneField,
} from "../components/PhoneField";
import { apiErrorText, AuthError, AuthShell, authButtonCls, authInputCls, authLabelCls, useReturnParam } from "./auth-shared";

/**
 * Customer registration — creates a PENDING_VERIFICATION account and
 * emails an 8-digit code; the verify page completes the flow. Any cart
 * intent stashed in sessionStorage survives registration + verification
 * and completes after the first sign-in. A phone number is required
 * (owner decision 2026-11-18): the country selector + national number
 * (or a full "+…" international number) is pre-checked here with the
 * same numbering-plan metadata the server enforces, and the server
 * stores the E.164 form.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const returnTo = useReturnParam("/account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidPhoneValue(phone, phoneCountry)) {
      setError("Enter a valid phone number, including the country code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        password,
        ...buildPhonePayload(phone, phoneCountry),
      };
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
        <PhoneField
          id="reg-phone"
          label="Phone"
          required
          country={phoneCountry}
          onCountryChange={setPhoneCountry}
          value={phone}
          onChange={setPhone}
        />
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
