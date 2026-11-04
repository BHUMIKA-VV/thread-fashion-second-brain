"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Heading, Plus, StickyNote, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { PiecePicker } from "@/features/outfit-studio/piece-picker";
import { pieceLabel } from "@/features/outfit-studio/names";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { ApiError, apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { addBlock, deleteBoard, getBoard, removeBlock, updateBlock, updateBoard, type NewBlock } from "@/services/boards";
import type { BoardBlock, BoardDetail } from "@/types/api";

/** The API's limit; the editor stops offering to add once a board is full. */
export const MAX_BLOCKS = 120;
const HEX = /^#[0-9a-f]{6}$/i;

/** A short, real name for a block, used for its label and its controls. */
export function blockLabel(block: BoardBlock): string {
  if (block.kind === "piece" && block.item) return pieceLabel(block.item);
  if (block.kind === "colour" && block.colour) return `${block.colour.name} ${block.colour.hex.toUpperCase()}`;
  const text = block.body ?? "";
  const short = text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  return `${block.kind === "heading" ? "Heading" : "Note"}: ${short}`;
}

export function BoardEditor({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const key = ["boards", "detail", id];
  const query = useQuery({ queryKey: key, queryFn: () => getBoard(id) });

  const onUpdated = (detail: BoardDetail) => {
    queryClient.setQueryData(key, detail);
    void queryClient.invalidateQueries({ queryKey: ["boards"], exact: true });
  };
  const add = useMutation({ mutationFn: (block: NewBlock) => addBlock(id, block), onSuccess: onUpdated });
  const change = useMutation({
    mutationFn: (c: { blockId: string; body?: string | null; position?: number; remove?: boolean }) =>
      c.remove ? removeBlock(id, c.blockId) : updateBlock(id, c.blockId, { body: c.body, position: c.position }),
    onSuccess: onUpdated,
  });

  if (query.isPending) {
    return <div role="status" className="h-[50vh] animate-pulse rounded-[2px] bg-ink/[0.06]" aria-label="Loading board" />;
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div role="alert" className="rounded-[2px] border border-line bg-paper-raised p-10 text-center">
        <p className="font-display text-2xl">{missing ? "This board doesn't exist" : "Couldn't load this board"}</p>
        <ButtonLink href="/boards" variant="secondary" className="mt-6">
          All boards
        </ButtonLink>
      </div>
    );
  }

  const board = query.data;
  const full = board.blocks.length >= MAX_BLOCKS;
  const failed = add.isError ? add.error : change.isError ? change.error : null;
  return (
    <div>
      <Link href="/boards" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Boards
      </Link>
      <DetailsForm board={board} onUpdated={onUpdated} />

      <div aria-live="polite">
        {failed && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {failed instanceof ApiError ? failed.message : "That change could not be saved."}
          </p>
        )}
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-12">
        <section aria-labelledby="board-blocks" className="min-w-0 lg:col-span-8">
          <h2 id="board-blocks" className="sr-only">
            The board
          </h2>
          {board.blocks.length === 0 ? (
            <p className="rounded-[2px] border border-dashed border-ink/20 px-6 py-14 text-center text-sm text-ink-muted">
              This board is empty. Add pieces from your archive, colours and notes.
            </p>
          ) : (
            <ol aria-label="Blocks on this board" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {board.blocks.map((block, index) => (
                <li
                  key={block.id}
                  className={cn(
                    block.kind === "heading" && "col-span-full",
                    block.kind === "note" && "col-span-2",
                  )}
                >
                  <BlockCard
                    block={block}
                    isFirst={index === 0}
                    isLast={index === board.blocks.length - 1}
                    busy={change.isPending}
                    onMove={(position) => change.mutate({ blockId: block.id, position })}
                    onBody={(body) => change.mutate({ blockId: block.id, body })}
                    onRemove={() => change.mutate({ blockId: block.id, remove: true })}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside aria-label="Add to this board" className="space-y-10 lg:sticky lg:top-8 lg:col-span-4 lg:self-start">
          {full ? (
            <p role="status" className="border-l-2 border-clay pl-3 text-sm">
              This board is full ({MAX_BLOCKS} blocks). Remove a block to add another.
            </p>
          ) : (
            <>
              <AddText busy={add.isPending} onAdd={(block) => add.mutate(block)} />
              <AddColour board={board} busy={add.isPending} onAdd={(block) => add.mutate(block)} />
              <PiecePicker
                chosen={new Set(board.blocks.flatMap((b) => (b.item ? [b.item.id] : [])))}
                full={false}
                replacing={null}
                chosenLabel="on this board"
                onChoose={(item) => add.mutate({ kind: "piece", itemId: item.id })}
              />
            </>
          )}
        </aside>
      </div>

      <DeleteBoard board={board} />
    </div>
  );
}

function DetailsForm({ board, onUpdated }: { board: BoardDetail; onUpdated: (d: BoardDetail) => void }) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? "");
  const save = useMutation({
    mutationFn: () => updateBoard(board.id, { name: name.trim(), description: description.trim() || null }),
    onSuccess: onUpdated,
  });
  const dirty = name.trim() !== board.name || (description.trim() || null) !== board.description;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && dirty) save.mutate();
  };

  return (
    <form onSubmit={submit} aria-label="Board details" className="mt-6 space-y-3 border-b border-line pb-8">
      <h1 className="sr-only">{board.name}</h1>
      <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">
        Board · {board.blocks.length} {board.blocks.length === 1 ? "block" : "blocks"}
      </p>
      <label className="block">
        <span className="sr-only">Board name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full bg-transparent font-display text-5xl leading-none tracking-tight outline-none focus:underline sm:text-6xl"
        />
      </label>
      <label className="block">
        <span className="sr-only">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Who it's for, the occasion, the brief…"
          className="w-full max-w-2xl resize-y bg-transparent text-ink-muted outline-none focus:text-ink"
        />
      </label>
      <div className="flex min-h-10 items-center gap-3" aria-live="polite">
        {(dirty || save.isPending) && (
          <Button type="submit" variant="secondary" disabled={!name.trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Save details"}
          </Button>
        )}
        {save.isError && (
          <span role="alert" className="text-sm text-danger">
            {save.error instanceof ApiError ? save.error.message : "Could not save."}
          </span>
        )}
      </div>
    </form>
  );
}

function BlockCard({
  block,
  isFirst,
  isLast,
  busy,
  onMove,
  onBody,
  onRemove,
}: {
  block: BoardBlock;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (position: number) => void;
  onBody: (body: string | null) => void;
  onRemove: () => void;
}) {
  const label = blockLabel(block);
  const isText = block.kind === "heading" || block.kind === "note";
  const [body, setBody] = useState(block.body ?? "");
  const save = () => {
    const next = body.trim() || null;
    if (next === block.body) return;
    if (isText && !next) {
      setBody(block.body ?? ""); // a heading or a note keeps its text; remove it instead
      return;
    }
    onBody(next);
  };

  return (
    <article aria-label={label} className="flex h-full flex-col">
      {block.kind === "piece" && block.item && (
        <>
          <Link href={`/items/${block.item.id}`} className="block aspect-[3/4] overflow-hidden bg-paper-raised">
            {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
            <img src={apiUrl(block.item.thumbnail_url)} alt={label} className="size-full object-cover" />
          </Link>
          {block.item.palette && <PaletteStrip colors={block.item.palette.colors} />}
        </>
      )}
      {block.kind === "colour" && block.colour && (
        <div>
          <div aria-hidden className="aspect-[3/4] border border-line" style={{ backgroundColor: block.colour.hex }} />
          <p className="mt-2 text-sm">{block.colour.name}</p>
          <p className="font-mono text-xs text-ink-muted">{block.colour.hex.toUpperCase()}</p>
        </div>
      )}

      <div className={cn("space-y-2 py-3", !isText && "border-b border-line")}>
        <label className="block text-xs text-ink-muted">
          <span className={cn(isText && "sr-only")}>{isText ? (block.kind === "heading" ? "Heading" : "Note") : "Caption"}</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            maxLength={block.kind === "heading" ? 200 : 2000}
            rows={block.kind === "heading" ? 1 : block.kind === "note" ? 3 : 2}
            placeholder={isText ? undefined : "Add a caption…"}
            className={cn(
              "block w-full resize-y rounded-[2px] text-ink",
              block.kind === "heading"
                ? "bg-transparent font-display text-3xl leading-tight outline-none focus:underline"
                : block.kind === "note"
                  ? "border-l-2 border-clay bg-transparent px-3 py-1 text-base outline-none"
                  : "mt-1 border border-line bg-paper-raised px-2 py-1.5 text-sm",
            )}
          />
        </label>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" disabled={isFirst || busy} onClick={() => onMove(block.position - 1)} aria-label={`Move ${label} earlier`}>
            <ArrowUp aria-hidden className="size-4" />
          </Button>
          <Button variant="ghost" disabled={isLast || busy} onClick={() => onMove(block.position + 1)} aria-label={`Move ${label} later`}>
            <ArrowDown aria-hidden className="size-4" />
          </Button>
          <Button variant="ghost" className="ml-auto text-danger" disabled={busy} onClick={onRemove} aria-label={`Remove ${label} from this board`}>
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function AddText({ busy, onAdd }: { busy: boolean; onAdd: (block: NewBlock) => void }) {
  const [kind, setKind] = useState<"heading" | "note">("note");
  const [text, setText] = useState("");
  const fieldId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onAdd({ kind, body: text.trim() });
    setText("");
  };
  return (
    <form onSubmit={submit} aria-labelledby="add-text-title">
      <h2 id="add-text-title" className="font-display text-2xl">
        Text
      </h2>
      <fieldset className="mt-3 flex gap-4 text-sm">
        <legend className="sr-only">Kind of text</legend>
        {(["note", "heading"] as const).map((k) => (
          <label key={k} className="inline-flex items-center gap-2">
            <input type="radio" name="text-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            {k === "note" ? <StickyNote aria-hidden className="size-4" /> : <Heading aria-hidden className="size-4" />}
            {k === "note" ? "Note" : "Heading"}
          </label>
        ))}
      </fieldset>
      <label htmlFor={fieldId} className="mt-3 block text-xs text-ink-muted">
        {kind === "note" ? "Note text" : "Heading text"}
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={kind === "heading" ? 200 : 2000}
        rows={kind === "heading" ? 1 : 3}
        placeholder={kind === "note" ? "e.g. Keep the gold to the borders." : "e.g. Colour story"}
        className="mt-1 block w-full resize-y rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
      />
      <Button type="submit" variant="secondary" className="mt-2" disabled={!text.trim() || busy}>
        <Plus aria-hidden className="size-4" /> Add {kind}
      </Button>
    </form>
  );
}

function AddColour({ board, busy, onAdd }: { board: BoardDetail; busy: boolean; onAdd: (block: NewBlock) => void }) {
  const [hex, setHex] = useState("#263b5e");
  const valid = HEX.test(hex.trim());
  const onBoard = new Set(board.blocks.flatMap((b) => (b.colour ? [b.colour.hex] : [])));
  // The colours Thread measured on the pieces already here, each once.
  const measured = new Map<string, string>();
  for (const block of board.blocks) {
    for (const c of block.item?.palette?.colors ?? []) if (!measured.has(c.hex)) measured.set(c.hex, c.name);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onAdd({ kind: "colour", hex: hex.trim().toLowerCase() });
  };

  return (
    <section aria-labelledby="add-colour-title">
      <h2 id="add-colour-title" className="font-display text-2xl">
        Colours
      </h2>
      {measured.size > 0 ? (
        <>
          <p className="mt-2 text-sm text-ink-muted">Measured on the pieces on this board:</p>
          <ul aria-label="Colours from pieces on this board" className="mt-3 flex flex-wrap gap-2">
            {[...measured].map(([value, name]) => {
              const added = onBoard.has(value);
              return (
                <li key={value}>
                  <button
                    type="button"
                    onClick={() => !added && !busy && onAdd({ kind: "colour", hex: value })}
                    aria-disabled={added || busy}
                    aria-label={added ? `${name} ${value.toUpperCase()}, on this board` : `Add ${name} ${value.toUpperCase()}`}
                    title={`${name} ${value.toUpperCase()}`}
                    className="relative block size-9 border border-line aria-disabled:cursor-default aria-disabled:opacity-40"
                    style={{ backgroundColor: value }}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Add pieces and their measured colours appear here.</p>
      )}
      <form onSubmit={submit} aria-label="Add a colour of your choice" className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-muted">
          Pick
          <input
            type="color"
            value={valid ? hex.trim().toLowerCase() : "#000000"}
            onChange={(e) => setHex(e.target.value)}
            className="mt-1 block h-10 w-12 cursor-pointer border border-line bg-paper-raised"
          />
        </label>
        <label className="text-xs text-ink-muted">
          Hex
          <input
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!valid}
            className="mt-1 block w-28 rounded-[2px] border border-line bg-paper-raised px-3 py-2 font-mono text-sm text-ink"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={!valid || busy}>
          <Plus aria-hidden className="size-4" /> Add colour
        </Button>
      </form>
    </section>
  );
}

function DeleteBoard({ board }: { board: BoardDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteBoard(board.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["boards", "detail", board.id] });
      void queryClient.invalidateQueries({ queryKey: ["boards"] });
      router.push("/boards");
    },
  });

  return (
    <div className="mt-14 border-t border-line pt-6">
      {!confirming ? (
        <Button variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden className="size-4" /> Delete board
        </Button>
      ) : (
        <div role="alertdialog" aria-labelledby="delete-board-title" className="rounded-[2px] border border-danger/30 bg-danger/5 p-5">
          <p id="delete-board-title" className="text-sm">
            Delete “{board.name}”? Its pieces stay in your archive; only the board, its colours and notes are removed.
          </p>
          <div className="mt-4 flex gap-3">
            <Button className="bg-danger text-paper hover:bg-danger/90" onClick={() => remove.mutate()} disabled={remove.isPending} autoFocus>
              {remove.isPending ? "Deleting…" : "Delete board"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={remove.isPending}>
              Cancel
            </Button>
          </div>
          {remove.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              The board could not be deleted.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
