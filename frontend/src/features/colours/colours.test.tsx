import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JsonLd } from "@/components/json-ld";
import { DEMO, demoCollection, demoPiece } from "@/features/demo/demo-data";
import { colourNamesData, demoCollectionData, demoPieceData, websiteData } from "@/lib/structured-data";
import { COLOUR_NAMES, MEANINGS } from "./colours";

describe("the colour names data", () => {
  it("gives every name a meaning and links only real demo pieces", () => {
    expect(COLOUR_NAMES.colours).toHaveLength(26);
    for (const colour of COLOUR_NAMES.colours) {
      expect(MEANINGS[colour.name], colour.name).toBeTruthy();
      expect(colour.hex).toMatch(/^#[0-9a-f]{6}$/);
      for (const match of colour.pieces) {
        const piece = demoPiece(match.piece);
        expect(piece, match.piece).toBeDefined();
        // The colour shown is one the piece's own palette really has.
        expect(piece!.palette.some((c) => c.hex === match.hex)).toBe(true);
        expect(match.distance).toBeLessThanOrEqual(COLOUR_NAMES.max_distance);
      }
    }
    expect(Object.keys(MEANINGS).sort()).toEqual(COLOUR_NAMES.colours.map((c) => c.name).sort());
  });
});

describe("structured data", () => {
  it("describes demo pieces as public-domain artworks, never products", () => {
    const piece = DEMO.pieces[0];
    const data = demoPieceData(piece);
    expect(data["@type"]).toBe("VisualArtwork");
    expect(data.license).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(data.url).toMatch(new RegExp(`/demo/pieces/${piece.id}$`));
    expect(data.image).toMatch(/^https?:\/\/.+\/demo\/images\/.+\.webp$/);
    expect(data.sameAs).toMatch(/^https:\/\/(www\.metmuseum\.org|clevelandart\.org)\//);
    const everything = JSON.stringify([websiteData(), ...DEMO.pieces.map(demoPieceData), colourNamesData()]);
    expect(everything).not.toMatch(/"Product"|"Offer"|"price"/);
  });

  it("lists a collection's pieces in order, and every colour name as a term", () => {
    const collection = demoCollection("indian-textiles")!;
    const list = demoCollectionData(collection).mainEntity.itemListElement;
    expect(list.map((i) => i.position)).toEqual(collection.pieces.map((_, i) => i + 1));
    expect(list[0].url).toMatch(new RegExp(`/demo/pieces/${collection.pieces[0]}$`));
    const terms = colourNamesData().hasDefinedTerm;
    expect(terms).toHaveLength(26);
    expect(terms.find((t) => t.name === "neel indigo")).toMatchObject({ termCode: "#263b5e", description: "Neel is indigo, the dye and the colour." });
  });

  it("can't be broken out of by the text it carries", () => {
    const { container } = render(<JsonLd data={{ name: "</script><script>alert(1)</script>" }} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(script.innerHTML).not.toContain("</script>");
    expect(JSON.parse(script.textContent!)).toMatchObject({ "@context": "https://schema.org", name: "</script><script>alert(1)</script>" });
  });
});
