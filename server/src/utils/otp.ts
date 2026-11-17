/**
 * Email one-time codes (DATABASE_DESIGN.md §4.3, §2.11; spec §7.1).
 *
 * Codes are 8 digits — low entropy — so they are never stored in plaintext
 * or under a plain hash: only an HMAC-SHA-256 keyed by the server OTP secret
 * (`OTP_HMAC_SECRET`, from config) is persisted (`code_hmac CHAR(64)`). The
 * HMAC input binds the code to its purpose and to the account's normalised
 * email — `${purpose}:${emailNormalized}:${code}` — so a code issued for one
 * purpose or address can never verify for another.
 *
 * Expiry, attempt limits, resend cooldown and send caps are policy, read by
 * the calling service from AppConfig.otpPolicy — nothing is hardcoded here.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_CODE_LENGTH = 8;

/** A cryptographically random 8-digit code, zero-padded ("00000000"–"99999999"). */
export function generateOtpCode(): string {
  return randomInt(0, 100_000_000)
    .toString()
    .padStart(OTP_CODE_LENGTH, "0");
}

/** The stored form of a code: HMAC-SHA-256 hex over purpose:email:code. */
export function hashOtp(
  secret: string,
  purpose: string,
  emailNormalized: string,
  code: string,
): string {
  return createHmac("sha256", secret)
    .update(`${purpose}:${emailNormalized}:${code}`, "utf8")
    .digest("hex");
}

/**
 * Verify a submitted code against the stored HMAC in constant time.
 * Attempt counting and expiry are the caller's responsibility (the
 * email_verification_codes row carries attempts/max_attempts/expires_at).
 */
export function verifyOtp(
  secret: string,
  purpose: string,
  emailNormalized: string,
  code: string,
  expectedHmac: string,
): boolean {
  const actual = Buffer.from(
    hashOtp(secret, purpose, emailNormalized, code),
    "utf8",
  );
  const expected = Buffer.from(expectedHmac, "utf8");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
