"use client";

import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/features/auth/use-session";
import { getLibrarySummary, listItems } from "@/services/items";
import { getShowcaseSummary } from "@/services/showcase";
import type { ColorFamily, Item, ShowcaseItem } from "@/types/api";

/** A piece the landing page can show, from your archive or from the public showcase. */
export type LandingPiece = {
  id: string;
  href: string;
  image: string;
  thumbnail: string;
  type: string;
  alt: string;
  colours: { hex: string; name: string; percentage: number }[];
};

export type LandingData = {
  pending: boolean;
  signedIn: boolean;
  /** Where the pieces come from, as a caption: "your archive" or "the showcase". */
  source: string;
  pieces: LandingPiece[];
  families: { family: ColorFamily; items: number }[];
  /** Where a colour family links to: your filtered archive, or the filtered showcase. */
  familyHref: (family: ColorFamily) => string;
};

const PIECES = 8;

function fromItem(item: Item): LandingPiece {
  return {
    id: item.id,
    href: `/items/${item.id}`,
    image: item.image_url,
    thumbnail: item.thumbnail_url,
    type: item.type,
    alt: item.notes ? item.notes.slice(0, 120) : `A ${item.type} from your archive`,
    colours: item.palette?.colors ?? [],
  };
}

function fromShowcase(item: ShowcaseItem): LandingPiece {
  const colours = item.palette?.colors ?? [];
  return {
    id: item.id,
    href: `/showcase/${item.id}`,
    image: item.image_url,
    thumbnail: item.thumbnail_url,
    type: item.type,
    alt: `A ${item.type}${colours.length ? ` in ${colours.slice(0, 2).map((c) => c.name).join(" and ")}` : ""}`,
    colours,
  };
}

/**
 * Real pieces for the landing page: signed in, your newest pieces and your colour families;
 * signed out, the newest published pieces and the showcase's families. Never invented: with
 * nothing to show, `pieces` is empty and the page uses plain brand colour instead.
 */
export function useLandingPieces(): LandingData {
  const session = useSession();
  const signedIn = !!session.data;
  const signedOut = session.data === null;

  const own = useQuery({
    queryKey: ["items", "list", "landing"],
    queryFn: () => listItems({ limit: PIECES }),
    enabled: signedIn,
  });
  const ownSummary = useQuery({ queryKey: ["items", "summary"], queryFn: getLibrarySummary, enabled: signedIn });
  const showcase = useQuery({
    queryKey: ["showcase", "summary"],
    queryFn: getShowcaseSummary,
    enabled: signedOut,
    retry: false,
  });

  if (signedIn) {
    return {
      pending: own.isPending,
      signedIn,
      source: "your archive",
      pieces: (own.data?.items ?? []).map(fromItem),
      families: (ownSummary.data?.color_families ?? []).filter((f) => f.items > 0),
      familyHref: (family) => `/gallery?color=${family}`,
    };
  }
  return {
    pending: session.isPending || (signedOut && showcase.isPending),
    signedIn,
    source: "the showcase",
    pieces: (showcase.data?.recent ?? []).map(fromShowcase),
    families: (showcase.data?.color_families ?? []).filter((f) => f.items > 0),
    familyHref: (family) => `/showcase?color=${family}`,
  };
}
