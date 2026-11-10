import { Presentation } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { matchText } from "@/features/boards/colour-story";
import { HARMONY_TEXT } from "@/features/palette/harmony";
import { demoChosen, demoPieceName } from "@/features/present/slides";
import { cn } from "@/lib/cn";

import { creditParts, demoPiece, type DemoBoard } from "./demo-data";
import { DemoCover } from "./demo-sections";
import { DemoTile } from "./demo-tile";

function Swatch({ hex, className }: { hex: string; className?: string }) {
  return <span aria-hidden className={cn("block shrink-0 border border-ink/15", className)} style={{ backgroundColor: hex }} />;
}

/** The demo's sample board, read-only: its blocks in order, then its calculated colour story. */
export function DemoBoardView({ board }: { board: DemoBoard }) {
  const chosen = demoChosen(board);
  const byBlock = new Map(chosen.map((c) => [Number(c.block_id), c]));
  const { measured, harmony } = board.colour_story;
  const total = measured.reduce((sum, c) => sum + c.share, 0) || 1;

  return (
    <div>
      <ButtonLink href={`/demo/boards/${board.id}/present`}>
        <Presentation aria-hidden className="size-4" /> Present
      </ButtonLink>

      <ol aria-label="Blocks on this board" className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {board.blocks.map((block, index) => {
          if (block.kind === "heading") {
            return (
              <li key={index} className="col-span-full border-t border-ink pt-5">
                <h2 className="font-display text-3xl">{block.body}</h2>
              </li>
            );
          }
          if (block.kind === "note") {
            return (
              <li key={index} className="col-span-2 self-start border-l-2 border-clay pl-4 leading-relaxed">
                {block.body}
              </li>
            );
          }
          if (block.kind === "colour") {
            const story = byBlock.get(index);
            return (
              <li key={index} className="text-sm">
                <Swatch hex={block.hex} className="aspect-[3/4] w-full" />
                <p className="mt-2 capitalize">{block.name}</p>
                <p className="font-mono text-xs text-ink-muted">{block.hex.toUpperCase()}</p>
                {block.body && <p className="mt-1">{block.body}</p>}
                {story && <p className="mt-1 text-xs text-ink-muted">{matchText(story, demoPieceName)}</p>}
              </li>
            );
          }
          const piece = demoPiece(block.piece);
          if (!piece) return null;
          return (
            <li key={index} className="text-sm">
              <DemoTile piece={piece} />
              {block.body && <p className="mt-2">{block.body}</p>}
              {/* The museum credit and object number stay with the piece wherever it appears. */}
              <p className="mt-1 text-xs text-ink-muted">{creditParts(piece.credit).text}.</p>
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="demo-board-story" className="mt-14 border-t border-ink pt-5">
        <h2 id="demo-board-story" className="font-display text-3xl">
          Colour story
        </h2>
        {harmony && (
          <p className="mt-2 text-sm">
            <span className="text-ink-muted">Harmony: </span>
            {HARMONY_TEXT[harmony]}
          </p>
        )}
        {measured.length > 0 && (
          <>
            <div role="img" aria-label={`Measured colours: ${measured.map((c) => c.name).join(", ")}`} className="mt-6 flex h-8 w-full overflow-hidden">
              {measured.map((c) => (
                <span key={c.hex} style={{ backgroundColor: c.hex, width: `${(c.share / total) * 100}%` }} />
              ))}
            </div>
            <ul aria-label="Measured colours and their shares" className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {measured.map((c) => (
                <li key={c.hex} className="flex items-center gap-2">
                  <Swatch hex={c.hex} className="size-4" />
                  <span className="capitalize">{c.name}</span>
                  <span className="text-ink-muted">{Math.round(c.share)}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {chosen.length > 0 && (
          <ul aria-label="Chosen colours and their nearest measured colour" className="mt-6 space-y-2 text-sm">
            {chosen.map((c) => (
              <li key={c.block_id} className="flex gap-3">
                <Swatch hex={c.hex} className="mt-0.5 size-5" />
                <span>
                  <span className="capitalize">{c.name}</span> <span className="font-mono text-xs text-ink-muted">{c.hex.toUpperCase()}</span>
                  <span className="block text-ink-muted">{matchText(c, demoPieceName)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-xs text-ink-muted">
          Calculated when the demo was built, by the same code as a board in your own archive: colours measured from the photographs and
          compared with CIEDE2000. Nothing here is written by a model.
        </p>
      </section>
    </div>
  );
}

/** A card for each sample board on the demo's front page. */
export function DemoBoardList({ boards }: { boards: DemoBoard[] }) {
  return (
    <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {boards.map((b) => {
        const pieces = b.blocks.flatMap((x) => (x.kind === "piece" ? [x.piece] : []));
        return (
          <li key={b.id}>
            <Link href={`/demo/boards/${b.id}`} className="group block">
              <DemoCover ids={pieces} />
              <span className="mt-3 block font-display text-xl group-hover:underline">{b.title}</span>
              <span className="text-xs text-ink-muted">
                {pieces.length} pieces · {b.blocks.length} blocks
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
