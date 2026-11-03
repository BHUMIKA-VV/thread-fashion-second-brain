# Website attraction and public demo: report

Milestone W1–W5, 3 November 2026. Nothing in this milestone is staged, committed, pushed or
deployed. The 17 outstanding files from before the milestone are untouched (checksums in
`frontend/.cache/10a-outstanding.sha256`); the two protected files edited with approval are
recorded in `frontend/.cache/w4-approved-edits.sha256`.

## What was built

**Landing page (signed out).** The cover now offers *Explore Thread* (to the demo) first and
*Create your wardrobe* second; the closing section offers *Explore the demo*, *Create your
wardrobe* and *Sign in*, in that order. Between them, in this order:

1. **Before · After**: five rows from scattered photos to what Thread does with them.
2. **What an archive looks like**: five unretouched screenshots of the real app (below).
3. **Try it on twenty museum pieces**: the demo's sample collections, linking into it.
4. The existing gallery, colour story and how-it-works sections.
5. **Who Thread is for**: fashion enthusiasts, stylists, designers, textile collectors.
6. **Why Thread**: private by default, measured not invented, honest about guesses, nothing
   leaves without asking.

There are no testimonials, ratings, user counts or popups, and a test fails if any appear.
Signed in, the landing page is unchanged: none of these sections are shown. With reduced
motion, the reveal animations now render content immediately (previously it stayed at
opacity 0; fixed with a regression test).

**Public read-only demo** at `/demo`: twenty public-domain museum pieces, searchable by text
and filterable by colour family and type, with a page per piece (photograph, measured palette,
tags marked as recorded or AI-suggested, credit and licence, kindred pieces by look and by
palette), four sample collections and three outfits with their shared and contrasting colours.
It is static: the pages are prerendered from `public/demo/demo.json`, make no API calls
other than the header's session check, and send no writes (both enforced by tests). Header and
footer gain a *Demo* link.

**Discoverability.** Share cards (Open Graph and Twitter) on every page; demo pieces,
collections and outfits are shared with their own photograph. Canonical addresses on public
pages. `sitemap.xml` lists the public and demo pages; `robots.txt` asks crawlers to skip the API
and account pages. The site address comes from `THREAD_PUBLIC_URL` (the setting the API already
uses for email links), falling back to `http://127.0.0.1:3100`; it is read at build time.

## Dataset

Built offline by `backend/scripts/build_demo.py` using the app's own palette extraction,
CLIP model (`open_clip/ViT-B-32/laion2b_s34b_b79k`), tagger and similarity code. Images are
re-encoded as WebP (1600 px, and 640 px thumbnails) with all metadata stripped; 6.7 MB in all.
Tags taken from the museum catalogue are marked *recorded*; the model's suggestions are marked
*AI*. Notes and credits come from the museum records.

| Source | Pieces | Licence |
| --- | --- | --- |
| The Metropolitan Museum of Art, Open Access | 13: dresses (1872, 1883, 1896), coats (1845, 1882, c. 1900), a jacket, a blouse, trousers, a shawl, slippers, two pairs of boots | CC0 |
| The Cleveland Museum of Art, Open Access | 7: bandhani sari and odhani, warp-ikat panel, resist-dyed and gold-block-printed cotton, two Kashmir shawl pieces | CC0 |

Each piece's page links to its museum record. Collections: *Indian textiles*, *Kashmir shawls &
boteh*, *Colour-coordinated: reds* (only pieces whose measured palette is at least 10 % red or
pink), *Nineteenth-century dress*. Outfits: *Red shawl, dark coat*, *Ochre afternoon*,
*Printed cotton*. Each outfit says it was styled for the demo from pieces of different eras and
is not a historical ensemble.

## Screenshots

Captured by `frontend/e2e/capture-screenshots.spec.ts` (run with `THREAD_CAPTURE=1`): it signs
up a throwaway account on the test servers, uploads twelve demo images through the normal
upload API, records the same catalogue tags, builds a collection and an outfit, photographs the
real pages and deletes the account. The PNGs were resized and cropped only, never retouched.

| File (`frontend/public/screens/`) | Shows |
| --- | --- |
| `palette.webp` | A piece page with its measured palette |
| `similar.webp` | Kindred pieces with similarity scores (cropped to two rows) |
| `textile-record.webp` | Tags: weave and craft recorded by a person, AI suggestions labelled |
| `gallery.webp` | The archive with search and colour filters |
| `outfit-studio.webp` | The Outfit Studio with an outfit's colour relationships |
| `og.jpg` | Share image, 1200×630, cut from the palette screenshot |

## Verification

| Check | Result |
| --- | --- |
| Ruff (lint, and format on new files) | Clean |
| pytest, full backend suite | 516 passed |
| TypeScript (`tsc --noEmit`) | Clean |
| ESLint | Clean |
| Vitest | 151 passed (21 files) |
| Production build | Built (as part of the Playwright run) |
| Playwright, full suite, desktop and Pixel 7 | 107 passed, 7 skipped, 0 failed |
| `npm audit --omit=dev` | 0 vulnerabilities |

The 7 skips: the opt-in screenshot capture (both viewports) and five existing tests that apply
to one viewport only (drag and keyboard tests on desktop, a phone-width test on mobile).

**Accessibility.** axe (WCAG 2.0/2.1/2.2 A and AA) passes on the landing page and on the demo
index, a piece, a collection and an outfit. The demo filters work by keyboard. Every
screenshot and demo image has descriptive alt text. Reduced motion is tested.

**Responsive.** No horizontal overflow at 360 and 390 px on the landing and demo pages; the
product tour was also checked visually on desktop and a 390 px phone.

**Security and privacy.** The demo makes no data requests and no writes (tested). No new
dependencies. No secrets in new files; the capture spec uses the existing test password helper
and deletes its account. All 46 published images carry no EXIF, XMP or ICC metadata. Unknown
demo ids render the not-found page with `noindex`. The CSP and `next.config.ts` are unchanged.

## Changed files

Modified, tracked:

- `frontend/src/app/layout.tsx`: site address, share card
- `frontend/src/app/page.tsx`: demo invite slot, share card
- `frontend/src/app/how-it-works/page.tsx`: share card
- `frontend/src/components/site-header.tsx`, `site-footer.tsx`: *Demo* link
- `frontend/src/features/palette/palette-strip.tsx`: accepts the demo's palette shape
- `frontend/src/features/landing/hero.tsx` (protected, approved): CTAs, story sections,
  reduced-motion fix; 36 lines added, 11 removed relative to its outstanding state
- `frontend/e2e/health.spec.ts` (protected, approved): lines 20–21, the new cover CTAs

New:

- `backend/scripts/build_demo.py`, `backend/tests/test_build_demo.py`
- `frontend/src/app/demo/page.tsx`, `demo/pieces/[id]/page.tsx`, `demo/collections/[id]/page.tsx`,
  `demo/outfits/[id]/page.tsx`
- `frontend/src/app/sitemap.ts`, `frontend/src/app/robots.ts`
- `frontend/src/features/demo/`: `demo-data.ts`, `demo-browse.tsx`, `demo-notice.tsx`,
  `demo-sections.tsx`, `demo-tile.tsx`, `demo.test.tsx`
- `frontend/src/features/landing/story-sections.tsx`, `demo-invite.tsx`
- `frontend/src/lib/site.ts`, `site.test.ts`
- `frontend/e2e/demo.spec.ts`, `landing.spec.ts`, `capture-screenshots.spec.ts`
- `frontend/public/demo/` (`demo.json`, 20 images, 20 thumbnails)
- `frontend/public/screens/` (5 WebP screenshots, `og.jpg`)
- `docs/website-demo-report.md` (this report)

Outside the repository's tracked tree: the build manifest and original museum JPEGs in
`database/sample_data/demo/` (git-ignored), and the raw PNG captures in `frontend/.cache/screens/`.

## Limitations

- **Palettes include studio backdrops.** Garments are photographed on grey; background masking
  removes most of it, but some grey remains in garment palettes. Fabrics are cropped to the
  cloth, so their palettes are clean.
- **Some AI tags are wrong** (for example *ajrakh* on a Kashmir shawl). They are shown as AI
  suggestions, as in the app, rather than hidden or corrected.
- **Sizes not confirmed.** Some Met garments (the 1855 jacket among them) may be children's
  clothes; the museum pages could not be checked (rate-limited), and the demo does not claim either way.
- **Rebuilding the dataset needs the git-ignored manifest and source images.** They are not in
  the repository; `frontend/public/demo/` is the committed output.
- **Share images of demo pages are WebP.** Most current link previews render WebP; an older
  one may show no image. The site-wide card is JPEG.
- **`/terms` keeps the site-wide card** and has no canonical address, because the page is part
  of the protected outstanding work.
- **`THREAD_PUBLIC_URL` must be set at build time** in production, or share cards and the
  sitemap point at the local fallback.
- **When the API is down**, the header briefly shows a mixed signed-in/out state (existing
  behaviour, not changed here).
