"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { addrUrl } from "@/lib/chain";
import { suffixTreasuryAbi } from "@/lib/abi";
import type { SuffixPool } from "@/lib/suffix-pools";

// Read-only. The Suffix Pool's $aiLP (junior) is a security; there is no
// trading UI here until counsel clears the offering. This surfaces the live,
// on-chain state of the mechanism only.

interface State {
  floorPar: bigint;
  seniorFloorPrice: bigint;
  aiSpotPrice: bigint;
  frothPrice: bigint;
  externalSenior: bigint;
  seniorClaim: bigint;
  juniorEquity: bigint;
  juniorNav: bigint;
  cushionBps: bigint;
  seniorSolvent: boolean;
  totalUSDC: bigint;
  poolAi: bigint;
  poolUsdc: bigint;
  feesBank: bigint;
  seniorCap: bigint;
  minCushionBps: bigint;
  kBps: bigint;
  mBps: bigint;
  feeBps: bigint;
}

const usd = (w: bigint) => `$${(Number(w) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const px = (w: bigint) => `$${(Number(w) / 1e6).toFixed(3)}`;
const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(bps % 100n === 0n ? 0 : 2)}%`;

export function SuffixPanel({ pool }: { pool: SuffixPool }) {
  const { publicClient } = useWallet();
  const t = pool.treasury;
  const [s, setS] = useState<State>();

  const refresh = useCallback(async () => {
    if (!t) return;
    const read = (fn: string) =>
      publicClient.readContract({ address: t, abi: suffixTreasuryAbi, functionName: fn as "floorPar" }) as Promise<bigint>;
    try {
      const [
        floorPar, seniorFloorPrice, aiSpotPrice, frothPrice, externalSenior, seniorClaim,
        juniorEquity, juniorNav, cushionBps, totalUSDC, poolAi, poolUsdc, feesBank,
        seniorCap, minCushionBps, kBps, mBps, feeBps,
      ] = await Promise.all([
        read("floorPar"), read("seniorFloorPrice"), read("aiSpotPrice"), read("frothPriceUSDC"),
        read("externalSeniorSupply"), read("seniorClaimUSDC"), read("juniorEquityUSDC"),
        read("juniorNAVPerToken"), read("cushionBps"), read("totalUSDC"), read("poolAi"),
        read("poolUsdc"), read("feesBankUsdc"), read("seniorCap"), read("minCushionBps"),
        read("K_FLOOR_BPS"), read("M_FROTH_BPS"), read("SWAP_FEE_BPS"),
      ]);
      const seniorSolvent = (await publicClient.readContract({
        address: t, abi: suffixTreasuryAbi, functionName: "seniorSolvent",
      })) as boolean;
      setS({
        floorPar, seniorFloorPrice, aiSpotPrice, frothPrice, externalSenior, seniorClaim,
        juniorEquity, juniorNav, cushionBps, seniorSolvent, totalUSDC, poolAi, poolUsdc,
        feesBank, seniorCap, minCushionBps, kBps, mBps, feeBps,
      });
    } catch (e) {
      console.error("suffix refresh failed", e);
    }
  }, [t, publicClient]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const cap = s && s.seniorCap > 0n;

  return (
    <div>
      {/* live band visualization */}
      <div className="border border-line/60 bg-bg-elev/20 p-5 mb-px">
        <div className="caption text-2xs text-fg-dim mb-3">live price band (${pool.symbol})</div>
        <div className="grid grid-cols-3 gap-px bg-line text-center">
          <Band label={`floor · k=${s ? pct(s.kBps) : "—"}`} value={s ? px(s.seniorFloorPrice) : "—"} sub="buyback floor" tone="floor" />
          <Band label="spot" value={s ? px(s.aiSpotPrice) : "—"} sub="protocol-owned pool" tone="spot" />
          <Band label={`froth top · m=${s ? (Number(s.mBps) / 10000).toFixed(2) : "—"}×`} value={s ? px(s.frothPrice) : "—"} sub="harvest above" tone="froth" />
        </div>
        <p className="text-2xs text-fg-dim mt-3 leading-relaxed">
          The meme runs free <span className="text-fg-mute">between</span> the floor and the froth top.
          Below the floor, arbitrage against the redeem-buyback pushes price up. Above the froth top,
          the protocol harvests the premium into the floor.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-line">
        {/* senior */}
        <div className="bg-bg p-5">
          <h3 className="font-serif text-[18px] mb-3">${pool.symbol} · senior <span className="text-fg-dim text-2xs">(cash floor)</span></h3>
          <Stat label="float (external)" value={s ? usd(s.externalSenior) : undefined} />
          <Stat label="hard claim (HardNAV)" value={s ? usd(s.seniorClaim) : undefined} />
          <Stat label="floor price" value={s ? px(s.seniorFloorPrice) : undefined} />
          <Stat label="floor backed?" value={s ? (s.seniorSolvent ? "yes — fully" : "under-backed") : undefined} />
          {cap && <Stat label="float cap" value={usd(s!.seniorCap)} />}
        </div>
        {/* junior */}
        <div className="bg-bg p-5">
          <h3 className="font-serif text-[18px] mb-3">${pool.symbol}LP · junior <span className="text-fg-dim text-2xs">(first-loss / upside)</span></h3>
          <Stat label="equity (residual)" value={s ? usd(s.juniorEquity) : undefined} />
          <Stat label="NAV / token" value={s ? px(s.juniorNav) : undefined} />
          <Stat label="cushion (of senior claim)" value={s ? pct(s.cushionBps) : undefined} />
          <Stat label="cushion floor (locked)" value={s ? pct(s.minCushionBps) : undefined} />
        </div>
        {/* treasury / POL */}
        <div className="bg-bg p-5">
          <h3 className="font-serif text-[18px] mb-3">treasury reserve</h3>
          <Stat label="floor reserve (USDC)" value={s ? usd(s.totalUSDC) : undefined} />
          <Stat label="floor par" value={s ? px(s.floorPar) : undefined} />
          <Stat label="realized revenue (unskimmed)" value={s ? usd(s.feesBank) : undefined} />
        </div>
        <div className="bg-bg p-5">
          <h3 className="font-serif text-[18px] mb-3">protocol-owned liquidity</h3>
          <Stat label="pool USDC" value={s ? usd(s.poolUsdc) : undefined} />
          <Stat label="pool $ai" value={s ? usd(s.poolAi) : undefined} />
          <Stat label="swap fee → revenue" value={s ? pct(s.feeBps) : undefined} />
          <Stat label="spot price" value={s ? px(s.aiSpotPrice) : undefined} />
        </div>
      </div>

      {t && (
        <div className="mt-3 text-2xs text-fg-dim">
          treasury <a className="underline" href={addrUrl(t)} target="_blank" rel="noreferrer">{t}</a>
        </div>
      )}
    </div>
  );
}

function Band({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "floor" | "spot" | "froth" }) {
  const color = tone === "floor" ? "text-emerald-400" : tone === "froth" ? "text-amber-300" : "text-accent";
  return (
    <div className="bg-bg p-4">
      <div className="caption text-2xs text-fg-dim mb-1">{label}</div>
      <div className={`font-serif text-[22px] ${color}`}>{value}</div>
      <div className="text-2xs text-fg-dim mt-1">{sub}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-line/30 last:border-0">
      <span className="caption text-2xs text-fg-dim">{label}</span>
      <span className={`text-[14px] ${value === undefined ? "text-fg-dim/40 animate-pulse" : ""}`}>
        {value ?? "···"}
      </span>
    </div>
  );
}
