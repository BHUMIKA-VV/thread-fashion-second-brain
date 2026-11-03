import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CountView } from "@/components/count-view";
import { contactEmail } from "@/components/legal-page";
import { AuthShell } from "@/features/auth/form-parts";
import { InterestForm } from "@/features/interest/interest-form";
import { shareMetadata } from "@/lib/site";

const DESCRIPTION =
  "A hand-run pilot for studios, labels and boutiques: your pieces and fabrics organised in Thread, with every colour measured.";

export const metadata: Metadata = {
  title: "Studio pilot",
  description: DESCRIPTION,
  ...shareMetadata({ title: "Studio pilot · Thread", description: DESCRIPTION, path: "/pilot" }),
};

// What the pilot is. Every line is something Thread does today, done with you by hand.
const INCLUDED = [
  "A private Thread archive for your studio, set up with you: up to 100 of your pieces or fabrics.",
  "Collections you choose, with notes, the craft and weave recorded, and every colour measured.",
  "Swatch cards and Outfit Studio boards to send to customers as images.",
  "Four weeks of short check-ins about what works and what's missing.",
];

const NOT_YET = ["Sharing a collection by link", "Keeping several clients' wardrobes apart", "Team accounts", "Paying online"];

// The demo collection closest to a studio's own archive: textiles, catalogued and measured.
const SAMPLE = { href: "/demo/collections/indian-textiles", title: "Indian textiles" };

// What the call is for. It is a conversation, not a pitch; nothing here is promised beyond it.
const CALL = [
  "A walk through Thread on a few of your own photos, or on the demo if you'd rather not share any.",
  "How you keep track of fabrics and pieces today, and where that gets in the way.",
  "Whether the pilot fits, what it would cost, and what you'd need that Thread doesn't do yet.",
];

/** THREAD_PILOT_PRICE, e.g. "₹2,999, once": shown only when the owner has decided one. */
function pilotPrice(): string | null {
  return process.env.THREAD_PILOT_PRICE?.trim() || null;
}

function Offer() {
  const price = pilotPrice();
  const email = contactEmail();
  return (
    <div className="space-y-6">
      <p>
        For stylists, designers, boutiques and collectors who work with many pieces and fabrics. We start with a
        small number of studios, so each gets proper attention.
      </p>
      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className="font-display text-xl text-ink">
          Three steps, at your pace
        </h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>
            <Link href="/try" className="text-ink underline underline-offset-4">
              Try one of your photos
            </Link>{" "}
            and see what Thread measures. No account needed, and nothing is kept.
          </li>
          <li>
            See a sample archive: the{" "}
            <Link href={SAMPLE.href} className="text-ink underline underline-offset-4">
              {SAMPLE.title}
            </Link>{" "}
            collection in the demo, museum pieces with every colour measured.
          </li>
          <li>
            <a href="#request" className="text-ink underline underline-offset-4">
              Request a 20-minute demo call
            </a>{" "}
            with the form.
          </li>
        </ol>
      </section>
      <section aria-labelledby="call-title">
        <h2 id="call-title" className="font-display text-xl text-ink">
          What a 20-minute demo call covers
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          {CALL.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2">We find a time by email, by video or phone. There&apos;s no obligation to join the pilot.</p>
      </section>
      <section aria-labelledby="included-title">
        <h2 id="included-title" className="font-display text-xl text-ink">
          What the pilot includes
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          {INCLUDED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="not-yet-title">
        <h2 id="not-yet-title" className="font-display text-xl text-ink">
          Not part of it yet
        </h2>
        <p className="mt-2">{NOT_YET.join(" · ")}. Tell us if you need one of these; it shapes what comes next.</p>
      </section>
      <section aria-labelledby="price-title">
        <h2 id="price-title" className="font-display text-xl text-ink">
          Price
        </h2>
        <p className="mt-2">
          {price ? `${price}. ` : "Agreed with you before we start. "}
          Nothing is paid online and there is no subscription. Requesting a call commits you to nothing.
        </p>
      </section>
      {email && (
        <p>
          Rather write?{" "}
          <a href={`mailto:${email}`} className="text-ink underline underline-offset-4">
            {email}
          </a>
          .
        </p>
      )}
    </div>
  );
}

export default function PilotPage() {
  return (
    <AuthShell kicker="Studio pilot" title="Your pieces, organised and measured" aside={<Offer />}>
      <CountView event="pilot_view" />
      {/* The form reads ?for= (useSearchParams), which needs a Suspense boundary. #request is
          step 3 of the journey in the aside. */}
      <span id="request" aria-hidden className="block scroll-mt-24" />
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse bg-ink/[0.05]" />}>
        <InterestForm />
      </Suspense>
    </AuthShell>
  );
}
