/**
 * Contact-form service (migration 0012) — the server side of the About
 * page "Send a Message" form.
 *
 * Flow (in order; the route adds the global Origin check in front):
 *   1. Honeypot — a filled `website` field means a bot: answer with the
 *      success shape, store nothing, send nothing, count nothing.
 *   2. Rate limits (MySQL-backed, HMAC keys — security/rate-limit.ts):
 *      per-IP short window (config, default 3 / 10 min), per-IP hourly
 *      (5 / hour), per-email hourly (5 / hour).
 *   3. Subject allowlist — read live from the published About page's
 *      contact_form section (CMS), falling back to the seed defaults.
 *   4. Turnstile — only when TURNSTILE_SECRET_KEY is configured; any
 *      failure or timeout fails CLOSED.
 *   5. Persist the submission (status RECEIVED) BEFORE sending, so an
 *      SMTP outage can never lose the message.
 *   6. Send through the shared mailer: From = the configured contact
 *      identity, To = the configured mailbox, Reply-To = the visitor's
 *      validated email. On acceptance the row becomes SENT with the
 *      SMTP message id; on failure it becomes FAILED, the failure is
 *      logged WITHOUT the message content, and the visitor gets a safe
 *      503 — success is never reported for a message that was not
 *      accepted.
 *
 * The visitor can never influence routing: the strict schema rejects
 * extra keys, and From/To come from AppConfig only.
 */
import { AppError } from "@bodhisattva/shared/errors";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../database/client.js";
import {
  contactSubmissions,
  pageSections,
  pages,
} from "../../database/schema/index.js";
import {
  CMS_PAGES,
  type ContactFormConfig,
} from "../../database/seed-data/cms-content.js";
import { createRateLimiter, type RateLimiter } from "../../security/rate-limit.js";
import type { Mailer } from "../../services/mailer.js";
import { normaliseEmail } from "../auth/schemas.js";
import type { ContactSubmissionInput } from "./schemas.js";

const ONE_HOUR_SECONDS = 3600;
/** Fixed hourly caps (spec Phase 6.1); the short window is configurable. */
const HOURLY_IP_MAX = 5;
const HOURLY_EMAIL_MAX = 5;
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 5000;

/**
 * The six seed defaults, read from the CMS seed content itself so the
 * fallback can never drift from what a fresh site is seeded with.
 */
export const DEFAULT_CONTACT_SUBJECTS: readonly string[] = (() => {
  const about = CMS_PAGES.find((page) => page.slug === "about");
  const section = about?.sections.find((s) => s.type === "contact_form");
  const options = (section?.config as Partial<ContactFormConfig> | undefined)
    ?.subjectOptions;
  return Array.isArray(options) && options.length > 0
    ? [...options]
    : ["General Enquiry"];
})();

/**
 * Escape a user-supplied value for interpolation into an HTML email.
 * This is the platform's first HTML-escaping helper: the mailer and the
 * orders templates interpolate only server-generated values (roles,
 * tokens, ids), so none existed to reuse.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ContactServiceDeps {
  db: Database;
  config: AppConfig;
  mailer: Mailer;
  logger: Logger;
}

export interface ContactRequestMeta {
  ipAddress: string | null;
}

export interface ContactService {
  submit(
    input: ContactSubmissionInput,
    meta: ContactRequestMeta,
  ): Promise<{ submitted: true }>;
}

/**
 * The allowed subjects, from the PUBLISHED About page's contact_form
 * section config. Any read failure (no page, no published revision, no
 * section, malformed config, DB error) falls back to the seed defaults:
 * the form must keep working even if the CMS content is mid-edit.
 */
async function loadAllowedSubjects(db: Database): Promise<string[]> {
  try {
    const rows = await db
      .select({ config: pageSections.config })
      .from(pages)
      .innerJoin(
        pageSections,
        eq(pageSections.revisionId, pages.publishedRevisionId),
      )
      .where(
        and(
          eq(pages.slug, "about"),
          eq(pages.status, "PUBLISHED"),
          isNull(pages.deletedAt),
          eq(pageSections.type, "contact_form"),
        ),
      )
      .orderBy(asc(pageSections.sortOrder))
      .limit(1);
    const options = (rows[0]?.config as Partial<ContactFormConfig> | undefined)
      ?.subjectOptions;
    if (Array.isArray(options)) {
      const clean = options.filter(
        (option): option is string =>
          typeof option === "string" && option.trim().length > 0,
      );
      if (clean.length > 0) return clean;
    }
  } catch {
    // Fall through to the seed defaults below.
  }
  return [...DEFAULT_CONTACT_SUBJECTS];
}

interface TurnstileResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
}

/**
 * Server-side Turnstile verification (spec Phase 6.3). Runs ONLY when a
 * secret is configured; then a token is mandatory and every failure —
 * missing token, network error, timeout, success=false, wrong hostname,
 * wrong action — fails closed with VALIDATION_FAILED.
 */
async function verifyTurnstile(
  config: AppConfig,
  token: string | undefined,
  remoteIp: string | null,
): Promise<void> {
  const secret = config.turnstileSecretKey;
  if (!secret) return;
  const fail = (): never => {
    throw AppError.validation(
      [{ field: "turnstileToken", issue: "verification failed" }],
      "Verification failed. Please try again.",
    );
  };
  if (!token) return fail();
  let data: TurnstileResponse;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    data = (await response.json()) as TurnstileResponse;
  } catch {
    return fail();
  }
  if (data.success !== true) return fail();
  // Hostname and action are mandatory, not when-present (security
  // review): Cloudflare returns both for a token issued to our widget,
  // so a response missing either is not evidence for this site/form.
  let expected: string;
  try {
    expected = new URL(config.appUrl).hostname;
  } catch {
    return fail();
  }
  if (data.hostname !== expected) return fail();
  if (data.action !== "contact") return fail();
}

function buildEmail(
  config: AppConfig,
  input: ContactSubmissionInput,
  submittedAt: Date,
): { subject: string; text: string; html: string } {
  const fullName = `${input.firstName} ${input.lastName}`;
  const timestamp = submittedAt.toISOString();
  const text = [
    `New contact message from the Bodhisattva International website.`,
    ``,
    `Name: ${fullName}`,
    `Email: ${input.email}`,
    `Subject: ${input.subject}`,
    `Submitted: ${timestamp}`,
    `Source: About page contact form`,
    ``,
    `Message:`,
    input.message,
  ].join("\n");
  const html = [
    `<h2 style="font-family: Georgia, serif; color: #173A1B;">New website contact message</h2>`,
    `<p><strong>Name:</strong> ${escapeHtml(fullName)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(input.email)}</p>`,
    `<p><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>`,
    `<p><strong>Submitted:</strong> ${escapeHtml(timestamp)}</p>`,
    `<p><strong>Message:</strong></p>`,
    `<p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>`,
    `<hr>`,
    `<p style="color: #666; font-size: 12px;">Source: About page contact form — ${escapeHtml(config.contact.fromName)}. Reply to this email to answer the visitor.</p>`,
  ].join("\n");
  return {
    subject: `[Website Contact] - ${input.subject}`,
    text,
    html,
  };
}

export function createContactService(deps: ContactServiceDeps): ContactService {
  const { db, config, mailer, logger } = deps;
  const rateLimiter: RateLimiter = createRateLimiter({
    db,
    keySecret: config.secrets.otpHmacSecret,
  });

  async function enforceLimit(
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const result = await rateLimiter.hitLimit(scope, key, limit, windowSeconds);
    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", undefined, [
        { field: "retryAfter", issue: String(result.retryAfterSeconds) },
      ]);
    }
  }

  return {
    async submit(
      input: ContactSubmissionInput,
      meta: ContactRequestMeta,
    ): Promise<{ submitted: true }> {
      // 1. Honeypot: success shape, but nothing stored, sent or counted.
      if (input.website && input.website.trim().length > 0) {
        return { submitted: true };
      }

      // 2. Rate limits (each hit is recorded, then evaluated in order).
      const ip = meta.ipAddress ?? "unknown";
      const shortWindowSeconds = Math.max(
        1,
        Math.round(config.contact.rateLimitWindowMs / 1000),
      );
      await enforceLimit("contact:ip", ip, config.contact.rateLimitMax, shortWindowSeconds);
      await enforceLimit("contact:ip60", ip, HOURLY_IP_MAX, ONE_HOUR_SECONDS);
      await enforceLimit(
        "contact:email",
        normaliseEmail(input.email),
        HOURLY_EMAIL_MAX,
        ONE_HOUR_SECONDS,
      );

      // 3. Subject allowlist (CMS-published, seed-default fallback).
      const allowedSubjects = await loadAllowedSubjects(db);
      if (!allowedSubjects.includes(input.subject)) {
        throw AppError.validation([
          { field: "subject", issue: "Please choose a subject from the list" },
        ]);
      }

      // 4. Turnstile (only when configured; fails closed).
      await verifyTurnstile(config, input.turnstileToken, meta.ipAddress);

      // 5. Persist first — an SMTP outage must never lose the message.
      const [inserted] = await db
        .insert(contactSubmissions)
        .values({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          subject: input.subject,
          message: input.message,
          status: "RECEIVED",
        })
        .$returningId();
      const submissionId = inserted.id;

      // 6. Send via the shared mailer; record the honest outcome.
      const email = buildEmail(config, input, new Date());
      try {
        const result = await mailer.sendMail({
          from: `${config.contact.fromName} <${config.contact.fromEmail}>`,
          to: config.contact.toEmail,
          replyTo: input.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        await db
          .update(contactSubmissions)
          .set({ status: "SENT", emailMessageId: result.messageId ?? null })
          .where(eq(contactSubmissions.id, submissionId));
      } catch (cause) {
        await db
          .update(contactSubmissions)
          .set({ status: "FAILED" })
          .where(eq(contactSubmissions.id, submissionId));
        // Only the failure codes are logged — never the raw SMTP error
        // (its text can carry server responses and envelope addresses),
        // never the message content, the visitor's address, or any
        // credential (security review).
        const smtpError = cause as
          | { code?: unknown; responseCode?: unknown }
          | null;
        logger.error(
          {
            submissionId,
            smtpCode:
              typeof smtpError?.code === "string" ? smtpError.code : undefined,
            smtpResponseCode:
              typeof smtpError?.responseCode === "number"
                ? smtpError.responseCode
                : undefined,
          },
          "contact form email delivery failed",
        );
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "Your message could not be sent. Please try again later.",
          undefined,
          { cause },
        );
      }
      return { submitted: true };
    },
  };
}
