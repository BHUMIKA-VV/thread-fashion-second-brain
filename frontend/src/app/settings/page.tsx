import type { Metadata } from "next";

import { SystemStatus } from "@/features/health/system-status";

export const metadata: Metadata = { title: "System" };

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
      <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Development</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">System</h1>
      <p className="mt-3 max-w-xl text-ink-muted">
        Live health of the local services Thread depends on. The browser reaches the API through
        the Next.js <code className="font-mono text-sm">/api</code> proxy.
      </p>
      <div className="mt-10">
        <SystemStatus />
      </div>
    </div>
  );
}
