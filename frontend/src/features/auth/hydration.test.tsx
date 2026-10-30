import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { AuthGate } from "./auth-gate";
import { SESSION_KEY } from "./use-session";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>private</p>
      </AuthGate>
    </QueryClientProvider>
  );
}

describe("session-dependent UI and hydration", () => {
  it("hydrates server HTML without a mismatch even when the session is already known", async () => {
    // The server renders before anyone knows who is signed in.
    const html = renderToString(tree(new QueryClient()));
    expect(html).toContain("Checking your session");

    // In the browser, a late-hydrating Suspense boundary finds the session already answered.
    routeFetch({ "GET /api/auth/session": () => Response.json(null) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(SESSION_KEY, null);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable = vi.fn();

    await act(async () => {
      hydrateRoot(container, tree(client), { onRecoverableError: recoverable });
    });

    expect(recoverable).not.toHaveBeenCalled();
    // ...and right after hydration it shows the signed-out state.
    expect(container.textContent).toContain("Sign in to see your archive");
    container.remove();
  });
});
