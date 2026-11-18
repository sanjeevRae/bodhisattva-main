# About Us Contact Form + SMTP — Review Record (2026-11-18)

Owner task: fix the Subject dropdown's white-on-white visibility and
make the About-page contact form deliver email securely from the
configured alerts@ identity to info@, server-side. Status:
**implemented, tested and verified locally; not deployed** (the
owner deploys: pull, `npm install`, `npm run db:migrate` for
migration 0012, restart, then a real test submission).

## Root cause of the dropdown bug

The select was styled `text-primary-foreground/65` (near-white, for
the dark section) with `appearance-none`, and no `option` styling
existed anywhere. The closed control looked fine on the dark band,
but the native option popup renders on the OS-default white
background — near-white text on white. `appearance-none` had also
removed the dropdown arrow with no replacement. Fix:
`.contact-subject-select option` rules in `src/styles/theme.css`
(white background, near-black text, `:checked` state) + a custom
chevron icon in the component.

## Independent security review (internal subagent) — verdict: ship it

No Critical or High findings. Header injection verified blocked at
three independent layers (schema rejects, exact subject allowlist,
and nodemailer 7.0.13's own CRLF neutralisation — the last proven
empirically with attack payloads). Routing is unreachable from the
client (strict schema; From/To from config only; the mailer's new
from/replyTo options are used by no other caller). The CSRF
exemption is sound: the endpoint reads no cookies/session, and the
global Origin check covers browser forgery. Rate limits run before
every expensive step, honeypot before the limits. No secrets in the
frontend bundle; failure logs carry no content or addresses.

Findings acted on:
- **Medium (configuration)**: distributed spam flood possible while
  Turnstile is unconfigured → documented (KNOWN_LIMITATIONS 43),
  production startup warning, owner action = add the free keys.
- **Low**: Turnstile hostname/action compared only when present →
  fixed, both are now mandatory.
- **Low**: raw SMTP error object in the failure log → fixed, only
  `code`/`responseCode` are logged now.
- Noted, not changed: no retention policy for `contact_submissions`
  (KNOWN_LIMITATIONS 44); the honeypot field name `website` is kept
  (it is inert for real users — hidden, `autocomplete="off"`, no
  password field on the form); `trust proxy = 1` is the platform's
  existing posture behind the single cPanel/Passenger hop — verify
  once at deployment that `req.ip` shows real client IPs.

## Independent QA (internal subagent) — 11/12 pass, defects fixed

Passed: API happy path (row SENT with message id; exact From/To/
Reply-To; subject format; text+HTML parts); eight invalid-input
cases → 400 envelope; honeypot (fake 200, no row, no mail); rate
limit (4th rapid submission → 429); SMTP outage → generic 503 + row
FAILED; dropdown rendering (dark text on white options, chevron,
all 6 subjects); real browser end-to-end submit; invalid-email
field error with values preserved; mobile 390px without overflow;
regression pages (/news, /shop, /login) clean.

Defects found and fixed, with regression coverage:
- **D-1**: a same-task double-click submitted twice (React state
  guard had not applied). Fixed with a synchronous ref lock;
  re-verified end-to-end by the lead: one row, one email.
- **D-2**: `GET /api/contact` answered the session guard's 401.
  Now 405 `METHOD_NOT_ALLOWED` with `Allow: POST` (+ test).
- **Cosmetic**: the CRLF-email rejection listed the email detail
  twice. The schema check is now a single combined issue (+ test
  assertion).
- Observed behaviour, kept: subject matching is case-sensitive
  (the real form always sends the exact CMS strings).

## Test evidence

- Feature suite `server/tests/contact.integration.test.ts`: 15/15
  (real MariaDB, real mail sink, live-CMS allowlist mutation test).
- Full integration: 112/112 across 9 suites. Unit: 121/121.
- Server typecheck + build clean; frontend build clean.
- Lead end-to-end on the built stack (production `dist` server +
  `vite preview`): filled the real About form, dispatched a
  synchronous double-click → success panel, exactly one
  `contact_submissions` row (SENT), exactly one email in the sink.

## External reviews (ChatGPT / Gemini, design-level, 2026-11-18)

Both reviewers were briefed on the design and evidence (not the
source). Scores — **ChatGPT: contact 9.0/10, Swagger 8.8/10.
Gemini: contact 8/10, Swagger 9/10.**

Contact form, points raised and dispositions:
- **Make Turnstile mandatory in production** (both reviewers; also
  the internal review's Medium). Owner decision, already the
  documented posture: the form works without it, the server warns
  at production startup, and KNOWN_LIMITATIONS 43 records the
  residual risk. Making boot fail without it would also block the
  owner's own staged rollout; the keys are a two-minute owner task.
- **SMTP/DB non-atomicity → transactional outbox** (ChatGPT). True
  in principle; deliberately not built. There are NO automatic
  retries anywhere, so a crash between SMTP acceptance and the
  SENT update can only leave a stale RECEIVED row — it can never
  produce a duplicate email. The platform already has an outbox
  pattern (orders) if retries are ever wanted.
- **Verify Turnstile before the CMS lookup / rate limits**
  (ChatGPT: efficiency; Gemini: ordering). Considered, not
  adopted. Rate limiting must count attempts (including bot
  attempts) or it is not a limiter, and the submission row is only
  persisted AFTER Turnstile passes — Gemini's "garbage rows flood
  the table before CAPTCHA" does not occur in this implementation.
  The CMS lookup is one indexed read, cheaper than the outbound
  Turnstile call it precedes.
- **Return 200 on SMTP failure since the message is stored**
  (Gemini). Not adopted: the owner's spec requires the honest
  outcome — a FAILED record and a generic 503 — rather than
  telling the visitor the message was sent when it was not.
- **Retention/privacy policy** (ChatGPT). Agreed; recorded as
  KNOWN_LIMITATIONS 44 for the owner's policy decision. The table
  is not reachable through any CMS or public endpoint (verified in
  the internal review).

Swagger, points raised and dispositions:
- **Coverage ≠ contract accuracy** (ChatGPT): correct — the diff
  proves every route is documented, not that every schema is
  perfect. The component schemas were derived from the modules'
  Zod DTOs; full contract testing is future work, noted here.
- **Auto-attach the CSRF token in Swagger via a requestInterceptor**
  (Gemini; ChatGPT called the manual flow acceptable). Considered,
  not adopted for now: functions do not survive swagger-ui-express
  option serialisation reliably, and the documented manual flow
  (paste the `csrf` cookie value into the header parameter) works.
  Revisit if the team finds it painful in practice.
- **Gate /api/docs behind an admin session in production**
  (Gemini). The docs are OFF in production by default
  (`API_DOCS_ENABLED`); enabling them is a deliberate owner act.
  Noted as a possible hardening if they are ever enabled publicly.
- Both reviewers confirmed cookie-based Authorize is the right
  call for this platform — no JWT should be introduced for docs.
