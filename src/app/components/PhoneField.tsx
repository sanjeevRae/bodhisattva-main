import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { authInputCls, authLabelCls } from "../pages/auth-shared";

/**
 * Phone input with a country selector (owner decision 2026-11-18:
 * phone is required and must be a real number for its country's
 * numbering plan). The country list, dial codes and validity all come
 * from libphonenumber-js metadata + Intl display names — no country
 * data is hardcoded here. The user types a national number and picks
 * its country, or types a full international number ("+…"), which
 * always wins over the selector. The server re-validates and stores
 * the E.164 form; this client check is a friendly pre-check only.
 */

export interface PhoneCountryOption {
  code: CountryCode;
  name: string;
  callingCode: string;
}

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export const PHONE_COUNTRIES: PhoneCountryOption[] = getCountries()
  .map((code) => ({
    code,
    name: regionNames?.of(code) ?? code,
    callingCode: getCountryCallingCode(code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const DEFAULT_PHONE_COUNTRY: CountryCode = "NP";

/** Split a stored E.164 number into selector country + national part for editing. */
export function splitStoredPhone(stored: string): {
  country: CountryCode;
  national: string;
} {
  const parsed = parsePhoneNumberFromString(stored);
  if (parsed?.country) {
    return { country: parsed.country, national: parsed.nationalNumber };
  }
  return { country: DEFAULT_PHONE_COUNTRY, national: stored };
}

/** The request payload for a phone field: international input stands alone. */
export function buildPhonePayload(
  value: string,
  country: CountryCode,
): { phone: string; phoneCountry?: string } {
  const trimmed = value.trim();
  return trimmed.startsWith("+")
    ? { phone: trimmed }
    : { phone: trimmed, phoneCountry: country };
}

/** Friendly pre-check mirroring the server rule (server stays authoritative). */
export function isValidPhoneValue(value: string, country: CountryCode): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("+")
    ? isValidPhoneNumber(trimmed)
    : isValidPhoneNumber(trimmed, country);
}

export function PhoneField({
  id,
  label,
  country,
  onCountryChange,
  value,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className={authLabelCls} htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-accent">
            {" "}
            *
          </span>
        )}
      </label>
      <div className="flex gap-2">
        <select
          id={`${id}-country`}
          aria-label="Country"
          className="w-auto max-w-[10.5rem] shrink-0 border border-border bg-background px-3 py-3.5 font-sans text-sm transition-colors focus:border-accent focus:outline-none"
          value={country}
          onChange={(e) => onCountryChange(e.target.value as CountryCode)}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} (+{c.callingCode})
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          required={required}
          autoComplete="tel-national"
          className={authInputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="98XXXXXXXX"
        />
      </div>
    </div>
  );
}
