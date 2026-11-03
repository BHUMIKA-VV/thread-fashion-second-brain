import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Audiences } from "./audiences";

describe("Audiences", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers the published contact address to professionals", () => {
    vi.stubEnv("THREAD_CONTACT_EMAIL", "hello@example.com");
    render(<Audiences />);
    expect(screen.getByRole("link", { name: "hello@example.com" })).toHaveAttribute("href", "mailto:hello@example.com");
  });

  it("says what isn't there yet, and invents no address when none is published", () => {
    vi.stubEnv("THREAD_CONTACT_EMAIL", "");
    render(<Audiences />);
    expect(screen.getByText(/^Not yet: sharing a collection with a client/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /@/ })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(6);
  });
});
