# Sharing previews & content protection (2026-11-19)

Owner requirements implemented after a written plan review with
ChatGPT, Claude and Gemini (all three approved with changes; the
changes below marked "review" came from that discussion).

## Social share previews — the link carries the image

Three layers, one contract (keep the two route tables in step:
`src/app/lib/meta.ts` ROUTE_META and `server/src/spa.ts` ROUTE_META):

1. **Static defaults** (`index.html`): proper `<title>`, description,
   canonical, full Open Graph/Twitter set between `<!--OG_START-->` /
   `<!--OG_END-->` markers, and a dedicated 1200×630 share image
   (`public/og-share.jpg`, ~100 KB JPEG — WhatsApp drops large or
   WebP previews). The template's old `noindex, nofollow` robots tag
   was also removed (it would have kept the production site out of
   search results entirely).
2. **Client updater** (`src/app/lib/meta.ts`): on every navigation the
   route's title/OG tags are applied; the article page refines its own
   entry (title, summary, scan image) once the record has loaded, so
   no stale previous-article tags survive. This layer serves tab
   titles and JS-capable crawlers — it does NOT reach WhatsApp /
   Facebook / Telegram, which never run JavaScript.
3. **Server injection** (`server/src/spa.ts`, opt-in `SERVE_SPA=true`):
   the API server also serves `dist/` and injects each page's tags
   into the raw HTML. `/news/:slug` resolves the *published* article
   (same eligibility as the public API; the view counter is NOT
   incremented for crawler fetches). Drafts and unknown slugs receive
   the default tags — nothing leaks. All values are attribute-escaped,
   image URLs are accepted only when site-relative or same-origin,
   URLs are built from `APP_URL` (never the Host header), HTML is
   served `Cache-Control: no-cache`, hashed `/assets/*` immutable,
   unknown asset paths 404, `/api/*` untouched. A dynamic
   `/sitemap.xml` (routes + published articles) is served in this
   mode; a static baseline ships in `public/` otherwise, with
   `public/robots.txt`.

**Deployment note:** layer 3 only works when the Node app receives
the page routes. On cPanel that means the "Setup Node.js App"
(Passenger) app must be the public front door (or a rewrite must send
page routes to it). With purely static hosting, layers 1–2 apply and
article shares fall back to the site share image.

**Known limit (owner informed):** the Gift Shop is a single page
(`/shop`) with no per-product URLs, so shared product links show the
shop preview. Per-product previews need product routes first.

## News article actions — assets, not page prints

The article footer's **Print** button was removed: it printed the
whole web page (and the site's print stylesheet deliberately renders
pages black, which is exactly the "black PDF named after the site
title" the owner hit — print-to-PDF takes the page `<title>` as its
filename). In its place, **Scan** downloads the clipping's own scan
image as `bodhisattva-<slug>.<ext>`:

- URL taken only from the loaded article record, must be same-origin
  (review: no arbitrary-URL fetch proxy);
- extension derived from the actual bytes (review), slug sanitised
  to `[a-z0-9-]`, busy state + failure fallback (opens the scan in a
  new tab), object URL revoked after the click;
- the PDF button is unchanged — the server's publication-gated
  endpoint with the standardised `bodhisattva-<slug>.pdf` name.
  Invoice/order printing in account/admin areas is untouched.

## Content protection (client requirement)

Public site only; the admin app is fully exempt, and form fields stay
fully usable. Live measures (`useWebsiteProtection` in
`src/app/components/shared.tsx` + the privacy screen in `App.tsx`):

- right-click blocked except inside form fields (review: paste /
  spellcheck / password managers keep working there);
- image drag blocked; copy/cut blocked outside editable fields;
- F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S blocked (never while typing
  in a form field) — content briefly obscures;
- PrintScreen (keydown and keyup) triggers the obscure layer;
- content obscures while the window is blurred / tab hidden, clears
  on focus, and any click resumes (the privacy screen says so), so a
  visitor can never be trapped in a blurred page;
- print rendering of pages is blacked out by the print stylesheet.

**Deliberately NOT implemented (unanimous reviewer advice):**
DevTools-open detection via window-size delta (false-positives on
125% display scaling, side panels and split-screen — it would lock
out ordinary visitors, including on the owner's own 125%-scaled
display) and clipboard clearing on PrintScreen (destroys whatever the
visitor legitimately copied, e.g. a checkout address, for near-zero
protection).

**Honest limit, stated to the owner:** these are deterrents, not
guarantees — no website can fully block OS screenshot tools or
browser-menu developer tools. The reviewers' stronger long-term
suggestion (public images at display resolution, originals held back)
is recorded here as a future option, not part of this change.
