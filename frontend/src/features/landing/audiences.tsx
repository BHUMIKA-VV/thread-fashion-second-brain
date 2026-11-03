import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { contactEmail } from "@/components/legal-page";

/**
 * Who Thread is for, in two columns: your own wardrobe, and professional work with fashion and
 * textiles. Each use is something Thread does today, and each professional one links to the demo
 * page that shows it. What Thread can't do yet for professionals is said plainly. Rendered on the
 * server (app/page.tsx) because it reads the published contact address.
 */

type Use = { title: string; body: string; demo?: { href: string; label: string } };

const WARDROBE: Use[] = [
  {
    title: "Keep every piece in one place",
    body: "Photograph clothes, fabrics and details from your phone, then search them by colour, type or tag.",
  },
  {
    title: "See what goes together",
    body: "Kindred pieces by look or by palette, and outfits composed in the Studio with the colours they share.",
  },
  {
    title: "Private by default",
    body: "Only your account sees your archive.",
  },
];

const STUDIO: Use[] = [
  {
    title: "Catalogue fabrics and stock",
    body: "Collections with notes, the craft and weave you record, and every piece searchable by colour.",
    demo: { href: "/demo/collections/indian-textiles", label: "A sample collection" },
  },
  {
    title: "Match a customer's colour",
    body: "Hex values and named colours measured from a photograph, with a swatch card to share.",
    demo: { href: "/demo/pieces/bandhani-sari", label: "A measured palette" },
  },
  {
    title: "Show a selection",
    body: "Compose up to twelve pieces in the Outfit Studio and export the board as an image.",
    demo: { href: "/demo/outfits/red-shawl-dark-coat", label: "A sample outfit" },
  },
];

function UseList({ uses }: { uses: Use[] }) {
  return (
    <ul className="mt-4 border-t border-ink">
      {uses.map((use) => (
        <li key={use.title} className="border-b border-line py-5">
          <h4 className="font-display text-xl">{use.title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{use.body}</p>
          {use.demo && (
            <Link href={use.demo.href} className="mt-2 inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:text-ink-muted">
              {use.demo.label} <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Audiences() {
  const email = contactEmail();
  return (
    <section aria-labelledby="who-title" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8">
      <h2 id="who-title" className="font-display text-4xl tracking-tight">
        Who Thread is for
      </h2>
      <div className="mt-8 grid gap-12 md:grid-cols-2">
        <section aria-labelledby="wardrobe-title">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">Fashion enthusiasts</p>
          <h3 id="wardrobe-title" className="mt-3 font-display text-3xl">
            For your wardrobe
          </h3>
          <UseList uses={WARDROBE} />
        </section>
        <section aria-labelledby="studio-title">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">Designers · stylists · boutiques · collectors</p>
          <h3 id="studio-title" className="mt-3 font-display text-3xl">
            For your studio or boutique
          </h3>
          <UseList uses={STUDIO} />
          <p className="mt-5 text-sm leading-relaxed text-ink-muted">
            Not yet: sharing a collection with a client, or keeping several clients&apos; wardrobes apart.
            {email && (
              <>
                {" "}
                Working with fashion or textiles professionally? Tell us how you work:{" "}
                <a href={`mailto:${email}`} className="text-ink underline underline-offset-4">
                  {email}
                </a>
                .
              </>
            )}
          </p>
        </section>
      </div>
    </section>
  );
}
