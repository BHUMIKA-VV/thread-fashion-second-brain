"use client";

import { useSyncExternalStore } from "react";

import { Presenter } from "@/features/present/presenter";
import { demoBoardSlides } from "@/features/present/slides";

import type { DemoBoard } from "./demo-data";

const subscribe = () => () => {};

/**
 * The sample board's slides. The page is static and the presenter reads the slide number from
 * the address, so the slides are drawn only once the page runs in the browser.
 */
export function DemoPresentation({ board }: { board: DemoBoard }) {
  const browser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!browser) return <div role="status" aria-label="Loading the presentation" className="h-[50vh] animate-pulse bg-ink/[0.05]" />;
  return <Presenter slides={demoBoardSlides(board)} exitHref={`/demo/boards/${board.id}`} name={board.title} />;
}
