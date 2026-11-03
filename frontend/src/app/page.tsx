import type { Metadata } from "next";

import { CountView } from "@/components/count-view";
import { Audiences } from "@/features/landing/audiences";
import { DemoInvite } from "@/features/landing/demo-invite";
import { Hero } from "@/features/landing/hero";
import { shareMetadata, SITE_DESCRIPTION } from "@/lib/site";

export const metadata: Metadata = shareMetadata({ title: "Thread", description: SITE_DESCRIPTION, path: "/" });

export default function Home() {
  return (
    <>
      <CountView event="landing_view" />
      <Hero demoInvite={<DemoInvite />} audiences={<Audiences />} />
    </>
  );
}
