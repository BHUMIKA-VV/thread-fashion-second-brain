import Image from "next/image";
import Link from "next/link";

import {
  creditParts,
  demoAsset,
  demoPiece,
  demoPieces,
  tagsByCategory,
  type DemoCollection,
  type DemoColour,
  type DemoOutfit,
  type DemoPiece,
  type OutfitColour,
} from "./demo-data";
import { DemoTile } from "./demo-tile";

/** The measured palette: a proportional bar, then each colour with its name, hex and share. */
export function DemoPalette({ colours }: { colours: DemoColour[] }) {
  return (
    <section aria-labelledby="palette-title" className="border-t border-ink pt-5">
      <h2 id="palette-title" className="font-display text-xl">
        Palette
      </h2>
      <div
        className="mt-4 flex h-14 overflow-hidden"
        role="img"
        aria-label={`Palette: ${colours.map((c) => `${c.name} ${Math.round(c.percentage)}%`).join(", ")}`}
      >
        {colours.map((c) => (
          <span key={c.hex} style={{ backgroundColor: c.hex, width: `${c.percentage}%` }} />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {colours.map((c) => (
          <li key={c.hex} className="flex items-center gap-3">
            <span aria-hidden className="size-4 shrink-0 border border-ink/10" style={{ backgroundColor: c.hex }} />
            <span className="capitalize">{c.name}</span>
            <span className="ml-auto font-mono text-xs text-ink-muted">
              {c.hex.toUpperCase()} · {Math.round(c.percentage)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-muted">
        Measured from the photograph in CIELAB. The museum&apos;s backdrop can take a share, as it would in any photo.
      </p>
    </section>
  );
}

/** Tags by category: catalogue facts as they are, model suggestions marked as such. */
export function DemoTags({ piece }: { piece: DemoPiece }) {
  if (piece.tags.length === 0) return null;
  return (
    <section aria-labelledby="tags-title" className="border-t border-ink pt-5">
      <h2 id="tags-title" className="font-display text-xl">
        Craft &amp; form
      </h2>
      <dl className="mt-4 space-y-3 text-sm">
        {tagsByCategory(piece.tags).map(([category, tags]) => (
          <div key={category} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <dt className="capitalize text-ink-muted">{category}</dt>
            <dd>
              {tags.map((t, i) => (
                <span key={t.tag}>
                  {i > 0 && ", "}
                  {t.tag}
                  {t.source === "ai" && <span className="text-ink-muted">{t.is_guess ? " (guess)" : " (suggested)"}</span>}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-ink-muted">
        Tags without a mark come from the museum&apos;s catalogue. &ldquo;Suggested&rdquo; tags are from an image model and
        may be wrong; fabric is only ever a guess from a photo.
      </p>
    </section>
  );
}

export function DemoCredit({ piece }: { piece: DemoPiece }) {
  const credit = creditParts(piece.credit);
  return (
    <section aria-labelledby="credit-title" className="border-t border-ink pt-5 text-sm">
      <h2 id="credit-title" className="font-display text-xl">
        Source
      </h2>
      {piece.note && <p className="mt-3 text-ink-muted">{piece.note}</p>}
      <p className="mt-3">{credit.text}.</p>
      <p className="mt-1 text-ink-muted">{piece.licence}.</p>
      {credit.url && (
        <a href={credit.url} rel="noopener noreferrer" target="_blank" className="mt-3 inline-block underline underline-offset-4">
          View the museum record<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </section>
  );
}

/** Kindred pieces: by look (image model) and by palette (colour distance). */
export function DemoKindred({ piece }: { piece: DemoPiece }) {
  const look = piece.similar_look.slice(0, 4);
  const palette = piece.similar_palette.slice(0, 4);
  return (
    <div className="mt-20 space-y-14">
      {look.length > 0 && (
        <KindredRow
          id="kindred-look"
          title="Kindred by look"
          note="Nearest pieces by the image model's visual similarity (1.00 would be identical)."
          entries={look.map((s) => ({ id: s.id, label: `Similarity ${s.similarity.toFixed(2)}` }))}
        />
      )}
      <KindredRow
        id="kindred-palette"
        title="Kindred by palette"
        note="Closest palettes by colour distance (CIEDE2000; lower is closer)."
        entries={palette.map((s) => ({ id: s.id, label: `Distance ${s.distance.toFixed(1)}` }))}
      />
    </div>
  );
}

function KindredRow({ id, title, note, entries }: { id: string; title: string; note: string; entries: { id: string; label: string }[] }) {
  return (
    <section aria-labelledby={id} className="border-t border-ink pt-5">
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
        {entries.map((e) => {
          const p = demoPiece(e.id);
          return p ? (
            <li key={e.id}>
              <DemoTile piece={p} sizes="(min-width: 640px) 25vw, 50vw" />
              <p className="mt-1 font-mono text-xs text-ink-muted">{e.label}</p>
            </li>
          ) : null;
        })}
      </ul>
    </section>
  );
}

/** Up to four thumbnails, as a collection or outfit cover. */
export function DemoCover({ ids }: { ids: string[] }) {
  return (
    <span className="grid aspect-[4/3] grid-cols-2 gap-px bg-line">
      {demoPieces(ids)
        .slice(0, 4)
        .map((p) => (
          <span key={p.id} className="relative block overflow-hidden bg-paper-raised">
            <Image src={demoAsset(p.thumbnail)} alt="" fill sizes="(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 50vw" className="object-cover" />
          </span>
        ))}
    </span>
  );
}

export function DemoCollectionList({ collections }: { collections: DemoCollection[] }) {
  return (
    <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {collections.map((c) => (
        <li key={c.id}>
          <Link href={`/demo/collections/${c.id}`} className="group block">
            <DemoCover ids={c.pieces} />
            <span className="mt-3 block font-display text-xl group-hover:underline">{c.title}</span>
            <span className="text-xs text-ink-muted">{c.pieces.length} pieces</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DemoOutfitList({ outfits }: { outfits: DemoOutfit[] }) {
  return (
    <ul className="mt-6 grid gap-6 sm:grid-cols-3">
      {outfits.map((o) => (
        <li key={o.id}>
          <Link href={`/demo/outfits/${o.id}`} className="group block">
            <DemoCover ids={o.pieces} />
            <span className="mt-3 block font-display text-xl group-hover:underline">{o.title}</span>
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              {o.pieces.length} pieces
              <span role="img" aria-label={`Main colours: ${o.colours.dominant.map((c) => c.name).join(", ")}`} className="flex gap-0.5">
                {o.colours.dominant.slice(0, 4).map((c) => (
                  <span key={c.hex} className="size-2.5 border border-ink/15" style={{ backgroundColor: c.hex }} />
                ))}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function OutfitSwatch({ colour }: { colour: OutfitColour }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="size-4 shrink-0 border border-ink/10" style={{ backgroundColor: colour.hex }} />
      <span className="capitalize">{colour.name}</span>
    </span>
  );
}
