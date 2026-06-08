"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbiItem } from "viem";
import { useWallet } from "./WalletProvider";
import { suffixTreasuryAbi } from "@/lib/abi";
import type { SuffixPool } from "@/lib/suffix-pools";

// Price chart reconstructed from on-chain swaps against the protocol-owned pool.
// No indexer needed: read AiBought/AiSold logs, derive each trade's execution
// price, and draw it. Floor + froth bands are overlaid from live contract reads.

const BUY = parseAbiItem("event AiBought(address indexed buyer, uint256 usdcIn, uint256 aiOut, uint256 fee)");
const SELL = parseAbiItem("event AiSold(address indexed seller, uint256 aiIn, uint256 usdcOut, uint256 fee)");
const DEPLOY_BLOCK = 46_180_000n; // suffix deploy floor
const WINDOW = 9_000n;            // Arc eth_getLogs cap is 10k

interface Pt { x: number; price: number }

export function SuffixPriceChart({ pool }: { pool: SuffixPool }) {
  const { publicClient } = useWallet();
  const t = pool.treasury;
  const [pts, setPts] = useState<Pt[]>();
  const [floor, setFloor] = useState<number>();
  const [froth, setFroth] = useState<number>();

  const load = useCallback(async () => {
    if (!t) return;
    try {
      const [fl, fr, spot] = (await Promise.all([
        publicClient.readContract({ address: t, abi: suffixTreasuryAbi, functionName: "seniorFloorPrice" }),
        publicClient.readContract({ address: t, abi: suffixTreasuryAbi, functionName: "frothPriceUSDC" }),
        publicClient.readContract({ address: t, abi: suffixTreasuryAbi, functionName: "aiSpotPrice" }),
      ])) as bigint[];
      setFloor(Number(fl) / 1e6);
      setFroth(Number(fr) / 1e6);

      const latest = await publicClient.getBlockNumber();
      const trades: Pt[] = [];
      for (let from = DEPLOY_BLOCK; from <= latest; from += WINDOW + 1n) {
        const to = from + WINDOW > latest ? latest : from + WINDOW;
        const [buys, sells] = await Promise.all([
          publicClient.getLogs({ address: t, event: BUY, fromBlock: from, toBlock: to }),
          publicClient.getLogs({ address: t, event: SELL, fromBlock: from, toBlock: to }),
        ]);
        for (const b of buys) {
          const a = b.args as { usdcIn?: bigint; aiOut?: bigint; fee?: bigint };
          if (a.aiOut && a.aiOut > 0n) {
            trades.push({ x: Number(b.blockNumber), price: Number((a.usdcIn ?? 0n) - (a.fee ?? 0n)) / Number(a.aiOut) });
          }
        }
        for (const s of sells) {
          const a = s.args as { aiIn?: bigint; usdcOut?: bigint; fee?: bigint };
          if (a.aiIn && a.aiIn > 0n) {
            trades.push({ x: Number(s.blockNumber), price: Number((a.usdcOut ?? 0n) + (a.fee ?? 0n)) / Number(a.aiIn) });
          }
        }
      }
      trades.sort((p, q) => p.x - q.x);
      // always end on the current spot so the line reaches "now"
      trades.push({ x: Number(latest), price: Number(spot) / 1e6 });
      setPts(trades);
    } catch (e) {
      console.error("suffix chart load", e);
      setPts([]);
    }
  }, [t, publicClient]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="border border-line/60 bg-bg-elev/20 p-5">
      <div className="caption text-2xs text-fg-dim mb-3">price · realized trades (on-chain)</div>
      <Chart pts={pts} floor={floor} froth={froth} />
      <div className="flex gap-4 mt-3 text-2xs text-fg-dim">
        <span><span className="inline-block w-3 border-t border-accent align-middle" /> spot</span>
        <span><span className="inline-block w-3 border-t border-emerald-400 align-middle" /> floor</span>
        <span><span className="inline-block w-3 border-t border-dashed border-amber-300/70 align-middle" /> froth top</span>
      </div>
    </div>
  );
}

function Chart({ pts, floor, froth }: { pts?: Pt[]; floor?: number; froth?: number }) {
  const W = 640, H = 200, PAD = 8;
  if (!pts) return <div className="h-[200px] animate-pulse bg-line/20" />;
  if (pts.length < 2) {
    return <div className="h-[200px] flex items-center justify-center text-2xs text-fg-dim">no trades yet — be the first</div>;
  }
  const prices = pts.map((p) => p.price);
  const lo = Math.min(...prices, floor ?? Infinity) * 0.98;
  const hi = Math.max(...prices, froth ?? 0) * 1.02;
  const xs = pts.map((p) => p.x);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const sx = (x: number) => PAD + ((x - xmin) / Math.max(1, xmax - xmin)) * (W - 2 * PAD);
  const sy = (v: number) => PAD + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - 2 * PAD);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(pts[pts.length - 1]!.x).toFixed(1)},${(H - PAD).toFixed(1)} L${sx(pts[0]!.x).toFixed(1)},${(H - PAD).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ai-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {froth !== undefined && froth <= hi && froth >= lo && (
        <line x1={PAD} x2={W - PAD} y1={sy(froth)} y2={sy(froth)} className="stroke-amber-300/60" strokeWidth="1" strokeDasharray="4 3" />
      )}
      {floor !== undefined && floor <= hi && floor >= lo && (
        <line x1={PAD} x2={W - PAD} y1={sy(floor)} y2={sy(floor)} className="stroke-emerald-400/70" strokeWidth="1" />
      )}
      <path d={area} fill="url(#ai-fill)" className="text-accent" />
      <path d={line} fill="none" className="stroke-accent" strokeWidth="1.5" />
    </svg>
  );
}
