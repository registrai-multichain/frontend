import Link from "next/link";
import { Shell } from "@/components/Shell";
import { MarketCard } from "@/components/MarketCard";
import { ProposalsPanel } from "@/components/ProposalsPanel";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { fmtInt } from "@/lib/format";

export default function MarketsPage() {
  const markets = DEMO_MARKETS;
  const totalLiquidity = markets.reduce((s, m) => s + m.liquidity / 1e6, 0);
  const totalTrades = markets.reduce((s, m) => s + m.history.length, 0);
  const totalVolume = markets.reduce(
    (s, m) => s + m.history.reduce((ss, t) => ss + t.collateral, 0),
    0,
  );

  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="caption mb-4">markets</div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[18ch]">
          Markets that{" "}
          <span className="italic text-accent">resolve themselves</span>.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          Every market on Registrai is bound to a registered feed and resolves
          automatically against the agent&apos;s attested value at expiry. No
          manual settlement, no resolver discretion on the price — just the
          onchain attestation, finalized after its dispute window.
        </p>

        <div className="grid grid-cols-3 gap-px bg-line mb-12">
          <Stat label="active markets" value={String(markets.length)} />
          <Stat label="total liquidity" value={`${fmtInt(totalLiquidity)} USDC`} />
          <Stat label="volume · 30d" value={`${fmtInt(totalVolume)} USDC`} />
        </div>

        <div className="flex items-baseline justify-between mb-5">
          <h2 className="caption">live markets</h2>
          <Link
            href="/markets/create"
            className="text-2xs text-fg-mute hover:text-accent transition-colors"
          >
            create a market →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {markets.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>

        <ProposalsPanel />

        <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
          <span className="font-serif italic">{totalTrades} trades</span> across{" "}
          {markets.length} markets on Arc testnet. Trades happen permissionlessly
          on the <code className="text-fg">Markets</code> contract; resolution is
          deterministic from the attestation history. The same primitive scales
          to thousands of markets across hundreds of feeds.
        </div>
      </article>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-5">
      <div className="caption text-fg-dim mb-2">{label}</div>
      <div className="text-[22px] tnum tracking-tightest">{value}</div>
    </div>
  );
}
