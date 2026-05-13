import type { Comparator, Market, MarketTrade } from "./types";
import live from "./live-data.json";
import { DEMO_FEED } from "./demo";

interface RawMarket {
  id: string;
  feedId: string;
  agent: string;
  threshold: number;
  comparator: number;
  expiry: number;
  creator: string;
  yesReserve: string;
  noReserve: string;
  phase: number;
  yesWon: boolean;
  createdAt: number;
  history?: MarketTrade[];
  fees?: {
    creator: string;
    agent: string;
    treasury: string;
    grossVolume: string;
  };
}

function decodeComparator(c: number): Comparator {
  if (c === 0) return ">";
  if (c === 1) return ">=";
  if (c === 2) return "<";
  return "<=";
}

function comparatorLabel(c: Comparator): string {
  if (c === ">") return "exceed";
  if (c === ">=") return "be at or above";
  if (c === "<") return "be below";
  return "be at or below";
}

function fmtThreshold(n: number, unit: string): string {
  return `${n.toLocaleString("en-US").replace(/,/g, " ")} ${unit}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildTitle(threshold: number, comparator: Comparator, expiry: number, unit: string): string {
  return `Will Warsaw residential price ${comparatorLabel(comparator)} ${fmtThreshold(threshold, unit)} by ${fmtDate(expiry)}?`;
}

/**
 * Markets read straight from Arc testnet. No trade history yet — markets are
 * day-zero. The history list stays empty until users trade; the chart
 * component handles the empty state cleanly.
 */
export const DEMO_MARKETS: Market[] = (live.markets as unknown as RawMarket[]).map((m) => {
  const comparator = decodeComparator(m.comparator);
  const yesReserve = Number(m.yesReserve);
  const noReserve = Number(m.noReserve);
  const liquidity = (yesReserve + noReserve) / 2;
  return {
    id: m.id as `0x${string}`,
    feedId: m.feedId as `0x${string}`,
    feedSymbol: DEMO_FEED.symbol,
    agent: m.agent as `0x${string}`,
    threshold: m.threshold,
    comparator,
    expiry: m.expiry,
    creator: m.creator as `0x${string}`,
    yesReserve,
    noReserve,
    liquidity,
    phase: m.phase === 0 ? "trading" : "resolved",
    history: (m.history ?? []).map((t) => ({
      ts: t.ts,
      yesPrice: t.yesPrice,
      side: t.side,
      collateral: t.collateral,
    })),
    title: buildTitle(m.threshold, comparator, m.expiry, DEMO_FEED.unit),
    unit: DEMO_FEED.unit,
    yesWon: m.yesWon,
    fees: m.fees
      ? {
          creator: Number(m.fees.creator),
          agent: Number(m.fees.agent),
          treasury: Number(m.fees.treasury),
          grossVolume: Number(m.fees.grossVolume),
        }
      : undefined,
  };
});

export function findMarket(id: string): Market | undefined {
  return DEMO_MARKETS.find((m) => m.id === id);
}
