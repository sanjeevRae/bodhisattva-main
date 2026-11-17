# Phase 5 — Independent Review Record

Reviews of the museum content modules (collections, exhibitions, gallery items,
news, foundation programs, testimonials) were obtained from ChatGPT and Gemini on
2026-11-17 against a written design brief (no code or secrets shared).

## Scores

- **ChatGPT: 8.2/10** — "Good implementation with manageable architectural debt.
  Approve with follow-up architectural changes before ecommerce implementation."
  (Data model 8.5, content migration 8.5, API design 8.5, media 7.5, publishing
  workflow 7, testing/verification 9, future extensibility 7.5.)
- **Gemini: 7.8/10** — "Exceptionally well-engineered for a content-driven
  phase", with friction points on live-editing exposure, dual-image debt and
  the Phase 6 domain mismatch.

## Converged findings and dispositions

### 1. Published records are edited live — no draft boundary (both reviewers' top content concern)
True, and a deliberate scope decision: module records are small single-form
edits, saved atomically in one server-validated request — a half-typed form
never reaches the database, and Zod validation runs before any write. The
residual risk is a deliberate-but-mistaken save to a live record, with audit
(actor + action on every write) and soft delete as the safety nets, but no
rollback. Page content — the high-risk surface — already has full revisions.
**Disposition:** accepted for now; a draft/live split for module records and a
"you are editing live content" warning in the admin forms are recorded as
Phase 8 / post-launch candidates. Not a Phase 6 blocker.

### 2. The content-module pattern must not become the commerce pattern (both reviewers)
Agreed — and already the plan. Phases 6–7 are a separate transactional domain
per the roadmap and the Phase 0 amendments: stock reservations (A1), order
idempotency keys (A2), price snapshots in immutable order lines, and explicit
order-transition endpoints (approve/process/ship/deliver/cancel), never a
generic PATCH of status. The Phase 6 brief will state this boundary explicitly.
Shared infrastructure (auth, audit, media, transactions) is reused; business
rules are not.

### 3. Dual image representation needs a measurable retirement (both reviewers)
The bridge stands until the client's media decision (BD-2). Retirement
condition, recorded here so it is checkable: the count of published module
records still resolving through `image_url` reaches zero (or the client
explicitly approves the exceptions), then a migration imports the remaining
URLs into `media_assets`, populates `cover_media_id`, and drops the legacy
columns and resolver fallback. Supporting facts the reviewers asked about:
media deletion is blocked at BOTH levels — the FKs are `ON DELETE RESTRICT`
in the schema, and the service layer refuses with a 409 naming the reference;
image priority (media asset wins) is implemented in exactly one resolver in
the museum service; the admin form shows both fields so the active source is
visible.

### 4. Derived display labels (both reviewers endorse)
Date labels derive from DATE columns (date-only, no timezone semantics);
counts are the museum's maintained cataloguing figure (`item_count`), not a
computed object count — that semantic is now stated here and in the admin
form's field label. If filtering by derived values is ever needed, the values
get stored then; not before.

### 5. Public list pagination (Gemini)
Not adopted. These endpoints back pages that render the full curated set by
design (6 collections, 9 exhibitions); admin lists are paginated. Revisit if
any module grows into the hundreds.

### 6. Soft deletes (Gemini concern — based on an incomplete summary)
Module records already soft-delete (`deleted_at`); public queries exclude
them and the media reference scan counts them. There is no admin trash UI —
recovery is database-level, acceptable at this scale.

### 7. Inferred categories and dedupe editorial risk (both reviewers)
The category inference was a one-time seed decision; categories are now
explicit, editable data on each record (not derived from names at runtime).
The flagged assignments and every intentional text change are enumerated in
`docs/phase-5/visual-diff.md` and were reported to the client as part of the
open real-data decision. ChatGPT's suggestion of context-specific
presentation fields (e.g. a separate Home promotional description per
exhibition) is recorded as a future enhancement; the Phase 0 mapping decision
was a single canonical text, and Phase 5 follows it.

### 8. Smaller checks raised by ChatGPT — verified in code/tests
Reorder rejects foreign-module ids (400, integration-tested) and runs in one
transaction; duplicate slugs return 409 (tested); public queries filter
`is_published` + `deleted_at` on every module including joins (news category
data comes only from published articles' categories); FULLTEXT search is
integration-tested with real museum terminology ("Mathura"); MariaDB's
minimum token length applies to very short queries, which fall back to the
LIKE path only on MATCH errors — short-query behaviour is a known,
accepted limitation of the current search.

## What was fixed during the phase (found by the phase's own verification)
- Six display columns the design's DDL lacked (curator, category, cover
  aspect, colour tokens, article slugs, program icons) — added as migration
  0006 before the APIs were built on them.
- News category colours vanished because data-driven Tailwind class names are
  never generated at build time — fixed with an explicit `@source inline`
  safelist in `src/styles/tailwind.css`.
- The News admin screen crashed on the one unpaginated museum endpoint's
  different envelope shape — the client now unwraps it explicitly.
