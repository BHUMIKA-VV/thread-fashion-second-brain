"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api-client";
import { precheckFile } from "@/lib/upload-rules";
import { uploadItem } from "@/services/items";
import type { Item, ItemType } from "@/types/api";

export type UploadStatus = "waiting" | "uploading" | "saving" | "done" | "duplicate" | "error";

export type UploadEntry = {
  id: string;
  file: File;
  previewUrl: string;
  type: ItemType;
  status: UploadStatus;
  /** 0–1 while bytes are being sent. */
  progress: number;
  item?: Item;
  existingItemId?: string;
  error?: string;
};

const CONCURRENCY = 3;

let counter = 0;
const nextId = () => `upload-${Date.now()}-${counter++}`;

export function useUploadQueue() {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const active = useRef(new Set<string>());
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, changes: Partial<UploadEntry>) => {
    setEntries((current) => current.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  }, []);

  const start = useCallback(
    async (entry: UploadEntry) => {
      active.current.add(entry.id);
      const controller = new AbortController();
      controllers.current.set(entry.id, controller);
      patch(entry.id, { status: "uploading", progress: 0 });
      try {
        const item = await uploadItem(entry.file, {
          type: entry.type,
          signal: controller.signal,
          onProgress: (fraction) =>
            patch(entry.id, fraction >= 1 ? { status: "saving", progress: 1 } : { progress: fraction }),
        });
        patch(entry.id, { status: "done", item, progress: 1 });
        void queryClient.invalidateQueries({ queryKey: ["items"] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ApiError && error.status === 409) {
          const details = error.details as { existing_item_id?: string } | null;
          patch(entry.id, {
            status: "duplicate",
            error: error.message,
            existingItemId: details?.existing_item_id,
          });
        } else {
          patch(entry.id, {
            status: "error",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      } finally {
        active.current.delete(entry.id);
        controllers.current.delete(entry.id);
      }
    },
    [patch, queryClient],
  );

  // Start waiting uploads whenever a slot frees up.
  useEffect(() => {
    const free = CONCURRENCY - active.current.size;
    if (free <= 0) return;
    entries
      .filter((e) => e.status === "waiting" && !active.current.has(e.id))
      .slice(0, free)
      .forEach((e) => void start(e));
  }, [entries, start]);

  const addFiles = useCallback((files: Iterable<File>, type: ItemType) => {
    const added: UploadEntry[] = Array.from(files, (file) => {
      const problem = precheckFile(file);
      return {
        id: nextId(),
        file,
        previewUrl: URL.createObjectURL(file),
        type,
        status: problem ? "error" : "waiting",
        progress: 0,
        error: problem ?? undefined,
      };
    });
    setEntries((current) => [...added, ...current]);
  }, []);

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    setEntries((current) => {
      const entry = current.find((e) => e.id === id);
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return current.filter((e) => e.id !== id);
    });
  }, []);

  const retry = useCallback(
    (id: string) => patch(id, { status: "waiting", error: undefined, progress: 0 }),
    [patch],
  );

  const clearFinished = useCallback(() => {
    setEntries((current) => {
      current
        .filter((e) => e.status === "done" || e.status === "duplicate")
        .forEach((e) => URL.revokeObjectURL(e.previewUrl));
      return current.filter((e) => e.status !== "done" && e.status !== "duplicate");
    });
  }, []);

  // Release preview URLs and cancel in-flight uploads when leaving the page.
  const latest = useRef(entries);
  useEffect(() => {
    latest.current = entries;
  }, [entries]);
  useEffect(
    () => () => {
      controllers.current.forEach((c) => c.abort());
      latest.current.forEach((e) => URL.revokeObjectURL(e.previewUrl));
    },
    [],
  );

  return { entries, addFiles, remove, retry, clearFinished };
}
