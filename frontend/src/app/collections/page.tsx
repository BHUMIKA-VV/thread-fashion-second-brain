import type { Metadata } from "next";
import Link from "next/link";

import { PAGE, PageHeader } from "@/components/page-header";
import { AuthGate } from "@/features/auth/auth-gate";
import { CollectionsList } from "@/features/collections/collections-list";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Shortlists"
        title="Collections"
        description="Group pieces into private collections. Deleting a collection never deletes the pieces in it."
      />
      <p className="mt-4 text-sm text-ink-muted">
        Presenting to a client? Arrange pieces, colours and notes on a{" "}
        <Link href="/boards" className="underline">
          board
        </Link>
        .
      </p>
      <div className="mt-10">
        <AuthGate what="your collections">
          <CollectionsList />
        </AuthGate>
      </div>
    </div>
  );
}
