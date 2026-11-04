import { ColourRelations } from "@/features/outfit-studio/colour-relations";
import { pieceLabel } from "@/features/outfit-studio/names";
import { HARMONY_TEXT } from "@/features/palette/palette-view";
import type { BoardDetail, ChosenColour } from "@/types/api";

/** The API's threshold: a chosen colour this close to a measured one counts as the same. */
export const SAME_COLOUR = 10;

function Swatch({ hex }: { hex: string }) {
  return <span aria-hidden className="size-5 shrink-0 border border-ink/15" style={{ backgroundColor: hex }} />;
}

/** What the chosen colour's nearest measured colour is, in words. */
export function matchText(colour: ChosenColour, pieceName: (itemId: string) => string): string {
  const { nearest } = colour;
  if (!nearest) return "No measured pieces on this board to compare with.";
  const where = `${nearest.name} on ${pieceName(nearest.item_id)}`;
  const difference = `difference ${nearest.distance.toFixed(1)}`;
  return colour.on_pieces ? `Matches ${where} (${difference}).` : `Not on the pieces yet; nearest is ${where} (${difference}).`;
}

/** The board's colours as Thread measured and you chose them: relationships, not a verdict. */
export function ColourStoryView({ board }: { board: BoardDetail }) {
  const { measured, chosen, harmony } = board.colour_story;
  const items = new Map(board.blocks.flatMap((b) => (b.item ? [[b.item.id, b.item] as const] : [])));
  const pieceName = (itemId: string) => {
    const item = items.get(itemId);
    return item ? pieceLabel(item) : "a piece";
  };

  return (
    <section aria-labelledby="colour-story-title" className="border-t border-line pt-10">
      <h2 id="colour-story-title" className="font-display text-3xl">
        Colour story
      </h2>
      {harmony ? (
        <p className="mt-2 text-sm">
          <span className="text-ink-muted">Harmony: </span>
          {HARMONY_TEXT[harmony]}
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Add pieces or colours and the board&apos;s colour story appears here.</p>
      )}

      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <ColourRelations colours={measured} />

        <section aria-labelledby="chosen-colours-title">
          <h3 id="chosen-colours-title" className="font-display text-2xl">
            Chosen colours
          </h3>
          {chosen.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No colours chosen yet. Add one from the panel.</p>
          ) : (
            <ul aria-label="Chosen colours and their nearest measured colour" className="mt-3 space-y-3">
              {chosen.map((colour) => (
                <li key={colour.block_id} className="flex gap-3">
                  <Swatch hex={colour.hex} />
                  <div className="min-w-0 text-sm">
                    <p>
                      <span className="capitalize">{colour.name}</span>{" "}
                      <span className="font-mono text-xs text-ink-muted">{colour.hex.toUpperCase()}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-ink-muted">
                      {colour.nearest && <Swatch hex={colour.nearest.hex} />}
                      <span className="min-w-0 break-words">{matchText(colour, pieceName)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <details className="mt-6 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
        <summary className="cursor-pointer">How the colour story is worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Colour relationships come from the pieces&apos; measured palettes, as in the outfit studio. A piece placed twice counts once.</li>
          <li>
            Each chosen colour is compared with every colour measured on the board&apos;s pieces (covering 5% or more of a
            photograph), using the CIEDE2000 colour difference. A difference of {SAME_COLOUR} or less counts as the same colour.
          </li>
          <li>The harmony takes the dominant measured colours and the chosen colours together, by the same rule as a single palette.</li>
          <li>Nothing here is written by a model, and none of it is a judgement on whether the colours work.</li>
        </ul>
      </details>
    </section>
  );
}
