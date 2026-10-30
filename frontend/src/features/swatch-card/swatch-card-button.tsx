"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-client";
import { cardFilename, renderSwatchCard, type CardColour } from "@/lib/swatch-card";

/** Download a 1080 x 1350 swatch card of this piece, made in the browser. */
export function SwatchCardButton({
  id,
  imageUrl,
  colours,
  type,
}: {
  id: string;
  imageUrl: string;
  colours: CardColour[];
  type: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  if (colours.length === 0) return null;

  const download = async () => {
    setState("busy");
    try {
      const blob = await renderSwatchCard({
        imageUrl: apiUrl(imageUrl),
        wordmarkUrl: "/brand/thread-wordmark.png",
        colours,
        caption: `${type} · Record ${id.slice(0, 6).toUpperCase()}`,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = cardFilename(id);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <div>
      <Button variant="secondary" onClick={() => void download()} disabled={state === "busy"}>
        <Download aria-hidden className="size-4" /> {state === "busy" ? "Making the card…" : "Download swatch card"}
      </Button>
      {state === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          The card could not be made in this browser.
        </p>
      )}
    </div>
  );
}
