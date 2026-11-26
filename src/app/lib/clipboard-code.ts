/**
 * Extract an 8-digit email verification code from clipboard text
 * (VerifyEmailPage's "Paste code" button, 2026-11-26).
 *
 * Deliberately conservative — a wrong guess fills the field with a
 * stranger's number, so ambiguity means "no code found":
 *  - Only the first 1024 characters are inspected (a pasted email is
 *    short; a pasted document should not be scanned wholesale).
 *  - A candidate is a run of digits, optionally grouped by single
 *    spaces or hyphens ("40303049", "4030 3049", "4030-3049").
 *    Separators are normalised WITHIN a candidate only — digits are
 *    never concatenated across separate candidates, so trailing
 *    numbers ("…expires in 10 minutes") can't extend a code.
 *  - A candidate counts only when its digits total exactly 8 (a
 *    9-digit run is one 9-digit candidate and is rejected whole).
 *  - Exactly one candidate → it wins. Several → the one appearing
 *    shortly after the word "code" wins ("Your verification code is
 *    4030 3049. Expires on 2026-11-26." — the date is also an
 *    8-digit candidate and must lose). Several with no contextual
 *    winner → null rather than a guess.
 *
 * Pure and total: any input yields a code or null, never a throw.
 */
const MAX_INSPECT_CHARS = 1024;
const CANDIDATE_RE = /\d+(?:[ -]\d+)*/g;
const CONTEXT_WINDOW = 48;

export function extractVerificationCode(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const text = raw.slice(0, MAX_INSPECT_CHARS);
  const candidates: { code: string; index: number; end: number }[] = [];
  for (const match of text.matchAll(CANDIDATE_RE)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length === 8) {
      candidates.push({ code: digits, index: match.index, end: match.index + match[0].length });
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].code;

  // A candidate is "contextual" when the word "code" appears in the
  // stretch of text between the PREVIOUS candidate and this one —
  // so in "…code is 4030 3049. Expires on 2026-11-26." only the
  // first candidate qualifies; the date's stretch (". Expires on ")
  // contains no "code" even though the word occurs earlier.
  const contextual = candidates.filter(({ index }, i) => {
    const stretchStart = i === 0 ? 0 : candidates[i - 1].end;
    const stretch = text.slice(Math.max(stretchStart, index - CONTEXT_WINDOW), index);
    // Word-boundary match: "barcode"/"postcode" must not qualify.
    return /\bcode\b/i.test(stretch);
  });
  return contextual.length === 1 ? contextual[0].code : null;
}
