import { Hero } from "@/features/landing/hero";

const PILLARS = [
  {
    title: "Palette",
    body: "Dominant colours clustered in CIELAB space, named, measured and exportable.",
  },
  {
    title: "Craft & style",
    body: "Zero-shot tags for garments, silhouettes, patterns and Indian textile traditions.",
  },
  {
    title: "Kindred pieces",
    body: "Visual embeddings and vector search across your own library — never anyone else's.",
  },
];

export default function Home() {
  return (
    <>
      <Hero />
      <section className="border-t border-line bg-paper-raised">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:grid-cols-3 sm:px-8">
          {PILLARS.map((pillar) => (
            <div key={pillar.title}>
              <h2 className="font-display text-2xl">{pillar.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{pillar.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
