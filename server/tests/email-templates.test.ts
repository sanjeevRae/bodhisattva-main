/**
 * Branded auth email builders (2026-11-26) — unit tests.
 *
 * Pins the contract the reviewers required: the Supercell-style
 * subject (verification ONLY), the contiguous code in BOTH parts,
 * the boxed digits in order, byte-compatible text parts, escaping
 * against hostile fixtures, URL scheme validation, leading zeros
 * surviving end to end, and the admin login's forgot-password link.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  invitationEmail,
  passwordResetEmail,
  verificationEmail,
} from "../src/services/email-templates.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("verificationEmail", () => {
  it("subject carries the grouped code; text keeps the exact legacy lines", () => {
    const mail = verificationEmail({ code: "31662065", expiryMinutes: 10 });
    expect(mail.subject).toBe("Your Bodhisattva Museum verification code [3166 2065]");
    expect(mail.text).toContain("Welcome to Bodhisattva Museum.");
    expect(mail.text).toContain("Your email verification code is: 31662065");
    expect(mail.text).toContain("It expires in 10 minutes.");
  });

  it("carries no press-and-hold tip in any email (owner removed it 2026-11-26)", () => {
    const tip = "press and hold the code";
    expect(verificationEmail({ code: "31662065", expiryMinutes: 10 }).text).not.toContain(tip);
    expect(verificationEmail({ code: "31662065", expiryMinutes: 10 }).html).not.toContain(tip);
    expect(passwordResetEmail({ resetUrl: "https://example.com/x", ttlMinutes: 60 }).html).not.toContain(tip);
    expect(invitationEmail({ role: "ADMIN", acceptUrl: "https://example.com/y" }).text).not.toContain(tip);
  });

  it("html has 8 boxed digits in order plus the contiguous code as text", () => {
    const mail = verificationEmail({ code: "31662065", expiryMinutes: 10 });
    const digits = [...mail.html.matchAll(/font-size:20px;font-weight:bold[^>]*>(\d)</g)].map(
      (m) => m[1],
    );
    expect(digits.join("")).toBe("31662065");
    expect(mail.html).toContain("Code: <strong>31662065</strong>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("http://127.0.0.1");
  });

  it("leading zeros survive subject, text and boxes", () => {
    const mail = verificationEmail({ code: "00001234", expiryMinutes: 10 });
    expect(mail.subject).toContain("[0000 1234]");
    expect(mail.text).toContain("code is: 00001234");
    const digits = [...mail.html.matchAll(/font-size:20px;font-weight:bold[^>]*>(\d)</g)].map(
      (m) => m[1],
    );
    expect(digits.join("")).toBe("00001234");
  });

  it("rejects malformed codes instead of rendering them", () => {
    expect(() => verificationEmail({ code: "1234567", expiryMinutes: 10 })).toThrow();
    expect(() => verificationEmail({ code: "123456789", expiryMinutes: 10 })).toThrow();
    expect(() => verificationEmail({ code: "1234abcd", expiryMinutes: 10 })).toThrow();
    expect(() => verificationEmail({ code: "1234567\n", expiryMinutes: 10 })).toThrow();
  });
});

describe("passwordResetEmail", () => {
  const url = "https://bodhisattvainternational.com/reset-password?tok=abc123";

  it("static subject (never a token), URL in text and twice in html", () => {
    const mail = passwordResetEmail({ resetUrl: url, ttlMinutes: 60 });
    expect(mail.subject).toBe("Reset your Bodhisattva Museum password");
    expect(mail.subject).not.toContain("abc123");
    expect(mail.text).toContain(`Use this link within 60 minutes:\n${url}`);
    expect(mail.html.split(url).length - 1).toBe(3); // button href + fallback href + fallback text
    expect(mail.html).toContain("Reset your password</a>");
  });

  it("rejects non-http(s) action URLs", () => {
    expect(() => passwordResetEmail({ resetUrl: "javascript:alert(1)", ttlMinutes: 60 })).toThrow();
    expect(() => passwordResetEmail({ resetUrl: "data:text/html;base64,x", ttlMinutes: 60 })).toThrow();
    expect(() => passwordResetEmail({ resetUrl: "not a url", ttlMinutes: 60 })).toThrow();
  });

  it("escapes a quote-bearing URL inside the href attribute", () => {
    const hostile = `https://example.com/reset-password?tok=a"b`;
    const mail = passwordResetEmail({ resetUrl: hostile, ttlMinutes: 60 });
    expect(mail.html).not.toContain(`href="https://example.com/reset-password?tok=a"b"`);
    expect(mail.html).toContain("a&quot;b");
  });
});

describe("invitationEmail", () => {
  const url = "https://bodhisattvainternational.com/accept-invitation?tok=xyz789";

  it("keeps the legacy subject and text; URL appears in both html spots", () => {
    const mail = invitationEmail({ role: "ADMIN", acceptUrl: url });
    expect(mail.subject).toBe("You have been invited to administer the Bodhisattva Museum website");
    expect(mail.text).toContain("with the role ADMIN.");
    expect(mail.text).toContain(`Accept the invitation within 72 hours using this link:\n${url}`);
    expect(mail.html.split(url).length - 1).toBe(3);
    expect(mail.html).toContain("Accept the invitation</a>");
  });

  it("escapes a hostile role instead of injecting markup", () => {
    const mail = invitationEmail({ role: `"><script>alert(1)</script>`, acceptUrl: url });
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).toContain(`"><script>alert(1)</script>`); // text part is plain by design
  });
});

describe("admin login forgot-password link (source guard)", () => {
  it("Login.tsx links to the public recovery flow", () => {
    const login = readFileSync(path.join(root, "src/admin/screens/Login.tsx"), "utf8");
    expect(login).toContain('href="/forgot-password"');
    expect(login).toContain("Forgot password?");
  });

  it("the reset page scrubs its token like the accept page does", () => {
    const pages = readFileSync(path.join(root, "src/app/pages/PasswordPages.tsx"), "utf8");
    expect(pages).toContain('const RESET_TOKEN_KEY = "bi-reset-token"');
    expect(pages).toContain('navigate("/reset-password", { replace: true })');
    expect(pages).toContain("sessionStorage.setItem(RESET_TOKEN_KEY, fromUrl)");
  });
});
