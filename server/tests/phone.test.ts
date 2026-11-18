/**
 * Phone normalisation tests (owner decision 2026-11-18): signup and
 * delivery phones must be real numbers under their country's numbering
 * plan, stored in E.164. All expectations are verified against the
 * libphonenumber-js metadata itself — nothing country-specific is
 * hardcoded in the implementation, so these cases span several plans.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "@bodhisattva/shared/errors";
import { normalizePhone, PHONE_FIELD_ISSUE } from "../src/utils/phone.js";

function expectPhoneError(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const appErr = err as AppError;
    expect(appErr.code).toBe("VALIDATION_FAILED");
    expect(appErr.details).toEqual([
      { field: "phone", issue: PHONE_FIELD_ISSUE },
    ]);
    return;
  }
  throw new Error("expected normalizePhone to throw");
}

describe("normalizePhone — valid numbers normalise to E.164", () => {
  it("accepts a Nepal mobile in E.164 form unchanged", () => {
    expect(normalizePhone("+9779812345678")).toBe("+9779812345678");
  });

  it("accepts a Nepal mobile in national form with its country", () => {
    expect(normalizePhone("9812345678", "NP")).toBe("+9779812345678");
  });

  it("accepts formatted international input (spaces/dashes)", () => {
    expect(normalizePhone("+977 98-1234-5678")).toBe("+9779812345678");
  });

  it("accepts an India mobile in both forms, same E.164 result", () => {
    expect(normalizePhone("+919876543210")).toBe("+919876543210");
    expect(normalizePhone("9876543210", "IN")).toBe("+919876543210");
  });

  it("accepts a US number in both forms, same E.164 result", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
    expect(normalizePhone("(415) 555-2671", "US")).toBe("+14155552671");
  });

  it("accepts a GB number in both forms, same E.164 result", () => {
    expect(normalizePhone("+442079460958")).toBe("+442079460958");
    expect(normalizePhone("02079460958", "GB")).toBe("+442079460958");
  });

  it("treats a leading + as authoritative over a supplied country", () => {
    expect(normalizePhone("+442079460958", "NP")).toBe("+442079460958");
  });

  it("accepts a lowercase country code", () => {
    expect(normalizePhone("9812345678", "np")).toBe("+9779812345678");
  });

  it("accepts a GB national number with trunk 0 and spaces", () => {
    expect(normalizePhone("020 7946 0018", "GB")).toBe("+442079460018");
    // The same number in international form gives the identical result.
    expect(normalizePhone("+442079460018")).toBe("+442079460018");
  });

  it("accepts a Canadian +1 number (not just US)", () => {
    expect(normalizePhone("+15062345678")).toBe("+15062345678");
    expect(normalizePhone("5062345678", "CA")).toBe("+15062345678");
  });

  it("accepts a Caribbean +1 number (Jamaica, +1 876)", () => {
    expect(normalizePhone("+18762101234")).toBe("+18762101234");
    expect(normalizePhone("8762101234", "JM")).toBe("+18762101234");
  });

  it("accepts a US number submitted with a different phoneCountry", () => {
    // The international prefix takes precedence over the country field.
    expect(normalizePhone("+14155552671", "NP")).toBe("+14155552671");
  });

  it("accepts parenthesised international input and normalises it", () => {
    expect(normalizePhone("+1 (202) 555-0123")).toBe("+12025550123");
  });
});

describe("normalizePhone — invalid input throws a phone field error", () => {
  it("rejects a too-short number", () => {
    expectPhoneError(() => normalizePhone("12345", "NP"));
    expectPhoneError(() => normalizePhone("+977981234567")); // one digit short of a real NP mobile
  });

  it("rejects letters and junk", () => {
    expectPhoneError(() => normalizePhone("abcdefghij"));
    expectPhoneError(() => normalizePhone("call-me-maybe", "NP"));
    expectPhoneError(() => normalizePhone(""));
  });

  it("rejects an impossible country code", () => {
    expectPhoneError(() => normalizePhone("+9999812345678"));
  });

  it("rejects a valid-length number that is not real under the plan", () => {
    // 10 digits with a +977 prefix, but 123… is not an allocated NP range.
    expectPhoneError(() => normalizePhone("+9771234567890"));
  });

  it("rejects national form without a country", () => {
    expectPhoneError(() => normalizePhone("9812345678"));
  });

  it("rejects national form with an unknown country code", () => {
    expectPhoneError(() => normalizePhone("9812345678", "XX"));
  });

  it("rejects a number embedded in surrounding text", () => {
    // The library parser could extract the number from the sentence;
    // the shape guard refuses to silently extract it.
    expectPhoneError(() => normalizePhone("Call me at +9779812345678"));
  });

  it("rejects an extension instead of silently dropping it", () => {
    expectPhoneError(() => normalizePhone("+1 212 555 0100 ext. 123"));
    expectPhoneError(() => normalizePhone("9812345678 x123", "NP"));
  });

  it("rejects a doubled or misplaced + sign", () => {
    expectPhoneError(() => normalizePhone("++9779812345678"));
    expectPhoneError(() => normalizePhone("977+9812345678"));
  });
});
