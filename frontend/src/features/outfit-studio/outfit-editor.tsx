"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Download, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { outfitCardFilename, renderOutfitCard } from "@/lib/outfit-card";
import { moved, type OutfitLayout } from "@/lib/outfit-layout";
import { deleteOutfit, duplicateOutfit, getOutfit, replaceOutfitItems, updateOutfit } from "@/services/outfits";
import type { Item, OutfitDetail, OutfitPieceRead, OutfitPieceRole, OutfitUpdate } from "@/types/api";

import { ColourRelations } from "./colour-relations";
import { Composition, LayoutChooser, PieceList } from "./composition";
import { pieceLabel, SEASON_NAMES } from "./names";
import { OrganiseOutfit } from "./organise-outfit";
import { DETAILS_FORM_ID, OutfitDetailsForm } from "./outfit-details";
import { PiecePicker } from "./piece-picker";

export const MAX_PIECES = 12;

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

type ExportState = { state: "idle" | "busy" } | { state: "done"; failed: number } | { state: "error" };

export function OutfitEditor({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = ["outfits", "detail", id];
  const query = useQuery({ queryKey: key, queryFn: () => getOutfit(id) });
  const [replacing, setReplacing] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState<ExportState>({ state: "idle" });
  // The last outfit the server confirmed, which a failed queue of changes returns to.
  const confirmed = useRef<OutfitDetail | undefined>(undefined);
  // A control that is about to disappear hands keyboard focus to this one (data-focus-key).
  const focusNext = useRef<string | null>(null);
  // The list the queued changes add up to, so each builds on the last even before a re-render.
  const desired = useRef<OutfitPieceRead[] | null>(null);
  const [layoutShown, setLayoutShown] = useState<OutfitLayout | null>(null);

  // Saves can overlap, so each answer only updates what that save is about: details never
  // bring back an older list of pieces, and pieces never bring back older details.
  const onDetailsSaved = (outfit: OutfitDetail) => {
    const current = queryClient.getQueryData<OutfitDetail>(key);
    const queued = desired.current && current;
    queryClient.setQueryData(key, queued ? { ...outfit, pieces: current.pieces, colours: current.colours } : outfit);
    void queryClient.invalidateQueries({ queryKey: ["outfits", "list"] });
  };
  const setPieces = (from: OutfitDetail) => {
    const current = queryClient.getQueryData<OutfitDetail>(key);
    queryClient.setQueryData(key, { ...(current ?? from), pieces: from.pieces, colours: from.colours });
  };

  // Shown at once and sent strictly in order, so quick changes are never lost or reordered.
  // Only the last answer is applied (with recalculated colours), since earlier ones are out of
  // date by then. On an error the previous list comes back: the server changes all or none.
  const replaceKey = ["outfits", "replace", id];
  const isLastReplace = () => queryClient.isMutating({ mutationKey: replaceKey }) === 1;
  const replace = useMutation({
    mutationKey: replaceKey,
    scope: { id: `outfit-pieces-${id}` },
    mutationFn: (pieces: OutfitPieceRead[]) =>
      replaceOutfitItems(id, pieces.map((p) => ({ item_id: p.item.id, role: p.role }))),
    onMutate: async (pieces) => {
      await queryClient.cancelQueries({ queryKey: key });
      const current = queryClient.getQueryData<OutfitDetail>(key);
      if (current) queryClient.setQueryData(key, { ...current, pieces: desired.current ?? pieces });
    },
    onError: () => {
      if (!isLastReplace()) return;
      desired.current = null;
      focusNext.current = null;
      if (confirmed.current) setPieces(confirmed.current);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onSuccess: (saved) => {
      confirmed.current = saved;
      if (!isLastReplace()) return;
      desired.current = null;
      setPieces(saved);
      void queryClient.invalidateQueries({ queryKey: ["outfits", "list"] });
    },
  });
  const details = useMutation({
    mutationFn: (changes: OutfitUpdate) => updateOutfit(id, changes),
    onSuccess: (outfit) => {
      onDetailsSaved(outfit);
      setDirty(false);
    },
  });
  // Apart from the details form, so changing layout never marks unsaved typing as saved.
  const layoutChange = useMutation({
    mutationFn: (layout: OutfitLayout) => updateOutfit(id, { layout }),
    onSuccess: onDetailsSaved,
    onSettled: () => setLayoutShown(null),
  });
  const duplicate = useMutation({
    mutationFn: () => duplicateOutfit(id),
    onSuccess: (copy) => {
      void queryClient.invalidateQueries({ queryKey: ["outfits", "list"] });
      router.push(`/outfit-studio/${copy.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteOutfit(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["outfits", "list"] });
      router.push("/outfit-studio");
    },
  });

  useEffect(() => {
    if (!focusNext.current) return;
    // Not there yet when it belongs to a piece still being placed: a later render will find it.
    const target = document.querySelector<HTMLElement>(`[data-focus-key="${focusNext.current}"]`);
    if (!target) return;
    target.focus();
    focusNext.current = null;
  });

  if (query.isPending) {
    return <div role="status" className="h-[60vh] animate-pulse bg-ink/[0.06]" aria-label="Loading outfit" />;
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div role="alert" className="border border-line bg-paper-raised p-10 text-center">
        <p className="font-display text-2xl">{missing ? "This outfit doesn't exist" : "Couldn't load this outfit"}</p>
        <ButtonLink href="/outfit-studio" variant="secondary" className="mt-6">
          All outfits
        </ButtonLink>
      </div>
    );
  }

  const outfit = query.data;
  const pieces = outfit.pieces;
  const layout = layoutShown ?? outfit.layout;
  const latest = () => desired.current ?? pieces;
  const change = (next: OutfitPieceRead[], message: string) => {
    if (!desired.current) confirmed.current = outfit;
    desired.current = next;
    setAnnouncement(message);
    replace.mutate(next);
  };
  const move = (from: number, to: number) => {
    const id = pieces[from].item.id;
    const list = latest();
    const start = list.findIndex((p) => p.item.id === id);
    if (start < 0) return;
    const end = Math.min(list.length - 1, Math.max(0, start + to - from));
    change(moved(list, start, end), `${pieceLabel(pieces[from].item)} moved to position ${end + 1} of ${list.length}.`);
  };
  const setRole = (index: number, role: OutfitPieceRole) =>
    change(
      latest().map((p) => (p.item.id === pieces[index].item.id ? { ...p, role } : p)),
      `${pieceLabel(pieces[index].item)} is now: ${role}.`,
    );
  const removePiece = (index: number) => {
    if (replacing === pieces[index].item.id) setReplacing(null);
    const neighbour = pieces[index + 1] ?? pieces[index - 1];
    focusNext.current = neighbour ? `remove-${neighbour.item.id}` : "composition-title";
    change(
      latest().filter((p) => p.item.id !== pieces[index].item.id),
      `${pieceLabel(pieces[index].item)} removed.`,
    );
  };
  const choose = (item: Item) => {
    const list = latest();
    if (list.some((p) => p.item.id === item.id)) return;
    if (replacing) {
      focusNext.current = `replace-${item.id}`;
      const out = list.find((p) => p.item.id === replacing);
      if (out) {
        change(
          list.map((p) => (p.item.id === replacing ? { ...p, item } : p)),
          `${pieceLabel(out.item)} replaced by ${pieceLabel(item)}.`,
        );
      }
      setReplacing(null);
      return;
    }
    if (list.length >= MAX_PIECES) return;
    const role: OutfitPieceRole = item.type === "accessory" ? "accessory" : "piece";
    change(
      [...list, { item, role, position: list.length }],
      `${pieceLabel(item)} added. ${list.length + 1} of ${MAX_PIECES} pieces.`,
    );
  };
  const exportCard = async () => {
    if (pieces.length === 0 || exporting.state === "busy") return;
    setExporting({ state: "busy" });
    try {
      const facts = [outfit.occasion, outfit.season ? SEASON_NAMES[outfit.season] : null].filter(Boolean).join(" · ");
      const { blob, failed } = await renderOutfitCard({
        name: outfit.name,
        subtitle: facts,
        layout,
        pieces: pieces.map((p) => ({
          imageUrl: apiUrl(p.item.image_url),
          thumbnailUrl: apiUrl(p.item.thumbnail_url),
          fileSize: p.item.file_size,
        })),
        colours: outfit.colours.dominant.map((c) => ({ hex: c.hex, name: c.name, share: c.share })),
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outfitCardFilename(outfit.name);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExporting({ state: "done", failed });
    } catch {
      setExporting({ state: "error" });
    }
  };

  const replacingPiece = pieces.find((p) => p.item.id === replacing);
  return (
    <div>
      <Link href="/outfit-studio" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All outfits
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <h1 className="min-w-0 max-w-full break-words font-display text-4xl leading-tight tracking-tight sm:text-5xl">
          {outfit.name}
        </h1>
        <div role="toolbar" aria-label="Outfit actions" className="flex flex-wrap items-center gap-2">
          {/* aria-disabled, not disabled, wherever pressing a button would otherwise drop focus. */}
          <Button
            type="submit"
            form={DETAILS_FORM_ID}
            aria-disabled={!dirty || details.isPending}
            onClick={(event) => {
              if (!dirty || details.isPending) event.preventDefault();
            }}
            className="aria-disabled:cursor-default aria-disabled:opacity-50"
          >
            <Save aria-hidden className="size-4" /> {details.isPending ? "Saving…" : dirty ? "Save details" : "Saved"}
          </Button>
          <Button variant="secondary" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
            <Copy aria-hidden className="size-4" /> {duplicate.isPending ? "Duplicating…" : "Duplicate"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void exportCard()}
            aria-disabled={pieces.length === 0 || exporting.state === "busy"}
            className="aria-disabled:cursor-default aria-disabled:opacity-50"
          >
            <Download aria-hidden className="size-4" /> {exporting.state === "busy" ? "Making the card…" : "Export PNG"}
          </Button>
          {confirmDelete ? (
            <>
              <Button variant="primary" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? "Deleting…" : "Yes, delete outfit"}
              </Button>
              <Button
                variant="ghost"
                autoFocus
                onClick={() => {
                  focusNext.current = "delete-outfit";
                  setConfirmDelete(false);
                }}
              >
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="ghost" data-focus-key="delete-outfit" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden className="size-4" /> Delete
            </Button>
          )}
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="mt-3 space-y-1 text-sm">
        {replace.isError && (
          <p role="alert" className="text-danger">
            {errorText(replace.error, "That change could not be saved.")} The outfit is back to its last saved state.
          </p>
        )}
        {details.isError && (
          <p role="alert" className="text-danger">
            {errorText(details.error, "The details could not be saved.")}
          </p>
        )}
        {layoutChange.isError && (
          <p role="alert" className="text-danger">
            {errorText(layoutChange.error, "The layout could not be changed.")}
          </p>
        )}
        {duplicate.isError && (
          <p role="alert" className="text-danger">
            {errorText(duplicate.error, "The outfit could not be duplicated.")}
          </p>
        )}
        {remove.isError && (
          <p role="alert" className="text-danger">
            {errorText(remove.error, "The outfit could not be deleted.")}
          </p>
        )}
        {exporting.state === "error" && (
          <p role="alert" className="text-danger">
            The card could not be made in this browser.
          </p>
        )}
        {exporting.state === "done" && (
          <p role="status" className={exporting.failed > 0 ? "text-danger" : "text-ink-muted"}>
            {exporting.failed > 0
              ? `Card downloaded, but ${exporting.failed} ${exporting.failed === 1 ? "photograph" : "photographs"} could not be loaded and ${exporting.failed === 1 ? "shows" : "show"} as a blank tile.`
              : "Card downloaded."}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-x-8 gap-y-10 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        {/* Composition first on small screens: it is what the page is about. */}
        <section aria-labelledby="composition-title" className="lg:col-start-2 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="composition-title" tabIndex={-1} data-focus-key="composition-title" className="font-display text-2xl">
              Composition
            </h2>
            <LayoutChooser
              value={layout}
              onChange={(next) => {
                setLayoutShown(next);
                layoutChange.mutate(next);
              }}
            />
          </div>
          <div className="mt-3">
            <Composition pieces={pieces} layout={layout} onMove={move} />
          </div>
          {pieces.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs text-ink-muted">
                {pieces.length} of {MAX_PIECES} pieces.{" "}
                {/* Dragging needs a mouse or trackpad, so touch screens are only told about the arrows. */}
                <span className="pointer-coarse:hidden">Drag photographs to reorder, or use the arrows.</span>
                <span className="hidden pointer-coarse:inline">Use the arrows to reorder.</span>
              </p>
              <PieceList
                pieces={pieces}
                replacingId={replacing}
                onMove={move}
                onRole={setRole}
                onReplace={(itemId) => setReplacing(replacing === itemId ? null : itemId)}
                onRemove={removePiece}
              />
            </div>
          )}
        </section>

        <div className="lg:col-start-1 lg:row-start-1">
          <PiecePicker
            chosen={new Set(pieces.map((p) => p.item.id))}
            full={pieces.length >= MAX_PIECES}
            replacing={replacingPiece ? pieceLabel(replacingPiece.item) : null}
            onChoose={choose}
          />
        </div>

        <aside aria-label="Outfit information" className="space-y-8 lg:col-start-3 lg:row-start-1">
          <section aria-labelledby="details-title">
            <h2 id="details-title" className="mb-3 font-display text-2xl">
              Details
            </h2>
            <OutfitDetailsForm
              key={outfit.id}
              outfit={outfit}
              onSave={(changes) => details.mutate(changes)}
              onDirtyChange={setDirty}
            />
          </section>
          <ColourRelations colours={outfit.colours} />
          <OrganiseOutfit outfitId={outfit.id} collectionIds={outfit.collection_ids} />
        </aside>
      </div>
    </div>
  );
}
