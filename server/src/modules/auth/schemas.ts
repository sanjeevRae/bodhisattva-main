/**
 * Auth request DTOs (spec §7.1; ARCHITECTURE.md §6.3).
 *
 * Every schema is `.strict()`: unknown properties are rejected, so a client
 * can never smuggle fields (role, status, emailVerifiedAt, …) into a write
 * — mass assignment is impossible by construction. Password policy
 * (SECURITY_THREAT_MODEL.md §6.1): minimum 10 characters for customers,
 * 12 for admin-role holders (the 12-char rule is enforced in the service
 * for password reset, where the account's roles are known; registration is
 * customer-only, so 10 applies here).
 */
import { z } from "zod";
import { phoneCountrySchema, phoneSchema } from "../../utils/phone.js";

export const PASSWORD_MIN_LENGTH_CUSTOMER = 10;
export const PASSWORD_MIN_LENGTH_ADMIN = 12;
export const PASSWORD_MAX_LENGTH = 128;

const emailField = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Invalid email address");

const passwordField = (minLength: number) =>
  z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .max(PASSWORD_MAX_LENGTH, "Password is too long");

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(120),
    email: emailField,
    password: passwordField(PASSWORD_MIN_LENGTH_CUSTOMER),
    // Phone is REQUIRED at signup (owner decision 2026-11-18) and is
    // validated against the real numbering plan in the service
    // (utils/phone.ts), which stores the E.164 form. phoneCountry is
    // the ISO code for national-format input; international ("+…")
    // input needs none. Existing accounts are unaffected: the column
    // stays nullable and login never demands a phone.
    phone: phoneSchema,
    phoneCountry: phoneCountrySchema,
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z
  .object({
    email: emailField,
    code: z
      .string()
      .regex(/^\d{8}$/, "The verification code is 8 digits"),
  })
  .strict();
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z
  .object({ email: emailField })
  .strict();
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string().min(1, "Password is required").max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z
  .object({ email: emailField })
  .strict();
export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>;

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(20, "Invalid reset token").max(200),
    newPassword: passwordField(PASSWORD_MIN_LENGTH_CUSTOMER),
  })
  .strict();
export type PasswordResetConfirmInput = z.infer<
  typeof passwordResetConfirmSchema
>;

/** Canonical email form: trimmed + lowercased (design §2.10). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
