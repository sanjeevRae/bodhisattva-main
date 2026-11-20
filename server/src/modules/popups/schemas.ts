import { z } from "zod";

/**
 * Popup schemas + the link-URL validator (owner feature, 2026-11-20;
 * plan reviewed by ChatGPT 9/10 and Gemini 8.5/10 — the URL rules
 * below are their convergent hardening, not a naive prefix check).
 *
 * A popup link may be:
 *  - an absolute http:// or https:// URL with a real hostname, or
 *  - a site-relative path with exactly one leading slash.
 * Everything else is rejected: other schemes in any letter case
 * (javascript:, data:, …), protocol-relative //host, backslashes,
 * whitespace or control characters ANYWHERE in the string (they are
 * how scheme checks get bypassed), and untrimmed input.
 */
export function isValidPopupLinkUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) {
    return false;
  }
  if (value !== value.trim()) return false;
  // Control characters, any whitespace, DEL, backslash — anywhere.
  if (/[\u0000-\u0020\u007F\\]/.test(value)) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const headingSchema = z.string().trim().min(1).max(160);
const messageSchema = z.string().trim().min(1).max(2000);
const buttonLabelSchema = z.string().trim().min(1).max(80);
const linkUrlSchema = z
  .string()
  .max(500)
  .refine(isValidPopupLinkUrl, {
    message: "Link must be an http(s) address or a site path starting with /.",
  });
const imageMediaIdSchema = z.number().int().positive();

const popupFields = {
  heading: headingSchema,
  message: messageSchema,
  imageMediaId: imageMediaIdSchema.nullable().optional(),
  buttonLabel: buttonLabelSchema.nullable().optional(),
  linkUrl: linkUrlSchema.nullable().optional(),
};

function requireLabelWithUrl(
  data: { buttonLabel?: string | null; linkUrl?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (data.linkUrl != null && data.buttonLabel == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["buttonLabel"],
      message: "A button label is required when a link is set.",
    });
  }
}

export const createPopupSchema = z
  .object({ ...popupFields, heading: headingSchema, message: messageSchema })
  .superRefine(requireLabelWithUrl);

export const updatePopupSchema = z
  .object({
    heading: headingSchema.optional(),
    message: messageSchema.optional(),
    imageMediaId: imageMediaIdSchema.nullable().optional(),
    buttonLabel: buttonLabelSchema.nullable().optional(),
    linkUrl: linkUrlSchema.nullable().optional(),
  })
  .superRefine(requireLabelWithUrl);

export type CreatePopupInput = z.infer<typeof createPopupSchema>;
export type UpdatePopupInput = z.infer<typeof updatePopupSchema>;
