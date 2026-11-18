/**
 * Phone number validation + normalisation (owner decision 2026-11-18).
 *
 * A phone number is REQUIRED at customer signup and on delivery
 * addresses, and it must be a real number under the destination
 * country's numbering plan — customers may live in any country, so NO
 * country lists, dial codes, lengths or national patterns are hardcoded
 * anywhere in this codebase: all numbering-plan knowledge comes from
 * the libphonenumber-js metadata (Google's libphonenumber data).
 *
 * Storage form is always E.164 (e.g. "+9779812345678"). Input may be
 * given either in international form (leading "+") or as a national
 * number together with its ISO 3166-1 alpha-2 country code.
 *
 * The users.phone column stays nullable: this requirement binds NEW
 * signups (and re-registration refreshes of still-unverified accounts).
 * Accounts created before the requirement are never retroactively
 * blocked — in particular, login never demands a phone.
 */
import { AppError } from "@bodhisattva/shared/errors";
// The server validates with the /max build: it carries the precise
// per-country digit patterns, while the /min build's isValid()
// degrades toward a length-only check. An empirical differential test
// (PHONE_REVIEW.md) compared 3,907 numbers across 52 countries and
// found 361 verdict divergences — every one a number /min accepts and
// /max rejects as not real under its plan (including Nepali numbers
// in unallocated 99…/93… ranges). The frontend pre-check keeps /min
// for bundle size; the divergence is one-directional (the client
// never rejects a number this server would accept) and the server
// verdict is authoritative.
import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import { z } from "zod";

export const PHONE_FIELD_ISSUE =
  "Enter a valid phone number, including the country code.";

/** Zod field for a raw phone input (shape only; the plan check is normalizePhone). */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .max(32);

/** Zod field for the optional ISO country code accompanying a national number. */
export const phoneCountrySchema = z.string().trim().length(2).optional();

function asCountryCode(value: string | undefined): CountryCode | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  return (getCountries() as string[]).includes(upper)
    ? (upper as CountryCode)
    : undefined;
}

/**
 * Input-shape guard, applied BEFORE the library parser. The parser is
 * deliberately liberal — it can extract a number from surrounding text
 * and would silently drop an extension — so anything that is not
 * purely a phone number is rejected up front with the same field
 * error: only digits, spaces, parentheses, hyphens and dots, plus a
 * single leading "+". Extensions are rejected, never silently
 * stripped: dropping one could misdirect contact and hides bad input
 * (PHONE_REVIEW.md). The length cap mirrors phoneSchema.max(32) so
 * the util is safe even for callers that skip the schema.
 */
const PHONE_INPUT_SHAPE = /^\+?[0-9\s().-]+$/;
const MAX_PHONE_INPUT_LENGTH = 32;

function phoneError(): AppError {
  return AppError.validation([{ field: "phone", issue: PHONE_FIELD_ISSUE }]);
}

/**
 * Validate `raw` against the real numbering plan and return its E.164
 * form. A leading "+" marks international form (any supplied country is
 * ignored); otherwise `country` must name a valid ISO country code to
 * interpret the national number. Throws AppError VALIDATION_FAILED with
 * a `phone` field detail on every failure — not purely a phone number
 * (see the shape guard), unparseable, not a real number for the plan,
 * or national form without a usable country.
 */
export function normalizePhone(raw: string, country?: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length > MAX_PHONE_INPUT_LENGTH ||
    !PHONE_INPUT_SHAPE.test(trimmed) ||
    !/[0-9]/.test(trimmed)
  ) {
    throw phoneError();
  }
  const parsed = trimmed.startsWith("+")
    ? parsePhoneNumberFromString(trimmed)
    : (() => {
        const code = asCountryCode(country);
        return code
          ? parsePhoneNumberFromString(trimmed, code)
          : undefined;
      })();
  if (!parsed || !parsed.isValid()) {
    throw phoneError();
  }
  return parsed.format("E.164");
}
