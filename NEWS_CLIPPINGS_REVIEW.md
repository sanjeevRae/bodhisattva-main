# News Clippings & Digital Press Archive — Independent Review

Module built 2026-11-18 on top of the Phase 5 museum/news system, per
the owner's additional-module specification. Reviewed independently by
ChatGPT and Gemini from a design-level brief (no source code, no real
data), following the project's Part 21 review pattern.

## Scores

- **ChatGPT — 8.7/10** ("Strong architecture… Approve the architecture
  conditionally, complete those three fixes, and then proceed.")
  Chat: chatgpt.com/c/6afd54ab-dbcc-83e8-914e-2196050371a4
- **Gemini — 8.6/10** ("Thoroughly verified, well-scoped, and
  defensively engineered for cPanel/Passenger constraints.")
  Chat: gemini.google.com/app/3e883222555eed0e

Both reviewers endorsed the core model: `news_attachments` (lifecycle,
visibility, replacement history) separated from `media_assets` (pure
file storage), transactional replacement, publication-gated PDF
serving, and the additive API evolution.

## Adopted and fixed before this commit

Both reviewers converged on the same top items; all were fixed and
re-tested (news suite 24 → 28 tests; full integration 97/97):

1. **Concurrent replacement race** (both, High). The replacement
   transaction now locks the article row `FOR UPDATE` and re-reads
   the ACTIVE attachment under the lock. A new test fires two
   simultaneous replacements and asserts exactly one ACTIVE
   attachment, a consistent `replaced_by_id` chain, and that the
   public endpoint serves the winner's bytes.
2. **Generic media-route bypass** (both). `GET /api/media/:id/file/:variant`
   could have served a document asset by id, skipping the
   publication gate. The media file resolver now refuses
   `application/pdf` assets (404); PDFs are served only through the
   gated news endpoints. Tested both ways (PDF 404, image 200).
3. **Inline-PDF script execution** (Gemini High, ChatGPT Medium).
   All PDF responses (view + download, public + admin) now carry
   `Content-Security-Policy: default-src 'none'; sandbox` alongside
   `nosniff`, so a PDF opened directly in a browser tab gets no
   script privileges on the site origin.
4. **FULLTEXT pollution by HTML** (Gemini Medium). Article bodies
   are HTML; the index now runs over a `content_plain` projection
   (tags stripped, entities decoded, derived at save in the same
   patch as the sanitized HTML). Searching for markup words
   ("strong", "href") no longer matches; visible-word search is
   test-covered. Migration 0011 was amended before first release,
   so sites run it once, in its final form.
5. **Orphan files on transaction failure** (both, Medium). If the
   attachment transaction fails after the file was stored, the
   just-created media row + file are purged best-effort; the
   Phase 8 media sweep remains the backstop.

## Verified already-correct (reviewer checklists)

- Preview responses set `Referrer-Policy: no-referrer` with
  `no-store` and `noindex` (Gemini's leakage concern).
- Public list responses never include the article body; all four
  sorts end in a unique `id` tie-breaker (ChatGPT's pagination
  determinism point).
- Media delete-protection counts **all** `news_attachments` rows
  (active and historical), so a duplicated article's shared PDF
  cannot be deleted from under it (both reviewers' shared-media
  concern). Replacement never deletes the previous file.
- Preview tokens are bound to one article id, SHA-256 at rest,
  30-minute expiry, oracle-free 404s — the CMS preview pattern.
  Deliberate scope: a preview token authorizes the article **text**;
  a draft's PDF stays behind the admin endpoints (the admin editor
  previews it there).

## Deferred, with rationale

- **DB-level one-ACTIVE guarantee** (generated-column unique index):
  the row-lock + concurrency test gives the practical guarantee;
  recorded as future hardening.
- **Separate cookieless origin for PDFs**: not available on the
  single-domain shared host; the CSP sandbox header is the
  compensating control.
- **Antivirus scanning**: unavailable on shared hosting (declared
  in the module spec response). Compensating controls: uploads
  restricted to `news.manage` holders, signature/structure
  validation, SHA-256 checksums, sandboxed serving.
- **Devanagari/short-token search tuning**: MariaDB FULLTEXT
  defaults (min token size, stopwords) apply; see
  KNOWN_LIMITATIONS.md.

## Found by the lead walkthrough (not by the reviewers)

The admin article editor rendered a **blank page for any article
with tags**: the detail API returns tag objects `{id, name, slug}`
while the editor's type declared `string[]`, so React threw when
rendering the chips. Type corrected (`NewsTagRef[]`), editor maps
to names. Caught only by clicking through the real UI — the
integration suite cannot see frontend render crashes; the
walkthrough evidence is in `docs/news-clippings/walkthrough.md`.
