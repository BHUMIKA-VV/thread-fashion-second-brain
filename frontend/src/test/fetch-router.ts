import { vi } from "vitest";

type Handler = (request: { method: string; url: string; body: unknown }) => Response | Promise<Response>;

/**
 * Route mocked fetch calls by "METHOD path-prefix" (most specific first). Returns the spy so
 * tests can assert on calls. Unmatched requests fail loudly.
 */
export function routeFetch(routes: Record<string, Handler>) {
  const entries = Object.entries(routes).sort(([a], [b]) => b.length - a.length);
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    for (const [key, handler] of entries) {
      const [routeMethod, prefix] = key.split(" ");
      if (routeMethod === method && url.startsWith(prefix)) return handler({ method, url, body });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

export function apiErrorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, details: null } }, { status });
}
