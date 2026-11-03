"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { EVENT_LABELS, getMetrics, sourceLabel } from "@/services/metrics";
import type { MetricEvent, MetricsSummary } from "@/types/api";

const RANGES = [7, 30, 90] as const;
const EVENTS = Object.keys(EVENT_LABELS) as MetricEvent[];

/**
 * The owner's view of how people find Thread: daily visit totals per public page and where
 * they came from, beside what the app's own tables say happened next. The counts hold no
 * identifiers, so they are totals, not a per-person funnel.
 */
export function MetricsAdmin() {
  const me = useSession().data;
  const [days, setDays] = useState<number>(30);
  const metrics = useQuery({
    queryKey: ["admin", "metrics", days],
    queryFn: () => getMetrics(days),
    enabled: !!me?.is_owner,
  });

  if (!me?.is_owner) return null;
  return (
    <section aria-labelledby="metrics-title" className="mt-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="metrics-title" className="font-display text-3xl tracking-tight">
          Visits
        </h2>
        <div role="group" aria-label="Period" className="flex gap-2">
          {RANGES.map((range) => (
            <Button
              key={range}
              variant={range === days ? "primary" : "secondary"}
              aria-pressed={range === days}
              onClick={() => setDays(range)}
            >
              {range} days
            </Button>
          ))}
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Each public page counts once per visit, without cookies or identifiers, and not at all for visitors whose
        browser asks not to be tracked or for known bots. These are daily totals, not people: they can&apos;t say
        whether the same person who saw the demo later signed up.
      </p>
      <div className="mt-6">
        {metrics.isPending ? (
          <div role="status" aria-label="Loading visits" className="h-48 animate-pulse bg-ink/[0.05]" />
        ) : metrics.isError ? (
          <div role="alert" className="border-y border-danger/30 py-10 text-center">
            <p className="font-display text-xl">Visits could not be loaded.</p>
            <Button className="mt-6" variant="secondary" onClick={() => void metrics.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <MetricsView summary={metrics.data} />
        )}
      </div>
    </section>
  );
}

function MetricsView({ summary: s }: { summary: MetricsSummary }) {
  const f = s.funnel;
  return (
    <div className="space-y-10">
      <dl aria-label="Page visits" className="grid gap-px border-y border-ink bg-line grid-cols-2 sm:grid-cols-4">
        {EVENTS.map((event) => (
          <Stat key={event} label={EVENT_LABELS[event]} value={s.events[event] ?? 0} />
        ))}
      </dl>

      <div>
        <h3 className="font-display text-xl">What happened next</h3>
        <dl aria-label="Outcomes" className="mt-3 grid gap-px border-y border-ink bg-line grid-cols-2 sm:grid-cols-5">
          <Stat label="Accounts created" value={f.signups} />
          <Stat label="Email confirmed" value={f.confirmed} />
          <Stat label="Added a piece" value={f.added_a_piece} />
          <Stat label="Wardrobe early access" value={f.wardrobe_interest} />
          <Stat label="Studio pilot" value={f.studio_interest} />
        </dl>
      </div>

      <div>
        <h3 className="font-display text-xl">Where visits came from</h3>
        {s.sources.length === 0 ? (
          <p className="mt-3 border-y border-line py-8 text-center text-ink-muted">No visits counted in this period.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-y border-ink text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.15em] text-ink-muted">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Source
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">
                    All
                  </th>
                  {EVENTS.map((event) => (
                    <th key={event} scope="col" className="py-2 pr-4 text-right font-normal">
                      {EVENT_LABELS[event]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.sources.map((row) => (
                  <tr key={row.source} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      {sourceLabel(row.source)}
                    </th>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.total}</td>
                    {EVENTS.map((event) => (
                      <td key={event} className="py-2 pr-4 text-right tabular-nums text-ink-muted">
                        {row.events[event] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Since {new Date(`${s.since}T00:00:00Z`).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}{" "}
          (UTC). Tag a link you share with <code>?ref=</code>, e.g. <code>?ref=insta-nov</code>, to see it here.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-paper px-4 py-5">
      <dt className="text-xs uppercase tracking-[0.2em] text-ink-muted">{label}</dt>
      <dd className="mt-2 font-display text-4xl">{value}</dd>
    </div>
  );
}
