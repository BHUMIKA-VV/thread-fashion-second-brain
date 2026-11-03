import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCountedViews } from "@/lib/beacon";
import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { renderWithQuery } from "@/test/render";
import type { PlaygroundResult } from "@/types/api";
import { Playground } from "./playground";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

const match = (id: string, extra: Partial<PlaygroundResult["similar_look"][number]>) => ({
  id,
  title: id.replace(/-/g, " "),
  type: "fabric" as const,
  thumbnail: `thumbs/${id}.webp`,
  similarity: null,
  distance: null,
  ...extra,
});

const result: PlaygroundResult = {
  width: 900,
  height: 1200,
  type: "garment",
  type_source: "suggested",
  palette: [
    { hex: "#9a2b2e", name: "kumkum", family: "red", percentage: 61.2 },
    { hex: "#efe9dd", name: "ivory", family: "white", percentage: 38.8 },
  ],
  palette_source: "masked",
  harmony: "monochromatic",
  model: "ready",
  look_compared: true,
  tags: [
    { category: "fabric", tag: "silk", score: 0.41, is_guess: true },
    { category: "pattern", tag: "bandhani", score: 0.62, is_guess: false },
  ],
  similar_look: [match("bandhani-odhani", { similarity: 0.812 })],
  similar_palette: [match("bandhani-sari", { distance: 7.4 })],
};

const photo = (type = "image/jpeg", size = 1000) => new File([new Uint8Array(size)], "kurta.jpg", { type });

const choose = (file: File) => fireEvent.change(screen.getByLabelText("Photo to analyse"), { target: { files: [file] } });

beforeEach(() => {
  resetCountedViews();
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:preview"), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
});

afterEach(() => vi.restoreAllMocks());

describe("Playground", () => {
  it("sends the photo itself, without cookies, and shows what was measured and suggested", async () => {
    const fetch = routeFetch({
      "POST /api/playground/analyse": () => Response.json(result),
      "POST /api/metrics/view": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<Playground />);
    const file = photo();
    choose(file);

    const heading = await screen.findByRole("heading", { name: "What Thread measured" });
    await vi.waitFor(() => expect(heading).toHaveFocus()); // moved there on the next frame
    const [url, init] = fetch.mock.calls.find(([u]) => String(u).includes("/playground/"))!;
    expect(url).toBe("/api/playground/analyse");
    expect(init?.body).toBe(file);
    expect(init?.credentials).toBe("omit");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");

    expect(screen.getByRole("img", { name: "Your photo" })).toHaveAttribute("src", "blob:preview");
    expect(screen.getByText(/read as/)).toHaveTextContent("read as Garment, suggested by the image model");
    expect(screen.getByText("Kumkum", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Harmony \(heuristic\)/)).toBeInTheDocument();
    const tags = screen.getByRole("region", { name: "Suggested tags" });
    expect(within(tags).getByText("Fabric (guess)").nextSibling).toHaveTextContent("silk (guess, 41%)");
    expect(within(tags).getByText("Pattern").nextSibling).toHaveTextContent("bandhani (62%)");
    const look = screen.getByRole("region", { name: "Kindred by look" });
    expect(within(look).getByRole("link", { name: /bandhani odhani/ })).toHaveAttribute("href", "/demo/pieces/bandhani-odhani");
    expect(within(look).getByText("Similarity 0.81")).toBeInTheDocument();
    expect(screen.getByText("Distance 7.4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download swatch card/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create your archive/ })).toHaveAttribute("href", "/signup");
    // For studios: a sample archive, then the call.
    expect(screen.getByRole("link", { name: /sample archive/ })).toHaveAttribute("href", "/demo/collections/indian-textiles");
    expect(screen.getByRole("link", { name: /request a 20-minute demo call/ })).toHaveAttribute("href", "/pilot#request");

    // One anonymous count for a visit that tried a photo.
    const counted = fetch.mock.calls.filter(([u]) => String(u) === "/api/metrics/view");
    expect(counted.map(([, i]) => JSON.parse(i?.body as string).event)).toEqual(["playground_analysis"]);
  });

  it("checks the file before sending anything", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    renderWithQuery(<Playground />);
    choose(photo("image/gif"));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG or WebP photo.");
    choose(photo("image/png", 8 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert")).toHaveTextContent("larger than 8 MB");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("analyses again as the chosen type", async () => {
    const fetch = routeFetch({
      "POST /api/playground/analyse": () => Response.json(result),
      "POST /api/metrics/view": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<Playground />);
    choose(photo());
    await screen.findByRole("heading", { name: "What Thread measured" });
    fireEvent.change(screen.getByLabelText("What is in the photo?"), { target: { value: "fabric" } });
    await vi.waitFor(() =>
      expect(fetch.mock.calls.map(([u]) => String(u))).toContain("/api/playground/analyse?type=fabric"),
    );
  });

  it("says plainly when the model is starting, and only the palette is shown", async () => {
    const fetch = routeFetch({
      "POST /api/playground/analyse": () =>
        Response.json({ ...result, model: "loading", tags: [], similar_look: [], type_source: "default", type: "other" }),
      "POST /api/metrics/view": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<Playground />);
    choose(photo());
    expect(await screen.findByText(/image model is starting up/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Kindred by look" })).not.toBeInTheDocument();
    expect(screen.getByText(/read as/)).toHaveTextContent("Other inspiration, Thread couldn't tell what it shows");
    fireEvent.click(screen.getByRole("button", { name: /Try again with the model/ }));
    await vi.waitFor(() =>
      expect(fetch.mock.calls.filter(([u]) => String(u).includes("/playground/")).length).toBe(2),
    );
  });

  it("shows the API's reason when busy or limited, with a retry when busy", async () => {
    routeFetch({
      "POST /api/playground/analyse": () =>
        apiErrorResponse(503, "busy", "The playground is busy with other photos. Try again in a moment."),
    });
    renderWithQuery(<Playground />);
    choose(photo());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("busy with other photos");
    expect(within(alert).getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });
});
