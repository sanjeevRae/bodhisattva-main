/**
 * Invitations DTOs (strict — unknown keys are rejected so a client can
 * never smuggle fields like `roleId` or `invitedBy` past the service).
 */
import { z } from "zod";

/** Roles an invitation may grant — never CUSTOMER (DATABASE_DESIGN §6.1). */
export const INVITABLE_ROLES = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const createInvitationSchema = z
  .object({
    email: z.string().trim().email().max(254),
    role: z.enum(INVITABLE_ROLES),
  })
  .strict();
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(20).max(512),
    name: z.string().trim().min(2).max(120),
    // Admin accounts: minimum 12 characters (bootstrap policy, Part 15.1).
    password: z.string().min(12).max(200),
  })
  .strict();
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
