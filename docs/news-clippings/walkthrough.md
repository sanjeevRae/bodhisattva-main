# News Clippings — lead walkthrough (2026-11-18)

End-to-end exercise of the module on the local stack (MariaDB 10.11,
API on :4000, `vite preview` on :4173, headless Chrome), against the
final build, after the review fix round. Screenshots in
`screenshots/`.

## Setup through the real flows

- Dev admin (`admin@example.com`, local DB only) re-enrolled MFA
  through the real API enrolment flow and reached a full session.
- Created the article "Ten Years of Embodied Enlightenment at Purna
  Museum" (The Himalayan Times, Feature, author "Arts Desk",
  published 2026-11-17) as a draft with rich-text content, two tags
  (Exhibition, Press Coverage) and the Featured flag.
- Generated a realistic two-page newspaper PDF (Chrome print-to-PDF
  of a styled broadsheet page, 35,908 bytes) and uploaded it through
  the admin PDF endpoint. The stored checksum equals the file's
  SHA-256 (`fd11f754…`). Published the article.

## Verified live

- Public archive `/news` (desktop + mobile): hero preserved,
  featured block, facet filter bar, editorial rows, count.
- Article page `/news/:slug`: byline, reading time, sanitized body,
  related articles; the **PDF viewer renders page 1 of 2** with
  zoom/fit/fullscreen/download controls
  (`screenshots/news-article-pdf-viewer.png`).
- PDF endpoints: view = 200 `application/pdf`, `Accept-Ranges`,
  inline; `Range: bytes=0-7` = 206 with correct `Content-Range`
  and body `%PDF-1.4`; download = attachment with the original
  filename; view responses carry
  `Content-Security-Policy: default-src 'none'; sandbox`.
- Search runs over the plain-text projection: `search=canvas`
  finds the article (word appears only in its body);
  `search=strong` returns 0 (the word exists only as an HTML tag).
- Media-route bypass is closed: `GET /api/media/<pdfId>/file/master`
  returns 404.
- Admin list (`screenshots/admin-news-list.png`): filters, PDF
  badge with filename, status, featured star, created-by.
- Admin editor (`screenshots/admin-news-editor.png`,
  `admin-news-editor-pdf.png`): full form, tag chips, TipTap body,
  publishing toggles, and the "Original PDF clipping" panel with
  Preview / Download original / Replace / Remove.

## Bug found and fixed during this walkthrough

Opening the editor for an article **with tags** crashed React
(error #31: tag objects rendered as children) and showed a blank
page. Root cause: the admin detail type declared `tags: string[]`
while the API returns `{id, name, slug}` objects. Fixed in
`src/admin/types.ts` + `src/admin/screens/News.tsx`; re-verified
with a clean browser profile (zero console exceptions).

## Notes

- The dev database's museum content had been wiped by earlier test
  churn; the seed was re-run (idempotent) before the walkthrough.
  During the review fix round, migration 0011 was amended and
  re-applied locally, which reset the demo article's body/featured
  flag/attachment row; all three were restored through the API on
  the final build, as recorded above. None of this touches any
  other environment: 0011 ships in its amended form and runs once.
