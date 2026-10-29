import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { CollectionsList } from "@/features/collections/collections-list";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Mood boards"
        title="Collections"
        description="Group pieces into private boards. Deleting a collection never deletes the pieces in it."
      />
      <div className="mt-10">
        <CollectionsList />
      </div>
    </div>
  );
}
