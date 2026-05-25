"use client";

/**
 * Client-rendered "discovered onchain" section for the /markets index.
 *
 * The page itself is statically exported with the curated seed markets from
 * live-data.json. This component runs after hydration and queries every
 * Markets contract for MarketCreated events, filtering out ids already in
 * the static manifest. Newly user-created markets surface here without
 * requiring a rebuild.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { type Address, type Hex } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS } from "@/lib/chain";
import { marketsAbi } from "@/lib/abi";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { fmtInt, isoDate, shortAddr, shortHash } from "@/lib/format";
import { DEMO_FEED } from "@/lib/demo";

interface Discovered {
  id: Hex;
  feedId: Hex;
  agent: Address;
  threshold: bigint;
  comparator: number;
  expiry: bigint;
  creator: Address;
  yesReserve: bigint;
  noReserve: bigint;
  marketsVersion: "1.0" | "1.1" | "2.0";
}

const COMP_LABEL = [">", "≥", "<", "≤"];

export function ChainMarketsSection() {
  const { publicClient } = useWallet();
  const [rows, setRows] = useState<Discovered[] | undefined>();

  useEffect(() => {
    let cancelled = false;
    const knownIds = new Set(DEMO_MARKETS.map((m) => m.id.toLowerCase()));

    const targets: Array<{
      addr: Address | undefined;
      version: "1.0" | "1.1" | "2.0";
    }> = [
      { addr: CONTRACTS.MarketsV2, version: "2.0" },
      { addr: CONTRACTS.MarketsV11, version: "1.1" },
      // Skip Markets v1.0 — the seeded markets list already covers it.
    ];

    (async () => {
      const found: Discovered[] = [];
      // Arc RPC caps eth_getLogs at 100k blocks AND prunes older ranges.
      const tip = await publicClient.getBlockNumber();
      const fromBlock = tip > 99_000n ? tip - 99_000n : 0n;
      for (const t of targets) {
        if (!t.addr) continue;
        try {
          const logs = await publicClient.getLogs({
            address: t.addr,
            event: {
              type: "event",
              name: "MarketCreated",
              inputs: [
                { name: "marketId", type: "bytes32", indexed: true },
                { name: "creator", type: "address", indexed: true },
                { name: "feedId", type: "bytes32", indexed: true },
                { name: "agent", type: "address", indexed: false },
                { name: "threshold", type: "int256", indexed: false },
                { name: "comparator", type: "uint8", indexed: false },
                { name: "expiry", type: "uint256", indexed: false },
                { name: "liquidity", type: "uint256", indexed: false },
              ],
            },
            fromBlock,
            toBlock: "latest",
            strict: false,
          });
          for (const lg of logs) {
            const id = (lg.topics[1] ?? lg.args?.marketId) as Hex | undefined;
            if (!id || knownIds.has(id.toLowerCase())) continue;
            const m = (await publicClient.readContract({
              address: t.addr,
              abi: marketsAbi,
              functionName: "getMarket",
              args: [id],
            })) as {
              feedId: Hex;
              agent: Address;
              threshold: bigint;
              comparator: number;
              expiry: bigint;
              creator: Address;
              yesReserve: bigint;
              noReserve: bigint;
              phase: number;
              yesWon: boolean;
              createdAt: bigint;
            };
            if (m.createdAt === 0n) continue;
            // Skip resolved markets in the live list — they belong to history.
            if (m.phase === 1) continue;
            found.push({
              id,
              feedId: m.feedId,
              agent: m.agent,
              threshold: m.threshold,
              comparator: Number(m.comparator),
              expiry: m.expiry,
              creator: m.creator,
              yesReserve: m.yesReserve,
              noReserve: m.noReserve,
              marketsVersion: t.version,
            });
          }
        } catch {
          // Per-version chain hiccup — keep going.
        }
      }
      // Sort newest first.
      found.sort((a, b) => Number(b.expiry) - Number(a.expiry));
      if (!cancelled) setRows(found);
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  if (rows === undefined) {
    return (
      <section className="mt-14">
        <div className="caption text-fg-dim">discovered onchain · loading…</div>
      </section>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="mt-14">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="caption">discovered onchain · {rows.length} markets</h2>
        <span className="text-2xs text-fg-dim">
          user-created · not yet in the static manifest
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((m) => {
          const yes = Number(m.yesReserve);
          const no = Number(m.noReserve);
          const yesPrice = yes + no > 0 ? no / (yes + no) : 0.5;
          const feedSymbol =
            m.feedId === DEMO_FEED.id ? DEMO_FEED.symbol : shortHash(m.feedId);
          const title = `Will ${feedSymbol} ${COMP_LABEL[m.comparator] ?? ">"} ${fmtInt(Number(m.threshold))} by ${isoDate(Number(m.expiry))}?`;
          return (
            <Link
              key={m.id}
              href={`/markets/view/?id=${m.id}`}
              className="block border border-line hover:border-line-strong hover:bg-bg-elev/40 transition-all p-5"
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
                <span className="caption text-accent">
                  {feedSymbol}
                </span>
                <span className="caption text-[10px] text-fg-dim border border-line px-1.5 py-0.5">
                  v{m.marketsVersion}
                </span>
              </div>
              <p className="font-serif italic text-fg text-[14.5px] leading-snug mb-4 max-w-[44ch]">
                {title}
              </p>
              <div className="flex items-baseline gap-6">
                <div>
                  <div className="caption text-up text-[10px] mb-0.5">YES</div>
                  <div className="text-[20px] tnum tracking-tightest">
                    {(yesPrice * 100).toFixed(1)}<span className="text-fg-mute text-[12px]">¢</span>
                  </div>
                </div>
                <div>
                  <div className="caption text-down text-[10px] mb-0.5">NO</div>
                  <div className="text-[20px] tnum tracking-tightest">
                    {((1 - yesPrice) * 100).toFixed(1)}<span className="text-fg-mute text-[12px]">¢</span>
                  </div>
                </div>
                <div className="ml-auto text-2xs text-fg-dim">
                  by {shortAddr(m.creator)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
