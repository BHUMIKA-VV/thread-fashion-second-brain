import type { OutfitColour, OutfitColours } from "@/types/api";

function Chip({ colour }: { colour: OutfitColour }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm capitalize">
      <span aria-hidden className="size-4 shrink-0 border border-ink/15" style={{ backgroundColor: colour.hex }} />
      {colour.name}
    </span>
  );
}

function Pairs({ title, pairs, none }: { title: string; pairs: [OutfitColour, OutfitColour][]; none: string }) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-[0.18em] text-ink-muted">{title}</h4>
      {pairs.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{none}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {pairs.map(([a, b]) => (
            <li key={`${a.hex}${b.hex}`} className="flex flex-wrap items-center gap-x-2">
              <Chip colour={a} />
              <span aria-hidden className="text-ink-muted">
                /
              </span>
              <span className="sr-only">with</span>
              <Chip colour={b} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Relationships calculated from the pieces' stored palettes; never a verdict on the outfit. */
export function ColourRelations({ colours }: { colours: OutfitColours }) {
  const { dominant, shared, complementary, contrasting, pieces_with_palette: measured } = colours;
  return (
    <section aria-labelledby="colour-title">
      <h3 id="colour-title" className="font-display text-2xl">
        Colour relationships
      </h3>
      {measured === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Add a piece with a measured palette to see how its colours relate.</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <h4 className="text-xs uppercase tracking-[0.18em] text-ink-muted">Dominant</h4>
            <div aria-hidden className="mt-1.5 flex h-3 overflow-hidden">
              {dominant.map((c) => (
                <span key={c.hex} style={{ backgroundColor: c.hex, flexGrow: c.share }} className="min-w-0.5 basis-0" />
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {dominant.map((c) => (
                <li key={c.hex} className="flex items-center justify-between gap-3">
                  <Chip colour={c} />
                  <span className="text-xs text-ink-muted">{Math.round(c.share)}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-[0.18em] text-ink-muted">Shared</h4>
            {shared.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">No colour appears in two pieces.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {shared.map((c) => (
                  <li key={c.hex}>
                    <Chip colour={c} />
                    <span className="ml-1 text-xs text-ink-muted">in {c.item_ids.length} pieces</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Pairs title="Complementary" pairs={complementary} none="No opposite hues across pieces." />
          <Pairs title="Contrasting" pairs={contrasting} none="No strong light and dark contrast across pieces." />
        </div>
      )}
      {colours.pieces_without_palette > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          {colours.pieces_without_palette} {colours.pieces_without_palette === 1 ? "piece has" : "pieces have"} no measured
          palette and {colours.pieces_without_palette === 1 ? "is" : "are"} left out.
        </p>
      )}
      <details className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
        <summary className="cursor-pointer">How these are worked out</summary>
        <p className="mt-2">
          These describe how the measured colours sit together. They are visual relationships, not rules about what
          looks good. Only colours covering at least 5% of a photograph count.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Dominant: each colour&apos;s average share across the pieces, with near-identical colours merged.</li>
          <li>Shared: a colour found in two or more pieces.</li>
          <li>Complementary: clearly coloured hues on different pieces, 150° to 210° apart on the colour wheel.</li>
          <li>Contrasting: colours on different pieces with a large difference in lightness (40 or more in CIELAB).</li>
        </ul>
      </details>
    </section>
  );
}
