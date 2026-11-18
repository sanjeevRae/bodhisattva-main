# Phone Validation — Independent Review Synthesis

Reviews run 2026-11-18 against a design-level brief (no code, no secrets,
no real data), per Part 21 of the master specification, on the change
that made a phone number **required at customer signup** (and on
delivery addresses), validated as a real number under the destination
country's numbering plan — any country, no hardcoded country data — and
stored in E.164.

## Scores

- **ChatGPT — 8.8/10.** "Ship with fixes": the `/min` metadata concern
  and the silent-extraction/extension behaviour of the liberal parser
  must be addressed; also raised the valid-vs-verified distinction.
- **Gemini — 9.1/10.** "Ship with minor fixes": agreed the design is
  sound; suggested silently stripping extensions instead of rejecting
  them, and a Redis-backed rate limiter.

The reviewers **disagreed on two points**. Both were resolved — one
empirically, one as a recorded policy decision.

## Disagreement 1 — `/min` vs `/max` metadata (resolved empirically)

ChatGPT claimed the `libphonenumber-js/min` build lacks the precise
digit-pattern metadata, so `isValid()` degrades toward `isPossible()`
and accepts valid-length numbers in unallocated ranges. Gemini claimed
`/min` retains all validation rules with identical verdicts. The
library's own README sides with ChatGPT in principle ("in the default
configuration `isValidNumber()` performs absolutely the same 'lite'
validation"), but the question was settled by measurement, not by
either authority:

**Method.** A throwaway differential script (not committed) imported
both `libphonenumber-js/min` and `libphonenumber-js/max` (v1.13.16) in
the server context and compared `isValid()` verdicts on **3,907
numbers**:

- every probe number in `server/tests/phone.test.ts` (19) — 0 divergences;
- the known valid-length-but-unallocated NP case `+9771234567890` —
  0 divergences (both reject);
- the unmutated example numbers for 52 countries (104 comparisons,
  mobile examples from the package's own data) — 0 divergences;
- systematic mutations of those examples — single-digit substitution
  at every position (two offsets), single-digit deletion at every
  position, truncation and extension — in international and national
  forms (3,470 comparisons) — **312 divergences**;
- pseudo-random national numbers at valid lengths, seeded PRNG
  (312 comparisons) — **49 divergences**.

**Result: 361 divergences (9.2%), every single one in the same
direction — `/min` accepts, `/max` rejects.** In every divergence both
builds agreed the length was *possible*; only the strict digit-pattern
check in `/max` rejected the number. The divergent space is exactly
"right length, wrong range": e.g. Nepali numbers `+9779941234567`,
`+9779341234567`, `9941234567 (NP)` are accepted by `/min` but are not
real NP numbers; likewise Indian numbers beginning `3…` or `1…`,
Irish numbers beginning `95…`/`80…`, German numbers beginning `10…`.
(One curiosity recorded for honesty: the README's canonical Singapore
example `+6589555555` no longer diverges in v1.13.16 metadata — both
builds accept it. The README text is stale; the corpus result is not.)

**Decision: the server now validates with `/max`.**
`server/src/utils/phone.ts` imports `libphonenumber-js/max`; the phone
unit suite passes unchanged against it (all previously accepted
numbers remain accepted — the test probes had zero divergences). The
frontend pre-check keeps `/min` for bundle size: the divergence is
one-directional, so the client can pass a number the server then
rejects with the standard `phone` field error, but can never reject a
number the server would accept. The server verdict is authoritative.

## Disagreement 2 — extensions and surrounding text (policy decision)

The library parser is liberal: it can extract a number from
surrounding text and silently drop an extension. Gemini suggested
silently stripping extensions; ChatGPT said reject. **Decision:
reject** (ChatGPT's position). Silently dropping an extension can
misdirect contact to a switchboard and hides bad input from the user;
a clear validation error costs the user one correction.

Implemented as a strict input-shape guard in `normalizePhone`, applied
**before** parsing: only digits, spaces, parentheses, hyphens and
dots, plus a single leading `+`, are allowed — anything else (letters,
extension markers such as `ext`/`x123`, a second or misplaced `+`,
surrounding words) throws the same `phone` field error. A 32-character
length cap is enforced in the util as well, mirroring the schema.
Formatted input such as `+1 (202) 555-0123` still parses and
normalises. Regression tests cover both rejections and the accepted
punctuation forms.

## Remaining dispositions

1. **Unverified-account refresh authorization (ChatGPT).** Recorded,
   out of scope for this change — it is the pre-existing Phase 2
   design: re-registering a still-unverified email refreshes the
   pending account's credentials (now including phone) and sends a
   fresh verification code **to that mailbox**. The account stays
   `PENDING_VERIFICATION` and cannot be used until whoever controls
   the mailbox enters the code, so a third party who triggers a
   refresh gains nothing and the mailbox owner can always reclaim the
   account by verifying. Changing this flow is an auth-design decision
   for a separate change.
2. **Phone values and logging/PII (ChatGPT).** Verified in code:
   pino-http is configured with no custom request serializer, so
   request bodies never enter the HTTP log at all; the redact list
   covers authorization/cookie headers and password fields; the error
   handler logs only `{ err }` (5xx) or `{ errCode }` (4xx) — a phone
   validation failure logs the code `VALIDATION_FAILED` only, never
   the submitted value. The mailer contains no logging calls; the one
   auth email-failure log records the SMTP error and subject line,
   never bodies or phone values. Audit entries for registration,
   address and order actions carry ids, actor email, reasons and
   statuses — no call site puts a phone value in audit metadata
   (checked individually). One observation recorded without change:
   the audit sanitizer's sensitive-key pattern targets credentials
   (`password|otp|token|secret|code`) and does not list `phone`; that
   is safe today only because no call site passes one, and a future
   call site must not start.
3. **Mobile-only restriction — NOT adopted.** Both reviewers agreed:
   landlines are legitimate contact and delivery numbers (the museum
   takes orders by phone and delivers to households and offices), so
   any number that is valid under its country's plan is accepted,
   whatever its type.
4. **Redis rate limiter (Gemini) — NOT adopted.** The platform
   deliberately uses a MySQL-backed rate-limit store (Phase 0
   decision): cPanel/Passenger runs multiple processes with no shared
   memory and no Redis service. Nothing about phone validation changes
   that calculus.
5. **As-you-type formatting (both, minor) — deferred.** Cosmetic; the
   field stores and displays E.164 after save. Revisit if users find
   the raw input hard to proofread.
6. **Valid ≠ verified (ChatGPT).** Accepted as a distinction and
   recorded prominently: this change proves a number is *real under
   its numbering plan*, not that the person signing up *owns* it.
   Phone-ownership verification (SMS OTP) is a possible future feature
   if the owner wants it — it needs an SMS provider and a cost/policy
   decision, and is **not** part of this change.

## Fixes applied in response to the reviews

- Server phone validation switched from `libphonenumber-js/min` to
  `libphonenumber-js/max` (Disagreement 1, empirical).
- Strict input-shape guard added to `normalizePhone` — extensions and
  surrounding text rejected, never silently stripped or extracted
  (Disagreement 2).
- Regression tests added (`server/tests/phone.test.ts`, now 22 cases):
  GB national with trunk 0 (`020 7946 0018` → `+442079460018`, and the
  `+44` form giving the identical result), a Canadian `+1` number, a
  Jamaican `+1 876` number, a US number submitted with
  `phoneCountry: "NP"` (international prefix wins), parenthesised
  `+1 (202) 555-0123` normalisation, and the rejection cases for
  surrounding text, extensions and doubled/misplaced `+`.

## Verification

- Server build clean (`tsc`).
- Phone unit tests: **22/22 passed**. Full unit suite: **121 passed**,
  0 failed.
- Full integration run from a clean mailbox: **7 suites, 69/69
  passed**, including the auth-flows case "requires a plan-valid phone
  at registration and stores it in E.164 form" and the store/orders
  suites whose address and checkout fixtures run against the stricter
  `/max` build.
- The differential script was throwaway and has been deleted; its
  method and counts are recorded above.
