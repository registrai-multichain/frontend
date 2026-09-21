import Link from "next/link";
import { BrandLockup } from "@/components/Brand";
import { Atlas } from "@/components/Atlas";

export const metadata = {
  title: "Builder Atlas · Registrai",
  description:
    "Builder density worldwide. Progress and volume read from chain; country self-declared.",
};

/**
 * Self-contained rather than wrapped in `Shell`: Shell carries the retired
 * warm-paper palette, and half a page in each theme looks like a mistake.
 */
export default function AtlasPage() {
  return (
    <div className="perennial">
      <div className="mx-auto w-full max-w-[1080px] px-6 sm:px-10">
        <header className="flex items-center justify-between gap-4 py-6 border-b border-[color:var(--line)]">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Registrai home">
            <BrandLockup markClassName="h-7 w-7" wordmarkClassName="text-[18px]" />
          </Link>
          <span className="text-[10px] tracking-[0.14em] uppercase text-[color:var(--fg-dim)]">
            arc testnet
          </span>
        </header>
        <main className="py-10">
          <Atlas />
        </main>
      </div>
    </div>
  );
}
