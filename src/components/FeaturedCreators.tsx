"use client";

import Link from "next/link";
import { MarketCard } from "./MarketCard";
import { StatusBadge } from "./StatusBadge";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import live from "@/lib/live-data.json";

/**
 * Surfaces markets created by non-deployer addresses. Empty by design until
 * external creators land — the empty state itself is the CTA.
 */
export function FeaturedCreators() {
  const deployer = live.contracts ? live.feed?.resolver?.toLowerCase() : "";
  // Treat the configured "agent" address as our own — anything else is external.
  const ownAddress = (
    (live as unknown as { agent?: { address?: string } }).agent?.address ?? deployer ?? ""
  ).toLowerCase();

  const external = DEMO_MARKETS.filter(
    (m) => m.creator.toLowerCase() !== ownAddress,
  );

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="caption">community-created markets</h2>
          <StatusBadge kind={external.length > 0 ? "live" : "soon"} />
        </div>
        <Link
          href="/markets/create"
          className="text-2xs text-fg-mute hover:text-accent transition-colors"
        >
          create one →
        </Link>
      </div>

      {external.length === 0 ? (
        <div className="border border-dashed border-line/60 p-6 sm:p-8">
          <p className="font-serif italic text-fg-mute text-[15px] leading-snug max-w-[56ch] mb-4">
            No external creators yet — be the first.
          </p>
          <p className="text-[13px] text-fg-mute leading-relaxed max-w-[64ch] mb-5">
            The first three feeds are ours, the first markets were seeded by
            us. Anyone with five USDC and an opinion can create a market
            against any of these feeds and earn{" "}
            <span className="text-accent">40 bps of every trade forever</span>.
            Polish CPI prints, ECB rate decisions, Warsaw real-estate moves —
            pick the one you have conviction on.
          </p>
          <div className="flex flex-wrap gap-3 text-[12.5px] tracking-wide">
            <Link
              href="/markets/create"
              className="px-3 py-1.5 border border-accent/60 text-accent hover:bg-accent hover:text-bg transition-colors"
            >
              create your first market →
            </Link>
            <a
              href="https://github.com/registrai-multichain/contracts/blob/main/methodology/warsaw-resi-v1.md"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 border border-line text-fg-mute hover:text-fg hover:border-line-strong transition-colors"
            >
              read the methodology
            </a>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {external.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      )}
    </section>
  );
}
