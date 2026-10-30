"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { getSession } from "@/services/auth";
import type { Me } from "@/types/api";

export const SESSION_KEY = ["session"] as const;

const noSubscription = () => () => {};

/**
 * False while React is hydrating server HTML, true afterwards. Parts of a page inside a
 * Suspense boundary hydrate later than the rest; by then the session may already be known,
 * and rendering it straight away would not match the HTML the server sent (React error #418).
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * Who is signed in. `data` is null when signed out, undefined while loading. While a part of
 * the page is still hydrating it reads as loading, exactly like the server render, and then
 * updates.
 */
export function useSession(): UseQueryResult<Me | null> {
  const hydrated = useHydrated();
  const query = useQuery({ queryKey: SESSION_KEY, queryFn: getSession, staleTime: 60_000 });
  if (hydrated) return query;
  return { ...query, data: undefined, isPending: true, isSuccess: false, isError: false, status: "pending" } as UseQueryResult<
    Me | null
  >;
}

/** After signing in or out, every cached answer belonged to the previous person. */
export function useResetForAccount() {
  const queryClient = useQueryClient();
  return useCallback(
    (me: Me | null) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
      queryClient.setQueryData(SESSION_KEY, me);
    },
    [queryClient],
  );
}
