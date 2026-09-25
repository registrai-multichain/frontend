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
import { encodeFunctionData, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { BUILDERS_NETWORK } from "./builders-network";
import { perennialDeploymentFor, type PerennialDeployment } from "./perennial-network";
import { safeBatchJson, singleTxSafeFile, type PlannedTx } from "./onboard-batch";
import { normalizeSource, sourceLabel } from "./verified-builders";
import { usd } from "./usd";

export const SUBJECT = { None: 0, Builder: 1, Wonder: 2 } as const;

export const wonderMarketsAbi = parseAbi([
  "function createWonderMarket(string source, bytes32 feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry, uint256 liquidity) returns (bytes32)",
  "function nominate(string source, bool on)",
  "function nominated(bytes32 key) view returns (bool)",
  "function subjectOf(bytes32 marketId) view returns ((uint8 kind, uint256 builderId, bytes32 sourceKey) s, bool bound)",
  "function feedSubjectOf(bytes32 feedId) view returns ((uint8 kind, uint256 builderId, bytes32 sourceKey))",
  "event WonderMarketCreated(bytes32 indexed marketId, bytes32 indexed sourceKey, address indexed creator, string source, bytes32 feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry)",
]);

export const wonderEscrowAbi = parseAbi([
  "function escrowOf(bytes32 key) view returns (uint256)",
  "function releasedTo(bytes32 key) view returns (uint256)",
  "function pendingRelease(bytes32 key) view returns (uint256 builderId, uint256 projectId, uint64 readyAt)",
  "function firstCreditAt(bytes32 key) view returns (uint64)",
  "function EXPIRY() view returns (uint256)",
  "function cancelRelease(bytes32 key)",
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
  /** The market's feed was bound to this subject when it opened: its builder leg reaches it. */
  bound: boolean;
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
  if ((s.kind === SUBJECT.Wonder || s.kind === SUBJECT.Builder) && !s.bound) out.push(LABEL_COMMUNITY);
  return out;
}

export { usd } from "./usd";

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

/** /admin's nominate box: the canonical source, only for an invited one (spec decision 2). */
export function nominateInput(
  raw: string,
  invited: ReadonlySet<string>,
): { ok: true; source: string } | { ok: false; error: string } {
  const source = normalizeSource(raw);
  if (!source) return { ok: false, error: "Not a GitHub repo or domain." };
  if (!invited.has(source)) return { ok: false, error: `Invite ${sourceLabel(source)} first: only invited projects are nominated.` };
  return { ok: true, source };
}

export function nominateTx(markets: Address, source: string, on: boolean): PlannedTx {
  return {
    kind: "nominate",
    to: markets,
    value: "0",
    data: encodeFunctionData({ abi: wonderMarketsAbi, functionName: "nominate", args: [source, on] }),
    label: `nominate(${source}, ${on})  # ${on ? "opens" : "closes"} wonder markets on ${sourceLabel(source)}`,
  };
}

export function cancelReleaseTx(escrow: Address, key: Hex, source: string): PlannedTx {
  return {
    kind: "cancelRelease",
    to: escrow,
    value: "0",
    data: encodeFunctionData({ abi: wonderEscrowAbi, functionName: "cancelRelease", args: [key] }),
    label: `cancelRelease(${key})  # stops the queued release of ${source}'s escrow`,
  };
}

export function nominateSafeFile(o: { markets: Address; source: string; on: boolean; chainId: number; createdAt: number }) {
  return singleTxSafeFile(nominateTx(o.markets, o.source, o.on), {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: ${o.on ? "nominate" : "un-nominate"} ${o.source}`,
  });
}

export function cancelReleaseSafeFile(o: { escrow: Address; source: string; chainId: number; createdAt: number }) {
  return safeBatchJson([cancelReleaseTx(o.escrow, sourceKey(o.source), o.source)], {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: cancel the wonder release of ${o.source}`,
  });
}
