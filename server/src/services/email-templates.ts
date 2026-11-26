/**
 * Branded authentication emails (owner request, 2026-11-26).
 *
 * Pure builders — no I/O, no config reads: each returns the complete
 * { subject, text, html } for one auth email, rendered on ONE shared
 * shell (table layout, inline styles, no external resources — nothing
 * to block, track or leak). Callers keep owning delivery semantics
 * (sendMailSafe's never-fail-the-flow behaviour, the invitation
 * service's audit-on-failure).
 *
 * SUBJECT-LINE CODE — an accepted trade-off, deliberately scoped:
 * the signup verification subject carries the code, Supercell-style
 * ("... verification code [3166 2065]"), because mail apps surface
 * codes from subjects and the code's own defences are strong (8
 * digits, 10-minute expiry, attempt limits, resend caps, HMAC at
 * rest, previous codes invalidated). Reviewers (ChatGPT + Gemini,
 * 2026-11-26) accepted it under these restrictions, which are part of
 * this module's contract:
 *  - ONLY the signup verification email puts a code in its subject.
 *    Reset tokens, invitation tokens and MFA codes NEVER appear in
 *    subjects (their subjects below are static strings).
 *  - Nothing logs a subject, a code, a body or a raw token. The auth
 *    service logs mail failures by a static kind label only.
 *
 * Escaping + validation: codes are asserted to be exactly 8 digits;
 * action URLs are parsed and must be http(s) (escaping alone is not
 * validation); every interpolated value is HTML-escaped for its
 * context. No user free-text enters any template — the only inputs
 * are the code, server-built URLs, the invited role (a server enum)
 * and TTL numbers.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const INK = "#26221b";
const MUTED = "#6f6a5e";
const GOLD = "#a97e2f";
const CREAM = "#f7f1e2";
const BOX_BG = "#fbf8f1";
const BOX_BORDER = "#d8cfb8";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Parse + scheme-check an action URL; throws on anything unexpected. */
function assertActionUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`refusing to email a non-http(s) action URL: ${parsed.protocol}`);
  }
  return url;
}

/** "31662065" → "3166 2065" (asserts the 8-digit string shape first). */
function groupedCode(code: string): string {
  if (!/^\d{8}$/.test(code)) {
    throw new Error("verification code must be exactly 8 digits");
  }
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

function shell(input: { preheader: string; bodyHtml: string }): string {
  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="color-scheme" content="light">`,
    `<title>Bodhisattva Museum</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background-color:${CREAM};">`,
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM};">`,
    `<tr><td align="center" style="padding:28px 12px;">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">`,
    `<tr><td align="center" style="padding:4px 8px 14px 8px;font-family:${SERIF};font-size:21px;letter-spacing:3px;color:${INK};">BODHISATTVA <span style="color:${GOLD};">MUSEUM</span></td></tr>`,
    `<tr><td style="background-color:#ffffff;border:1px solid ${BOX_BORDER};padding:30px 28px;">`,
    input.bodyHtml,
    `</td></tr>`,
    `<tr><td align="center" style="padding:16px 8px 4px 8px;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};">Bodhisattva International &middot; Purna Museum of Newa Art, Kupondole, Lalitpur</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}

function paragraph(text: string, style = ""): string {
  return `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${INK};${style}">${text}</p>`;
}

function mutedLine(text: string): string {
  return `<p style="margin:0 0 10px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${MUTED};">${text}</p>`;
}

/** Table-cell button (Outlook-safe) + the raw URL as a usable fallback. */
function actionBlock(url: string, label: string): string {
  const safe = escapeHtml(url);
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 16px 0;">`,
    `<tr><td bgcolor="${GOLD}" style="background-color:${GOLD};border-radius:3px;">`,
    `<a href="${safe}" style="display:inline-block;padding:12px 26px;font-family:${SANS};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>`,
    `</td></tr>`,
    `</table>`,
    `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${MUTED};">Or copy this link into your browser:<br>`,
    `<a href="${safe}" style="color:${GOLD};word-break:break-all;">${safe}</a></p>`,
  ].join("\n");
}

/** The 8 digits as boxed cells (4 + gap + 4), sized to fit 360px. */
function digitBoxes(code: string): string {
  const cells = code
    .split("")
    .map((digit, i) => {
      const gap = i === 4 ? `<td width="14" style="font-size:0;line-height:0;">&nbsp;</td>` : "";
      const sep = i > 0 && i !== 4 ? `<td width="6" style="font-size:0;line-height:0;">&nbsp;</td>` : "";
      return `${gap}${sep}<td width="34" height="46" align="center" valign="middle" style="width:34px;height:46px;background-color:${BOX_BG};border:1px solid ${BOX_BORDER};border-radius:4px;font-family:${SANS};font-size:20px;font-weight:bold;color:${INK};">${digit}</td>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:4px auto 14px auto;"><tr>${cells}</tr></table>`;
}

export function verificationEmail(input: { code: string; expiryMinutes: number }): EmailContent {
  const grouped = groupedCode(input.code);
  const subject = `Your Bodhisattva Museum verification code [${grouped}]`;
  const text = [
    `Welcome to Bodhisattva Museum.`,
    ``,
    `Your email verification code is: ${input.code}`,
    ``,
    `It expires in ${input.expiryMinutes} minutes.`,
    `If you did not create an account, you can ignore this email.`,
    ``,
    `Tip: on your phone, press and hold the code to copy it.`,
  ].join("\n");
  const html = shell({
    preheader: `Your verification code expires in ${input.expiryMinutes} minutes.`,
    bodyHtml: [
      paragraph(`Welcome to Bodhisattva Museum.`),
      paragraph(`Your email verification code is:`),
      digitBoxes(input.code),
      // The contiguous code as real text (client code-detection and
      // copy/paste must never depend on reading split table cells).
      `<p style="margin:0 0 14px 0;text-align:center;font-family:${SANS};font-size:15px;color:${INK};">Code: <strong>${input.code}</strong></p>`,
      mutedLine(`Tip: on your phone, press and hold the code to copy it.`),
      mutedLine(`It expires in ${input.expiryMinutes} minutes.`),
      mutedLine(`If you did not create an account, you can ignore this email.`),
    ].join("\n"),
  });
  return { subject, text, html };
}

export function passwordResetEmail(input: { resetUrl: string; ttlMinutes: number }): EmailContent {
  const url = assertActionUrl(input.resetUrl);
  const subject = `Reset your Bodhisattva Museum password`;
  const text = [
    `We received a request to reset your password.`,
    ``,
    `Use this link within ${input.ttlMinutes} minutes:`,
    url,
    ``,
    `If you did not request this, you can ignore this email — your password will not change.`,
  ].join("\n");
  const html = shell({
    preheader: `Reset your password within ${input.ttlMinutes} minutes.`,
    bodyHtml: [
      paragraph(`We received a request to reset your password.`),
      actionBlock(url, "Reset your password"),
      mutedLine(`Use this link within ${input.ttlMinutes} minutes.`),
      mutedLine(`If you did not request this, you can ignore this email — your password will not change.`),
    ].join("\n"),
  });
  return { subject, text, html };
}

export function invitationEmail(input: { role: string; acceptUrl: string }): EmailContent {
  const url = assertActionUrl(input.acceptUrl);
  const subject = `You have been invited to administer the Bodhisattva Museum website`;
  const text = [
    `You have been invited to join the Bodhisattva Museum website administration team with the role ${input.role}.`,
    ``,
    `Accept the invitation within 72 hours using this link:`,
    url,
    ``,
    `If you were not expecting this invitation, you can ignore this email.`,
  ].join("\n");
  const html = shell({
    preheader: `You have been invited to administer the Bodhisattva Museum website.`,
    bodyHtml: [
      paragraph(
        `You have been invited to join the Bodhisattva Museum website administration team with the role <strong>${escapeHtml(input.role)}</strong>.`,
      ),
      actionBlock(url, "Accept the invitation"),
      mutedLine(`Accept the invitation within 72 hours.`),
      mutedLine(`If you were not expecting this invitation, you can ignore this email.`),
    ].join("\n"),
  });
  return { subject, text, html };
}
