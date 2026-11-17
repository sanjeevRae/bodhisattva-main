/**
 * TOTP + secret-encryption helpers (DATABASE_DESIGN.md §6.2–§6.3,
 * PHASE0_REVIEW.md amendment A3).
 *
 * - TOTP via otplib (RFC 6238, SHA-1, 6 digits, 30 s step, ±1 step window).
 *   `matchTotpStep` returns the exact time-step a code belongs to, which is
 *   what makes replay protection possible: a step may be consumed only
 *   once, enforced atomically against `mfa_credentials.last_used_counter`.
 * - Secrets at rest are AES-256-GCM ciphertext under TOTP_ENCRYPTION_KEY,
 *   serialised as `v1:<iv>:<tag>:<ciphertext>` (base64 parts) — the `v1`
 *   prefix is the key/format version, so a future key rotation can
 *   introduce `v2` without ambiguity. The serialised string (pure ASCII)
 *   is what the VARBINARY column stores.
 * - Recovery codes: 10 characters from an unambiguous alphabet, displayed
 *   grouped (`XXXXX-XXXXX`), normalised (upper-case, alphanumerics only)
 *   before hashing/verification.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { authenticator } from "otplib";

export const TOTP_ISSUER = "Bodhisattva Museum";
export const TOTP_STEP_SECONDS = 30;

// otplib 12: create() replaces the option set rather than merging, so the
// plugin defaults (key encoder/decoder, digest, RNG) are spread in
// explicitly — but `epoch` must NOT be among them. allOptions() snapshots
// `epoch: Date.now()`, and a stored epoch overrides the fresh per-call
// default forever: the instance would check every code against the
// module-load time-step (± window) and MFA would break ~a minute after
// each server start. Caught by the Phase 2 integration suite (intermittent
// code_mismatch failures growing with process age); fixed by the lead.
const { epoch: _discardedEpoch, ...pluginDefaults } = authenticator.allOptions();
const totp = authenticator.create({
  ...pluginDefaults,
  step: TOTP_STEP_SECONDS,
  window: 1,
  digits: 6,
});

/** Decode TOTP_ENCRYPTION_KEY (64-char hex, or base64) to its 32 bytes. */
export function decodeTotpKey(encoded: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).",
    );
  }
  return key;
}

const FORMAT_VERSION = "v1";

export function encryptTotpSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptTotpSecret(
  stored: Buffer | string,
  key: Buffer,
): string {
  // The varbinary column is typed as string by Drizzle, but mysql2 may hand
  // back a Buffer at runtime — normalise either shape. The serialised form
  // is pure ASCII (base64), so the utf8 round-trip is lossless.
  const serialised = Buffer.isBuffer(stored)
    ? stored.toString("utf8")
    : stored;
  const [version, ivB64, tagB64, ctB64] = serialised.split(":");
  if (version !== FORMAT_VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Unsupported encrypted TOTP secret format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateTotpSecret(): string {
  return totp.generateSecret(20);
}

export function buildOtpAuthUrl(accountEmail: string, secret: string): string {
  return totp.keyuri(accountEmail, TOTP_ISSUER, secret);
}

/** The TOTP time-step (counter) containing `now`. */
export function currentTotpStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Which time-step does `code` belong to? Returns the matched step
 * (current ± 1), or null when the code is not valid in the window.
 * Callers must still consume the step atomically — two concurrent
 * requests can both match here; only one may win the database update.
 */
export function matchTotpStep(
  secret: string,
  code: string,
  now: Date = new Date(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp.checkDelta(code, secret);
  if (delta === null) return null;
  return currentTotpStep(now) + delta;
}

// --- Recovery codes --------------------------------------------------------

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
export const RECOVERY_CODE_COUNT = 10;

function randomCodeChar(): string {
  // Rejection sampling: no modulo bias over the 31-char alphabet.
  for (;;) {
    const byte = randomBytes(1)[0];
    if (byte < 248) return RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  }
}

/** One display-form recovery code, e.g. "K7QX2-9PDMA". */
export function generateRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () => randomCodeChar()).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function generateRecoveryCodes(
  count: number = RECOVERY_CODE_COUNT,
): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

/** Canonical form used for hashing and verification. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
