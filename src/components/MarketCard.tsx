import Link from "next/link";
import type { Market } from "@/lib/types";
import { fmtPct, fmtInt } from "@/lib/format";

export function MarketCard({ market }: { market: Market }) {
  const yesPrice = market.noReserve / (market.yesReserve + market.noReserve);
  const noPrice = 1 - yesPrice;
  const days = Math.max(0, Math.ceil((market.expiry - Date.now() / 1000) / 86_400));
  const recentTrades = market.history.length;
  const volume = market.history.reduce((s, t) => s + t.collateral, 0);

  return (
    <Link
      href={`/markets/${market.id}`}
      className="block border border-line hover:border-line-strong hover:bg-bg-elev/40 transition-all p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between mb-3">
        <span className="caption text-fg-dim">resolves against</span>
        <span className="caption text-fg-dim">{days}d to expiry</span>
      </div>
      <div className="caption text-accent mb-3">{market.feedSymbol}</div>
      <h3 className="font-serif text-[19px] sm:text-[20px] leading-snug mb-5 max-w-[40ch]">
        {market.title}
      </h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <PriceCell label="YES" price={yesPrice} accent />
        <PriceCell label="NO" price={noPrice} />
      </div>
      <div className="flex items-center justify-between text-2xs text-fg-dim">
        <span>
          {recentTrades === 0
            ? `newly created · ${fmtInt(market.liquidity / 1e6)} USDC seed`
            : `${recentTrades} trades · ${fmtInt(volume)} USDC vol`}
        </span>
        <span className="hover:text-accent transition-colors">trade →</span>
      </div>
    </Link>
  );
}

function PriceCell({ label, price, accent }: { label: string; price: number; accent?: boolean }) {
  return (
    <div className={`border ${accent ? "border-up/40" : "border-line"} px-3 py-2.5`}>
      <div className="flex items-baseline justify-between">
        <span className={`caption ${accent ? "text-up" : "text-down"}`}>{label}</span>
        <span className="tnum text-[19px] tracking-tightest">{(price * 100).toFixed(1)}¢</span>
      </div>
      <div className="text-2xs text-fg-dim mt-1">
        implied {fmtPct(price * 100, 1)}
      </div>
    </div>
  );
}
