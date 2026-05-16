"use client";

import { useMemo } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { useChainPoll } from "./useChainPoll";
import { DEFAULT_CHAIN } from "@/lib/chains";
import { marketsAbi } from "@/lib/abi";
import { CONTRACTS } from "@/lib/chain";

interface OnchainMarket {
  feedId: Hex;
  agent: `0x${string}`;
  threshold: bigint;
  comparator: number;
  expiry: bigint;
  creator: `0x${string}`;
  yesReserve: bigint;
  noReserve: bigint;
  phase: number;
  yesWon: boolean;
  createdAt: bigint;
}

export interface LiveMarket {
  yesReserve: bigint;
  noReserve: bigint;
  phase: number;
  yesPrice: number;
  noPrice: number;
}

const REFRESH_MS = 15_000;

/**
 * Polls the Markets contract for one market every 15s while the tab is
 * visible. Used by MarketCard so prices animate as the MM bot trades
 * (every 15 minutes today, more often once organic flow lands) without
 * forcing a page refresh.
 */
export function useLiveMarket(marketId: string | undefined): {
  data: LiveMarket | undefined;
  freshAt: number | undefined;
} {
  const client = useMemo(
    () =>
      createPublicClient({
        chain: DEFAULT_CHAIN.viemChain,
        transport: http(DEFAULT_CHAIN.rpcUrls[0]),
      }),
    [],
  );

  const { data, freshAt } = useChainPoll(
    async () => {
      if (!marketId) return undefined;
      const m = (await client.readContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "getMarket",
        args: [marketId as Hex],
      })) as OnchainMarket;
      const total = m.yesReserve + m.noReserve;
      const yesPrice = total === 0n ? 0.5 : Number(m.noReserve) / Number(total);
      return {
        yesReserve: m.yesReserve,
        noReserve: m.noReserve,
        phase: m.phase,
        yesPrice,
        noPrice: 1 - yesPrice,
      } as LiveMarket;
    },
    REFRESH_MS,
    [marketId],
  );

  return { data, freshAt };
}
