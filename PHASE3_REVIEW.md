# PHASE 3 REVIEW — Independent reviews of the CMS backend

Reviews run 2026-11-17 (design-level briefs; no secrets, credentials or
real data shared). ChatGPT 8.8/10 ("Review CMS Design"), Gemini 8.5/10.

## Convergent findings and dispositions

### Applied in Phase 3 (before commit)

1. **Concurrent clone-on-edit race** (both reviewers' #1). `saveDraft`,
   `publishPage` and `rollbackPage` already serialize on a
   `SELECT … FOR UPDATE` lock of the page row, and `saveDraft` re-checks
   the draft version inside that lock — but `getDraft` cloned without the
   lock, so two simultaneous editor opens could each clone and orphan one
   draft. Fixed: `getDraft` now takes the same page-row lock inside its
   transaction. Rollback semantics with an in-progress draft: rollback
   re-points `draft_revision_id` at a fresh clone of the rollback target;
   the superseded draft revision row is retained in history (never
   deleted), so no content is destroyed, though it leaves the editing
   flow — documented behaviour, acceptable for a small admin team.
2. **Sharp decompression-bomb guard** (both reviewers). Every decode of
   user-supplied bytes now passes `limitInputPixels: 40_000_000`
   (≈7300×5500, far above legitimate site imagery); an over-limit image
   is rejected as a 400 validation error rather than surfacing as a 500.
3. **Preview response hardening** (ChatGPT). The preview route now sends
   `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`
   and `X-Robots-Tag: noindex, nofollow`. The endpoint already resolves
   the revision exclusively through the validated token record.

### Verified already satisfied

- **Validate at save AND publish** — both reviewers: essential
  defence-in-depth, not redundant. The integration suite proves it
  (invalid section inserted directly in the DB → publish refused, live
  content preserved).
- **Preview token design** — hash-only storage + uniform 404 called
  "exemplary" (Gemini) / "strong" (ChatGPT).
- **Rollback audit** — publish and rollback write audit rows with the
  acting administrator and revision ids (ChatGPT asked for
  previous/new revision ids — present in audit metadata).
- **Public settings exposure** — `GET /api/site` returns only settings
  flagged `is_public` (explicit allowlist by flag, not naming).
- **Animated images** — GIF/AVIF animation is preserved deliberately
  (`animated: true` when pages > 1) and now bounded by the same pixel
  ceiling per frame decode.

### Recorded for later phases

- **Last-good published-content cache** (both reviewers): serve the
  last published payload if the API/DB blips. Deferred to Phase 8 with
  the hosting work — the right cache layer (CDN vs filesystem vs
  service-worker) depends on the cPanel topology Meena connects later.
  Rules recorded from ChatGPT: cache only published revisions, never
  preview responses; refresh only after a successful publish commit;
  revision-aware keys with explicit invalidation on publish.
- **Section schema versioning** (ChatGPT): add `schemaVersion` per
  section type with deterministic migrations before the registry's
  first breaking change. No breaking change exists yet; the builder
  (Phase 4) is the natural point to introduce the field, since it is
  the first consumer that writes sections outside the seed.
- **Orphan media-file cleanup** (ChatGPT): a periodic sweep deleting
  files with no DB row past a conservative age threshold — Phase 8 ops.
  Until then, the write-then-insert flow unlinks on insert failure;
  only a hard process kill mid-upload can orphan a file.
- **Media reference registry** (both reviewers): as Phases 5–6 add
  module tables, each module must register its media references with
  the deletion blocker (or a normalized `media_references` table
  replaces the JSON scan). Written into the Phase 5/6 briefs.
- **Preview-token revocation + generation rate limits** (ChatGPT):
  tokens are short-lived (30 min), admin-issued and bound to one
  page+revision; explicit revocation lands with the Phase 4 builder UI,
  which is where an admin would use it.
- **Composite FK for published-revision ownership** (ChatGPT): the
  service layer only ever points `published_revision_id` at a revision
  of the same page (publish/rollback operate on the page's own
  revisions inside the page lock); a composite FK is a Phase 8
  hardening candidate.
- **Hero eyebrow seed normalization** (ChatGPT + frontend diff): the
  seed normalized `&nbsp;·&nbsp;` to plain spaces, changing the mobile
  hero wrap. Content-fidelity fix belongs with Meena's real-content
  decisions; recorded in `docs/phase-3/visual-diff.md`.

## Scores

| Reviewer | Score | One-line verdict |
|---|---|---|
| ChatGPT | 8.8/10 | "Approve with required hardening" — concurrency, media limits, last-good cache (top two applied in-phase; cache deferred to Phase 8) |
| Gemini | 8.5/10 | "Exceptionally thorough, production-grade" — draft race, pixel bombs, frontend resilience (first two applied in-phase) |
