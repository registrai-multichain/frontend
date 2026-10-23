/** Pure view logic for the paper markets pages (spec §3): tabs, ticket state, card figures, URL params. */
import { avatarUrl } from "./builders-gallery";
import { OUTCOME, priceOf, type MarketStatusKey, type Reserves } from "./perennial-market";

export type MarketTab = "trending" | "closing" | "new" | "unclaimed" | "ended";

export const MARKET_TABS: readonly { key: MarketTab; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "closing", label: "Closing soon" },
  { key: "new", label: "New" },
  { key: "unclaimed", label: "Unclaimed projects" },
  { key: "ended", label: "Ended" },
];

export function parseTab(raw: string | null | undefined): MarketTab {
  const k = raw?.trim().toLowerCase();
  return MARKET_TABS.find((t) => t.key === k)?.key ?? "trending";
}

export function parseMarketParam(raw: string | null | undefined): `0x${string}` | undefined {
  return raw && /^0x[0-9a-fA-F]{64}$/.test(raw) ? (raw.toLowerCase() as `0x${string}`) : undefined;
}

export const parseSide = (raw: string | null | undefined): "Yes" | "No" => (raw?.trim().toLowerCase() === "no" ? "No" : "Yes");

export const isEnded = (key: MarketStatusKey) => key === "resolved-yes" || key === "resolved-no" || key === "voided";

export const yesPct = (m: Reserves) => Math.round(Number(priceOf(m, OUTCOME.Yes)) / 1e16);

export interface TabItem { createdAt: bigint; expiry: bigint; yesPct: number; canTrade: boolean; wonder: boolean; ended: boolean }

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
const openFirst = (a: TabItem, b: TabItem) => Number(!a.canTrade) - Number(!b.canTrade);

export function marketsForTab<T extends TabItem>(items: T[], tab: MarketTab): T[] {
  const live = items.filter((x) => !x.ended);
  switch (tab) {
    case "closing": return [...live].sort((a, b) => openFirst(a, b) || cmp(a.expiry, b.expiry));
    case "new": return [...live].sort((a, b) => cmp(b.createdAt, a.createdAt));
    case "unclaimed": return live.filter((x) => x.wonder).sort((a, b) => cmp(b.createdAt, a.createdAt));
    case "ended": return items.filter((x) => x.ended).sort((a, b) => cmp(b.expiry, a.expiry));
    default: return [...live].sort((a, b) => openFirst(a, b) || Math.abs(50 - a.yesPct) - Math.abs(50 - b.yesPct));
  }
}

/** "$X in the pot": the v3 collateral, else the seeded liquidity (legacy). */
export const potOf = (m: { collateral?: bigint; seeded: bigint }) => m.collateral ?? m.seeded;

export function holdingLabel(p: { yes: bigint; no: bigint }): string | null {
  if (p.yes > 0n && p.no > 0n) return "You hold Yes and No";
  if (p.yes > 0n) return "You hold Yes";
  if (p.no > 0n) return "You hold No";
  return null;
}

export type TicketState = "paused" | "connect" | "switch" | "fund" | "trade" | "settle" | "collect" | "closed";

export interface TicketInput {
  writesEnabled: boolean;
  address?: string;
  onChain: boolean;
  canTrade: boolean;
  /** The trading balance; undefined while it loads (never read as zero). */
  ledgerBal: bigint | undefined;
  canResolve: boolean;
  canVoid: boolean;
  canRedeem: boolean;
  redeemable: bigint;
  canClaimLP: boolean;
  lp: bigint;
  /** Shares held: a holder with $0 to trade still gets the form, so they can sell. */
  yes: bigint;
  no: bigint;
}

export function ticketState(i: TicketInput): TicketState {
  if (!i.writesEnabled) return "paused";
  if (i.canTrade) {
    if (!i.address) return "connect";
    if (!i.onChain) return "switch";
    return i.ledgerBal === 0n && i.yes === 0n && i.no === 0n ? "fund" : "trade";
  }
  if (i.canResolve || i.canVoid) return "settle";
  // Settled: a disconnected viewer can't know what they won, so ask them to connect.
  if (!i.address) return i.canRedeem || i.canClaimLP ? "connect" : "closed";
  if ((i.canRedeem && i.redeemable > 0n) || (i.canClaimLP && i.lp > 0n)) return i.onChain ? "collect" : "switch";
  return "closed";
}

/** parseUsdcInput options for the ticket's amount: no cap while the balance is still unread. */
export function tradeAmountOpts(mode: "buy" | "sell", ledgerBal: bigint | undefined, held: bigint): { max?: bigint; label: string } {
  if (mode === "sell") return { max: held, label: "share amount" };
  return ledgerBal === undefined ? { label: "amount" } : { max: ledgerBal, label: "amount" };
}

export function topBuilder<T extends { builderId: number }>(builders: T[], incomeOf: (id: number) => bigint): T | null {
  let best: T | null = null;
  let bestIncome = 0n;
  for (const b of builders) {
    const inc = incomeOf(b.builderId);
    if (inc > bestIncome) { best = b; bestIncome = inc; }
  }
  return best;
}

/** /rounds categories: the 5-minute price rounds, or the longer event markets (`#events`). */
export type RoundsTab = "price" | "events";
export const ROUNDS_TABS: readonly { key: RoundsTab; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "events", label: "Events" },
];
export const parseRoundsTab = (hash: string | null | undefined): RoundsTab =>
  hash?.replace(/^#/, "").trim().toLowerCase() === "events" ? "events" : "price";

/** A builder row's avatar: its first verified GitHub project's owner, else null (the initial). No website icons. */
export function rowAvatar(projects: readonly { source: string; status: string }[]): string | null {
  const pick = projects.find((p) => p.status === "verified" && p.source.startsWith("github:"));
  return pick ? avatarUrl(pick.source) : null;
}
