import { z } from "zod";

/**
 * Policy schemas. The slug set is FIXED (the three footer pages);
 * there are deliberately no create/delete shapes. Update and restore
 * bodies are .strict() — a client may not smuggle in updated_by,
 * updated_at or any other server-owned field (ChatGPT amendment) —
 * and both carry the `version` the editor loaded, for optimistic
 * concurrency (409 on mismatch).
 */
export const POLICY_SLUGS = ["privacy-policy", "terms-of-use", "accessibility"] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export const policySlugSchema = z.enum(POLICY_SLUGS);

/** 500 KB of HTML is far beyond any real policy page. */
export const MAX_POLICY_BODY_CHARS = 500_000;

export const updatePolicySchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    bodyHtml: z.string().min(1).max(MAX_POLICY_BODY_CHARS),
    version: z.number().int().positive(),
  })
  .strict();

export const restorePolicySchema = z
  .object({
    revisionId: z.number().int().positive(),
    version: z.number().int().positive(),
  })
  .strict();

export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type RestorePolicyInput = z.infer<typeof restorePolicySchema>;
