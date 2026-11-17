# PHASE 4 REVIEW — Independent reviews of the visual page builder

Reviews run 2026-11-17 (design-level briefs; no secrets or real data
shared). ChatGPT 8.5/10, Gemini 8.0/10.

## Applied in Phase 4 (before commit)

1. **Autosave snapshot semantics** (both reviewers' top concern). A save
   response can no longer mark a newer local document as saved or
   overwrite edits made during the request: the editor captures the sent
   payload, and on success only adopts the server response when the
   local document is unchanged; otherwise the baseline advances and the
   state stays "Unsaved" until the next autosave persists it. Saves were
   already serialized; the guard is now explicit and tested by design.
2. **Draft saves bound to the loaded revision** (ChatGPT's
   publish-during-edit hole). `PUT draft` now requires the `revisionId`
   the editor loaded; inside the page-row lock the server rejects with
   409 when that revision is no longer the page's draft or has since
   been published — closing the narrow case where a stale editor's
   version number could coincidentally match a fresh clone. The CMS
   integration suite asserts exactly this scenario.
3. **In-place MFA step-up** (both reviewers). New
   `POST /api/auth/mfa/step-up` verifies a TOTP code through the same
   replay-protected path as login MFA, rate-limited like login
   (5/15 min, counter cleared on success), audited, and stamps the
   session — no rotation. The Users screen now opens a step-up modal on
   the server's step-up 403 and retries the parked action once. Admins
   no longer sign out/in when the 15-minute window lapses.
4. **TOTP QR code** (both reviewers). Enrolment renders a QR of the
   otpauth URL (`qrcode` package) above the copyable secret, with a
   text-only fallback.
5. **Schema-drift contract test** (both reviewers). A unit test extracts
   the client field-spec keys from `src/admin/field-specs.ts` and
   asserts set equality with the server registry's `SECTION_TYPES`
   (22 = 22, both directions). Enum-level drift checks remain a future
   strengthening; the server stays authoritative and returns
   field-level errors the editor surfaces.

## Verified already satisfied

- **Duplicate deep-clones** (ChatGPT): the editor duplicates sections
  with `structuredClone` for config and design — no shared references.
- **Whole-array save** (both reviewers): endorsed as the right model at
  this scale; the server side is a transactional compare-and-swap under
  the page lock with the version check inside.
- **Canvas click isolation**: the editor intercepts canvas interactions
  at capture phase; PageRenderer itself performs no data fetching (page
  components do), so module sections in the canvas render from the same
  controlled temporary data as the public pages — no uncontrolled side
  effects today.

## Recorded for later phases

- **WYSIWYG rich-text editing** (both reviewers' usability #1): raw
  HTML textarea is safe (server sanitizes) but unfriendly for museum
  staff. A constrained editor (TipTap-class) whose output exactly
  matches the sanitize-html allowlist is a Phase 8 pre-launch item —
  integrating it mid-build risks output drift against the sanitizer.
- **Render modes for the canvas** (ChatGPT): when Phase 5 module
  sections begin fetching real data, PageRenderer gains an explicit
  editor/preview mode so module data in the canvas is controlled.
  Recorded in the Phase 5 brief.
- **Composed-band fidelity** (both): About's contact_information +
  contact_form compose into one dark band publicly but render as two
  bands in the editor canvas (the editor does compose them when
  adjacent in the navigator — the remaining gap is per-section
  standalone rendering); accepted for now, revisit with render modes.
- **Schema versioning** (ChatGPT, carried from Phase 3): introduce
  `schemaVersion` before the registry's first breaking change.
- **Contrast care on functional screens** (Gemini): menus/settings/
  users are functional-first; keep dense tables off low-contrast cream
  backgrounds — noted for the Phase 8 accessibility pass.

## Scores

| Reviewer | Score | One-line verdict |
|---|---|---|
| ChatGPT | 8.5/10 | "Good enough for a controlled production launch" — autosave correctness, editor isolation, drift checks (first and third applied; isolation verified/recorded) |
| Gemini | 8.0/10 | "Production-grade editor architecture" — WYSIWYG, drift, QR, step-up (QR + step-up applied; WYSIWYG deferred to Phase 8 with rationale) |
