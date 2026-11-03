"use client";

import { useEffect } from "react";

import { countView, type CountedPage } from "@/lib/beacon";

/** Counts this visit seeing a public page (see lib/beacon.ts). Renders nothing. */
export function CountView({ event }: { event: CountedPage }) {
  useEffect(() => countView(event), [event]);
  return null;
}
