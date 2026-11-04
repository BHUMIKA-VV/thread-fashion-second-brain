import { HARMONY_TEXT } from "@/features/palette/palette-view";
import { pieceLabel } from "@/features/outfit-studio/names";
import { apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { BoardDetail } from "@/types/api";

import { matchText } from "./colour-story";

/** Notes up to this long are kept on one printed page. */
const KEEP_NOTE_CHARS = 600;

/**
 * The board as printed, for "Save as PDF": only shown in print (A4 landscape, see globals.css).
 * Every note and caption is printed whole, and each piece keeps its full note and its source
 * link, so museum credits and record numbers travel with the photograph.
 */
export function BoardSheet({ board }: { board: BoardDetail }) {
  const { measured, chosen, harmony } = board.colour_story;
  const items = new Map(board.blocks.flatMap((b) => (b.item ? [[b.item.id, b.item] as const] : [])));
  const pieceName = (itemId: string) => {
    const item = items.get(itemId);
    return item ? pieceLabel(item) : "a piece";
  };
  const total = measured.dominant.reduce((sum, c) => sum + c.share, 0) || 1;

  return (
    <div className="board-sheet hidden text-ink print:block" data-testid="board-sheet">
      <header className="border-b border-line pb-4">
        <p className="text-[9pt] uppercase tracking-[0.28em] text-ink-muted">Board</p>
        <h2 className="font-display text-[28pt] leading-tight">{board.name}</h2>
        {board.description && <p className="mt-1 whitespace-pre-line text-[11pt] text-ink-muted">{board.description}</p>}
      </header>

      <ol className="mt-5 grid grid-cols-4 gap-4">
        {board.blocks.map((block) => {
          if (block.kind === "heading") {
            return (
              <li key={block.id} className="board-sheet-heading col-span-full pt-2 font-display text-[18pt] leading-tight">
                {block.body}
              </li>
            );
          }
          if (block.kind === "note") {
            return (
              <li
                key={block.id}
                // A short note stays on one page; a long one may run on rather than leave a page half empty.
                className={cn(
                  "col-span-2 whitespace-pre-line border-l-2 border-clay pl-3 text-[10pt]",
                  (block.body ?? "").length <= KEEP_NOTE_CHARS && "board-sheet-keep",
                )}
              >
                {block.body}
              </li>
            );
          }
          return (
            <li key={block.id} className="board-sheet-keep text-[8.5pt] leading-snug">
              {block.item && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
                  <img src={apiUrl(block.item.thumbnail_url)} alt={pieceLabel(block.item)} className="aspect-[3/4] w-full object-cover" />
                  <p className="mt-1 whitespace-pre-line">{block.item.notes?.trim() || pieceLabel(block.item)}</p>
                  {block.item.source_url && <p className="break-all text-ink-muted">{block.item.source_url}</p>}
                </>
              )}
              {block.colour && (
                <>
                  <div className="board-sheet-ink aspect-[3/4] w-full border border-line" style={{ backgroundColor: block.colour.hex }} />
                  <p className="mt-1 capitalize">
                    {block.colour.name} <span className="font-mono normal-case">{block.colour.hex.toUpperCase()}</span>
                  </p>
                </>
              )}
              {block.body && <p className="mt-0.5 whitespace-pre-line text-ink-muted">{block.body}</p>}
            </li>
          );
        })}
      </ol>

      {(harmony || measured.dominant.length > 0 || chosen.length > 0) && (
        <section className="board-sheet-keep mt-6 border-t border-line pt-4 text-[10pt]">
          <h3 className="font-display text-[16pt]">Colour story</h3>
          {harmony && <p className="text-ink-muted">Harmony: {HARMONY_TEXT[harmony]}</p>}
          {measured.dominant.length > 0 && (
            <>
              <div className="board-sheet-ink mt-2 flex h-4 w-full">
                {measured.dominant.map((c) => (
                  <span
                    key={c.hex}
                    style={{
                      backgroundColor: c.hex,
                      width: `${(c.share / total) * 100}%`,
                    }}
                  />
                ))}
              </div>
              <p className="mt-1 text-ink-muted">
                Measured: {measured.dominant.map((c) => `${c.name} ${Math.round(c.share)}%`).join(" · ")}
              </p>
            </>
          )}
          {chosen.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {chosen.map((c) => (
                <li key={c.block_id}>
                  <span className="capitalize">{c.name}</span> <span className="font-mono">{c.hex.toUpperCase()}</span>:{" "}
                  <span className="text-ink-muted">{matchText(c, pieceName)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[8pt] text-ink-muted">
            Colours are measured from the photographs and compared with CIEDE2000; nothing here is written by a model.
          </p>
        </section>
      )}
    </div>
  );
}
