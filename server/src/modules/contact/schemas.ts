/**
 * Contact-form DTO (strict — unknown keys are rejected, so a visitor can
 * never smuggle routing fields such as `to`, `cc`, `bcc` or `from` past
 * the service: sender and recipient come from server configuration only,
 * and the visitor's address is used solely as Reply-To after validation).
 *
 * Header-injection defence starts here: single-line fields reject every
 * control character, and the email additionally rejects percent-encoded
 * CR/LF (%0d / %0a), which lenient downstream parsers could decode into
 * a header break. The message body is multiline by design, so instead
 * of rejecting it strips control characters other than \n and \t.
 */
import { z } from "zod";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ENCODED_CRLF = /%(0d|0a)/i;
/** Everything except \n (\x0A) and \t (\x09). */
const MESSAGE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function nameField(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(80)
    .refine(
      (value) => !CONTROL_CHARS.test(value),
      `${label} contains invalid characters`,
    );
}

export const contactSubmissionSchema = z
  .object({
    firstName: nameField("First name"),
    lastName: nameField("Last name"),
    email: z
      .string()
      .trim()
      .min(1, "Email is required")
      .max(254)
      // One combined check, one issue: chaining .email() + .refine()
      // reported the same "Invalid email address" detail twice for an
      // address that failed both (QA cosmetic defect).
      .superRefine((value, ctx) => {
        if (
          CONTROL_CHARS.test(value) ||
          ENCODED_CRLF.test(value) ||
          !z.string().email().safeParse(value).success
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid email address",
          });
        }
      }),
    // Membership of the CMS-configured allowlist is enforced in the
    // service (the list lives in the About page's contact_form section).
    subject: z.string().trim().min(1, "Subject is required").max(120),
    message: z
      .string()
      .transform((value) =>
        value.trim().replace(MESSAGE_CONTROL_CHARS, ""),
      )
      .pipe(
        z
          .string()
          .min(10, "Message must be at least 10 characters")
          .max(5000, "Message must be at most 5000 characters"),
      ),
    /**
     * Honeypot: a field real visitors never see or fill (the frontend
     * renders it hidden and leaves it empty). Optional here; the service
     * silently "accepts" any submission that arrives with it filled.
     */
    website: z.string().max(200).optional(),
    /**
     * Cloudflare Turnstile token. Only required when the server has
     * TURNSTILE_SECRET_KEY configured — the service enforces it then.
     */
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict();
export type ContactSubmissionInput = z.infer<typeof contactSubmissionSchema>;
