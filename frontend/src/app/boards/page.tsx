import type { Metadata } from "next";
import { Suspense } from "react";

import { PAGE, PageHeader } from "@/components/page-header";
import { AuthGate } from "@/features/auth/auth-gate";
import { BoardsList } from "@/features/boards/boards-list";

export const metadata: Metadata = { title: "Boards" };

export default function BoardsPage({ searchParams }: PageProps<"/boards">) {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Moodboards"
        title="Boards"
        description="Pieces, colours and notes for a client or a concept, in the order you want to show them. Private to you; deleting a board never deletes the pieces on it."
      />
      <div className="mt-10">
        {/* The query string is runtime data with Cache Components, so it is read inside Suspense. */}
        <Suspense fallback={<div className="h-64 animate-pulse bg-ink/[0.05]" />}>
          {searchParams.then(({ from }) => (
            <AuthGate what="your boards">
              <BoardsList fromCollection={typeof from === "string" ? from : undefined} />
            </AuthGate>
          ))}
        </Suspense>
      </div>
    </div>
  );
}
