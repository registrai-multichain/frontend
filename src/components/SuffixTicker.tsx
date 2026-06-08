"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { suffixTreasuryAbi } from "@/lib/abi";
import type { SuffixPool } from "@/lib/suffix-pools";

// Big live price for the hero: spot, the cash floor beneath it, and how far
// above the floor we are right now.
export function SuffixTicker({ pool }: { pool: SuffixPool }) {
  const { publicClient } = useWallet();
  const t = pool.treasury;
  const [spot, setSpot] = useState<number>();
  const [floor, setFloor] = useState<number>();

  const load = useCallback(async () => {
    if (!t) return;
    try {
      const [sp, fl] = (await Promise.all([
        publicClient.readContract({ address: t, abi: suffixTreasuryAbi, functionName: "aiSpotPrice" }),
        publicClient.readContract({ address: t, abi: suffixTreasuryAbi, functionName: "seniorFloorPrice" }),
      ])) as bigint[];
      setSpot(Number(sp) / 1e6);
      setFloor(Number(fl) / 1e6);
    } catch (e) { console.error("ticker", e); }
  }, [t, publicClient]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => void load(), 12_000); return () => clearInterval(id); }, [load]);

  const aboveFloor = spot !== undefined && floor !== undefined && floor > 0
    ? ((spot - floor) / floor) * 100 : undefined;

  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <div>
        <div className="caption text-2xs text-fg-dim">spot</div>
        <div className="font-serif text-[40px] leading-none tabular-nums">
          {spot !== undefined ? `$${spot.toFixed(3)}` : <span className="text-fg-dim/40">—</span>}
        </div>
      </div>
      <div>
        <div className="caption text-2xs text-fg-dim">cash floor</div>
        <div className="font-serif text-[40px] leading-none text-emerald-400 tabular-nums">
          {floor !== undefined ? `$${floor.toFixed(3)}` : <span className="text-fg-dim/40">—</span>}
        </div>
      </div>
      {aboveFloor !== undefined && (
        <div className="text-2xs text-fg-dim self-end pb-1">
          {aboveFloor >= 0 ? "+" : ""}{aboveFloor.toFixed(0)}% above the floor · can&apos;t fall below it
        </div>
      )}
    </div>
  );
}
