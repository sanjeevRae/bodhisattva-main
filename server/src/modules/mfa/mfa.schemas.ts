/**
 * MFA DTOs (strict — unknown keys rejected).
 */
import { z } from "zod";

export const totpCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Code must be the 6-digit code from your authenticator app."),
  })
  .strict();
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const recoveryCodeSchema = z
  .object({
    recoveryCode: z.string().trim().min(6).max(64),
  })
  .strict();
export type RecoveryCodeInput = z.infer<typeof recoveryCodeSchema>;
