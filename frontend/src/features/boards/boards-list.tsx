"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { createBoard, listBoards } from "@/services/boards";
import { listCollections } from "@/services/collections";
import type { BoardSummary } from "@/types/api";

export function BoardsList({ fromCollection }: { fromCollection?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["boards"], queryFn: listBoards });
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => listCollections() });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState(fromCollection ?? "");
  const create = useMutation({
    mutationFn: () =>
      createBoard(name.trim(), { description: description.trim() || undefined, fromCollectionId: source || undefined }),
    onSuccess: (board) => {
      queryClient.setQueryData(["boards", "detail", board.id], board);
      void queryClient.invalidateQueries({ queryKey: ["boards"], exact: true });
      router.push(`/boards/${board.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <div className="space-y-10">
      <form onSubmit={submit} aria-label="New board" className="flex flex-wrap items-end gap-3 border-y border-line py-5">
        <label className="min-w-48 flex-1 text-xs text-ink-muted">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Meera, sangeet concepts"
            className="mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="min-w-48 flex-[2] text-xs text-ink-muted">
          Description (optional)
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            className="mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="min-w-48 flex-1 text-xs text-ink-muted">
          Start from
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-2 py-2 text-sm text-ink"
          >
            <option value="">An empty board</option>
            {(collections.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                Collection: {c.name} ({c.item_count})
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <LayoutGrid aria-hidden className="size-4" /> {create.isPending ? "Creating…" : "Create board"}
        </Button>
        {create.isError && (
          <p role="alert" className="w-full text-sm text-danger">
            {create.error instanceof ApiError ? create.error.message : "The board could not be created."}
          </p>
        )}
      </form>

      {query.isPending ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading boards">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-64 animate-pulse rounded-[2px] bg-ink/[0.06]" />
          ))}
        </ul>
      ) : query.isError ? (
        <div role="alert" className="text-sm text-danger">
          Boards could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : query.data.length === 0 ? (
        <p className="border-b border-line px-6 py-14 text-center text-sm text-ink-muted">
          No boards yet. Create one above, empty or from a collection, then add pieces, colours and notes.
        </p>
      ) : (
        <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your boards">
          {query.data.map((board) => (
            <li key={board.id}>
              <BoardCard board={board} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BoardCard({ board }: { board: BoardSummary }) {
  const covers = board.cover_thumbnails;
  return (
    <Link href={`/boards/${board.id}`} className="group block">
      <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-line">
        {[0, 1, 2, 3].map((i) =>
          covers[i] ? (
            // eslint-disable-next-line @next/next/no-img-element -- private image served by the API
            <img key={i} src={apiUrl(covers[i])} alt="" className="size-full object-cover" />
          ) : (
            <span key={i} className="bg-paper" />
          ),
        )}
      </div>
      <div className="border-b border-line py-4">
        <p className="font-display text-2xl underline-offset-4 group-hover:underline">{board.name}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {board.block_count} {board.block_count === 1 ? "block" : "blocks"}
        </p>
        {board.description && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{board.description}</p>}
      </div>
    </Link>
  );
}
