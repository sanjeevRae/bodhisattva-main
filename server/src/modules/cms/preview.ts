/**
 * CMS preview tokens (Phase 0 amendment A4 — separate published / editor /
 * preview retrieval).
 *
 * A preview token is a 256-bit one-time-shown capability that lets an admin
 * view a page's DRAFT revision without a session (e.g. in a fresh browser
 * tab or shared with a reviewer). Following the §2.11 token pattern, only
 * the SHA-256 digest is stored (`preview_tokens.token_hash`); the raw token
 * is returned exactly once, at creation. Tokens are bound to one page AND
 * one revision — the preview stays stable while editing continues — and
 * expire after 30 minutes.
 *
 * Validation is deliberately oracle-free for the public route: a missing
 * page, an unknown token, an expired token and a token bound to another
 * page all surface as the same 404.
 */
import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { previewTokens } from "../../database/schema/index.js";
import { generateToken, hashToken } from "../../utils/tokens.js";

export const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface CreatedPreviewToken {
  /** Raw token — shown once, never stored or logged. */
  token: string;
  revisionId: number;
  expiresAt: Date;
}

export async function createPreviewToken(
  db: Database,
  pageId: number,
  revisionId: number,
  createdBy: number,
): Promise<CreatedPreviewToken> {
  const { raw, hash } = generateToken(32);
  const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS);
  await db.insert(previewTokens).values({
    pageId,
    revisionId,
    tokenHash: hash,
    expiresAt,
    createdBy,
  });
  return { token: raw, revisionId, expiresAt };
}

/**
 * Resolve a raw token for a page: returns the bound revision id when the
 * token exists, belongs to the page and has not expired; otherwise null.
 */
export async function resolvePreviewToken(
  db: Database,
  pageId: number,
  rawToken: string,
): Promise<number | null> {
  if (!rawToken) return null;
  const [row] = await db
    .select({ revisionId: previewTokens.revisionId })
    .from(previewTokens)
    .where(
      and(
        eq(previewTokens.tokenHash, hashToken(rawToken)),
        eq(previewTokens.pageId, pageId),
        gt(previewTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.revisionId ?? null;
}
