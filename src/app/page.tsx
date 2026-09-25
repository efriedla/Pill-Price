import { SearchBoxFallback } from "@/features/search";
import { Card } from "@/ui/Card";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[var(--measure)] flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-step-4 text-text-primary">
          Pill Price
        </h1>
        <p className="text-text-secondary">
          A reference tool for U.S. drug pricing, built on RxNorm, openFDA, and
          NADAC.
        </p>
      </header>

      <Card tone="sunken" title="What you are looking at">
        <p>
          NADAC reports what pharmacies pay to acquire a drug. It is not what a
          patient pays at the counter, and it is not an insurance price. Every
          figure in this app is labelled accordingly.
        </p>
      </Card>

      {/* The plain GET form: it submits to /search, which takes over from there. */}
      <SearchBoxFallback />
    </main>
  );
}
