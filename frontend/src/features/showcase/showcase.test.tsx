import { useQuery } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFilters, filtersToSearch, EMPTY_FILTERS } from "@/lib/gallery-filters";
import { cardFilename, cardLayout, CARD } from "@/lib/swatch-card";
import { getItem } from "@/services/items";
import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { setUrl } from "@/test/navigation-mock";
import { makeItem, renderWithQuery } from "@/test/render";
import type { Me, ShowcaseItem, ShowcaseList, ShowcaseSummary } from "@/types/api";
import { PublishSwitch } from "./publish-switch";
import { ShowcaseGrid } from "./showcase-grid";
import { ShowcasePiece } from "./showcase-piece";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

const colours = [
  { hex: "#d1291c", rgb: [209, 41, 28] as [number, number, number], name: "sindoor red", family: "red" as const, percentage: 62.4 },
  { hex: "#263b5e", rgb: [38, 59, 94] as [number, number, number], name: "neel indigo", family: "blue" as const, percentage: 30.1 },
  { hex: "#f1e6d0", rgb: [241, 230, 208] as [number, number, number], name: "ivory", family: "white" as const, percentage: 7.5 },
];

const published: ShowcaseItem = {
  id: "abcdef12-0000-4000-8000-000000000001",
  type: "fabric",
  width: 600,
  height: 800,
  created_at: "2026-10-29T10:00:00Z",
  palette: { colors: colours, harmony: "complementary", source: "original", updated_at: "2026-10-29T10:00:00Z" },
  image_url: "/showcase/items/abcdef12-0000-4000-8000-000000000001/image?variant=original",
  thumbnail_url: "/showcase/items/abcdef12-0000-4000-8000-000000000001/image?variant=thumbnail",
};

const summary: ShowcaseSummary = {
  owner_name: "Bhumika",
  total: 1,
  by_type: { fabric: 1 },
  color_families: [{ family: "red", items: 1 }],
  tags: [],
  collections: 0,
  recent: [published],
};

const owner: Me = { id: "u1", display_name: "Owner", email: "o@example.com", email_verified: true, is_owner: true, has_password: true };

beforeEach(() => setUrl("/showcase"));

describe("swatch card layout", () => {
  it("fills the band edge to edge in proportion, and lists the largest colours first", () => {
    const { band, rows } = cardLayout([...colours].reverse());
    expect(band[0].x).toBe(CARD.margin);
    expect(band.at(-1)!.x + band.at(-1)!.width).toBe(CARD.width - CARD.margin);
    expect(band.reduce((sum, s) => sum + s.width, 0)).toBe(CARD.width - 2 * CARD.margin);
    expect(rows.map((r) => r.name)).toEqual(["sindoor red", "neel indigo", "ivory"]);
    expect(rows[0]).toMatchObject({ code: "#D1291C", share: "62%" });
  });

  it("shows at most five colours and names the file by record", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ hex: `#00000${i}`, name: `c${i}`, percentage: 12.5 }));
    expect(cardLayout(many).rows).toHaveLength(5);
    expect(cardFilename(published.id)).toBe("thread-swatch-abcdef.png");
  });
});

describe("gallery filters", () => {
  it("round-trips the owner's showcase filter through the URL", () => {
    expect(filtersToSearch({ ...EMPTY_FILTERS, published: true })).toBe("published=true");
    expect(parseFilters(new URLSearchParams("published=false")).published).toBe(false);
    expect(parseFilters(new URLSearchParams("published=maybe")).published).toBeUndefined();
  });
});

describe("ShowcaseGrid", () => {
  it("shows the published pieces and the owner's name", async () => {
    routeFetch({
      "GET /api/showcase/items": () => Response.json({ items: [published], total: 1, limit: 24, offset: 0, reasons: {} } satisfies ShowcaseList),
      "GET /api/showcase/collections": () => Response.json([]),
      "GET /api/showcase": () => Response.json(summary),
    });
    renderWithQuery(<ShowcaseGrid />);

    expect(await screen.findByRole("link", { name: /fabric in sindoor red and neel indigo/ })).toHaveAttribute(
      "href",
      `/showcase/${published.id}`,
    );
    expect(screen.getByText("Bhumika")).toBeInTheDocument();
    expect(screen.getByText("1 piece")).toBeInTheDocument();
  });

  it("says when nothing is published yet", async () => {
    routeFetch({ "GET /api/showcase": () => apiErrorResponse(404, "showcase_not_set_up", "No showcase.") });
    renderWithQuery(<ShowcaseGrid />);
    expect(await screen.findByText("The showcase opens soon")).toBeInTheDocument();
  });
});

describe("ShowcasePiece", () => {
  it("explains a piece that was made private", async () => {
    routeFetch({ [`GET /api/showcase/items/${published.id}`]: () => apiErrorResponse(404, "not_found", "Gone.") });
    renderWithQuery(<ShowcasePiece id={published.id} />);
    expect(await screen.findByText("This piece isn't in the showcase")).toBeInTheDocument();
  });

  it("shows the palette, tags and the swatch card, never notes", async () => {
    routeFetch({
      [`GET /api/showcase/items/${published.id}/similar`]: () => Response.json({ item_id: published.id, results: [], compared: 0 }),
      [`GET /api/showcase/items/${published.id}`]: () => Response.json({ ...published, tags: [{ category: "craft", tag: "ikat" }] }),
    });
    renderWithQuery(<ShowcasePiece id={published.id} />);

    expect(await screen.findByRole("heading", { level: 1, name: "sindoor red fabric" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Palette: sindoor red 62%, neel indigo 30%, ivory 8%" })).toBeInTheDocument();
    expect(screen.getByText("ikat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download swatch card" })).toBeInTheDocument();
  });
});

describe("PublishSwitch", () => {
  it("is the owner's alone", async () => {
    const fetchMock = routeFetch({ "GET /api/auth/session": () => Response.json({ ...owner, is_owner: false }) });
    renderWithQuery(<PublishSwitch kind="item" id="i1" isPublic={false} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("turns on only once the server has saved it and the piece has been re-read", async () => {
    let serverPublic = false;
    let release: () => void = () => {};
    const saved = new Promise<void>((resolve) => (release = resolve));
    routeFetch({
      "GET /api/auth/session": () => Response.json(owner),
      "GET /api/items/i1": () => Response.json(makeItem({ id: "i1", is_public: serverPublic })),
      "PUT /api/items/i1/showcase": async ({ body }) => {
        await saved;
        serverPublic = (body as { public: boolean }).public;
        return Response.json(makeItem({ id: "i1", is_public: serverPublic }));
      },
    });
    renderWithQuery(<ItemSwitch />);

    const toggle = await screen.findByRole("switch", { name: "Show in showcase" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Private: only you can see this piece.")).toBeInTheDocument();
    fireEvent.click(toggle);

    // Saving: busy, and still showing the saved (private) state.
    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(toggle).toBeDisabled();

    release();
    await vi.waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(toggle).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("link", { name: "View it as visitors do" })).toHaveAttribute("href", "/showcase/i1");
  });

  it("keeps showing the saved state when the save fails", async () => {
    routeFetch({
      "GET /api/auth/session": () => Response.json(owner),
      "GET /api/items/i1": () => Response.json(makeItem({ id: "i1", is_public: false })),
      "PUT /api/items/i1/showcase": () => apiErrorResponse(500, "internal_error", "The server could not save that."),
    });
    renderWithQuery(<ItemSwitch />);

    const toggle = await screen.findByRole("switch", { name: "Show in showcase" });
    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent("The server could not save that.");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("aria-busy", "false");
    expect(toggle).toBeEnabled();
    expect(screen.getByText("Private: only you can see this piece.")).toBeInTheDocument();
    expect(screen.queryByText(/^Public\./)).not.toBeInTheDocument();
  });
});

/** The switch fed from the item query, as on the item page. */
function ItemSwitch() {
  const item = useQuery({ queryKey: ["items", "detail", "i1"], queryFn: () => getItem("i1") });
  if (!item.data) return null;
  return <PublishSwitch kind="item" id="i1" isPublic={item.data.is_public} />;
}
