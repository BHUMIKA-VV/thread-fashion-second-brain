import { COLOUR_NAMES, MEANINGS } from "@/features/colours/colours";
import { creditParts, demoAsset, demoPiece, type DemoCollection, type DemoPiece } from "@/features/demo/demo-data";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";

/**
 * schema.org descriptions of the public pages, built only from what the pages show. Demo pieces
 * are museum objects, described as artworks with their credit and licence, never as products.
 */

const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

export const absolute = (path: string) => new URL(path, SITE_URL).href;

export function websiteData() {
  return { "@type": "WebSite", name: "Thread", url: absolute("/"), description: SITE_DESCRIPTION };
}

export function demoPieceData(piece: DemoPiece) {
  const credit = creditParts(piece.credit);
  return {
    "@type": "VisualArtwork",
    name: piece.title,
    url: absolute(`/demo/pieces/${piece.id}`),
    image: absolute(demoAsset(piece.image)),
    ...(piece.note && { description: piece.note }),
    creditText: credit.text,
    ...(credit.url && { sameAs: credit.url }),
    // Every demo piece is public domain (CC0); features/demo/demo.test.tsx checks it.
    license: CC0,
    keywords: [...piece.palette.map((c) => c.name), ...piece.tags.map((t) => t.tag)].join(", "),
    isPartOf: { "@type": "CollectionPage", name: "Explore Thread", url: absolute("/demo") },
  };
}

export function demoCollectionData(collection: DemoCollection) {
  return {
    "@type": "CollectionPage",
    name: collection.title,
    ...(collection.description && { description: collection.description }),
    url: absolute(`/demo/collections/${collection.id}`),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: collection.pieces.flatMap((id, index) => {
        const piece = demoPiece(id);
        return piece ? [{ "@type": "ListItem", position: index + 1, name: piece.title, url: absolute(`/demo/pieces/${id}`) }] : [];
      }),
    },
  };
}

export function colourNamesData() {
  return {
    "@type": "DefinedTermSet",
    name: "Indian colour names in Thread",
    description: COLOUR_NAMES.source,
    url: absolute("/colours"),
    hasDefinedTerm: COLOUR_NAMES.colours.map((c) => ({
      "@type": "DefinedTerm",
      name: c.name,
      termCode: c.hex,
      description: MEANINGS[c.name],
      url: absolute(`/colours#${c.slug}`),
    })),
  };
}
