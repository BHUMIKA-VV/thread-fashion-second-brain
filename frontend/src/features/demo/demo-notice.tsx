import Link from "next/link";

/** Says plainly what the demo is: read-only, computed once, public-domain museum pieces. */
export function DemoNotice() {
  return (
    <aside aria-label="About this demo" className="border-l-2 border-clay bg-paper-raised px-4 py-3 text-sm leading-relaxed text-ink-muted">
      <p>
        <span className="font-medium text-ink">A read-only demo.</span> Twenty public-domain pieces from The Met and the
        Cleveland Museum of Art. Their colours, tags and kindred pieces were computed once by Thread; nothing you do
        here is saved (the visit is only counted, anonymously). To see the same on one of yours,{" "}
        <Link href="/try" className="text-ink underline underline-offset-4">
          try a photo
        </Link>
        ; to keep your own pieces,{" "}
        <Link href="/signup" className="text-ink underline underline-offset-4">
          create your wardrobe
        </Link>
        .
      </p>
    </aside>
  );
}
