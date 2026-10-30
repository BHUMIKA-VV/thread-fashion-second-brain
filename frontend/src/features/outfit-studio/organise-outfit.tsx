"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ApiError } from "@/lib/api-client";
import { listCollections } from "@/services/collections";
import { addOutfitToCollection, removeOutfitFromCollection } from "@/services/outfits";
import type { OutfitDetail } from "@/types/api";

/** Which of your collections this outfit is in. */
export function OrganiseOutfit({ outfitId, collectionIds }: { outfitId: string; collectionIds: string[] }) {
  const queryClient = useQueryClient();
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => listCollections() });
  const key = ["outfits", "detail", outfitId];
  // What each box shows until the server answers.
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const toggle = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) =>
      add ? addOutfitToCollection(id, outfitId) : removeOutfitFromCollection(id, outfitId),
    // The box changes at once, and goes back if the server refuses.
    onMutate: async ({ id, add }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OutfitDetail>(key);
      if (previous) {
        const others = previous.collection_ids.filter((c) => c !== id);
        queryClient.setQueryData(key, { ...previous, collection_ids: add ? [...others, id] : others });
      }
      return { previous };
    },
    onError: (_error, _toggle, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: (_data, _error, { id }) => {
      setShown((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  return (
    <section aria-labelledby="organise-title">
      <h3 id="organise-title" className="font-display text-2xl">
        Collections
      </h3>
      {collections.isPending ? (
        <div role="status" aria-label="Loading collections" className="mt-2 h-16 animate-pulse bg-ink/[0.05]" />
      ) : collections.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          Collections could not be loaded.
        </p>
      ) : collections.data.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          You have no collections yet.{" "}
          <Link href="/collections" className="underline">
            Create one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {collections.data.map((collection) => (
            <li key={collection.id}>
              <label className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={shown[collection.id] ?? collectionIds.includes(collection.id)}
                  onChange={(e) => {
                    setShown({ ...shown, [collection.id]: e.target.checked });
                    toggle.mutate({ id: collection.id, add: e.target.checked });
                  }}
                />
                {collection.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {toggle.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {toggle.error instanceof ApiError ? toggle.error.message : "That change could not be saved."}
        </p>
      )}
    </section>
  );
}
