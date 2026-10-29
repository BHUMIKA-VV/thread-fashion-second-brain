"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { getSession } from "@/services/auth";
import type { Me } from "@/types/api";

export const SESSION_KEY = ["session"] as const;

/** Who is signed in. `data` is null when signed out, undefined while loading. */
export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: getSession, staleTime: 60_000 });
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
