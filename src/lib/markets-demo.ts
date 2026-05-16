import type { Comparator, Market, MarketTrade } from "./types";
import live from "./live-data.json";

/** Shape of one feed in live-data.json (multi-feed surface). */
interface RawFeed {
  id: string;
  symbol: string;
  name: string;
  description: string;
  unit: string;
  decimals: number;
  displayDivisor: number;
}

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
  verifiable?: boolean;
  marketsVersion?: string;
  history?: MarketTrade[];
  fees?: {
    creator: string;
    agent: string;
    treasury: string;
    grossVolume: string;
  };
}

interface RawFeedWithRule extends RawFeed {
  rule?: string;
}

const RULE_BY_FEED = new Map<string, string>(
  ((live as unknown as { feeds?: RawFeedWithRule[] }).feeds ?? [])
    .filter((f) => f.rule)
    .map((f) => [f.id, f.rule!]),
);

const FEEDS_BY_ID = new Map<string, RawFeed>(
  ((live as unknown as { feeds?: RawFeed[] }).feeds ?? []).map((f) => [f.id, f]),
);

function comparatorLabel(c: Comparator): string {
  if (c === ">") return "exceed";
  if (c === ">=") return "be at or above";
  if (c === "<") return "be below";
  return "be at or below";
}

function decodeComparator(c: number): Comparator {
  if (c === 0) return ">";
  if (c === 1) return ">=";
  if (c === 2) return "<";
  return "<=";
}

function fmtThreshold(n: number, feed: RawFeed): string {
  if (feed.displayDivisor > 1) {
    const human = n / feed.displayDivisor;
    return `${human.toFixed(feed.decimals)}%`;
  }
  return `${n.toLocaleString("en-US").replace(/,/g, " ")} ${feed.unit}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function feedNounPhrase(feed: RawFeed): string {
  // Convert "Warsaw residential" → "Warsaw residential price"
  // "Polish CPI Y/Y" → "Polish CPI YoY"
  // "ECB main refi rate" → "ECB main refi rate"
  switch (feed.symbol) {
    case "WARSAW_RESI_PLN_SQM":
      return "Warsaw residential price";
    case "POLAND_CPI_YOY_BPS":
      return "Polish CPI";
    case "ECB_MAIN_REFI_BPS":
      return "ECB main refi rate";
    default:
      return feed.name;
  }
}

function buildTitle(
  threshold: number,
  comparator: Comparator,
  expiry: number,
  feed: RawFeed,
): string {
  return `Will ${feedNounPhrase(feed)} ${comparatorLabel(comparator)} ${fmtThreshold(threshold, feed)} by ${fmtDate(expiry)}?`;
}

export const DEMO_MARKETS: Market[] = (live.markets as unknown as RawMarket[]).map((m) => {
  const comparator = decodeComparator(m.comparator);
  const feed =
    FEEDS_BY_ID.get(m.feedId) ??
    // Fallback for markets whose feed metadata isn't in live-data (shouldn't happen)
    ({
      id: m.feedId,
      symbol: "UNKNOWN",
      name: "Unknown feed",
      description: "",
      unit: "",
      decimals: 0,
      displayDivisor: 1,
    } satisfies RawFeed);

  const yesReserve = Number(m.yesReserve);
  const noReserve = Number(m.noReserve);
  const liquidity = (yesReserve + noReserve) / 2;

  return {
    id: m.id as `0x${string}`,
    feedId: m.feedId as `0x${string}`,
    feedSymbol: feed.symbol,
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
    title: buildTitle(m.threshold, comparator, m.expiry, feed),
    unit: feed.displayDivisor > 1 ? "%" : feed.unit,
    yesWon: m.yesWon,
    fees: m.fees
      ? {
          creator: Number(m.fees.creator),
          agent: Number(m.fees.agent),
          treasury: Number(m.fees.treasury),
          grossVolume: Number(m.fees.grossVolume),
        }
      : undefined,
    verifiable: m.verifiable === true,
    rule: RULE_BY_FEED.get(m.feedId) as `0x${string}` | undefined,
    marketsVersion: m.marketsVersion,
  };
});

export function findMarket(id: string): Market | undefined {
  return DEMO_MARKETS.find((m) => m.id === id);
}

/** Find a feed by its onchain id. Used by feed-detail and related pages. */
export function findFeed(id: string): RawFeed | undefined {
  return FEEDS_BY_ID.get(id);
}

/** Every registered feed — for /feeds index, profile breadcrumbs, etc. */
export const ALL_FEEDS: RawFeed[] = Array.from(FEEDS_BY_ID.values());
