import { apiFetch } from "@/lib/api-client";
import type { BoardBlockKind, BoardDetail, BoardSummary } from "@/types/api";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const path = (id: string) => `/boards/${encodeURIComponent(id)}`;
const blockPath = (id: string, blockId: string) => `${path(id)}/blocks/${encodeURIComponent(blockId)}`;

/** Your boards, most recently changed first. */
export function listBoards(): Promise<BoardSummary[]> {
  return apiFetch<BoardSummary[]>("/boards");
}

export function getBoard(id: string): Promise<BoardDetail> {
  return apiFetch<BoardDetail>(path(id));
}

/** With fromCollectionId, the board starts with that collection's pieces, notes as captions.
 * Rejects with code "board_limit" or "board_full" (409). */
export function createBoard(name: string, options: { description?: string; fromCollectionId?: string } = {}): Promise<BoardDetail> {
  return apiFetch<BoardDetail>(
    "/boards",
    json("POST", {
      name,
      description: options.description || null,
      ...(options.fromCollectionId ? { from_collection_id: options.fromCollectionId } : {}),
    }),
  );
}

export function updateBoard(id: string, changes: { name?: string; description?: string | null }): Promise<BoardDetail> {
  return apiFetch<BoardDetail>(path(id), json("PATCH", changes));
}

/** Deletes the board and its blocks; the pieces stay in your archive. */
export function deleteBoard(id: string): Promise<void> {
  return apiFetch<void>(path(id), { method: "DELETE" });
}

export type NewBlock =
  | { kind: "piece"; itemId: string; body?: string }
  | { kind: "colour"; hex: string; body?: string }
  | { kind: Extract<BoardBlockKind, "heading" | "note">; body: string };

/** Adds a block at the end. Rejects with code "board_full" (409) when the board is full. */
export function addBlock(id: string, block: NewBlock): Promise<BoardDetail> {
  const body =
    block.kind === "piece"
      ? { kind: "piece", item_id: block.itemId, body: block.body || null }
      : block.kind === "colour"
        ? { kind: "colour", hex: block.hex, body: block.body || null }
        : { kind: block.kind, body: block.body };
  return apiFetch<BoardDetail>(`${path(id)}/blocks`, json("POST", body));
}

/** body null clears a caption; a heading or a note keeps its text. */
export function updateBlock(
  id: string,
  blockId: string,
  changes: { body?: string | null; hex?: string; position?: number },
): Promise<BoardDetail> {
  return apiFetch<BoardDetail>(blockPath(id, blockId), json("PATCH", changes));
}

export function removeBlock(id: string, blockId: string): Promise<BoardDetail> {
  return apiFetch<BoardDetail>(blockPath(id, blockId), { method: "DELETE" });
}
