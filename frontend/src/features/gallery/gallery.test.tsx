import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeItem, renderWithQuery } from "@/test/render";
import type { ItemList } from "@/types/api";
import { Gallery } from "./gallery";

function listResponse(items: ItemList["items"], total = items.length): Response {
  return Response.json({ items, total, limit: 24, offset: 0 } satisfies ItemList);
}

describe("Gallery", () => {
  it("shows an empty state that links to upload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse([]));
    renderWithQuery(<Gallery />);

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload images" })).toHaveAttribute("href", "/upload");
  });

  it("renders thumbnails through the API proxy with honest status", async () => {
    const item = makeItem();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse([item]));
    renderWithQuery(<Gallery />);

    const link = await screen.findByRole("link", { name: /garment image/i });
    expect(link).toHaveAttribute("href", `/items/${item.id}`);
    expect(screen.getByRole("img")).toHaveAttribute("src", `/api/items/${item.id}/image?variant=thumbnail`);
    expect(screen.getByText("Awaiting analysis")).toBeInTheDocument();
    expect(screen.getByText("1 piece")).toBeInTheDocument();
  });

  it("filters by type through the query string", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => listResponse([]));
    renderWithQuery(<Gallery />);
    await screen.findByText("Your library is empty");

    fireEvent.click(screen.getByRole("button", { name: "Fabrics" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/items?limit=24&offset=0&type=fabric", undefined),
    );
    expect(screen.getByRole("button", { name: "Fabrics" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Nothing of this type yet")).toBeInTheDocument();
  });

  it("shows an error with a working retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
      .mockResolvedValueOnce(listResponse([]));
    renderWithQuery(<Gallery />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The gallery could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
