/**
 * Perennial chain reads: market discovery, capability probes and the market /
 * builder views the panel renders. Everything here goes through the selected
 * network's official RPC. Pure logic lives in perennial-market.ts.
 */
import {
  decodeEventLog,
  parseAbi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { marketsPerennialAbi } from "./abi";
import live from "./live-data.json";
import { PERENNIAL_BUILDERS } from "./perennial";
import { blockChunks } from "./perennial-market";
import { SNAPSHOT_MATCHES_NETWORK, type PerennialDeployment } from "./perennial-network";
import { wonderContracts, wonderMarketsAbi, type MarketSubject } from "./wonder";
import { readMarketSubjects } from "./wonder-chain";
import { isRevert, readFeeModel, readMarketSettlement } from "./market-fees-chain";
import { snapshotBadgeFor, snapshotBuilders, snapshotRowFor, verificationFor, type Verification } from "./builder-verification";
import type { BadgeInfo } from "./verified-builder-badge";
import { sourceFromProfileURI, sourceLabel } from "./verified-builders";
import type { FeeModel } from "./market-fees";
import { readEconomy, readIncomes, readMarketsFund, type EconomyOverview } from "./economy-chain";

export { isRevert };

/** Views that are not in every deployed ABI yet — probed, never assumed. */
export const probeAbi = parseAbi([
  "function isApprovedFeed(bytes32 feedId, address agent) view returns (bool)",
  "function SETTLEMENT_WINDOW() view returns (uint256)",
]);
export const builderViewsAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function builders(uint256) view returns (address owner, string profileURI, bytes linkedIdentity, uint64 createdAt, bool active)",
]);
export const attestationViewsAbi = parseAbi([
  "function latestValue(bytes32 feedId, address agent) view returns (int256 value, uint256 timestamp, bool finalized)",
]);

const MARKET_CREATED = marketsPerennialAbi.find(
  (e) => e.type === "event" && e.name === "MarketCreated",
)!;
/** Wonder markets (a deployment with a WonderEscrow): created by createWonderMarket. */
const WONDER_CREATED = wonderMarketsAbi.find((e) => e.type === "event" && e.name === "WonderMarketCreated")!;

// ───────────────────────────── discovery ─────────────────────────────

/** `wonder`: market id (lowercase) -> source, for the wonder markets found. */
type DiscoveryCache = { ids: string[]; scannedTo: string; wonder?: Record<string, string> };

const cacheKey = (d: PerennialDeployment) =>
  `perennial:markets:v1:${d.chain.id}:${(d.contracts.MarketsPerennial ?? "").toLowerCase()}`;

function readCache(d: PerennialDeployment): DiscoveryCache | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey(d));
    if (!raw) return undefined;
    const c = JSON.parse(raw) as DiscoveryCache;
    return Array.isArray(c.ids) && typeof c.scannedTo === "string" ? c : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(d: PerennialDeployment, c: DiscoveryCache) {
  try {
    window.localStorage.setItem(cacheKey(d), JSON.stringify(c));
  } catch {
    // storage unavailable (private mode) — discovery simply rescans next time
  }
}

/** Remember a market this browser just created, so it survives reload even
 *  before the log scan reaches its block. */
export function rememberMarket(d: PerennialDeployment, id: Hex) {
  const c = readCache(d) ?? { ids: [], scannedTo: "0" };
  if (!c.ids.includes(id.toLowerCase())) c.ids.push(id.toLowerCase());
  writeCache(d, c);
}

/** Market ids the build-time snapshot already knows, and the block it covers. */
function snapshotSeed(d: PerennialDeployment): { ids: string[]; scannedTo: bigint } {
  const mp = (d.contracts.MarketsPerennial ?? "").toLowerCase();
  const atlas = (live as { atlas?: { markets?: string; lastScannedBlock?: string; marketToBuilder?: Record<string, number> } }).atlas;
  if (!SNAPSHOT_MATCHES_NETWORK || !atlas || (atlas.markets ?? "").toLowerCase() !== mp) {
    return { ids: [], scannedTo: 0n };
  }
  const ids = new Set<string>();
  for (const m of (live as { perennialMarkets?: { marketId: string }[] }).perennialMarkets ?? []) ids.add(m.marketId.toLowerCase());
  for (const id of Object.keys(atlas.marketToBuilder ?? {})) ids.add(id.toLowerCase());
  return { ids: [...ids], scannedTo: BigInt(atlas.lastScannedBlock ?? "0") };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface Discovery {
  ids: Hex[];
  /** Last block covered by the MarketCreated scan. */
  scannedTo: bigint;
  /** True when older blocks are still unscanned (resumes on the next refresh). */
  partial: boolean;
  /** Wonder market id (lowercase) -> its project source (WonderMarketCreated). */
  wonderSources: Record<string, string>;
}

/**
 * Every MarketCreated on the deployment: snapshot ids, plus this browser's cache,
 * plus a chunked (<=5000 blocks, Arc's cap) log scan from the furthest known
 * block to head. The scan is budgeted per call and its cursor persisted, so a
 * long gap is filled across refreshes instead of stalling the first paint.
 */
export async function discoverMarkets(
  client: PublicClient,
  d: PerennialDeployment,
  head: bigint,
  budgetChunks = 60,
): Promise<Discovery> {
  const mp = d.contracts.MarketsPerennial!;
  const seed = snapshotSeed(d);
  const cache = typeof window !== "undefined" ? readCache(d) : undefined;
  const ids = new Set<string>([...seed.ids, ...(cache?.ids ?? [])]);
  const wonderOn = wonderContracts(d) !== null;
  const wonderSources: Record<string, string> = { ...(cache?.wonder ?? {}) };
  let from = seed.scannedTo;
  const cached = cache ? BigInt(cache.scannedTo) : 0n;
  if (cached > from) from = cached;
  if (from === 0n && d.deployBlock) from = d.deployBlock - 1n;
  const chunks = blockChunks(from + 1n, head).slice(0, budgetChunks);
  // Two at a time, stop at the first failure (rate limit, range cap): the
  // cursor only ever advances over a contiguous run of scanned chunks.
  let scannedTo = from;
  let failed = false;
  for (let i = 0; i < chunks.length && !failed; i += 2) {
    const pair = chunks.slice(i, i + 2);
    const res = await Promise.allSettled(
      pair.map(([a, b]) =>
        wonderOn
          ? client.getLogs({ address: mp, events: [MARKET_CREATED, WONDER_CREATED] as never, fromBlock: a, toBlock: b })
          : client.getLogs({ address: mp, event: MARKET_CREATED as never, fromBlock: a, toBlock: b }),
      ),
    );
    for (let j = 0; j < res.length; j++) {
      const r = res[j];
      if (r.status !== "fulfilled") { failed = true; break; }
      for (const lg of r.value as Log[]) {
        const id = lg.topics[1];
        if (id) ids.add(id.toLowerCase());
        const ev = lg as unknown as { eventName?: string; args?: { source?: string } };
        if (id && ev.eventName === "WonderMarketCreated" && typeof ev.args?.source === "string") {
          wonderSources[id.toLowerCase()] = ev.args.source;
        }
      }
      scannedTo = pair[j][1];
    }
  }
  const out = { ids: [...ids] as Hex[], scannedTo, partial: scannedTo < head, wonderSources };
  if (typeof window !== "undefined") writeCache(d, { ids: out.ids, scannedTo: scannedTo.toString(), wonder: wonderSources });
  return out;
}

/** The MarketCreated id from a createMarket receipt. */
export function marketIdFromLogs(logs: Log[], markets: Address): Hex | undefined {
  for (const lg of logs) {
    if (lg.address.toLowerCase() !== markets.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: marketsPerennialAbi, data: lg.data, topics: lg.topics });
      if (ev.eventName === "MarketCreated") return (ev.args as { marketId: Hex }).marketId;
    } catch {
      // not a MarketCreated log
    }
  }
  return undefined;
}

// ───────────────────────────── reads ─────────────────────────────

export interface ChainMarket {
  id: Hex;
  feedId: Hex;
  agent: Address;
  threshold: bigint;
  comparator: number;
  expiry: bigint;
  creator: Address;
  builderId: bigint;
  yesReserve: bigint;
  noReserve: bigint;
  phase: number;
  yesWon: boolean;
  createdAt: bigint;
  /** Liquidity the creator seeded (totalLpShares) — the market's depth. */
  seeded: bigint;
  lpPot: bigint;
  /** settlementState(id).state — undefined on the legacy contract. */
  settlement?: number;
  /** isApprovedFeed(feed, agent) — undefined when the view does not exist. */
  approved?: boolean;
  /** v3 only (undefined on legacy): the pot and the agent's held 20% while
   *  unsettled; the void snapshot once voided. */
  collateral?: bigint;
  agentEscrow?: bigint;
  voidTraderPool?: bigint;
  voidNetCostTotal?: bigint;
  /** subjectOf (a deployment with wonder markets): builder or wonder, and whether its feed pays it. */
  subject?: MarketSubject;
}

export interface BuilderRow {
  builderId: number;
  owner: Address;
  active: boolean;
  name: string;
  repo: string;
  profileURI: string;
  /** The builder's own milestone feed (count of verified artifacts), if any. */
  milestoneFeedId?: Hex;
  /** The builder's lead project source from the synced snapshot (its first
   *  verified project), else a legacy `registrai:` profile link, else null. */
  source: string | null;
  /** Every project with its own milestone feed (synced snapshot; spec
   *  2026-09-24-builder-projects-design.md "Phase 2": a market names the
   *  builder and one project's feed). Empty for legacy single-source builders. */
  projects: BuilderProject[];
  /** Verified mark (synced snapshot, same builder id and owner). */
  verification: Verification | null;
  /** Verified Builder Badge as of the last sync; the UI refreshes it live. */
  badge: BadgeInfo | null;
}

export interface BuilderProject {
  id: number;
  source: string;
  status: string;
  milestoneFeedId: Hex | null;
}

/**
 * Whether the builder-economy reads run:
 *  - "not-deployed": no BuilderFund / SeasonPool configured for this network;
 *  - "unlinked": configured, but the deployed MarketsPerennial predates the fund
 *    (no FUND()) or pays another fund — its numbers would not be these markets';
 *  - "live": the markets pay this fund.
 */
export type FundStatus = "not-deployed" | "unlinked" | "live";

export interface Overview {
  chainNow: bigint;
  /** Client clock (seconds) when chainNow was read — for ticking countdowns. */
  readAt: number;
  supportsSettlement: boolean;
  settlementWindow?: bigint;
  approvalView: boolean;
  /** Probed: v3 1% trading fee, else the legacy per-trade fee, else unknown. */
  feeModel: FeeModel;
  minLiquidity: bigint;
  attestation: Address;
  markets: ChainMarket[];
  hiddenUnapproved: number;
  discovery: Discovery;
  builders: BuilderRow[];
  fundStatus: FundStatus;
  /** BuilderFund + SeasonPool views; null unless fundStatus is "live". */
  economy: EconomyOverview | null;
  /** builderId -> income credited this epoch (empty unless the fund is live). */
  incomeThisEpoch: Record<number, bigint>;
}

type RawMarket = Pick<
  ChainMarket,
  "feedId" | "agent" | "threshold" | "comparator" | "expiry" | "creator" | "builderId" | "yesReserve" | "noReserve" | "phase" | "yesWon" | "createdAt"
>;

function repoFromURI(uri: string): string {
  const source = sourceFromProfileURI(uri);
  if (source) return sourceLabel(source);
  return uri.replace(/^ipfs:\/\//, "").replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/\/$/, "");
}

/** Snapshot-provided milestone feeds (keeper builders.json via sync), if any. */
function snapshotMilestoneFeeds(): Record<string, Hex> {
  if (!SNAPSHOT_MATCHES_NETWORK) return {};
  const rows = (live as { perennialBuilders?: { builderId?: number; milestoneFeedId?: string | null }[] }).perennialBuilders ?? [];
  const out: Record<string, Hex> = {};
  for (const r of rows) if (r.builderId && r.milestoneFeedId) out[String(r.builderId)] = r.milestoneFeedId as Hex;
  return out;
}

export async function readOverview(client: PublicClient, d: PerennialDeployment): Promise<Overview> {
  const mp = d.contracts.MarketsPerennial!;
  const reg = d.contracts.BuilderRegistry!;
  const read = <T,>(p: Promise<unknown>) => p as Promise<T>;

  const [block, feeModel, minLiquidity, attestation, nextId, fundStatus] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    readFeeModel(client, mp, "perennial"),
    read<bigint>(client.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "MIN_LIQUIDITY" })),
    read<Address>(client.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "ATTESTATION" })),
    read<bigint>(client.readContract({ address: reg, abi: builderViewsAbi, functionName: "nextId" })),
    readFundStatus(client, d),
  ]);
  const economy = fundStatus === "live" ? await readEconomy(client, d.contracts.BuilderFund!, d.contracts.SeasonPool!) : null;
  const readAt = Math.floor(Date.now() / 1000);

  const discovery = await discoverMarkets(client, d, block.number);

  const raws = await pool(discovery.ids, 6, async (id) => {
    const [m, seeded, lpPot] = await Promise.all([
      read<RawMarket>(client.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "getMarket", args: [id] })),
      read<bigint>(client.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "totalLpShares", args: [id] })),
      read<bigint>(client.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "lpPotAtResolution", args: [id] })),
    ]);
    return { ...m, id, comparator: Number(m.comparator), phase: Number(m.phase), seeded, lpPot } as ChainMarket;
  });
  let markets = raws.filter((m) => m.createdAt > 0n);
  const subjects = await subjectsFor(client, d, markets.map((m) => m.id), discovery.wonderSources);
  for (const m of markets) m.subject = subjects[m.id.toLowerCase()];

  // v3 accounting: the pot and agent escrow while unsettled, the void snapshot
  // once voided (for the local payout mirror). Skipped on legacy.
  if (feeModel.kind === "trade") {
    await pool(markets, 6, async (m) => {
      Object.assign(m, await readMarketSettlement(client, mp, m.id, m.phase));
    });
  }

  // Capability probe 1: SettlementPolicy. settlementState reverts on the legacy
  // contract (Arc testnet today) — then settle/void are hidden, not guessed.
  let supportsSettlement = false;
  let settlementWindow: bigint | undefined;
  try {
    settlementWindow = (await client.readContract({ address: mp, abi: probeAbi, functionName: "SETTLEMENT_WINDOW" })) as bigint;
    supportsSettlement = true;
  } catch (e) {
    if (!isRevert(e)) throw e;
  }
  if (supportsSettlement && markets.length) {
    try {
      await client.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "settlementState", args: [markets[0].id] });
    } catch (e) {
      if (!isRevert(e)) throw e;
      supportsSettlement = false;
    }
  }
  if (supportsSettlement) {
    await pool(markets, 6, async (m) => {
      if (m.phase !== 0) return;
      const [state] = (await client.readContract({
        address: mp, abi: marketsPerennialAbi, functionName: "settlementState", args: [m.id],
      })) as readonly [number, bigint];
      m.settlement = Number(state);
    });
  }

  // Capability probe 2: isApprovedFeed (next release). Absent -> show all.
  let approvalView = false;
  const approvals = new Map<string, boolean>();
  const probePair = markets[0] ? ([markets[0].feedId, markets[0].agent] as const) : ([`0x${"0".repeat(64)}` as Hex, `0x${"0".repeat(40)}` as Address] as const);
  try {
    const ok = (await client.readContract({ address: mp, abi: probeAbi, functionName: "isApprovedFeed", args: [...probePair] })) as boolean;
    approvalView = true;
    if (markets[0]) approvals.set(`${probePair[0]}|${probePair[1]}`.toLowerCase(), ok);
  } catch (e) {
    if (!isRevert(e)) throw e;
  }
  let hiddenUnapproved = 0;
  if (approvalView) {
    for (const m of markets) {
      const k = `${m.feedId}|${m.agent}`.toLowerCase();
      if (!approvals.has(k)) {
        approvals.set(k, (await client.readContract({ address: mp, abi: probeAbi, functionName: "isApprovedFeed", args: [m.feedId, m.agent] })) as boolean);
      }
      m.approved = approvals.get(k);
    }
    const before = markets.length;
    markets = markets.filter((m) => m.approved !== false);
    hiddenUnapproved = before - markets.length;
  }

  // Builders straight from the registry; names from the static directory.
  const snapFeeds = snapshotMilestoneFeeds();
  const snapRows = snapshotBuilders();
  const ids = Array.from({ length: Math.max(0, Number(nextId) - 1) }, (_, i) => i + 1);
  const builders = await pool(ids, 6, async (id) => {
    const [owner, profileURI, , , active] = (await client.readContract({
      address: reg, abi: builderViewsAbi, functionName: "builders", args: [BigInt(id)],
    })) as readonly [Address, string, Hex, bigint, boolean];
    const meta = PERENNIAL_BUILDERS.find((b) => b.builderId === id && b.address.toLowerCase() === owner.toLowerCase());
    const repo = meta?.repo ?? repoFromURI(profileURI);
    return {
      builderId: id,
      owner,
      active,
      name: meta?.name ?? (repo || `Builder #${id}`),
      repo,
      profileURI,
      milestoneFeedId: meta?.milestoneFeedId ?? snapFeeds[String(id)] ?? milestoneFeedFromMarkets(markets, id, d.operator),
      source: snapshotRowFor(snapRows, { builderId: id, owner })?.source ?? sourceFromProfileURI(profileURI),
      projects: (snapshotRowFor(snapRows, { builderId: id, owner })?.projects ?? []).map((p) => ({
        id: p.id, source: p.source, status: p.status, milestoneFeedId: (p.milestoneFeedId as Hex | null) ?? null,
      })),
      verification: verificationFor(snapRows, { builderId: id, owner }),
      badge: snapshotBadgeFor(snapRows, { builderId: id, owner }),
    } satisfies BuilderRow;
  });

  const incomeThisEpoch = economy
    ? await readIncomes(client, economy.fund, economy.epoch, builders.map((b) => b.builderId))
    : {};

  return {
    chainNow: block.timestamp,
    readAt,
    supportsSettlement,
    settlementWindow,
    approvalView,
    feeModel,
    minLiquidity,
    attestation,
    markets,
    hiddenUnapproved,
    discovery,
    builders,
    fundStatus,
    economy,
    incomeThisEpoch,
  };
}

/** Is the configured BuilderFund the one these markets pay? (See FundStatus.) */
export async function readFundStatus(client: PublicClient, d: PerennialDeployment): Promise<FundStatus> {
  if (!d.fundDeployed) return "not-deployed";
  const paid = await readMarketsFund(client, d.contracts.MarketsPerennial!);
  return paid && paid.toLowerCase() === d.contracts.BuilderFund!.toLowerCase() ? "live" : "unlinked";
}

/** The builder's project whose milestone feed a market names (per-project feeds). */
export function projectForFeed(b: Pick<BuilderRow, "projects"> | undefined, feedId: Hex): BuilderProject | undefined {
  return b?.projects.find((p) => p.milestoneFeedId && p.milestoneFeedId.toLowerCase() === feedId.toLowerCase());
}

/** The caretaker opens each builder's milestone markets on that builder's own
 *  feed with the operator as agent — so the newest such market names the feed. */
export function milestoneFeedFromMarkets(
  markets: Pick<ChainMarket, "builderId" | "agent" | "feedId" | "createdAt">[],
  builderId: number,
  operator: Address | null,
): Hex | undefined {
  if (!operator) return undefined;
  const mine = markets
    .filter((m) => m.builderId === BigInt(builderId) && m.agent.toLowerCase() === operator.toLowerCase())
    .sort((a, b) => Number(b.createdAt - a.createdAt));
  return mine[0]?.feedId;
}

/** Latest attested value for (feed, agent), or null when nothing is attested. */
export async function readLatestValue(
  client: PublicClient,
  attestation: Address,
  feedId: Hex,
  agent: Address,
): Promise<{ value: bigint; timestamp: bigint; finalized: boolean } | null> {
  const [value, timestamp, finalized] = (await client.readContract({
    address: attestation, abi: attestationViewsAbi, functionName: "latestValue", args: [feedId, agent],
  })) as readonly [bigint, bigint, boolean];
  if (timestamp === 0n) return null;
  return { value, timestamp, finalized };
}

/** Each market's subject (subjectOf) on a deployment with wonder markets; {} otherwise
 *  (subjectOf does not exist before the wonder contracts: never called there). */
export async function subjectsFor(
  client: { readContract: PublicClient["readContract"] },
  d: Pick<PerennialDeployment, "contracts">,
  ids: Hex[],
  wonderSources: Record<string, string>,
): Promise<Record<string, MarketSubject>> {
  const w = wonderContracts(d);
  return w ? readMarketSubjects(client as never, w.markets, ids, wonderSources) : {};
}
