import type { Metadata } from "next";

import { DemoInvite } from "@/features/landing/demo-invite";
import { Hero } from "@/features/landing/hero";
import { shareMetadata, SITE_DESCRIPTION } from "@/lib/site";

export const metadata: Metadata = shareMetadata({ title: "Thread", description: SITE_DESCRIPTION, path: "/" });

export default function Home() {
  return <Hero demoInvite={<DemoInvite />} />;
}
