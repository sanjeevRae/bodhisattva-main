/**
 * TOTP helper tests: key decoding, AES-256-GCM roundtrip, step matching
 * (the basis of replay protection, amendment A3) and recovery-code shape.
 */
import { authenticator } from "otplib";
import { describe, expect, it } from "vitest";
import {
  currentTotpStep,
  decodeTotpKey,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  matchTotpStep,
  normalizeRecoveryCode,
} from "../src/modules/mfa/totp.js";
import { testConfig } from "./helpers.js";

const key = decodeTotpKey(testConfig().secrets.totpEncryptionKey);

describe("decodeTotpKey", () => {
  it("accepts a 64-char hex key as 32 bytes", () => {
    expect(key.length).toBe(32);
  });

  it("rejects keys that do not decode to 32 bytes", () => {
    expect(() => decodeTotpKey("abcd")).toThrow(/32 bytes/);
  });
});

describe("encrypt/decrypt roundtrip", () => {
  it("recovers the secret and uses the v1: format", () => {
    const secret = generateTotpSecret();
    const stored = encryptTotpSecret(secret, key);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptTotpSecret(stored, key)).toBe(secret);
  });

  it("produces different ciphertext for the same secret (random IV)", () => {
    const secret = generateTotpSecret();
    const a = encryptTotpSecret(secret, key);
    const b = encryptTotpSecret(secret, key);
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with the wrong key (GCM auth tag)", () => {
    const stored = encryptTotpSecret(generateTotpSecret(), key);
    const wrong = decodeTotpKey(
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    );
    expect(() => decryptTotpSecret(stored, wrong)).toThrow();
  });
});

describe("matchTotpStep", () => {
  it("matches a freshly generated code to the current step (±1)", () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    const step = matchTotpStep(secret, code);
    expect(step).not.toBeNull();
    expect(Math.abs((step as number) - currentTotpStep())).toBeLessThanOrEqual(1);
  });

  it("rejects a wrong code and malformed input", () => {
    const secret = generateTotpSecret();
    const good = authenticator.generate(secret);
    const wrong = good === "000000" ? "111111" : "000000";
    expect(matchTotpStep(secret, wrong)).toBeNull();
    expect(matchTotpStep(secret, "12345")).toBeNull();
    expect(matchTotpStep(secret, "abcdef")).toBeNull();
  });
});

describe("recovery codes", () => {
  it("generates 10 grouped codes from the unambiguous alphabet", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/);
    }
  });

  it("normalises case and strips separators for verification", () => {
    expect(normalizeRecoveryCode("k7qx2-9pdma")).toBe("K7QX29PDMA");
    expect(normalizeRecoveryCode(" K7QX2 9PDMA ")).toBe("K7QX29PDMA");
  });
});
