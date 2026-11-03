import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { shareMetadata } from "@/lib/site";

const DESCRIPTION = "How Thread stores a piece, measures its colours, finds kindred pieces and helps you compose outfits.";

export const metadata: Metadata = {
  title: "How it works",
  description: DESCRIPTION,
  ...shareMetadata({ title: "How it works · Thread", description: DESCRIPTION, path: "/how-it-works" }),
};

const STEPS = [
  {
    title: "Add a piece",
    body: "Upload a photograph of an outfit, garment, fabric or accessory. It is checked, stored against your account, and private to you.",
  },
  {
    title: "Its colours are measured",
    body: "Thread reads the photograph's palette: the main colours, their names and how much of the image each covers. If it can't measure them, it shows no palette rather than guessing.",
  },
  {
    title: "Kindred pieces and tags appear",
    body: "An image model running on Thread's own server finds the pieces in your archive that look most alike and suggests tags. Tags are suggestions, and your corrections are kept.",
  },
  {
    title: "Search and collect",
    body: "Find pieces by words, colour and type, then gather them into ordered collections with your own notes. Deleting a collection never deletes its pieces.",
  },
  {
    title: "Compose outfits",
    body: "In the Outfit Studio, arrange up to 12 pieces in a Feature, Grid or Column layout, see how their measured colours relate, and download the result as a PNG card.",
  },
] as const;

const PROMISES = [
  {
    title: "Private until published",
    body: "Your archive is visible only to your account. Only Thread's owner can place pieces in the public showcase, and only their own.",
  },
  {
    title: "Nothing leaves without asking",
    body: "Deep analysis is optional and, where it is turned on, runs one piece at a time. It tells you what will be sent to Claude and waits for you to confirm. Your notes are never sent.",
  },
  {
    title: "Descriptions, not verdicts",
    body: "Colour relationships and tags describe what is measured in a photograph. They don't tell you what looks good, and they can be wrong.",
  },
] as const;

export default function HowItWorksPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="The method"
        title="How it works"
        description="Thread turns photographs of what you wear into an archive you can search, compare and compose from."
      />

      <ol className="mt-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="grid gap-x-8 gap-y-2 border-b border-line py-8 sm:grid-cols-12 sm:py-10">
            <span aria-hidden className="font-display text-3xl italic text-clay sm:col-span-2 sm:text-4xl">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h2 className="font-display text-3xl leading-tight tracking-tight sm:col-span-4">{step.title}</h2>
            <p className="max-w-prose leading-relaxed text-ink-muted sm:col-span-6">{step.body}</p>
          </li>
        ))}
      </ol>

      <section aria-labelledby="promises-title" className="mt-16">
        <h2 id="promises-title" className="font-display text-4xl tracking-tight">
          What stays true
        </h2>
        <div className="mt-6 grid gap-x-8 gap-y-8 border-t border-line pt-6 sm:grid-cols-3">
          {PROMISES.map((promise) => (
            <div key={promise.title}>
              <h3 className="font-display text-2xl leading-tight">{promise.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{promise.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-14 flex flex-wrap gap-3">
        <ButtonLink href="/upload">Add your first piece</ButtonLink>
        <ButtonLink href="/showcase" variant="secondary">
          See the showcase
        </ButtonLink>
      </div>
    </div>
  );
}
