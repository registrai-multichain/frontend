"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { Address } from "viem";
import { builderRegistryAbi, marketsPerennialAbi, nanoLedgerAbi, usdcAbi } from "@/lib/abi";
import { readHolderSettlement } from "@/lib/market-fees-chain";
import { projectForFeed, readOverview, type BuilderRow, type ChainMarket, type Overview } from "@/lib/perennial-chain";
import { marketStatus, type MarketStatus } from "@/lib/perennial-market";
import { marketQuestion, metricNoun } from "@/lib/plain-words";
import { sourceLabel } from "@/lib/verified-builders";
import { SUBJECT } from "@/lib/wonder";
import { D, perennialClient } from "./usePerennialTx";

export type Position = {
  yes: bigint;
  no: bigint;
  lp: bigint;
  /** v3 views — undefined on the legacy contract. */
  netCost?: bigint;
  redeemable?: bigint;
  claimableLP?: bigint;
};
export type Account = { ledgerBal: bigint; walletBal: bigint; registered: boolean; positions: Record<string, Position> };
export const EMPTY_POS: Position = { yes: 0n, no: 0n, lp: 0n };
export const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const SWR_OPTS = { refreshInterval: 30_000, dedupingInterval: 10_000, revalidateOnFocus: false } as const;

export function usePerennialData(address?: Address) {
  const publicClient = perennialClient();
  const P = D.contracts;
  const mp = P.MarketsPerennial!;

  const [clientNow, setClientNow] = useState(0);
  useEffect(() => {
    const tick = () => setClientNow(Math.floor(Date.now() / 1000));
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => window.clearInterval(t);
  }, []);

  const { data: ov, error: ovError, isValidating: ovValidating } = useSWR<Overview>(["perennial-overview", D.chain.id, mp], () => readOverview(publicClient, D), SWR_OPTS);
  const markets = useMemo(() => ov?.markets ?? [], [ov]);
  const builders = useMemo(() => ov?.builders ?? [], [ov]);
  const marketIdsKey = markets.map((m) => m.id).join(",");

  const { data: acct, error: acctError } = useSWR<Account>(
    ov && address ? ["perennial-account", D.chain.id, address, marketIdsKey] : null,
    async () => {
      const [ledgerBal, walletBal, registered, rows] = await Promise.all([
        publicClient.readContract({ address: P.NanoLedger!, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address!] }) as Promise<bigint>,
        publicClient.readContract({ address: P.USDC!, abi: usdcAbi, functionName: "balanceOf", args: [address!] }) as Promise<bigint>,
        publicClient.readContract({ address: P.BuilderRegistry!, abi: builderRegistryAbi, functionName: "isRegistered", args: [address!] }) as Promise<boolean>,
        Promise.all(markets.map(async (m) => {
          const [[yes, no, lp], v3] = await Promise.all([
            Promise.all([
              publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "yesBalance", args: [m.id, address!] }),
              publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "noBalance", args: [m.id, address!] }),
              publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "lpShares", args: [m.id, address!] }),
            ]) as Promise<bigint[]>,
            // netCost / redeemable / claimableLP exist only on the v3 contract.
            ov!.feeModel.kind === "trade" ? readHolderSettlement(publicClient, mp, m.id, address!, m.phase) : Promise.resolve({}),
          ]);
          return [m.id, { yes, no, lp, ...v3 } satisfies Position] as const;
        })),
      ]);
      return { ledgerBal, walletBal, registered, positions: Object.fromEntries(rows) };
    },
    SWR_OPTS,
  );

  // Chain time: the latest block's timestamp plus time elapsed since it was read. Never the raw client clock.
  const chainNow = ov && clientNow ? ov.chainNow + BigInt(Math.max(0, clientNow - ov.readAt)) : undefined;

  const builderById = (id: bigint | number | undefined): BuilderRow | undefined =>
    builders.find((b) => BigInt(b.builderId) === BigInt(id ?? -1));
  const statusOf = (m: ChainMarket): MarketStatus =>
    marketStatus({
      phase: m.phase, yesWon: m.yesWon, expiry: m.expiry, chainNow,
      settlement: m.settlement, supportsSettlement: Boolean(ov?.supportsSettlement), feeModel: ov?.feeModel,
    });
  const isWonder = (m: ChainMarket) => m.subject?.kind === SUBJECT.Wonder && Boolean(m.subject.source);
  const subjectFor = (m: ChainMarket) =>
    isWonder(m) ? sourceLabel(m.subject!.source!) : builderById(m.builderId)?.name ?? `Builder #${m.builderId}`;
  // A market on one of the builder's project feeds (or its legacy single feed), resolved by the operator.
  const isMilestoneMarket = (m: ChainMarket) => {
    const b = builderById(m.builderId);
    const onFeed = Boolean(projectForFeed(b, m.feedId)) || Boolean(b?.milestoneFeedId && same(b.milestoneFeedId, m.feedId));
    return onFeed && same(m.agent, D.operator);
  };
  /** The project the market's feed belongs to (the unclaimed project for a wonder market), else the builder's lead source. */
  const sourceFor = (m: ChainMarket): string | undefined =>
    isWonder(m)
      ? m.subject!.source!
      : projectForFeed(builderById(m.builderId), m.feedId)?.source ?? builderById(m.builderId)?.source ?? undefined;
  /** A metric noun only for a count we know (the operator's milestone feed); else undefined = "the number tracked". */
  const metricFor = (m: ChainMarket) =>
    isMilestoneMarket(m) || (isWonder(m) && same(m.agent, D.operator)) ? metricNoun(sourceFor(m)) : undefined;
  const questionFor = (m: ChainMarket) =>
    marketQuestion({ subject: subjectFor(m), metric: metricFor(m), threshold: m.threshold, comparator: m.comparator, expiry: m.expiry });
  const positionOf = (m: ChainMarket | undefined): Position => (m && acct?.positions[m.id]) || EMPTY_POS;
  const incomeOf = (id: bigint | number) => ov?.incomeThisEpoch[Number(id)] ?? 0n;

  return {
    publicClient, ov, ovError, ovValidating, markets, builders, acct, acctError, chainNow,
    statusOf, builderById, isWonder, subjectFor, isMilestoneMarket, sourceFor, metricFor, questionFor, positionOf, incomeOf,
  };
}
export type PerennialData = ReturnType<typeof usePerennialData>;
