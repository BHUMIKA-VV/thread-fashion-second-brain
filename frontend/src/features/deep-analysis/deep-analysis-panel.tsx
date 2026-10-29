"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { getDeepAnalysis, getDeepAnalysisStatus, startDeepAnalysis } from "@/services/deep-analysis";
import type { DeepAnalysis, DeepAnalysisResult, DeepAnalysisStatus } from "@/types/api";

export const DEEP_ANALYSIS_POLL_MS = 2_000;

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Optional Claude vision description. Sends nothing until the user confirms each run. */
export function DeepAnalysisPanel({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const statusKey = ["deep-analysis", "status"];
  const analysisKey = ["deep-analysis", itemId];
  const status = useQuery({ queryKey: statusKey, queryFn: getDeepAnalysisStatus });
  const analysis = useQuery({
    queryKey: analysisKey,
    queryFn: () => getDeepAnalysis(itemId),
    enabled: status.data?.available === true,
    refetchInterval: (q) => (q.state.data?.status === "running" ? DEEP_ANALYSIS_POLL_MS : false),
  });
  const [confirming, setConfirming] = useState(false);
  const start = useMutation({
    mutationFn: () => startDeepAnalysis(itemId),
    onSuccess: (running) => {
      setConfirming(false);
      queryClient.setQueryData(analysisKey, running);
      void queryClient.invalidateQueries({ queryKey: statusKey });
    },
    onError: () => setConfirming(false),
  });

  const current = analysis.data;
  const running = current?.status === "running";

  return (
    <section aria-labelledby="deep-analysis-title" className="rounded-2xl border border-line bg-paper-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="deep-analysis-title" className="font-display text-xl">
          Deep analysis
        </h2>
        {status.data?.available && current && !confirming && (
          <Button variant="secondary" onClick={() => setConfirming(true)} disabled={running || start.isPending}>
            <Sparkles aria-hidden className={cn("size-4", running && "animate-pulse")} />
            {running ? "Analysing…" : current?.status === "not_run" ? "Deep analyze" : "Run again"}
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-4 text-sm" aria-live="polite">
        {status.isPending ? (
          <div className="h-10 animate-pulse rounded-xl bg-ink/[0.06]" aria-label="Loading deep analysis" />
        ) : status.isError ? (
          <p role="alert" className="text-danger">
            Deep analysis status could not be loaded.
          </p>
        ) : !status.data.available ? (
          <Unavailable status={status.data} />
        ) : (
          <>
            <ProviderNote status={status.data} />
            {confirming && (
              <Confirm
                status={status.data}
                pending={start.isPending}
                onSend={() => start.mutate()}
                onCancel={() => setConfirming(false)}
              />
            )}
            {start.isError && (
              <p role="alert" className="text-danger">
                {start.error instanceof ApiError ? start.error.message : "The analysis could not be started."}
              </p>
            )}
            {analysis.isError ? (
              <p role="alert" className="text-danger">
                The analysis could not be loaded.
              </p>
            ) : current ? (
              <AnalysisState analysis={current} />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Unavailable({ status }: { status: DeepAnalysisStatus }) {
  if (status.reason === "disabled_in_production") {
    return <p className="text-ink-muted">The local test analyzer is disabled in production.</p>;
  }
  return (
    <p className="text-ink-muted">
      Deep analysis is off. It is optional: to describe a piece with Claude, set{" "}
      <code className="rounded bg-ink/[0.06] px-1">THREAD_ANTHROPIC_API_KEY</code> in <code>.env</code> and restart
      the API. Palettes, tags and similar pieces work without it.
    </p>
  );
}

function ProviderNote({ status }: { status: DeepAnalysisStatus }) {
  if (status.provider === "fake") {
    return (
      <p className="rounded-lg bg-ink/[0.04] px-3 py-2 text-xs text-ink-muted">
        Test analyzer: canned results; nothing leaves this computer.
      </p>
    );
  }
  return (
    <p className="text-xs text-ink-muted">
      Uses {status.model}. {status.runs_today} of {status.daily_limit} runs used today.
    </p>
  );
}

function Confirm({
  status,
  pending,
  onSend,
  onCancel,
}: {
  status: DeepAnalysisStatus;
  pending: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const fake = status.provider === "fake";
  return (
    <div
      role="alertdialog"
      aria-labelledby="deep-confirm-title"
      aria-describedby="deep-confirm-body"
      className="rounded-2xl border border-line bg-paper p-4"
    >
      <p id="deep-confirm-title" className="font-medium">
        {fake ? "Run the test analyzer?" : "Send this piece to Anthropic?"}
      </p>
      <div id="deep-confirm-body" className="mt-2 space-y-2 text-ink-muted">
        <p>{fake ? "In a real run, this is what would be sent:" : "Sent to Anthropic for analysis:"}</p>
        <ul className="list-disc space-y-1 pl-5">
          {status.sent.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>Never sent: {status.not_sent.join(", ").toLowerCase()}.</p>
        {fake ? (
          <p>The test analyzer sends nothing and costs nothing.</p>
        ) : (
          <p>
            It runs on {status.model}, and Anthropic may charge for API usage. You have used {status.runs_today} of{" "}
            {status.daily_limit} runs today; that limit is a guard against runaway use, not a spending limit.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={onSend} disabled={pending} autoFocus>
          {pending ? "Starting…" : fake ? "Run test analysis" : "Send to Claude"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AnalysisState({ analysis }: { analysis: DeepAnalysis }) {
  return (
    <>
      {analysis.status === "running" && (
        <p className="flex items-center gap-2 text-ink-muted" role="status">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-ink" />
          Analysing with {analysis.requested_model}… this usually takes under a minute.
        </p>
      )}
      {analysis.status === "failed" && analysis.error && (
        <p role="alert" className="text-danger">
          {analysis.error.message}
        </p>
      )}
      {analysis.result && (
        <ResultView
          result={analysis.result}
          model={analysis.result_model}
          at={analysis.result_at}
          previous={analysis.status !== "completed"}
        />
      )}
    </>
  );
}

function ResultView({
  result,
  model,
  at,
  previous,
}: {
  result: DeepAnalysisResult;
  model: string | null;
  at: string | null;
  previous: boolean;
}) {
  const facts: [string, string | null][] = [
    ["Garment", result.garment],
    ["Silhouette", result.silhouette],
    ["Pattern", result.pattern],
  ];
  return (
    <article aria-label={previous ? "Last successful analysis" : "Analysis"} className="space-y-3">
      {previous && <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Last successful analysis</p>}
      <p className="leading-relaxed">{result.summary}</p>
      {!result.is_fashion_image && <p className="text-ink-muted">Claude did not see clothing or fabric in this image.</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {facts.map(([label, value]) =>
          value ? (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ) : null,
        )}
        {result.fabric && (
          <>
            <dt className="text-ink-muted">Fabric (guess)</dt>
            <dd>
              {result.fabric.guess} · {result.fabric.confidence} confidence
              <span className="block text-xs text-ink-muted">{result.fabric.reasoning}</span>
            </dd>
          </>
        )}
      </dl>
      {result.crafts.length > 0 && (
        <List title="Possible crafts">
          {result.crafts.map((craft) => (
            <li key={craft.name}>
              {craft.name} · {craft.confidence} confidence
              <span className="block text-xs text-ink-muted">{craft.evidence}</span>
            </li>
          ))}
        </List>
      )}
      {result.styling_ideas.length > 0 && <Strings title="Styling ideas" items={result.styling_ideas} />}
      {result.occasions.length > 0 && <Strings title="Occasions" items={result.occasions} />}
      {result.caveats.length > 0 && <Strings title="Caveats" items={result.caveats} />}
      <p className="text-xs text-ink-muted">
        AI description{model ? ` from ${model}` : ""}
        {at ? `, ${dateFormat.format(new Date(at))}` : ""}. It may be wrong: fabric and craft are guesses from a
        photo, not facts about the piece.
      </p>
    </article>
  );
}

function List({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-ink-muted">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5">{children}</ul>
    </div>
  );
}

function Strings({ title, items }: { title: string; items: string[] }) {
  return (
    <List title={title}>
      {items.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </List>
  );
}
