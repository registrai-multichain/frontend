import Link from "next/link";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { SUFFIX_POOLS } from "@/lib/suffix-pools";

export const metadata = {
  title: "Suffix Pools · Registrai",
  description:
    "Cash-floored suffix tokens on Arc — memecoins with a buyback floor that ratchets from real protocol revenue. $ai live; $xyz, $fun and more to come.",
};

export default function PoolsPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">suffix pools</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">testnet</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[22ch]">
          Memecoins with a <span className="italic text-accent">floor</span>.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          Each suffix — <span className="italic">$ai, $xyz, $fun</span> — is its own cash-floored
          token: a protocol-owned pool you trade against, with a buyback floor that ratchets up from
          real revenue. One engine, many suffixes.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line">
          {SUFFIX_POOLS.map((p) => (
            <Link
              key={p.symbol}
              href={`/pool/${p.symbol}`}
              className="bg-bg p-6 hover:bg-bg-elev/30 transition-colors group"
            >
              <div className="flex items-baseline justify-between mb-3">
                <span className="font-serif text-[28px]">${p.symbol}</span>
                <span className={`caption text-2xs ${p.live ? "text-emerald-400" : "text-fg-dim"}`}>
                  {p.live ? "live" : "soon"}
                </span>
              </div>
              <div className="text-[13px] text-fg-mute italic mb-2">{p.tagline}</div>
              <p className="text-[12.5px] text-fg-dim leading-relaxed">{p.blurb}</p>
              <div className="mt-4 text-2xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                {p.live ? "trade →" : "preview →"}
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute max-w-[70ch]">
          <span className="font-serif italic">How they relate.</span> All suffix pools are consumers
          of Registrai oracle infrastructure — Registrai itself stays neutral. Each suffix is a
          separate deployment (own treasury, tokens, pool). Testnet only; nothing here is an offer.
        </div>
      </article>
    </Shell>
  );
}
