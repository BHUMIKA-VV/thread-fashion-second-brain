import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeItem, renderWithQuery } from "@/test/render";
import type { SimilarResponse } from "@/types/api";
import { SimilarPieces } from "./similar-pieces";

const QUERY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function response(overrides: Partial<SimilarResponse> = {}): Response {
  return Response.json({
    item_id: QUERY_ID,
    model: "open_clip/ViT-B-32/laion2b_s34b_b79k@1a25a44/pp1",
    results: [],
    compared: 0,
    not_indexed: 0,
    ...overrides,
  } satisfies SimilarResponse);
}

function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, details: null } }, { status });
}

describe("SimilarPieces", () => {
  it("shows a loading state, then ranked matches linking to each item", async () => {
    const near = makeItem({ id: "11111111-1111-4111-8111-111111111111", type: "outfit" });
    const far = makeItem({ id: "22222222-2222-4222-8222-222222222222", type: "fabric" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        results: [
          { item: near, similarity: 0.9312 },
          { item: far, similarity: 0.7045 },
        ],
        compared: 2,
      }),
    );
    renderWithQuery(<SimilarPieces itemId={QUERY_ID} />);

    expect(screen.getByLabelText("Loading similar pieces")).toBeInTheDocument();
    const links = await screen.findAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`/items/${near.id}`, `/items/${far.id}`]);
    expect(links[0]).toHaveAccessibleName("outfit — similarity 0.93");
    expect(screen.getByText("0.70")).toBeInTheDocument();
    expect(screen.getByText(/Compared with 2 of your pieces/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/items/${QUERY_ID}/similar?limit=12`, undefined);
  });

  it("has an honest empty state for a library with nothing to compare", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    renderWithQuery(<SimilarPieces itemId={QUERY_ID} />);

    expect(await screen.findByText(/Nothing to compare with yet/)).toBeInTheDocument();
  });

  it("says when other pieces could not be compared", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ not_indexed: 3 }));
    renderWithQuery(<SimilarPieces itemId={QUERY_ID} />);

    expect(await screen.findByText("None of your other pieces could be compared yet.")).toBeInTheDocument();
  });

  it("waits calmly while the model loads and shows results when it is ready", async () => {
    const match = makeItem({ id: "33333333-3333-4333-8333-333333333333" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiError(503, "model_loading", "The image model is loading."))
      .mockResolvedValueOnce(response({ results: [{ item: match, similarity: 0.88 }], compared: 1 }));
    renderWithQuery(<SimilarPieces itemId={QUERY_ID} />);

    expect(await screen.findByText(/Loading the image model/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // not shown as an error

    // Retried automatically after MODEL_LOADING_RETRY_MS, no click needed.
    expect(await screen.findByRole("link", {}, { timeout: 6_000 })).toHaveAttribute(
      "href",
      `/items/${match.id}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("explains a missing image model and can retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        apiError(503, "model_unavailable", "The image model is not installed. Run `python -m scripts.fetch_model` in the backend folder."),
      )
      .mockResolvedValueOnce(response());
    renderWithQuery(<SimilarPieces itemId={QUERY_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("fetch_model");
    expect(screen.getByText(/Uploads and colour palettes keep working/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/Nothing to compare with yet/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offers re-indexing when this image could not be embedded", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiError(422, "embedding_failed", "This image could not be indexed."))
      .mockResolvedValueOnce(Response.json(makeItem({ id: QUERY_ID })))
      .mockResolvedValue(response());
    renderWithQuery(<SimilarPieces itemId={QUERY_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: "Index this image again" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/items/${QUERY_ID}/embedding`, { method: "POST" }),
    );
    expect(await screen.findByText(/Nothing to compare with yet/)).toBeInTheDocument();
  });
});
