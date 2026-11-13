import type { Metadata } from "next";
import Link from "next/link";

import { PAGE, PageHeader } from "@/components/page-header";
import { Pricing } from "@/features/pricing/pricing";
import { shareMetadata } from "@/lib/site";

const DESCRIPTION =
  "Proposed pilot pricing for Thread: a free tier with the museum demo, the photo playground and a small archive, and two studio plans. Nothing is on sale yet.";

export const metadata: Metadata = {
  title: "Pricing",
  description: DESCRIPTION,
  ...shareMetadata({ title: "Pricing · Thread", description: DESCRIPTION, path: "/pricing" }),
};

// Every answer describes how Thread works today, or says plainly what isn't decided yet.
const QUESTIONS = [
  {
    q: "Can I buy a plan today?",
    a: "Not yet. These are proposed prices for a pilot, published so you can tell us whether they fit. No payment can be made on Thread yet and no account is charged. To take part in the pilot, ask on the studio pilot page.",
  },
  {
    q: "What happens to my pieces if I change plan?",
    a: "Nothing you have added is deleted because of a plan change. How an archive that holds more than a plan allows will be handled is set out here before plans open.",
  },
  {
    q: "What counts towards the limits?",
    a: "Each piece you upload counts as one, including inspiration images added to a board. Storage is the size of those photographs. Collections, boards, outfits and notes don't count.",
  },
  {
    q: "Do I need an account for the demo or the playground?",
    a: "No. Both are open to everyone. The playground measures one photo at a time and doesn't keep it.",
  },
  {
    q: "Is there an annual price?",
    a: "No. Each paid plan is priced per 30 days; there is no annual plan or discount.",
  },
  {
    q: "What about cancellation and refunds?",
    a: "The cancellation and refund policy will be published in the terms before any payment can be made.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Plans"
        title="Pricing"
        description="Start with the museum demo and the photo playground. Keep a private archive, and move to a studio plan when your work needs boards, presentations and room to grow."
      />
      <div className="mt-10">
        <Pricing />
      </div>

      <section aria-labelledby="questions-title" className="mt-20 border-t border-ink pt-5">
        <h2 id="questions-title" className="font-display text-3xl">
          Questions
        </h2>
        <dl className="mt-6 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {QUESTIONS.map(({ q, a }) => (
            <div key={q}>
              <dt className="font-medium">{q}</dt>
              <dd className="mt-2 leading-relaxed text-ink-muted">{a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-sm text-ink-muted">
          See the{" "}
          <Link href="/terms" className="text-ink underline underline-offset-4">
            terms
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="text-ink underline underline-offset-4">
            privacy notice
          </Link>
          , or{" "}
          <Link href="/pilot" className="text-ink underline underline-offset-4">
            ask about the studio pilot
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
