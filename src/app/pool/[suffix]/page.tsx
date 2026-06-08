import { notFound } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { FaucetHint } from "@/components/FaucetHint";
import { SuffixTicker } from "@/components/SuffixTicker";
import { SuffixPriceChart } from "@/components/SuffixPriceChart";
import { SuffixTradePanel } from "@/components/SuffixTradePanel";
import { SuffixPanel } from "@/components/SuffixPanel";
import { SUFFIX_POOLS, getPool } from "@/lib/suffix-pools";

export function generateStaticParams() {
  return SUFFIX_POOLS.map((p) => ({ suffix: p.symbol }));
}

export function generateMetadata({ params }: { params: { suffix: string } }) {
  const pool = getPool(params.suffix);
  if (!pool) return { title: "Suffix pool · Registrai" };
  return {
    title: `$${pool.symbol} · ${pool.name} · Registrai`,
    description: `${pool.tagline} — a cash-floored suffix token on Arc. ${pool.blurb}`,
  };
}

export default function PoolPage({ params }: { params: { suffix: string } }) {
  const pool = getPool(params.suffix);
  if (!pool) notFound();

  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">${pool.symbol} · suffix pool</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">testnet · cash-floored</span>
        </div>

        {!pool.live ? (
          <ComingSoon pool={pool} />
        ) : (
          <>
            <h1 className="font-serif text-[44px] sm:text-[60px] leading-[1.0] tracking-tightest mb-6">
              ${pool.symbol}
              <span className="block text-[20px] sm:text-[24px] text-fg-mute italic mt-2">
                {pool.tagline}
              </span>
            </h1>

            <div className="mb-10">
              <SuffixTicker pool={pool} />
            </div>

            <FaucetHint className="mb-6" />

            <div className="mb-6 border border-amber-500/30 bg-amber-500/5 p-3 text-2xs text-amber-300/80 leading-relaxed">
              <b>Testnet · not financial advice · not an offer.</b> ${pool.symbol} is a testnet token
              with a cash buyback-floor policy (not a redemption right or profit promise). The junior
              tranche <span className="text-fg-mute">${pool.symbol}LP is a security and is NOT offered
              or tradeable here.</span> Real-asset backing is a future roadmap item.
            </div>

            {/* chart + trade */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-px bg-line mb-px">
              <SuffixPriceChart pool={pool} />
              <SuffixTradePanel pool={pool} />
            </div>

            {/* deep state */}
            <SuffixPanel pool={pool} />

            {/* how it works */}
            <h2 className="font-serif text-[26px] mt-14 mb-5">How the floor works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
              <Card title="trade above, floored below"
                body={`$${pool.symbol} trades on a protocol-owned pool like any memecoin. Below the buyback floor, arbitrage (buy cheap, redeem at the floor) snaps the price back up. You can always sell to the treasury at the floor.`} />
              <Card title="the floor ratchets up"
                body="Every trade pays a 0.30% fee, and froth above the band is harvested — both flow into the floor reserve, raising the floor over time. It only moves up, and only from realized revenue." />
              <Card title="cash now, domains later"
                body={`The floor is backed by the USDC reserve today. Real .ai-style domain backing (marked by a bonded Registrai oracle) is a post-mainnet roadmap item — upside, not the reason to buy.`} />
            </div>

            {/* tokenomics */}
            <h2 className="font-serif text-[26px] mt-14 mb-5">Tokenomics</h2>
            <div className="border border-line/60 divide-y divide-line/40 text-[13px]">
              <Row k="two tokens" v={`$${pool.symbol} (senior, cash-floored, what you trade) + $${pool.symbol}LP (junior, first-loss/upside — a security, not offered yet)`} />
              <Row k="floor" v="k = 0.90 × par; backed by the USDC reserve; ratchets from fees + froth harvest" />
              <Row k="liquidity" v="100% protocol-owned (POL) — no mercenary LPs; the treasury market-makes its own pool" />
              <Row k="supply" v="bounded senior float (SENIOR_CAP), governed by a timelock; junior elastic + NAV-gated" />
              <Row k="safety" v="junior absorbs losses first; the protocol never mints junior to defend senior (no LUNA spiral)" />
              <Row k="no transfer tax" v="standard ERC-20, bridge-ready" />
            </div>
            <p className="text-2xs text-fg-dim mt-3">
              Full design + tokenomics specs live in the repo (suffix-pool-design, suffix-tokenomics).
            </p>

            {/* FAQ */}
            <h2 className="font-serif text-[26px] mt-14 mb-5">FAQ</h2>
            <div className="space-y-4 max-w-[68ch]">
              <Faq q="Can it go to zero?" a={`Not while the treasury reserve holds: $${pool.symbol} has a cash buyback floor it can always be sold to the treasury at. That's the whole point — a memecoin with a floor.`} />
              <Faq q="What backs the floor?" a="Today, the protocol's USDC reserve (plus realized revenue). Not domains yet — real-asset backing is a future roadmap item, disclosed honestly and not a reason to buy now." />
              <Faq q={`What is $${pool.symbol}LP?`} a={`The junior tranche — the leveraged first-loss/upside leg. It is a security, ring-fenced and NOT offered or tradeable here pending legal review.`} />
              <Faq q="Is this an investment?" a="No. This is a testnet token; nothing here is an offer, solicitation, or financial advice. The floor is a protocol policy, not a contractual redemption right." />
            </div>

            <div className="mt-12">
              <Link href="/pools" className="text-2xs text-accent hover:underline">← all suffix pools</Link>
            </div>
          </>
        )}
      </article>
    </Shell>
  );
}

function ComingSoon({ pool }: { pool: { symbol: string; name: string; blurb: string } }) {
  return (
    <>
      <h1 className="font-serif text-[44px] sm:text-[60px] leading-[1.0] tracking-tightest mb-6">
        ${pool.symbol}
        <span className="block text-[20px] text-fg-mute italic mt-2">coming soon</span>
      </h1>
      <p className="text-fg-mute text-[15px] leading-relaxed max-w-[60ch] mb-8">{pool.blurb}</p>
      <p className="text-[13px] text-fg-mute max-w-[60ch]">
        {pool.name} runs the same engine as $ai — a cash-floored suffix token with protocol-owned
        liquidity and a floor that ratchets from real revenue. It deploys after $ai. Watch this space.
      </p>
      <div className="mt-10">
        <Link href="/pool/ai" className="text-2xs text-accent hover:underline">→ see $ai, live now</Link>
      </div>
    </>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-bg p-5">
      <h3 className="font-serif text-[17px] leading-snug mb-3 max-w-[24ch]">{title}</h3>
      <p className="text-[12.5px] text-fg-mute leading-relaxed">{body}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-4 px-4 py-3">
      <span className="caption text-2xs text-fg-dim sm:w-[140px] shrink-0">{k}</span>
      <span className="text-fg-mute">{v}</span>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="font-serif text-[16px] mb-1">{q}</div>
      <p className="text-[13px] text-fg-mute leading-relaxed">{a}</p>
    </div>
  );
}
