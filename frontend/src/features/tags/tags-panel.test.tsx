import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { ItemTag, ItemTags, TagScores, Vocabulary } from "@/types/api";
import { TagsPanel } from "./tags-panel";

const item = makeItem({ type: "garment" });
const BASE = `/api/items/${item.id}`;

function tag(overrides: Partial<ItemTag>): ItemTag {
  return {
    category: "craft",
    tag: "ikat",
    source: "ai",
    score: 0.82,
    custom: false,
    outdated: false,
    is_guess: false,
    ...overrides,
  };
}

function itemTags(overrides: Partial<ItemTags> = {}): ItemTags {
  return {
    item_id: item.id,
    status: "completed",
    version: "open_clip/ViT-B-32/x/pp1/pt1/vabc",
    suggested_type: null,
    tags: [
      tag({}),
      tag({ category: "fabric", tag: "silk", score: 0.51, is_guess: true }),
      tag({ category: "craft", tag: "bandhani", source: "user", score: null }),
      tag({ category: "aesthetic", tag: "quiet luxury", source: "user", score: null, custom: true }),
    ],
    removed: [tag({ category: "pattern", tag: "floral", score: 0.4 })],
    ...overrides,
  };
}

const vocabulary: Vocabulary = {
  version: "pt1/vabc",
  categories: [
    { category: "craft", is_guess: false, max_tags: 2, tags: ["ikat", "bandhani", "kanjeevaram"] },
    { category: "fabric", is_guess: true, max_tags: 1, tags: ["silk", "cotton"] },
  ],
};

const scores: TagScores = {
  item_id: item.id,
  version: "v",
  note: "Scores are a softmax within each category: relative and uncalibrated, not probabilities.",
  categories: [
    {
      category: "craft",
      is_guess: false,
      min_score: 0.3,
      min_margin: 0.1,
      max_tags: 2,
      labels: [
        { tag: "ikat", score: 0.82, none: false, passes: true },
        { tag: "none", score: 0.1, none: true, passes: false },
        { tag: "bandhani", score: 0.08, none: false, passes: false },
      ],
    },
  ],
};

describe("TagsPanel", () => {
  it("groups tags and marks AI, your additions, custom tags and fabric guesses", async () => {
    routeFetch({
      [`GET ${BASE}/tags`]: () => Response.json(itemTags()),
      "GET /api/tags/vocabulary": () => Response.json(vocabulary),
    });
    renderWithQuery(<TagsPanel item={item} />);

    expect(await screen.findByText("ikat")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fabric (guess)" })).toBeInTheDocument();
    const ikat = screen.getByTitle(/AI model score 0\.82 \(relative, uncalibrated\)/);
    expect(within(ikat).getByText("AI")).toBeInTheDocument();
    expect(screen.getByTitle(/a guess from the photo/)).toHaveTextContent("silk");
    expect(screen.getByTitle("added by you")).toHaveTextContent("bandhani");
    expect(screen.getByTitle("custom")).toHaveTextContent("quiet luxury");
    expect(screen.getByRole("button", { name: "Restore floral" })).toBeInTheDocument();
  });

  it("removes and restores tags as corrections", async () => {
    const fetchMock = routeFetch({
      [`GET ${BASE}/tags`]: () => Response.json(itemTags()),
      [`PATCH ${BASE}/tags`]: () => Response.json(itemTags()),
      "GET /api/tags/vocabulary": () => Response.json(vocabulary),
    });
    renderWithQuery(<TagsPanel item={item} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove ikat" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/tags`, expect.objectContaining({ method: "PATCH" })),
    );
    const removeCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(removeCall[1]!.body as string)).toEqual({
      add: [],
      remove: [{ category: "craft", tag: "ikat" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore floral" }));
    await waitFor(() => {
      const bodies = fetchMock.mock.calls
        .filter(([, init]) => init?.method === "PATCH")
        .map(([, init]) => JSON.parse(init!.body as string));
      expect(bodies).toContainEqual({ add: [{ category: "pattern", tag: "floral" }], remove: [] });
    });
  });

  it("adds a tag in a chosen category and shows the server's validation message", async () => {
    let attempts = 0;
    routeFetch({
      [`GET ${BASE}/tags`]: () => Response.json(itemTags()),
      "GET /api/tags/vocabulary": () => Response.json(vocabulary),
      [`PATCH ${BASE}/tags`]: () =>
        attempts++ === 0
          ? apiErrorResponse(422, "invalid_tag", "Tags are 1-40 characters: letters, numbers…")
          : Response.json(itemTags()),
    });
    renderWithQuery(<TagsPanel item={item} />);

    const form = await screen.findByRole("form", { name: "Add a tag" });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "fabric" } });
    fireEvent.change(within(form).getByLabelText("Tag"), { target: { value: "<bad>" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add tag" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Tags are 1-40 characters");
    expect(within(form).getByLabelText("Tag")).toHaveValue("<bad>"); // kept for fixing

    fireEvent.change(within(form).getByLabelText("Tag"), { target: { value: "cotton" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add tag" }));
    await waitFor(() => expect(within(form).getByLabelText("Tag")).toHaveValue(""));
  });

  it("explains pending and unavailable AI tags", async () => {
    routeFetch({
      [`GET ${BASE}/tags`]: () => Response.json(itemTags({ status: "unavailable", tags: [], removed: [] })),
      "GET /api/tags/vocabulary": () => Response.json(vocabulary),
    });
    renderWithQuery(<TagsPanel item={item} />);

    expect(await screen.findByText(/not installed\. You can still add tags/)).toBeInTheDocument();
  });

  it("shows every score with the thresholds when asked", async () => {
    routeFetch({
      [`GET ${BASE}/tags`]: () => Response.json(itemTags()),
      "GET /api/tags/vocabulary": () => Response.json(vocabulary),
      [`GET ${BASE}/tag-scores`]: () => Response.json(scores),
    });
    renderWithQuery(<TagsPanel item={item} />);

    fireEvent.click(await screen.findByRole("button", { name: "Show all scores" }));

    expect(await screen.findByText(/relative and uncalibrated/)).toBeInTheDocument();
    const craft = screen.getByRole("list", { name: "Craft scores" });
    expect(within(craft).getByText("none of these")).toBeInTheDocument();
    expect(within(craft).getAllByText(/shown as a tag|below threshold/)).toHaveLength(3);
    expect(screen.getByText(/shown if ≥ 0\.30/)).toBeInTheDocument();
  });

  it("re-analyses on request", async () => {
    const fetchMock = routeFetch({
      [`GET ${BASE}/tags`]: () => Response.json(itemTags()),
      "GET /api/tags/vocabulary": () => Response.json(vocabulary),
      [`POST ${BASE}/reanalyze`]: () => Response.json(item),
    });
    renderWithQuery(<TagsPanel item={item} />);

    fireEvent.click(await screen.findByRole("button", { name: "Re-analyse this image" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/reanalyze`, { method: "POST" }),
    );
  });
});
