"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ChangeEvent } from "react";

import { ApiError } from "@/lib/api-client";
import { ACCEPT_ATTRIBUTE, precheckFile } from "@/lib/upload-rules";
import type { NewBlock } from "@/services/boards";
import { uploadItem } from "@/services/items";

type State =
  | { state: "idle" }
  | { state: "uploading"; progress: number }
  | { state: "added"; duplicate: boolean }
  | { state: "error"; message: string };

function existingId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details as { existing_item_id?: unknown } | undefined;
  return typeof details?.existing_item_id === "string" ? details.existing_item_id : null;
}

/**
 * An inspiration image (a photograph, a painting, a street scene) put straight onto the board.
 * It is saved to the archive as "Other inspiration", so Thread measures its colours and it can
 * be searched; the gallery can hide these with "Hide other inspiration".
 */
export function AddInspiration({ busy, onAdd }: { busy: boolean; onAdd: (block: NewBlock) => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<State>({ state: "idle" });
  const inputId = useId();
  const uploading = status.state === "uploading";

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again still fires
    if (!file || uploading || busy) return;
    const problem = precheckFile(file);
    if (problem) {
      setStatus({ state: "error", message: problem });
      return;
    }
    setStatus({ state: "uploading", progress: 0 });
    try {
      const item = await uploadItem(file, { type: "other", onProgress: (progress) => setStatus({ state: "uploading", progress }) });
      onAdd({ kind: "piece", itemId: item.id });
      setStatus({ state: "added", duplicate: false });
    } catch (error) {
      const existing = existingId(error);
      if (existing) {
        onAdd({ kind: "piece", itemId: existing });
        setStatus({ state: "added", duplicate: true });
      } else {
        setStatus({
          state: "error",
          message: error instanceof ApiError && error.status !== 0 ? error.message : "The image could not be uploaded. Try again.",
        });
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    }
  };

  return (
    <section aria-labelledby="add-inspiration-title">
      <h2 id="add-inspiration-title" className="font-display text-2xl">
        Inspiration image
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        A photograph, painting or scene that sets the mood. It is saved to your archive as Other inspiration, so Thread measures its
        colours; the gallery can hide these.
      </p>
      <label htmlFor={inputId} className="sr-only">
        Upload an inspiration image
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        onChange={(event) => void choose(event)}
        disabled={uploading || busy}
        className="mt-3 block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-[2px] file:border file:border-line file:bg-paper-raised file:px-3 file:py-2 file:text-ink disabled:opacity-50"
      />
      <p className="mt-1 text-xs text-ink-muted">JPEG, PNG or WebP, up to 15 MB.</p>
      <div aria-live="polite" className="mt-2 min-h-5 text-sm">
        {uploading && <p className="text-ink-muted">Uploading… {Math.round(status.progress * 100)}%</p>}
        {status.state === "added" && (
          <p className="text-ink-muted">
            {status.duplicate
              ? "This image is already in your archive, so that copy was added to the board."
              : "Added to the board. Its colours appear once Thread has measured them."}
          </p>
        )}
        {status.state === "error" && (
          <p role="alert" className="text-danger">
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
