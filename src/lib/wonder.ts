/**
 * Wonder markets on the site (spec docs/superpowers/specs/2026-09-25-wonder-markets-design.md):
 * markets about a NOMINATED project that has not claimed a builder yet. Their builder fee
 * leg waits in WonderEscrow under keccak256(source) until the team claims; the keeper
 * releases it (7 days the Safe can cancel) or it expires to the season pool.
 *
 * Pure: ABIs, keys, labels, the release view and the Safe files. Chain reads live in
 * wonder-chain.ts. Everything is off (wonderContracts(d) === null) on a deployment
 * without a WonderEscrow — mainnet phase 1, testnet v5.
 */
import { keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { BUILDERS_NETWORK } from "./builders-network";
import { perennialDeploymentFor, type PerennialDeployment } from "./perennial-network";
import { sourceLabel } from "./verified-builders";
import { usd } from "./usd";

export const SUBJECT = { None: 0, Builder: 1, Wonder: 2 } as const;

export const wonderMarketsAbi = parseAbi([
  "function createWonderMarket(string source, bytes32 feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry, uint256 liquidity) returns (bytes32)",
  "function nominate(string source, bool on)",
  "function nominated(bytes32 key) view returns (bool)",
  "function subjectOf(bytes32 marketId) view returns ((uint8 kind, uint256 builderId, bytes32 sourceKey) s, bool bound)",
  "function feedSubjectOf(bytes32 feedId) view returns ((uint8 kind, uint256 builderId, bytes32 sourceKey))",
  "event WonderMarketCreated(bytes32 indexed marketId, bytes32 indexed sourceKey, address indexed creator, string source, bytes32 feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry)",
  "error NotNominated()",
  "error NotCanonical()",
  "error BadgeNotLive()",
  "error BadSubject()",
  "error BuilderInactive()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);

export const wonderEscrowAbi = parseAbi([
  "function escrowOf(bytes32 key) view returns (uint256)",
  "function releasedTo(bytes32 key) view returns (uint256)",
  "function pendingRelease(bytes32 key) view returns (uint256 builderId, uint256 projectId, uint64 readyAt)",
  "function firstCreditAt(bytes32 key) view returns (uint64)",
  "function EXPIRY() view returns (uint256)",
  "function cancelRelease(bytes32 key)",
  "error NoPendingRelease()",
  "error NotAuthorized()",
  "error NotCanonical()",
  "error ProjectMismatch()",
  "error BuilderNotLive()",
  "error AlreadyReleased()",
  "error ReleasePending()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);

/** SourceKey.keyOf: keccak256 of the canonical source string. */
export function sourceKey(source: string): Hex {
  return keccak256(toBytes(source));
}

export interface WonderContracts {
  markets: Address;
  escrow: Address;
}

/** The wonder contracts of a deployment, or null (no wonder markets there). */
export function wonderContracts(d: Pick<PerennialDeployment, "contracts">): WonderContracts | null {
  const { MarketsPerennial, WonderEscrow } = d.contracts;
  return MarketsPerennial && WonderEscrow ? { markets: MarketsPerennial, escrow: WonderEscrow } : null;
}

/** Wonder markets on the builders network (the gallery, /verify, /admin, /guide). */
export const WONDER_ON_BUILDERS: WonderContracts | null = wonderContracts(perennialDeploymentFor(BUILDERS_NETWORK));

export interface MarketSubject {
  kind: number;
  builderId: bigint;
  sourceKey: Hex;
  /** The market's feed was bound to this subject when it opened: its builder leg reaches it.
   *  undefined = unknown (its subjectOf read failed). */
  bound: boolean | undefined;
  /** A wonder market's canonical source (from its WonderMarketCreated event). */
  source?: string;
}

export const LABEL_UNCLAIMED = "Unclaimed: this team hasn't joined Registrai and hasn't endorsed this market.";
export const LABEL_COMMUNITY = "Community market: not created or endorsed by the project.";

/** The labels a market card shows (spec "Site": community-market labels). */
export function marketLabels(s?: MarketSubject): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.kind === SUBJECT.Wonder) out.push(LABEL_UNCLAIMED);
  if ((s.kind === SUBJECT.Wonder || s.kind === SUBJECT.Builder) && s.bound === false) out.push(LABEL_COMMUNITY);
  return out;
}

export { usd } from "./usd";

/** The labels as short chips for a market row (the full sentence as its title). */
export function marketLabelsShort(s?: MarketSubject): { short: string; full: string }[] {
  return marketLabels(s).map((full) => ({ short: full === LABEL_UNCLAIMED ? "Unclaimed" : "Community", full }));
}

/** Where a project's wonder markets are listed (the markets site's Wonder view). */
export const MARKETS_ORIGIN = "https://registrai.cc";
export const wonderAnchor = (source: string) => `wonder-${source.replace(/[^a-z0-9]+/g, "-")}`;
export const wonderMarketsHref = (source: string) => `${MARKETS_ORIGIN}/perennial/wonder/#${wonderAnchor(source)}`;

/** How long unclaimed escrow waits: the contract's EXPIRY when read, else the default. */
export function expiryDaysText(expirySec: number | null): string {
  return expirySec ? `${Math.round(expirySec / 86_400)} days` : "about 180 days";
}

/** "$X waiting for the team", only for a positive amount. */
export function waitingLine(amount: bigint | null | undefined): string | null {
  return typeof amount === "bigint" && amount > 0n ? `${usd(amount)} waiting for the team` : null;
}

export interface WonderStatus {
  source: string;
  key: Hex;
  nominated: boolean;
  escrow: bigint;
  /** Builder the escrow was released to (0 = not released). */
  releasedTo: number;
  pending: { builderId: number; projectId: number; readyAt: number } | null;
  /** Unix seconds of the first unreleased credit (0 = none). */
  firstCreditAt: number;
}

const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** What a source's escrow is doing now, and one line saying so. */
export function releaseView(
  s: WonderStatus,
  nowSec: number,
  expirySec: number,
): { state: "released" | "pending" | "ready" | "expired" | "waiting" | "empty"; line: string | null } {
  if (s.releasedTo > 0) return { state: "released", line: `Released to builder #${s.releasedTo}` };
  if (s.pending) {
    const { builderId, readyAt } = s.pending;
    if (nowSec < readyAt) {
      return { state: "pending", line: `${usd(s.escrow)} releases to builder #${builderId} on ${day(readyAt)} (the Safe can cancel until then)` };
    }
    return { state: "ready", line: `${usd(s.escrow)} ready for builder #${builderId}: anyone can execute the release` };
  }
  if (s.escrow <= 0n) return { state: "empty", line: null };
  if (s.firstCreditAt > 0 && nowSec >= s.firstCreditAt + expirySec) {
    return { state: "expired", line: `${usd(s.escrow)} unclaimed since ${day(s.firstCreditAt)}: it goes to the season pool` };
  }
  return { state: "waiting", line: waitingLine(s.escrow) };
}

/** The escrow to advertise as "waiting for the team": only while it is actually waiting
 *  (not expired, not queued to a builder, not released); null otherwise or unknown. */
export function waitingAmount(s: WonderStatus | undefined, nowSec: number, expirySec: number | null): bigint | null {
  if (!s || expirySec === null) return null;
  return releaseView(s, nowSec, expirySec).state === "waiting" ? s.escrow : null;
}

/** Wonder markets grouped by project, busiest first. */
export function groupWonderMarkets<T extends { source: string }>(ms: T[]): { source: string; key: Hex; markets: T[] }[] {
  const by = new Map<string, T[]>();
  for (const m of ms) by.set(m.source, [...(by.get(m.source) ?? []), m]);
  return [...by.entries()]
    .map(([source, markets]) => ({ source, key: sourceKey(source), markets }))
    .sort((a, b) => b.markets.length - a.markets.length || a.source.localeCompare(b.source));
}

/** now + days, rounded UP to a whole hour (the markets' expiry grid). */
export function nextHourExpiry(nowSec: number, days: number): bigint {
  return BigInt(Math.ceil((nowSec + days * 86_400) / 3600) * 3600);
}

/** The operator's milestone feed of a source (live-data.json builderFeeds.feeds). */
export function wonderFeedFor(feeds: Record<string, string> | undefined, source: string): Hex | null {
  const f = feeds?.[`registrai-milestone:${source}`];
  return typeof f === "string" && /^0x[0-9a-fA-F]{64}$/.test(f) ? (f as Hex) : null;
}

/** Why a wonder market cannot be opened on `feed` for `source` (null = it can). */
export function wonderCreateCheck(o: {
  source: string;
  feed: Hex | null;
  feedSubject: { kind: number; sourceKey: Hex } | null;
  nominated: boolean;
  /** The feed has a first attested reading (else threshold = 1 would be a sure YES). */
  hasReading: boolean;
}): string | null {
  if (!o.nominated) return `${sourceLabel(o.source)} is not nominated: wonder markets open only on nominated projects.`;
  if (o.source.startsWith("domain:")) {
    return `${sourceLabel(o.source)} is a domain: its milestones are counted from its deployers, which nobody knows until the team claims it.`;
  }
  if (!o.feed) return `${sourceLabel(o.source)} has no milestone feed yet: the keeper provisions it within about 10 minutes of the nomination.`;
  if (o.feedSubject?.kind === SUBJECT.Builder) return `${sourceLabel(o.source)} has joined Registrai: open a builder market for it instead.`;
  if (!o.feedSubject || o.feedSubject.kind !== SUBJECT.Wonder || o.feedSubject.sourceKey.toLowerCase() !== sourceKey(o.source).toLowerCase()) {
    return "This feed is not bound to the project yet: its fees would go to the season pool, not the team. Try again after the keeper's next check.";
  }
  if (!o.hasReading) return "Waiting for the milestone agent's first reading of this feed: a market needs it to set its threshold.";
  return null;
}
