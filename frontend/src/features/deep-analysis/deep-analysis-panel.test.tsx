import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { renderWithQuery } from "@/test/render";
import type { DeepAnalysis, DeepAnalysisResult, DeepAnalysisStatus } from "@/types/api";
import { DEEP_ANALYSIS_POLL_MS, DeepAnalysisPanel } from "./deep-analysis-panel";

const ITEM = "aaaaaaaa-0000-4000-8000-000000000001";

function status(overrides: Partial<DeepAnalysisStatus> = {}): DeepAnalysisStatus {
  return {
    available: true,
    reason: null,
    provider: "claude",
    model: "claude-opus-5-5",
    effort: "medium",
    daily_limit: 25,
    runs_today: 3,
    sent: ["This piece's image, resized and without metadata.", "Its palette colour names and visible tags."],
    not_sent: ["Your notes", "The source URL"],
    ...overrides,
  };
}

const RESULT: DeepAnalysisResult = {
  summary: "A red kurta with ikat borders.",
  is_fashion_image: true,
  garment: "kurta",
  silhouette: null,
  pattern: "ikat border",
  fabric: { guess: "cotton-like weave", confidence: "medium", reasoning: "Matte surface." },
  crafts: [{ name: "ikat", confidence: "medium", evidence: "Blurred chevron edges." }],
  styling_ideas: ["Pair with white churidar"],
  occasions: [],
  caveats: ["Only the front is visible."],
};

function analysis(overrides: Partial<DeepAnalysis> = {}): DeepAnalysis {
  return {
    item_id: ITEM,
    status: "not_run",
    requested_model: null,
    started_at: null,
    finished_at: null,
    error: null,
    result: null,
    result_model: null,
    result_at: null,
    prompt_version: null,
    usage: null,
    ...overrides,
  };
}

const completed = analysis({
  status: "completed",
  requested_model: "claude-opus-5-5",
  result: RESULT,
  result_model: "claude-opus-5-5",
  result_at: "2026-10-29T10:00:00Z",
});

const posts = (fetchMock: ReturnType<typeof routeFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

afterEach(() => vi.useRealTimers());

describe("DeepAnalysisPanel", () => {
  it("explains how to turn it on when no key is configured, and asks for nothing else", async () => {
    const fetchMock = routeFetch({
      "GET /api/deep-analysis/status": () =>
        Response.json(status({ available: false, reason: "not_configured", provider: null, model: null })),
    });
    renderWithQuery(<DeepAnalysisPanel itemId={ITEM} />);

    expect(await screen.findByText(/THREAD_ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/work without it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deep analyze/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/deep-analysis/status"]);
  });

  it("asks before sending, says what is and is not sent, and cancelling sends nothing", async () => {
    const fetchMock = routeFetch({
      "GET /api/deep-analysis/status": () => Response.json(status()),
      [`GET /api/items/${ITEM}/deep-analysis`]: () => Response.json(analysis()),
    });
    renderWithQuery(<DeepAnalysisPanel itemId={ITEM} />);

    fireEvent.click(await screen.findByRole("button", { name: /Deep analyze/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Send this piece to Anthropic?" });
    expect(dialog).toHaveTextContent("resized and without metadata");
    expect(dialog).toHaveTextContent("palette colour names and visible tags");
    expect(dialog).toHaveTextContent("Never sent: your notes, the source url");
    expect(dialog).toHaveTextContent("Anthropic may charge for API usage");
    expect(dialog).toHaveTextContent("3 of 25 runs today");
    expect(dialog).toHaveTextContent("not a spending limit");
    expect(dialog).toHaveTextContent("claude-opus-5-5");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("sends only after confirming, polls while running and shows the labelled result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state = analysis();
    const fetchMock = routeFetch({
      "GET /api/deep-analysis/status": () => Response.json(status()),
      [`GET /api/items/${ITEM}/deep-analysis`]: () => Response.json(state),
      [`POST /api/items/${ITEM}/deep-analyze`]: () => {
        state = analysis({ status: "running", requested_model: "claude-opus-5-5" });
        return Response.json(state, { status: 202 });
      },
    });
    renderWithQuery(<DeepAnalysisPanel itemId={ITEM} />);

    fireEvent.click(await screen.findByRole("button", { name: /Deep analyze/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send to Claude" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Analysing with claude-opus-5-5");
    expect(posts(fetchMock)).toHaveLength(1);
    expect(JSON.parse(String(posts(fetchMock)[0][1]!.body))).toEqual({ confirm: true });

    state = completed;
    await vi.advanceTimersByTimeAsync(DEEP_ANALYSIS_POLL_MS + 100);

    const result = await screen.findByRole("article", { name: "Analysis" });
    expect(result).toHaveTextContent("A red kurta with ikat borders.");
    expect(result).toHaveTextContent("cotton-like weave · medium confidence");
    expect(result).toHaveTextContent("ikat · medium confidence");
    expect(result).toHaveTextContent("It may be wrong");
    expect(screen.getByRole("button", { name: /Run again/ })).toBeEnabled();
  });

  it("shows a failed re-run's reason and keeps the last successful result", async () => {
    routeFetch({
      "GET /api/deep-analysis/status": () => Response.json(status()),
      [`GET /api/items/${ITEM}/deep-analysis`]: () =>
        Response.json({
          ...completed,
          status: "failed",
          error: { code: "declined", message: "Claude declined to analyse this image.", retry_after_seconds: null },
        }),
    });
    renderWithQuery(<DeepAnalysisPanel itemId={ITEM} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Claude declined to analyse this image.");
    expect(screen.getByRole("article", { name: "Last successful analysis" })).toHaveTextContent("A red kurta");
  });

  it("reports why a run could not start", async () => {
    routeFetch({
      "GET /api/deep-analysis/status": () => Response.json(status()),
      [`GET /api/items/${ITEM}/deep-analysis`]: () => Response.json(analysis()),
      [`POST /api/items/${ITEM}/deep-analyze`]: () =>
        apiErrorResponse(429, "daily_limit_reached", "The daily limit of 25 deep analyses has been reached."),
    });
    renderWithQuery(<DeepAnalysisPanel itemId={ITEM} />);

    fireEvent.click(await screen.findByRole("button", { name: /Deep analyze/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send to Claude" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("daily limit of 25");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("labels the local test analyzer honestly", async () => {
    routeFetch({
      "GET /api/deep-analysis/status": () => Response.json(status({ provider: "fake", model: "local-fake-analyzer" })),
      [`GET /api/items/${ITEM}/deep-analysis`]: () => Response.json(analysis()),
    });
    renderWithQuery(<DeepAnalysisPanel itemId={ITEM} />);

    expect(await screen.findByText(/nothing leaves this computer/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Deep analyze/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Run the test analyzer?" });
    expect(dialog).toHaveTextContent("sends nothing and costs nothing");
    expect(within(dialog).getByRole("button", { name: "Run test analysis" })).toBeInTheDocument();
  });
});
