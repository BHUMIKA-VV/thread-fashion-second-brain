"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { ApiError } from "@/lib/api-client";
import { setAllPublic } from "@/services/showcase";

/** The owner's bulk switch, with a confirmation step: publishing is a public act. */
export function PublishAll() {
  const owner = useSession().data?.is_owner === true;
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<null | boolean>(null);
  const run = useMutation({
    mutationFn: (isPublic: boolean) => setAllPublic(isPublic),
    onSuccess: () => {
      setAsking(null);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["showcase"] });
    },
  });
  if (!owner) return null;

  if (asking === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAsking(true)}>
          Publish all…
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)}>
          Unpublish all…
        </Button>
        {run.isSuccess && (
          <p role="status" className="self-center text-sm text-ink-muted">
            {run.data.changed} {run.data.changed === 1 ? "piece" : "pieces"} {run.data.public ? "published" : "made private"}.
          </p>
        )}
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-label={asking ? "Publish every piece?" : "Make every piece private?"} className="border-l-2 border-ink pl-4 text-sm">
      <p className="text-ink">
        {asking
          ? "Publish every piece in your archive? Anyone can then see their images, palettes and tags (never your notes)."
          : "Make every piece private? They disappear from the showcase at once (cached images can linger up to 5 minutes)."}
      </p>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => run.mutate(asking)} disabled={run.isPending}>
          {run.isPending ? "Working…" : asking ? "Publish all" : "Make all private"}
        </Button>
        <Button variant="ghost" onClick={() => setAsking(null)} disabled={run.isPending}>
          Cancel
        </Button>
      </div>
      {run.isError && (
        <p role="alert" className="mt-2 text-danger">
          {run.error instanceof ApiError ? run.error.message : "That didn't work."}
        </p>
      )}
    </div>
  );
}
