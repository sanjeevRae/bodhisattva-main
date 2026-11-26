/**
 * extractVerificationCode + the VerifyEmailPage paste button
 * (2026-11-26) — behavioural tests for the pure extractor (the case
 * list from the ChatGPT/Gemini plan reviews) and source guards for
 * the page wiring (type="button", gesture-direct read, no request
 * from the paste path).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractVerificationCode } from "../../src/app/lib/clipboard-code";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("extractVerificationCode", () => {
  it("accepts the plain, grouped and hyphenated forms", () => {
    expect(extractVerificationCode("40303049")).toBe("40303049");
    expect(extractVerificationCode("4030 3049")).toBe("40303049");
    expect(extractVerificationCode("4030-3049")).toBe("40303049");
    expect(extractVerificationCode("  4030 3049 \n")).toBe("40303049");
    expect(extractVerificationCode("[4030 3049]")).toBe("40303049");
  });

  it("extracts from realistic copied text", () => {
    expect(extractVerificationCode("Your verification code is 40303049")).toBe("40303049");
    expect(extractVerificationCode("Your code is 4030 3049")).toBe("40303049");
    expect(
      extractVerificationCode(
        "Welcome to Bodhisattva Museum.\n\nYour email verification code is: 40303049\n\nIt expires in 10 minutes.",
      ),
    ).toBe("40303049");
  });

  it("the contextual code beats the date trap", () => {
    expect(
      extractVerificationCode("Your verification code is 4030 3049. Expires on 2026-11-26."),
    ).toBe("40303049");
  });

  it("rejects wrong lengths, non-codes and ambiguity", () => {
    expect(extractVerificationCode("123456789")).toBeNull(); // 9 digits, one candidate
    expect(extractVerificationCode("123456")).toBeNull();
    expect(extractVerificationCode("No verification code here")).toBeNull();
    expect(extractVerificationCode("")).toBeNull();
    expect(extractVerificationCode("call 9812345678 or 0144223344")).toBeNull();
    // Two unrelated 8-digit values, no code context → no guessing.
    expect(extractVerificationCode("order 12345678 ref 87654321")).toBeNull();
    // Trailing numbers never extend a shorter fragment into a code.
    expect(extractVerificationCode("code 4030 in 10 minutes")).toBeNull();
  });

  it("the word code must be a word — lookalikes do not create context", () => {
    expect(extractVerificationCode("barcode 12345678, order 87654321")).toBeNull();
    expect(extractVerificationCode("postcode 12345678, ref 87654321")).toBeNull();
    expect(extractVerificationCode("decode 12345678, order 87654321")).toBeNull();
    expect(extractVerificationCode("zipcode 12345678, ref 87654321")).toBeNull();
    expect(extractVerificationCode("codeword 12345678, ref 87654321")).toBeNull();
  });

  it("context matching is case-insensitive and punctuation-tolerant", () => {
    expect(
      extractVerificationCode("Your CODE is 4030 3049. Expires on 2026-11-26."),
    ).toBe("40303049");
    expect(extractVerificationCode("Code: 12345678, expires 2026-11-26")).toBe("12345678");
  });

  it("never concatenates digits across separate candidates", () => {
    expect(extractVerificationCode("4030 and then 3049")).toBeNull();
  });

  it("caps the inspected length", () => {
    const padded = `${"x".repeat(2000)} 40303049`;
    expect(extractVerificationCode(padded)).toBeNull();
  });
});

describe("VerifyEmailPage paste button (source guard)", () => {
  const page = readFileSync(path.join(root, "src/app/pages/VerifyEmailPage.tsx"), "utf8");

  it("is a type=button that reads the clipboard from the tap", () => {
    expect(page).toContain('type="button"');
    expect(page).toContain("Paste code");
    expect(page).toContain("navigator.clipboard.readText()");
    expect(page).toContain("window.isSecureContext");
    expect(page).toContain("extractVerificationCode");
    expect(page).toContain('aria-live="polite"');
  });

  it("the paste path adds no network call (fill-only, never submits)", () => {
    // submit + resend are the only two shopRequest calls in the file.
    expect(page.match(/shopRequest\(/g)).toHaveLength(2);
    const handler = page.slice(page.indexOf("pasteFromClipboard"));
    expect(handler.slice(0, handler.indexOf("};"))).not.toContain("shopRequest");
  });
});
