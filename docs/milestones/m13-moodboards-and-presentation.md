# M13: Textile Moodboards & Client Presentation Studio

Status: proposed, not started. Follows M12 (client acquisition and growth), pushed at `f4bafe2`.

## Why this milestone

M12 brings people to Thread. M13 gives a professional a reason to stay: a studio collects
fabric photos and inspiration, builds a colour story, and presents it to a client as a
polished board, slide view or PDF. That is a tangible deliverable in their actual business
and the clearest candidate for a paid tier, more so than adding more AI tagging.

Moodboard Builder (priority 1) and Client Presentation Mode (priority 4) are built as one
feature: a **board** is what you compose; **present** and **export** are two ways of showing it.

## What already exists to build on

| Need | Already in Thread |
|---|---|
| Fabric photos with measured palettes | Items, with palette extraction (CIEDE2000, Indian colour names) |
| Grouping pieces with notes and order | Collections: `CollectionItem.position` and `.note` |
| Colour story of several pieces | `app/color/outfit.outfit_colours`, used by the outfit studio |
| Layout of several photos | `lib/outfit-layout.ts` and the outfit studio composition |
| Image export without a server | `lib/swatch-card.ts` and `lib/outfit-card.ts` draw PNGs on a canvas, memory-capped |
| Comparing palettes | `app/color/compare.palette_distance` |
| Natural-language search | CLIP text encoding (`Embedder.encode_texts`) behind `repositories/search.py` |

## Scope

A board holds an ordered list of blocks:

- **piece**: an archive item, shown with its photo and, optionally, its measured palette;
- **colour**: a swatch, picked from a piece's measured palette or entered as a hex, named
  with Thread's colour names;
- **note**: designer text (heading or paragraph);
- **inspiration image**: a picture that is not part of the archive (see decision 1).

From a board you can:

- **present** it: a full-screen, keyboard-driven slide view for a client meeting, which hides
  internal detail (AI suggestions, guesses, status) unless the owner chooses to show it;
- **export a PNG** drawn in the browser, like the outfit card;
- **export a PDF** through a print stylesheet and the browser's "Save as PDF", with A4 and
  landscape pages. This needs no new dependency.

The colour story is calculated, never written by a model: the board's palette is measured
from its pieces and colour blocks, with shares, names and harmony.

## Increments

Each increment is independently testable and is committed only on approval.

1. **M13-1 Boards API.** `Board` and `BoardBlock` models, migration, schemas, service,
   routes (create, list, read, rename, delete; add, edit, reorder, remove blocks), owner-only
   access. Pytest coverage for ownership, ordering and validation.
2. **M13-2 Board editor.** `/boards` and `/boards/[id]`: add pieces from the archive or a
   collection, add colours (from a piece's palette or a hex), add notes, reorder with mouse
   and keyboard, remove. Vitest and Playwright, WCAG and phone-width checks.
3. **M13-3 Colour story.** The board's calculated palette (shares, Indian colour names,
   harmony) shown on the board and kept current as blocks change.
4. **M13-4 Export.** PNG board image drawn on a canvas (memory-capped like the outfit card)
   and a print stylesheet for PDF. Tests for layout, failed-image handling and print output.
5. **M13-5 Present mode.** Full-screen slides from a board or an existing collection: cover,
   pieces with palettes and notes, colour story, closing slide. Arrow keys, Escape, focus
   management, reduced motion respected. Internal detail hidden by default.
6. **M13-6 Inspiration images.** Upload images onto a board (depends on decision 1).
7. **M13-7 Demo board.** A static sample board in the public demo, built from the museum
   pieces, so visitors see the feature before signing up. Museum credits and object numbers
   stay on every piece; nothing is presented as a product for sale.

## Decisions needed before building

1. **Inspiration images.** Either they are uploaded as ordinary archive items of type
   "other" (they get palettes and search for free, but appear in the archive), or they are
   board-only images (kept out of the archive, need their own storage path and limits).
   Recommendation: archive items, with a filter to hide type "other" from the gallery.
2. **Collections and boards.** Boards are a new object, and a collection can be turned into
   a board (copying its pieces and notes) or presented directly. Recommendation: both.
3. **Paid tier.** Nothing is gated in M13. Which parts become paid is decided after
   interviews, not assumed here.

## Out of scope for M13

- Public share links for boards (privacy requirements not validated; same rule as M12).
- A generic AI chatbot, or AI-written textile descriptions on boards.
- Social or networking features.
- Inventory and sample tracking (priority 6): wait for customer interviews.

## Later milestones, in priority order

- **Fabric colour matching (priority 2).** Compare two fabrics' measured palettes: closest
  matches, differences, complementary colours. Builds on `palette_distance`.
- **Smart textile search (priority 3).** Natural-language search such as "warm beige silk
  with gold tones", combining the existing CLIP text search with colour-name and tag
  filters parsed from the query.
- **Combination intelligence (priority 5).** Suggestions from colour harmony, fabric and
  garment category, explained by the measurements behind them.
- **Inventory and sample tracking (priority 6).** Quantities, supplier, price, location and
  sample status, after interviews confirm the need.

## Constraints carried over

- No new dependencies unless unavoidable; PDF via print CSS, PNG via canvas.
- No fake features, testimonials, users or partnerships; no misleading AI claims.
- Keep the existing visual identity; WCAG 2.2 AA and phone widths for every new page.
- The 16 protected uncommitted files stay untouched; nothing is committed, pushed or
  deployed without approval.
