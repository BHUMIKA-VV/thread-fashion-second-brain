"use client";

import { Camera, ImagePlus, RotateCcw, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useId, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { cn } from "@/lib/cn";
import { ACCEPT_ATTRIBUTE, formatBytes } from "@/lib/upload-rules";
import { ITEM_TYPES, type ItemType } from "@/types/api";
import { useUploadQueue, type UploadEntry } from "./use-upload-queue";

const TYPE_LABELS: Record<ItemType, string> = {
  outfit: "Outfit",
  garment: "Garment",
  fabric: "Fabric swatch",
  accessory: "Accessory",
  other: "Other inspiration",
};

const STATUS: Record<UploadEntry["status"], { label: string; tone: StatusTone }> = {
  waiting: { label: "Waiting", tone: "idle" },
  uploading: { label: "Uploading", tone: "neutral" },
  saving: { label: "Checking image & extracting colours", tone: "neutral" },
  done: { label: "Saved", tone: "success" },
  duplicate: { label: "Already saved", tone: "warning" },
  error: { label: "Not uploaded", tone: "danger" },
};

export function UploadPanel() {
  const { entries, addFiles, remove, retry, clearFinished } = useUploadQueue();
  const [type, setType] = useState<ItemType>("garment");
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const typeGroupId = useId();

  const onFiles = (files: FileList | null) => {
    if (files && files.length > 0) addFiles(files, type);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    onFiles(event.dataTransfer.files);
  };

  const finished = entries.some((e) => e.status === "done" || e.status === "duplicate");

  return (
    <div className="space-y-8">
      <fieldset>
        <legend id={typeGroupId} className="text-sm font-medium">
          What are you saving?
        </legend>
        <div role="radiogroup" aria-labelledby={typeGroupId} className="mt-3 flex flex-wrap gap-2">
          {ITEM_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => setType(value)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                type === value
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-muted hover:border-ink/40 hover:text-ink",
              )}
            >
              {TYPE_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">Applies to the next files you add. You can change it later.</p>
      </fieldset>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center transition-colors",
          dragging ? "border-clay bg-clay/5" : "border-ink/25 bg-paper-raised",
        )}
      >
        <ImagePlus aria-hidden className="size-8 text-ink-muted" />
        <p className="mt-4 font-display text-2xl">Drop images here</p>
        <p className="mt-2 text-sm text-ink-muted">JPEG, PNG or WebP · up to 15 MB each · several at once</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => pickerRef.current?.click()}>
            <Upload aria-hidden className="size-4" /> Choose files
          </Button>
          <Button variant="secondary" onClick={() => cameraRef.current?.click()} className="sm:hidden">
            <Camera aria-hidden className="size-4" /> Take a photo
          </Button>
        </div>
        <input
          ref={pickerRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          className="sr-only"
          aria-label="Choose image files"
          data-testid="file-input"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {entries.length > 0 && (
        <section aria-labelledby="upload-queue-title">
          <div className="flex items-center justify-between">
            <h2 id="upload-queue-title" className="font-display text-xl">
              Uploads
            </h2>
            {finished && (
              <Button variant="ghost" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
          </div>
          <ul className="mt-4 space-y-3">
            <AnimatePresence initial={false}>
              {entries.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-4 rounded-xl border border-line bg-paper-raised p-3"
                >
                  <QueueRow entry={entry} onRemove={remove} onRetry={retry} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
    </div>
  );
}

function QueueRow({
  entry,
  onRemove,
  onRetry,
}: {
  entry: UploadEntry;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { label, tone } = STATUS[entry.status];
  const percent = Math.round(entry.progress * 100);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      <img src={entry.previewUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{entry.file.name}</p>
          <span className="text-xs text-ink-muted">{formatBytes(entry.file.size)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2" aria-live="polite">
          <StatusBadge tone={tone} label={entry.status === "uploading" ? `${label} ${percent}%` : label} />
          {entry.status === "done" && entry.item && (
            <Link href={`/items/${entry.item.id}`} className="text-xs underline underline-offset-2">
              View item
            </Link>
          )}
          {entry.status === "duplicate" && entry.existingItemId && (
            <Link href={`/items/${entry.existingItemId}`} className="text-xs underline underline-offset-2">
              Open the saved copy
            </Link>
          )}
          {entry.error && entry.status === "error" && (
            <span className="text-xs text-danger">{entry.error}</span>
          )}
        </div>
        {entry.status === "done" && entry.item?.palette && (
          <PaletteStrip colors={entry.item.palette.colors} className="mt-2 max-w-60 rounded-full" />
        )}
        {(entry.status === "uploading" || entry.status === "saving") && (
          <div
            role="progressbar"
            aria-label={`Uploading ${entry.file.name}`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10"
          >
            <div className="h-full bg-clay transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      {entry.status === "error" && (
        <Button variant="ghost" aria-label={`Retry ${entry.file.name}`} onClick={() => onRetry(entry.id)}>
          <RotateCcw aria-hidden className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        aria-label={entry.status === "uploading" ? `Cancel ${entry.file.name}` : `Remove ${entry.file.name}`}
        onClick={() => onRemove(entry.id)}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </>
  );
}
