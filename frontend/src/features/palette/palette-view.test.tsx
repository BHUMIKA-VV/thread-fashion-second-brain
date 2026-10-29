import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeItem, renderWithQuery } from "@/test/render";
import type { Item, Palette } from "@/types/api";
import { PaletteView } from "./palette-view";

const palette: Palette = {
  colors: [
    { hex: "#e3a018", rgb: [227, 160, 24], name: "haldi yellow", family: "orange", percentage: 70 },
    { hex: "#263b5e", rgb: [38, 59, 94], name: "neel indigo", family: "blue", percentage: 30 },
  ],
  harmony: "complementary",
  source: "original",
  updated_at: "2026-10-24T10:00:00Z",
};

function withPalette(overrides: Partial<Item> = {}): Item {
  const item = makeItem({ stage_status: { thumbnail: "completed", palette: "completed" }, palette, ...overrides });
  return { ...item, palette_card_url: item.palette ? `/items/${item.id}/palette.png` : null };
}

afterEach(() => vi.unstubAllGlobals());

describe("PaletteView", () => {
  it("shows the extracted swatches, hex values and shares", () => {
    renderWithQuery(<PaletteView item={withPalette()} />);

    expect(screen.getByRole("button", { name: /^Copy haldi yellow\s*#E3A018/ })).toBeInTheDocument();
    expect(screen.getByText("#E3A018 · 70%")).toBeInTheDocument();
    expect(screen.getByText("#263B5E · 30%")).toBeInTheDocument();
    expect(screen.getByText(/Harmony \(heuristic\)/)).toBeInTheDocument();
    expect(screen.getByText(/Complementary/)).toBeInTheDocument();
    expect(screen.getByText(/whole image/)).toBeInTheDocument();
  });

  it("links the PNG export through the API proxy", () => {
    const item = withPalette();
    renderWithQuery(<PaletteView item={item} />);

    const link = screen.getByRole("link", { name: "Export card" });
    expect(link).toHaveAttribute("href", `/api/items/${item.id}/palette.png`);
    expect(link).toHaveAttribute("download");
  });

  it("copies a hex value to the clipboard and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderWithQuery(<PaletteView item={withPalette()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Copy neel indigo\s*#263B5E/ }));

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("#263b5e");
  });

  it("falls back to the legacy copy command when the Clipboard API is refused", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;
    renderWithQuery(<PaletteView item={withPalette()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Copy haldi yellow\s*#E3A018/ }));

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("says so when no copy method works", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderWithQuery(<PaletteView item={withPalette()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Copy haldi yellow\s*#E3A018/ }));

    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
  });

  it("shows no colours when extraction failed, and retries on request", async () => {
    const item = makeItem({ stage_status: { thumbnail: "completed", palette: "failed" } });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(withPalette({ id: item.id })));
    renderWithQuery(<PaletteView item={item} />);

    expect(screen.getByText(/could not be extracted/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export card" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/items/${item.id}/palette`, { method: "POST" }),
    );
  });

  it("surfaces the server's error message when a retry fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: { code: "palette_failed", message: "The colour palette could not be extracted from this image.", details: null } },
        { status: 422 },
      ),
    );
    renderWithQuery(<PaletteView item={makeItem()} />);

    fireEvent.click(screen.getByRole("button", { name: "Extract palette" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be extracted");
  });
});
