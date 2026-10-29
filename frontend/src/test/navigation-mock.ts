import { useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * A tiny stand-in for next/navigation: a URL query store that router.replace/push update and
 * useSearchParams re-renders from. Use with:
 *   vi.mock("next/navigation", () => navigationMock);
 */
let current = new URLSearchParams();
let currentPath = "/gallery";
const listeners = new Set<() => void>();

function navigate(url: string) {
  const [path, query = ""] = url.split("?");
  currentPath = path || currentPath;
  current = new URLSearchParams(query);
  listeners.forEach((listener) => listener());
}

export const router = {
  replace: vi.fn(navigate),
  push: vi.fn(navigate),
  back: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export function setUrl(url: string) {
  navigate(url);
  router.replace.mockClear();
  router.push.mockClear();
}

export function currentSearch(): string {
  return current.toString();
}

export const navigationMock = {
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => current,
    ),
  useRouter: () => router,
  usePathname: () => currentPath,
};
