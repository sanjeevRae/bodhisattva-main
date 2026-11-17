/**
 * Opaque one-time tokens — password-reset links, invitation links and any
 * future emailed secret (DATABASE_DESIGN.md §2.11, §4.4, §6.1).
 *
 * Pattern: the raw token is shown exactly once (in the email/link); only its
 * SHA-256 hex digest is stored (`token_hash CHAR(64)`). Tokens are 256-bit
 * by default, so a plain SHA-256 digest is sufficient — the preimage space
 * is far too large to brute-force, unlike low-entropy OTP codes (see
 * utils/otp.ts, which therefore uses a keyed HMAC instead).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface GeneratedToken {
  /** base64url-encoded raw token. Show once; never store or log it. */
  raw: string;
  /** SHA-256 hex of `raw` — the value persisted in the database. */
  hash: string;
}

/** Generate a fresh token: `byteLength` random bytes (default 32 = 256-bit). */
export function generateToken(byteLength = 32): GeneratedToken {
  const raw = randomBytes(byteLength).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

/** SHA-256 hex digest of a raw token, for lookup by the stored hash. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time string comparison (for digests/HMACs). Returns false on
 * length mismatch — digest lengths are not secret, so the early exit leaks
 * nothing useful; equal-length inputs are compared with timingSafeEqual.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
