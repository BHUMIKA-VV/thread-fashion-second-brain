import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { Item } from "@/types/api";

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export function makeItem(overrides: Partial<Item> = {}): Item {
  const id = overrides.id ?? "11111111-1111-4111-8111-111111111111";
  return {
    id,
    type: "garment",
    suggested_type: null,
    notes: null,
    source_url: null,
    processing_status: "queued",
    processing_error: null,
    width: 600,
    height: 800,
    mime_type: "image/jpeg",
    file_size: 120_000,
    created_at: "2026-10-24T10:00:00Z",
    updated_at: "2026-10-24T10:00:00Z",
    stage_status: { thumbnail: "completed" },
    palette: null,
    image_url: `/items/${id}/image?variant=original`,
    thumbnail_url: `/items/${id}/image?variant=thumbnail`,
    palette_card_url: null,
    ...overrides,
  };
}
