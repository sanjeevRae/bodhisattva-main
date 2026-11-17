/**
 * Roles DTOs (strict — unknown keys rejected).
 */
import { z } from "zod";

export const assignRoleSchema = z
  .object({
    role: z.enum(["SUPER_ADMIN", "ADMIN", "STORE_ADMIN", "CUSTOMER"]),
  })
  .strict();
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
