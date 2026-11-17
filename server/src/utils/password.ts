/**
 * Password hashing — Argon2id (DATABASE_DESIGN.md §2.11; spec §15.1).
 *
 * The encoded hash string embeds its own parameters, so parameters can be
 * retuned later without invalidating existing hashes: verification always
 * uses the parameters stored in the hash being checked. The same helpers
 * hash MFA recovery codes (PHASE0_REVIEW.md amendment A3: recovery codes
 * are individually Argon2id-hashed).
 *
 * BENCHMARK (provisional — host benchmark pending): parameters were tuned
 * on the development VM (shared vCPU, Node 24) for a 250–500 ms single-hash
 * target, measured 2026-11-17:
 *   m=19456 KiB, t=2, p=1 (OWASP baseline)  -> ~48 ms  (too fast here)
 *   m=65536 KiB, t=3, p=1 (CHOSEN)          -> ~260–370 ms
 *   m=98304 KiB, t=2, p=1                   -> ~265–275 ms
 * The chosen profile is the RFC 9106 first-recommended memory/time profile
 * at p=1 (single-threaded: shared hosting cannot be assumed to offer spare
 * cores). PROVISIONAL: re-benchmark on the cPanel host before production —
 * if the host is slower or memory-capped, lower the parameters here; only
 * newly created hashes are affected.
 */
import argon2 from "argon2";

export const PASSWORD_HASH_PARAMS = {
  memoryCost: 65_536, // KiB (64 MiB)
  timeCost: 3,
  parallelism: 1,
} as const;

/** Hash a password (or recovery code) with Argon2id. Returns the encoded hash. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: PASSWORD_HASH_PARAMS.memoryCost,
    timeCost: PASSWORD_HASH_PARAMS.timeCost,
    parallelism: PASSWORD_HASH_PARAMS.parallelism,
  });
}

/**
 * Verify a candidate against an encoded Argon2id hash, using the parameters
 * embedded in the hash. Returns false (never throws) for a malformed stored
 * hash, so login flows can treat storage corruption as a plain mismatch.
 */
export async function verifyPassword(
  storedHash: string,
  candidate: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, candidate);
  } catch {
    return false;
  }
}
