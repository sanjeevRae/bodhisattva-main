/**
 * Unit tests for the popup link-URL validator + schemas (2026-11-20).
 * The validator is the security boundary for the one admin-controlled
 * URL that gets rendered to every visitor, so the bypass catalogue
 * (scheme tricks, whitespace/control smuggling, protocol-relative,
 * backslashes) is pinned down case by case.
 */
import { describe, expect, it } from "vitest";
import {
  createPopupSchema,
  isValidPopupLinkUrl,
  updatePopupSchema,
} from "../src/modules/popups/schemas.js";

describe("isValidPopupLinkUrl — accepted", () => {
  const ok = [
    "https://example.com",
    "https://example.com/path?q=1#frag",
    "http://sub.example.co.uk:8080/a-b_c",
    "/shop",
    "/",
    "/exhibitions/babu-kaji",
    "/news?tag=press",
  ];
  for (const value of ok) {
    it(`accepts ${value}`, () => {
      expect(isValidPopupLinkUrl(value)).toBe(true);
    });
  }
});

describe("isValidPopupLinkUrl — rejected", () => {
  const bad: Array<[string, string]> = [
    ["javascript:alert(1)", "javascript scheme"],
    ["JaVaScRiPt:alert(1)", "mixed-case scheme"],
    ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "data scheme"],
    ["vbscript:msgbox(1)", "vbscript scheme"],
    ["ftp://example.com/file", "ftp scheme"],
    ["//evil.example.com", "protocol-relative"],
    ["///evil.example.com", "triple slash"],
    ["https://exa mple.com", "embedded space"],
    [" https://example.com", "leading space"],
    ["https://example.com ", "trailing space"],
    ["https://example.com/\npath", "embedded newline"],
    ["java\tscript:alert(1)", "embedded tab"],
    ["https:\\\\evil.example.com", "backslashes"],
    ["/\\evil.example.com", "slash-backslash"],
    ["example.com", "bare host, no scheme"],
    ["https://", "no hostname"],
    ["", "empty"],
    ["http://exam ple.com", "space in host"],
  ];
  for (const [value, why] of bad) {
    it(`rejects ${why}`, () => {
      expect(isValidPopupLinkUrl(value)).toBe(false);
    });
  }

  it("rejects over-length values", () => {
    expect(isValidPopupLinkUrl("https://example.com/" + "a".repeat(600))).toBe(false);
  });
});

describe("popup schemas", () => {
  it("accepts a minimal create payload", () => {
    const parsed = createPopupSchema.parse({ heading: "Welcome", message: "Hello." });
    expect(parsed.heading).toBe("Welcome");
  });

  it("accepts a link with a label", () => {
    const parsed = createPopupSchema.parse({
      heading: "Sale",
      message: "Visit the shop.",
      buttonLabel: "Shop now",
      linkUrl: "/shop",
    });
    expect(parsed.linkUrl).toBe("/shop");
  });

  it("rejects a link without a button label", () => {
    const result = createPopupSchema.safeParse({
      heading: "Sale",
      message: "Visit the shop.",
      linkUrl: "/shop",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsafe link", () => {
    const result = createPopupSchema.safeParse({
      heading: "Sale",
      message: "Visit the shop.",
      buttonLabel: "Go",
      linkUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long heading and message", () => {
    expect(
      createPopupSchema.safeParse({ heading: "x".repeat(161), message: "ok" }).success,
    ).toBe(false);
    expect(
      createPopupSchema.safeParse({ heading: "ok", message: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("update schema allows partial edits but still guards the pair rule", () => {
    expect(updatePopupSchema.safeParse({ heading: "New" }).success).toBe(true);
    expect(updatePopupSchema.safeParse({ linkUrl: "/shop" }).success).toBe(false);
    expect(
      updatePopupSchema.safeParse({ linkUrl: "/shop", buttonLabel: "Go" }).success,
    ).toBe(true);
    expect(updatePopupSchema.safeParse({ imageMediaId: null }).success).toBe(true);
  });
});
