import { cn } from "@/lib/cn";
import type { PaletteColor } from "@/types/api";

/** A thin proportional band of palette colours (decorative summary; details live elsewhere). */
export function PaletteStrip({ colors, className }: { colors: PaletteColor[]; className?: string }) {
  return (
    <div
      className={cn("flex h-2 overflow-hidden", className)}
      role="img"
      aria-label={`Palette: ${colors.map((c) => c.name).join(", ")}`}
    >
      {colors.map((color) => (
        <span
          key={color.hex}
          style={{ backgroundColor: color.hex, flexGrow: color.percentage }}
          className="min-w-0.5 basis-0"
        />
      ))}
    </div>
  );
}
