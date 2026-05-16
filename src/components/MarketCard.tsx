"use client";

import Link from "next/link";
import type { Market } from "@/lib/types";
import { fmtPct, fmtInt } from "@/lib/format";
import { useLiveMarket } from "@/lib/hooks/useLiveMarket";
import { LivePulse } from "./LivePulse";
import { VerifiableBadge } from "./VerifiableBadge";

export function MarketCard({ market }: { market: Market }) {
  const { data: live, freshAt } = useLiveMarket(market.id);

  // Default to seeded reserves until first chain read returns.
  const yesReserve = live?.yesReserve ?? BigInt(market.yesReserve);
  const noReserve = live?.noReserve ?? BigInt(market.noReserve);
  const yesPrice = live?.yesPrice ?? market.noReserve / (market.yesReserve + market.noReserve);
  const noPrice = 1 - yesPrice;

  const days = Math.max(0, Math.ceil((market.expiry - Date.now() / 1000) / 86_400));
  const recentTrades = market.history.length;
  const volume = market.history.reduce((s, t) => s + t.collateral, 0);
  const liveLiquidity = Number(yesReserve + noReserve) / 1e6;

  return (
    <Link
      href={`/markets/${market.id}`}
      className="block border border-line hover:border-line-strong hover:bg-bg-elev/40 transition-all p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between mb-3">
        <span className="caption text-fg-dim">resolves against</span>
        <div className="flex items-center gap-2">
          <LivePulse freshAt={freshAt} />
          <span className="caption text-fg-dim">{days}d to expiry</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="caption text-accent">{market.feedSymbol}</span>
        {market.verifiable && <VerifiableBadge rule={market.rule} />}
      </div>
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
            ? `${fmtInt(liveLiquidity)} USDC pool`
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
