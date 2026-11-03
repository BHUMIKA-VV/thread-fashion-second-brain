import data from "./indian-colours.json";

import type { ColorFamily } from "@/types/api";

/**
 * Thread's Indian colour names (backend/app/color/data/indian_colors.json), with the demo
 * pieces whose measured palettes come close to each. Written by
 * backend/scripts/export_colour_names.py from the published demo; nothing here is estimated.
 */

export type ColourMatch = {
  piece: string;
  /** The piece's own measured colour that is closest to the reference shade. */
  hex: string;
  name: string;
  share: number;
  /** CIEDE2000 distance from the reference shade. */
  distance: number;
};

export type IndianColour = { name: string; slug: string; hex: string; family: ColorFamily; pieces: ColourMatch[] };

export const COLOUR_NAMES = data as unknown as {
  source: string;
  max_distance: number;
  min_share: number;
  colours: IndianColour[];
};

/** What each name means: the word, not a claim about how the colour is used. */
export const MEANINGS: Record<string, string> = {
  "haldi yellow": "Haldi is turmeric.",
  "kesari saffron": "Kesari, from kesar: saffron.",
  "sindoor red": "Sindoor is vermilion powder.",
  "kumkum red": "Kumkum is the red powder used for a tilak.",
  "anar red": "Anar is pomegranate.",
  "gulabi pink": "Gulabi means rose-coloured, from gulab, a rose.",
  "rani pink": "Rani means queen; rani pink is the vivid magenta-pink of that name.",
  "gajri orange": "Gajri, from gajar: carrot.",
  "mehendi green": "Mehendi is henna.",
  "tota green": "Tota is a parrot.",
  "pista green": "Pista is pistachio.",
  "neel indigo": "Neel is indigo, the dye and the colour.",
  "morpankhi blue": "Morpankhi means like a peacock's feather.",
  "firozi turquoise": "Firozi, from firoza: turquoise, the stone.",
  "aasmani blue": "Aasmani, from aasman: the sky.",
  "jamuni purple": "Jamuni, from jamun, the dark purple fruit also called Java plum.",
  "baingani aubergine": "Baingani, from baingan: aubergine.",
  "kattha brown": "Kattha is catechu, a brown plant extract also used as a dye.",
  "mitti terracotta": "Mitti is earth or clay.",
  "badami almond": "Badami, from badam: almond.",
  "chandan sandalwood": "Chandan is sandalwood.",
  "malai cream": "Malai is cream.",
  "zari gold": "Zari is metallic thread woven into textiles, often gold.",
  "chandi silver": "Chandi is silver.",
  "hathi grey": "Hathi is an elephant.",
  "kajal black": "Kajal is kohl.",
};
