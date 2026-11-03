import { CountView } from "@/components/count-view";

/** Every demo page counts towards one "saw the demo" per visit (see lib/beacon.ts). */
export default function DemoLayout({ children }: LayoutProps<"/demo">) {
  return (
    <>
      <CountView event="demo_view" />
      {children}
    </>
  );
}
