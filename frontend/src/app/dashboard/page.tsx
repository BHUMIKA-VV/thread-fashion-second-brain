import type { Metadata } from "next";

import { Dashboard } from "@/features/dashboard/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
      <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Overview</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">Dashboard</h1>
      <div className="mt-10">
        <Dashboard />
      </div>
    </div>
  );
}
