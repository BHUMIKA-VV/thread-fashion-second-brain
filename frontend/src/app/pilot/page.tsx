import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

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
          Nothing is paid online and there is no subscription. Joining the list commits you to nothing.
        </p>
      </section>
      <p>
        See what Thread does first in the{" "}
        <Link href="/demo" className="text-ink underline underline-offset-4">
          demo
        </Link>
        {email ? (
          <>
            , or write to{" "}
            <a href={`mailto:${email}`} className="text-ink underline underline-offset-4">
              {email}
            </a>
          </>
        ) : null}
        .
      </p>
    </div>
  );
}

export default function PilotPage() {
  return (
    <AuthShell kicker="Studio pilot" title="Your pieces, organised and measured" aside={<Offer />}>
      {/* The form reads ?for= (useSearchParams), which needs a Suspense boundary. */}
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse bg-ink/[0.05]" />}>
        <InterestForm />
      </Suspense>
    </AuthShell>
  );
}
