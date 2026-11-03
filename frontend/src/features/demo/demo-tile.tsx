import Image from "next/image";
import Link from "next/link";

import { PaletteStrip } from "@/features/palette/palette-strip";

import { demoAsset, pieceAlt, type DemoPiece } from "./demo-data";

/** One demo piece in a grid: image, measured palette band, type and title. */
export function DemoTile({ piece, sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" }: { piece: DemoPiece; sizes?: string }) {
  return (
    <Link href={`/demo/pieces/${piece.id}`} className="group block">
      <span className="relative block aspect-[3/4] overflow-hidden bg-paper-raised">
        <Image
          src={demoAsset(piece.thumbnail)}
          alt={pieceAlt(piece)}
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-700 group-hover:scale-[1.02] motion-reduce:transition-none"
        />
      </span>
      {piece.palette.length > 0 && <PaletteStrip colors={piece.palette} />}
      <span className="block border-b border-line py-2.5">
        <span className="block text-[11px] uppercase tracking-[0.2em] text-ink-muted">{piece.type}</span>
        <span className="mt-1 block text-sm leading-snug text-ink group-hover:underline">{piece.title}</span>
      </span>
    </Link>
  );
}
