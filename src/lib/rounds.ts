/**
 * Common markets: Registrai's 5-minute Up/Down price rounds and event markets
 * on MarketsV4, run by the rounds agent (keeper/rounds.py).
 *
 * Pure logic only (discovery log parsing, round grouping, status derivation,
 * formatting) so all of it is unit-tested; the page does the I/O.
 *
 * How a round works on chain ("bet now on the next 5 minutes"): at each
 * 5-minute boundary B the agent opens the market for the NEXT round [B+5m,
 * B+10m]. Its expiry is B+5m, so betting closes as the round starts, before any
 * of its price path is known. At B+10m the agent attests the round's CHANGE,
 * close(B+10m) − close(B+5m), on one of the asset's rotating change feeds
 * ("registrai-data:btc-usd-5m-change-<n>"); YES = Up iff the change > 0
 * (threshold 0, GreaterThan, so a tie is Down). Final after the feed's
 * challenge window, then resolved.
 *
 * Markets on the legacy price feeds ("registrai-data:btc-usd": the strike is
 * the price at open, the round is [expiry − 5m, expiry]) still settle and show.
 */
import { keccak256, toBytes, type Address, type Hex } from "viem";
import testnetDeployment from "./deployments/arc-testnet-rounds.json";
import mainnetDeployment from "./deployments/arc-mainnet-rounds.json";
import { selectPerennialNetwork } from "./perennial-network";
import { COMPARATOR, PHASE } from "./perennial-market";

// ───────────────────────────── deployment ─────────────────────────────

export interface AssetMeta {
  key: string;
  symbol: string;
  name: string;
  /** Coinbase product id, e.g. "BTC-USD". */
  product: string;
  /** The agent attests round(price * 10^decimals). */
  decimals: number;
}

export interface EventMeta {
  key: string;
  question: string;
  /** Unix seconds. */
  expiry: number;
  /** A short-dated testnet rehearsal: shown only while open or recently settled. */
  rehearsal: boolean;
  /** The market opened at deploy (a seed; discovery can find a newer one). */
  marketId?: Hex | null;
  /** Where the team published the proof once the event happened. */
  evidenceUrl?: string | null;
  /** A market opened from an approved proposal (discovered on chain, not in the deployment). */
  proposal?: ProposalMeta;
}

/** What the page knows about a proposed market beyond the chain: the proposals API's
 *  public record (question, rule, source), or only the proposal id when it is down. */
export interface ProposalMeta {
  id: string;
  /** "event": yes/no on a curated feed; "price": median spot at the deadline. */
  kind: "event" | "price";
  rule?: string;
  source?: string;
  /** The proposals API's record matched the market on chain (its words are shown). */
  verified: boolean;
  /** Price markets: the asset's symbol and attested decimals (its threshold's units). */
  symbol?: string;
  decimals?: number;
}

export interface RoundsDeployment {
  /** False while the network's MarketsV4 / agent are not filled in: no reads. */
  deployed: boolean;
  testnet: boolean;
  /** "Arc testnet" / "Arc mainnet", for copy. */
  label: string;
  chainId: number;
  rpc: string;
  explorer: string;
  deployBlock: bigint;
  roundSecs: number;
  /** MarketsV4 settlement window: the first reading in [expiry, expiry + this]. */
  settlementWindow: number;
  contracts: { MarketsV4: Address; Registry: Address; Attestation: Address; NanoLedger: Address; USDC: Address };
  agent: Address;
  descriptionPrefix: string;
  assets: AssetMeta[];
  events: EventMeta[];
  /** Feeds recorded at deploy; merged with (and overridden by) FeedCreated logs. */
  feeds: Record<string, { feedId: Hex; disputeWindow: number }>;
}

/** The raw JSON shape (testnet and mainnet share it; mainnet has nulls until deployed). */
export interface RoundsDeploymentJson {
  network?: string;
  chainId: number;
  rpc: string;
  explorer: string;
  deployBlock: number | null;
  roundSecs: number;
  settlementWindow: number;
  contracts: Record<string, string | null>;
  agent: string | null;
  descriptionPrefix: string;
  assets: AssetMeta[];
  events: Array<Omit<EventMeta, "marketId"> & { marketId?: string | null }>;
  feeds: Record<string, { feedId: string; disputeWindow: number }>;
}

export function loadDeployment(raw: RoundsDeploymentJson): RoundsDeployment {
  const testnet = raw.chainId !== 5042;
  const deployed = Boolean(raw.contracts.MarketsV4 && raw.agent && raw.deployBlock);
  return {
    deployed,
    testnet,
    label: testnet ? "Arc testnet" : "Arc mainnet",
    chainId: raw.chainId,
    rpc: raw.rpc,
    explorer: raw.explorer,
    deployBlock: BigInt(raw.deployBlock ?? 0),
    roundSecs: raw.roundSecs,
    settlementWindow: raw.settlementWindow,
    contracts: raw.contracts as RoundsDeployment["contracts"],
    agent: (raw.agent ?? "0x0000000000000000000000000000000000000000") as Address,
    descriptionPrefix: raw.descriptionPrefix,
    assets: raw.assets,
    // a testnet rehearsal event never shows on mainnet
    events: raw.events
      .filter((e) => testnet || !e.rehearsal)
      .map((e) => ({ ...e, marketId: (e.marketId ?? null) as Hex | null })),
    feeds: raw.feeds as RoundsDeployment["feeds"],
  };
}

/** Chosen at BUILD time, like Perennial (NEXT_PUBLIC_PERENNIAL_NETWORK). */
export const ROUNDS: RoundsDeployment = loadDeployment(
  (selectPerennialNetwork(process.env.NEXT_PUBLIC_PERENNIAL_NETWORK) === "mainnet"
    ? mainnetDeployment
    : testnetDeployment) as RoundsDeploymentJson,
);

/** Rounds shown per asset in the results strip. */
export const RECENT_ROUNDS = 6;

// ───────────────────────────── market pages ─────────────────────────────

/** An asset's market page is /rounds/<slug>/ (e.g. "btc"): one page per asset that
 *  always shows its current round (rounds roll every few minutes). */
export function assetSlug(a: Pick<AssetMeta, "symbol">): string {
  return a.symbol.toLowerCase();
}

export function assetHref(a: Pick<AssetMeta, "symbol">): string {
  return `/rounds/${assetSlug(a)}/`;
}

export function assetBySlug(slug: string, assets: readonly AssetMeta[] = ROUNDS.assets): AssetMeta | undefined {
  const s = slug.toLowerCase();
  return assets.find((a) => assetSlug(a) === s);
}

/** An event market's page: /rounds/event/<key>/. */
export function eventHref(e: Pick<EventMeta, "key">): string {
  return `/rounds/event/${e.key}/`;
}
/** Arc testnet makes a block about every 0.5 s. */
export const BLOCK_SECS = 0.5;
/** How far back the page scans for rounds: ~2 hours of blocks. */
export const LOG_WINDOW_BLOCKS = 15_000n;
/** The Arc RPC caps eth_getLogs ranges; never ask for more than this. */
export const LOG_CHUNK_BLOCKS = 5_000n;
/** How long a signed round trade stays valid (capped at the round's close). */
export const ROUND_TRADE_WINDOW_SECS = 120n;

// ───────────────────────────── discovery: feeds ─────────────────────────────

const CHANGE_DESC = /^([a-z0-9][a-z0-9-]*)-5m-change-(\d+)$/;
const CHANGE_KEY = /^([a-z0-9][a-z0-9-]*):5m-(\d+)$/;

/** "registrai-data:btc-usd" -> "btc-usd"; a change feed
 *  "registrai-data:btc-usd-5m-change-3" -> "btc-usd:5m-3" (the agent's key);
 *  anything else -> null. */
export function feedKeyFromDescription(desc: string | undefined, prefix = ROUNDS.descriptionPrefix): string | null {
  if (!desc || !desc.startsWith(prefix)) return null;
  const key = desc.slice(prefix.length).trim();
  const ch = CHANGE_DESC.exec(key);
  if (ch) return `${ch[1]}:5m-${ch[2]}`;
  return /^[a-z0-9][a-z0-9-]*$/.test(key) ? key : null;
}

/** A feed key's asset (or event) and whether it is a round-change feed:
 *  "btc-usd:5m-3" -> { asset: "btc-usd", change: true }. */
export function feedKind(key: string): { asset: string; change: boolean } {
  const ch = CHANGE_KEY.exec(key);
  return ch ? { asset: ch[1], change: true } : { asset: key, change: false };
}

export interface AgentFeed {
  /** The agent's feed key: "btc-usd", "btc-usd:5m-3", "arc-token-tradable". */
  key: string;
  /** The asset (or event) the feed is about. */
  asset: string;
  /** A round-change feed (next-round markets settle on it). */
  change: boolean;
  /** Lower-case bytes32. */
  feedId: Hex;
  /** Challenge window in seconds: a reading is final this long after it lands. */
  disputeWindow: number;
  /** Block of FeedCreated; -1 for a deploy seed (any real log wins over it). */
  blockNumber: bigint;
}

/** The agent's feeds: `byKey` is the live feed per key (a feed the agent was
 *  slashed on is replaced by a newer one); `byId` keeps every feed, retired ones
 *  included, because their markets still settle and pay out. */
export interface FeedBook {
  byKey: Record<string, AgentFeed>;
  byId: Record<string, AgentFeed>;
}

/** Minimal shape of a viem-decoded FeedCreated log. */
export interface FeedCreatedLog {
  args: { feedId?: Hex; creator?: Address; description?: string; disputeWindow?: bigint };
  blockNumber: bigint | null;
  logIndex: number | null;
}

export function seedFeedBook(feeds: RoundsDeployment["feeds"]): FeedBook {
  const book: FeedBook = { byKey: {}, byId: {} };
  for (const [key, f] of Object.entries(feeds)) {
    const feed: AgentFeed = { key, ...feedKind(key), feedId: f.feedId.toLowerCase() as Hex, disputeWindow: f.disputeWindow, blockNumber: -1n };
    book.byKey[key] = feed;
    book.byId[feed.feedId] = feed;
  }
  return book;
}

const sameAddr = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const logOrder = (a: { blockNumber: bigint | null; logIndex: number | null }, b: typeof a) => {
  const ab = a.blockNumber ?? 0n;
  const bb = b.blockNumber ?? 0n;
  if (ab !== bb) return ab < bb ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
};

/** Fold FeedCreated logs into a book: only feeds the agent created with a
 *  "registrai-data:<key>" description count; for one key the later feed wins. */
export function mergeFeedLogs(book: FeedBook, logs: readonly FeedCreatedLog[], agent: Address): FeedBook {
  const out: FeedBook = { byKey: { ...book.byKey }, byId: { ...book.byId } };
  for (const lg of [...logs].sort(logOrder)) {
    const { feedId, creator, description, disputeWindow } = lg.args;
    if (!feedId || !sameAddr(creator, agent)) continue;
    const key = feedKeyFromDescription(description);
    if (!key) continue;
    const feed: AgentFeed = {
      key,
      ...feedKind(key),
      feedId: feedId.toLowerCase() as Hex,
      disputeWindow: Number(disputeWindow ?? 0n),
      blockNumber: lg.blockNumber ?? 0n,
    };
    out.byId[feed.feedId] = feed;
    const prev = out.byKey[key];
    if (!prev || prev.blockNumber <= feed.blockNumber) out.byKey[key] = feed;
  }
  return out;
}

// ───────────────────────────── discovery: markets ─────────────────────────────

export interface RoundMarket {
  /** Lower-case bytes32. */
  marketId: Hex;
  feedId: Hex;
  /** The asset (or event) key: "btc-usd". */
  key: string;
  /** A next-round market (on a change feed): betting until `expiry`, the round
   *  is [expiry, expiry + roundSecs] and settles on its change. Otherwise a
   *  legacy price round [expiry − roundSecs, expiry] against its strike. */
  change: boolean;
  agent: Address;
  threshold: bigint;
  comparator: number;
  /** Unix seconds: when trading closes. */
  expiry: number;
  liquidity: bigint;
  blockNumber: bigint;
}

/** Minimal shape of a viem-decoded MarketCreated log. */
export interface MarketCreatedLog {
  args: {
    marketId?: Hex;
    creator?: Address;
    feedId?: Hex;
    agent?: Address;
    threshold?: bigint;
    comparator?: number;
    expiry?: bigint;
    liquidity?: bigint;
  };
  blockNumber: bigint | null;
  logIndex: number | null;
}

/** Registrai's own markets: on the agent's feeds, opened by the agent and naming
 *  it as the settling agent. Anyone may open a market on a public feed (even one
 *  naming our agent, with any strike); those are not the rounds and never show
 *  here, so nobody can slip a look-alike "current round" onto the page. */
export function parseMarketLogs(logs: readonly MarketCreatedLog[], book: FeedBook, agent: Address): RoundMarket[] {
  const seen = new Set<string>();
  const out: RoundMarket[] = [];
  for (const lg of [...logs].sort(logOrder)) {
    const a = lg.args;
    if (!a.marketId || !a.feedId || a.expiry === undefined || a.threshold === undefined) continue;
    if (!sameAddr(a.agent, agent) || !sameAddr(a.creator, agent)) continue;
    const feed = book.byId[a.feedId.toLowerCase()];
    if (!feed) continue;
    // A round market is exactly "change > 0" (threshold 0, GreaterThan): the
    // page's Up = Yes wording assumes it. Anything else on a change feed is not
    // a round we show (a keeper bug would otherwise mislabel it).
    if (feed.change && (a.threshold !== 0n || Number(a.comparator ?? COMPARATOR.GreaterThan) !== COMPARATOR.GreaterThan)) continue;
    const id = a.marketId.toLowerCase() as Hex;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      marketId: id,
      feedId: feed.feedId,
      key: feed.asset,
      change: feed.change,
      agent: a.agent as Address,
      threshold: a.threshold,
      comparator: Number(a.comparator ?? COMPARATOR.GreaterThan),
      expiry: Number(a.expiry),
      liquidity: a.liquidity ?? 0n,
      blockNumber: lg.blockNumber ?? 0n,
    });
  }
  return out;
}

/** First block of the rounds scan: the last ~2 hours, never before deploy. */
export function scanStart(head: bigint, deployBlock: bigint, window: bigint = LOG_WINDOW_BLOCKS): bigint {
  const from = head > window ? head - window + 1n : 0n;
  return from > deployBlock ? from : deployBlock;
}

/** Contiguous inclusive ranges of at most `size` blocks. */
export function logChunks(from: bigint, to: bigint, size: bigint = LOG_CHUNK_BLOCKS): Array<[bigint, bigint]> {
  if (size <= 0n) throw new Error("chunk size must be positive");
  const out: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    out.push([start, end > to ? to : end]);
  }
  return out;
}

/**
 * Scan [from, to] in chunks (two requests in flight). Stops at the first failed
 * chunk, so `scannedTo` only ever covers a contiguous run: the next scan resumes
 * from scannedTo + 1 and nothing is skipped.
 */
export async function scanLogs<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<readonly T[]>,
  from: bigint,
  to: bigint,
  size: bigint = LOG_CHUNK_BLOCKS,
): Promise<{ logs: T[]; scannedTo: bigint; complete: boolean }> {
  const logs: T[] = [];
  let scannedTo = from - 1n;
  const chunks = logChunks(from, to, size);
  for (let i = 0; i < chunks.length; i += 2) {
    const pair = chunks.slice(i, i + 2);
    const res = await Promise.allSettled(pair.map(([a, b]) => fetchRange(a, b)));
    for (let j = 0; j < res.length; j++) {
      const r = res[j];
      if (r.status !== "fulfilled") return { logs, scannedTo, complete: false };
      logs.push(...r.value);
      scannedTo = pair[j][1];
    }
  }
  return { logs, scannedTo, complete: true };
}

// ───────────────────────────── grouping ─────────────────────────────

/** The price window a round is about: a next-round market's round starts when
 *  its betting closes; a legacy round ends at its close. */
export function roundWindow(m: Pick<RoundMarket, "expiry" | "change">, roundSecs: number = ROUNDS.roundSecs): { start: number; end: number } {
  return m.change ? { start: m.expiry, end: m.expiry + roundSecs } : { start: m.expiry - roundSecs, end: m.expiry };
}

export interface AssetRounds {
  /** The round taking bets now: phase Trading and expiry > now (soonest first). */
  current?: RoundMarket;
  /** The round playing out now: betting closed, its window not over. */
  inPlay?: RoundMarket;
  /** Rounds whose window is over, newest first, at most RECENT_ROUNDS. */
  recent: RoundMarket[];
}

/**
 * Per asset: the round taking bets, the round in play, and the recent ones.
 * `phases` (marketId -> phase) is optional: an unread market counts as trading
 * until its expiry.
 */
export function groupRounds(
  markets: readonly RoundMarket[],
  assetKeys: readonly string[],
  now: number,
  phases: Record<string, number | undefined> = {},
  recent: number = RECENT_ROUNDS,
  roundSecs: number = ROUNDS.roundSecs,
): Record<string, AssetRounds> {
  const out: Record<string, AssetRounds> = {};
  for (const key of assetKeys) out[key] = { recent: [] };
  const newer = (a: RoundMarket, b: RoundMarket) => a.blockNumber > b.blockNumber;
  for (const m of markets) {
    const g = out[m.key];
    if (!g) continue;
    const phase = phases[m.marketId];
    if (m.expiry > now) {
      if (phase !== undefined && phase !== PHASE.Trading) continue;
      if (!g.current || m.expiry < g.current.expiry || (m.expiry === g.current.expiry && newer(m, g.current))) g.current = m;
    } else if (roundWindow(m, roundSecs).end > now) {
      if (!g.inPlay || m.expiry > g.inPlay.expiry || (m.expiry === g.inPlay.expiry && newer(m, g.inPlay))) g.inPlay = m;
    } else {
      g.recent.push(m);
    }
  }
  for (const key of Object.keys(out)) {
    const end = (m: RoundMarket) => roundWindow(m, roundSecs).end;
    out[key].recent.sort((a, b) => end(b) - end(a) || (a.blockNumber < b.blockNumber ? 1 : a.blockNumber > b.blockNumber ? -1 : 0));
    out[key].recent = out[key].recent.slice(0, recent);
  }
  return out;
}

/** The newest market on an event's feed (a re-opened event supersedes the old one). */
export function latestMarketFor(markets: readonly RoundMarket[], key: string): RoundMarket | undefined {
  let best: RoundMarket | undefined;
  for (const m of markets) {
    if (m.key !== key) continue;
    if (!best || m.blockNumber > best.blockNumber) best = m;
  }
  return best;
}

// ───────────────────────────── status ─────────────────────────────

/** Attestation.firstInWindow(feed, agent, expiry, expiry + window). */
export interface Reading {
  found: boolean;
  value: bigint;
  /** Unix seconds the reading landed on chain. */
  timestamp: number;
  finalized: boolean;
}

export type RoundStatusKey = "live" | "in-play" | "awaiting-reading" | "settling" | "resolved-up" | "resolved-down" | "voided";

export interface RoundStatus {
  key: RoundStatusKey;
  /** Short label for a chip or a strip cell. */
  label: string;
  /** One sentence for a tooltip or a detail line. */
  detail: string;
  /** settling: when the reading becomes final (reading time + challenge window). */
  finalAt?: number;
  /** settling: the reading is past its challenge window; the agent resolves next. */
  final?: boolean;
  /** settling: what the reading says, before it is final. */
  provisional?: "up" | "down";
  /** awaiting-reading: no reading in the settlement window, so the market voids. */
  voidable?: boolean;
}

/** Does `value` satisfy the market's comparator against its threshold (YES)? */
export function yesWins(value: bigint, threshold: bigint, comparator: number): boolean {
  switch (comparator) {
    case COMPARATOR.GreaterThan:
      return value > threshold;
    case COMPARATOR.GreaterOrEqual:
      return value >= threshold;
    case COMPARATOR.LessThan:
      return value < threshold;
    case COMPARATOR.LessOrEqual:
      return value <= threshold;
    default:
      return false;
  }
}

export interface StatusInput {
  phase: number;
  yesWon: boolean;
  expiry: number;
  /** Chain time (latest block), unix seconds. */
  now: number;
  /** undefined / not found: no reading after the close yet. */
  reading?: Reading | null;
  /** The feed's challenge window, seconds. */
  disputeWindow: number;
  threshold: bigint;
  comparator: number;
  /** MarketsV4 settlement window (default: the deployment's). */
  settlementWindow?: number;
  /** A next-round market: the round runs [expiry, expiry + roundSecs] after betting closes. */
  change?: boolean;
  roundSecs?: number;
}

export function roundStatus(s: StatusInput): RoundStatus {
  if (s.phase === PHASE.Resolved) {
    return s.yesWon
      ? { key: "resolved-up", label: "Up", detail: "Resolved Up: Up shares pay 1 USDC each." }
      : { key: "resolved-down", label: "Down", detail: "Resolved Down: Down shares pay 1 USDC each." };
  }
  if (s.phase === PHASE.Voided) {
    return { key: "voided", label: "Voided", detail: "Voided: every trader gets their net cost back." };
  }
  if (s.now < s.expiry) {
    return s.change
      ? { key: "live", label: "Betting", detail: "Betting is open until the round starts." }
      : { key: "live", label: "Live", detail: "Trading until the close." };
  }
  const r = s.reading;
  const roundEnd = s.expiry + (s.roundSecs ?? ROUNDS.roundSecs);
  if (s.change && (!r || !r.found) && s.now < roundEnd) {
    return {
      key: "in-play",
      label: "In play",
      detail: "Betting closed when the round started. It settles on the price change over the round.",
    };
  }
  if (!r || !r.found) {
    const window = s.settlementWindow ?? ROUNDS.settlementWindow;
    if (s.now >= s.expiry + window) {
      return {
        key: "awaiting-reading",
        label: "No reading",
        detail: "No reading landed in the settlement window, so this round voids and refunds net cost.",
        voidable: true,
      };
    }
    return {
      key: "awaiting-reading",
      label: s.change ? "Ended" : "Closed",
      detail: s.change
        ? "The round ended. Waiting for the agent's reading of its change."
        : "Trading closed. Waiting for the agent's reading of the close.",
    };
  }
  const up = yesWins(r.value, s.threshold, s.comparator);
  const finalAt = r.timestamp + s.disputeWindow;
  const final = r.finalized || s.now >= finalAt;
  return {
    key: "settling",
    label: final ? "Resolving" : up ? "Up?" : "Down?",
    detail: final
      ? `The reading is final (${up ? "Up" : "Down"}); the agent resolves the market next.`
      : `The reading says ${up ? "Up" : "Down"}. It becomes final when the challenge window ends.`,
    finalAt,
    final,
    provisional: up ? "up" : "down",
  };
}

// ───────────────────────────── claims ─────────────────────────────

export interface Claim {
  market: RoundMarket;
  amount: bigint;
}

/** Markets with something to redeem, soonest-closed first. */
export function claimList(markets: readonly RoundMarket[], redeemable: Record<string, bigint | undefined>): Claim[] {
  return markets
    .map((m) => ({ market: m, amount: redeemable[m.marketId] ?? 0n }))
    .filter((c) => c.amount > 0n)
    .sort((a, b) => a.market.expiry - b.market.expiry);
}

// ───────────────────────────── events ─────────────────────────────

/** How long a settled rehearsal stays on the page after its deadline. */
export const REHEARSAL_GRACE_SECS = 24 * 3600;

/** A real event market always shows; a rehearsal only while open (or awaiting
 *  settlement) or within a day of its deadline. */
export function eventVisible(ev: Pick<EventMeta, "rehearsal">, phase: number | undefined, expiry: number, now: number): boolean {
  if (!ev.rehearsal) return true;
  if (phase === undefined || phase === PHASE.Trading) return true;
  return now < expiry + REHEARSAL_GRACE_SECS;
}

/** What the event feed's latest reading means, in words. */
export function evidenceNote(value: bigint | undefined, evidenceUrl?: string | null): string {
  if (value === undefined) return "Reading the feed…";
  if (value <= 0n) return "No evidence recorded yet.";
  return evidenceUrl ? "Recorded as happened. Evidence:" : "Recorded as happened. The evidence link is published with the reading.";
}

// ───────────────────────────── proposed markets ─────────────────────────────
//
// Markets opened from admin-approved proposals (spec §6). The rounds agent
// provisions a feed "registrai-data:p-<proposalId>" and opens one market on it;
// neither is in the deployment JSON, so both are discovered from chain. The
// question comes from the public proposals API, falling back to "Proposal #id".

const PROPOSAL_KEY = /^p-p[a-z2-7]{10}$/;

/** A proposal feed's key: "p-" + a proposal id ("p" + 10 base32 characters). */
export function isProposalKey(key: string): boolean {
  return PROPOSAL_KEY.test(key);
}

/** "p-pabcdefghij" -> "pabcdefghij". */
export function proposalIdOfKey(key: string): string {
  return key.slice(2);
}

/** A bytes32 market id as the page's query parameter carries it. */
export function isMarketId(s: string): s is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

/** A proposed market's page: one static route, the market id in the query. */
export function proposedMarketHref(marketId: string): string {
  return `/rounds/market/?id=${marketId.toLowerCase()}`;
}

/** The newest market on each proposal feed (a market is never re-opened on another
 *  contract, but a feed can in principle carry more than one), open ones first by
 *  deadline, then the finished ones newest deadline first. */
export function proposedMarkets(markets: readonly RoundMarket[], now: number): RoundMarket[] {
  const latest = new Map<string, RoundMarket>();
  for (const m of markets) {
    if (!isProposalKey(m.key)) continue;
    const prev = latest.get(m.key);
    if (!prev || m.blockNumber > prev.blockNumber) latest.set(m.key, m);
  }
  const open = (m: RoundMarket) => m.expiry > now;
  return [...latest.values()].sort((a, b) =>
    open(a) !== open(b) ? (open(a) ? -1 : 1) : open(a) ? a.expiry - b.expiry : b.expiry - a.expiry,
  );
}

/** A proposal's public record from GET /api/market-proposals/<id>, narrowed to what
 *  the market page shows. Untrusted input: anything malformed is dropped. */
export interface ApprovalTerms {
  threshold: bigint;
  comparator: number;
  expiry: number;
  /** 1 = yes/no event, 2 = price at a deadline. */
  kind: number;
  question: string;
  /** "" for a yes/no market. */
  asset: string;
  /** keccak256 of the rule as signed. */
  ruleHash?: Hex;
}

export interface ProposalInfo {
  question: string;
  kind?: "event" | "price";
  rule?: string;
  source?: string;
  asset?: string;
  /** From the admin-signed outcome, when one is recorded (https only). */
  evidenceUrl?: string;
  /** The approval's creator payee; "" means the treasury. */
  creatorPayee?: string;
  /** What the admin signed (the approval message): checked against chain and against
   *  the record's own words before any of them is shown. */
  terms?: ApprovalTerms;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
const httpsUrl = (v: unknown) => {
  const s = text(v, 2048);
  return s && /^https:\/\/\S+$/.test(s) ? s : undefined;
};
const intText = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined);

/** The API's record for proposal `id`, or null when it is malformed or is another
 *  proposal's record. */
export function parseProposalInfo(json: unknown, id: string): ProposalInfo | null {
  const p = (json as { proposal?: unknown } | null)?.proposal as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object" || p.id !== id) return null;
  const question = text(p.question, 300);
  if (!question) return null;
  const kind = p.kind === "event" || p.kind === "price" ? p.kind : undefined;
  const outcome = (p.outcome as { message?: { evidenceUrl?: unknown } } | undefined)?.message;
  const payee = typeof p.creatorPayee === "string" && /^0x[0-9a-fA-F]{40}$/.test(p.creatorPayee) ? p.creatorPayee : "";
  const msg = (p.approval as { message?: Record<string, unknown> } | undefined)?.message;
  const th = intText(msg?.threshold, /^-?\d{1,78}$/);
  const cmp = intText(msg?.comparator, /^\d{1,3}$/);
  const exp = intText(msg?.expiry, /^\d{1,20}$/);
  const knd = intText(msg?.kind, /^\d{1,3}$/);
  const sq = text(msg?.question, 1200);
  const sa = typeof msg?.asset === "string" && msg.asset.length <= 16 ? msg.asset : undefined;
  const rh = typeof msg?.ruleHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(msg.ruleHash) ? (msg.ruleHash.toLowerCase() as Hex) : undefined;
  const terms =
    th !== undefined && cmp !== undefined && exp !== undefined && knd !== undefined && sq !== undefined && sa !== undefined
      ? { threshold: BigInt(th), comparator: Number(cmp), expiry: Number(exp), kind: Number(knd), question: sq, asset: sa, ruleHash: rh }
      : undefined;
  return {
    question,
    kind,
    rule: text(p.rule, 1000),
    source: httpsUrl(p.source),
    asset: text(p.asset, 16),
    evidenceUrl: httpsUrl(outcome?.evidenceUrl),
    creatorPayee: payee,
    terms,
  };
}

/** What a proposals API answer means for the page: a record to parse, a definitive
 *  "no such proposal" (404, 410: kept), or anything else (a network error or timeout,
 *  429, 5xx, any other 4xx: forgotten and asked again later). */
export function proposalAnswer(status: number | "network"): "ok" | "missing" | "retry" {
  if (status === "network") return "retry";
  if (status >= 200 && status < 300) return "ok";
  return status === 404 || status === 410 ? "missing" : "retry";
}

/** Backoff before asking again after `fails` transient failures: 10 s, doubling, at most 5 min. */
export function proposalRetryMs(fails: number): number {
  return Math.min(300_000, 10_000 * 2 ** Math.max(0, fails - 1));
}

type MarketTerms = Pick<RoundMarket, "threshold" | "comparator" | "expiry">;

/** The API record describes THIS market: its signed approval's threshold, comparator
 *  and expiry are the ones on chain, and the record's question and asset are the ones
 *  signed. Anything else (a stale, edited or wrong record) must not put its words on
 *  the market. */
export function infoMatchesMarket(info: ProposalInfo | null | undefined, m: MarketTerms): info is ProposalInfo & { terms: ApprovalTerms } {
  const t = info?.terms;
  return Boolean(
    t &&
      t.threshold === m.threshold &&
      t.comparator === m.comparator &&
      t.expiry === m.expiry &&
      (t.kind === 1 || t.kind === 2) &&
      info!.question === t.question &&
      (info!.asset ?? "") === t.asset,
  );
}

/** The event-page description of a proposed market. When the proposals API's record
 *  matches the market (infoMatchesMarket), the signed approval gives the kind, the
 *  question and the asset, and the record its rule (only if it hashes to the signed
 *  ruleHash), source and evidence. Otherwise the page says "Proposal #id", shows the raw
 *  on-chain terms, and takes the kind from chain: a threshold of 1 with GreaterOrEqual
 *  is a yes/no market (what the agent opens for kind 1), anything else a price market. */
export function proposalEventMeta(
  m: Pick<RoundMarket, "key" | "marketId" | "expiry" | "threshold" | "comparator">,
  info: ProposalInfo | null | undefined,
  assets: Record<string, { symbol: string; decimals: number }> = {},
): EventMeta {
  const id = proposalIdOfKey(m.key);
  const ok = infoMatchesMarket(info, m) ? info : undefined;
  const chainKind = m.threshold === 1n && m.comparator === COMPARATOR.GreaterOrEqual ? "event" : "price";
  const kind = ok ? (ok.terms.kind === 2 ? "price" : "event") : chainKind;
  const asset = kind === "price" && ok?.terms.asset ? assets[ok.terms.asset] : undefined;
  const rule = ok?.rule && ok.terms.ruleHash && keccak256(toBytes(ok.rule)) === ok.terms.ruleHash ? ok.rule : undefined;
  return {
    key: m.key,
    question: ok?.terms.question ?? `Proposal #${id}`,
    expiry: m.expiry,
    rehearsal: false,
    marketId: m.marketId,
    evidenceUrl: ok?.evidenceUrl ?? null,
    proposal: { id, kind, verified: Boolean(ok), rule, source: ok?.source, symbol: asset?.symbol, decimals: asset?.decimals },
  };
}

/** Days a proposal feed is searched for its market: the agent opens it in the pass
 *  that provisions the feed, so a feed with no market after this was never opened. */
export const PROPOSAL_MARKET_SEARCH_SECS = 3 * 86_400;
/** How far back proposal feeds are searched: a proposed market's deadline is at most
 *  366 days after it opens, plus a day for settlement. */
export const PROPOSAL_LOOKBACK_SECS = 367 * 86_400;

/** A covered, contiguous block range [lo, hi]. */
export interface Cover {
  lo: bigint;
  hi: bigint;
}

/** The next range to scan for proposal feeds, newest first: the blocks added since
 *  the cover, a whole chunk at a time (oldest first, so the cover stays contiguous),
 *  then back from its low end to `floor`. null when nothing is left to scan. */
export function nextBackfill(cover: Cover | undefined, head: bigint, floor: bigint, chunk: bigint = LOG_CHUNK_BLOCKS): [bigint, bigint] | null {
  if (head < floor) return null;
  if (!cover) {
    const lo = head - chunk + 1n;
    return [lo > floor ? lo : floor, head];
  }
  // A gap under a chunk is left to the page's own scan of the recent blocks; the
  // next visit (or the gap reaching a chunk) covers it here.
  if (head - cover.hi >= chunk) return [cover.hi + 1n, cover.hi + chunk];
  if (cover.lo > floor) {
    const lo = cover.lo - chunk;
    return [lo > floor ? lo : floor, cover.lo - 1n];
  }
  return null;
}

/** The cover after scanning [from, to]: grows only when the range touches it. */
export function extendCover(cover: Cover | undefined, from: bigint, to: bigint): Cover | undefined {
  if (to < from) return cover;
  if (!cover) return { lo: from, hi: to };
  if (from > cover.hi + 1n || to < cover.lo - 1n) return cover;
  return { lo: from < cover.lo ? from : cover.lo, hi: to > cover.hi ? to : cover.hi };
}

/** A proposal feed found by the background scan, and how far its market was searched.
 *  Only ids and block numbers are kept: the feed's key is re-read from the Registry on
 *  every visit, so an edited record cannot relabel a feed. */
export interface ProposalFeedRecord {
  feedId: Hex;
  block: bigint;
  /** MarketCreated on this feed was searched through this block. */
  marketTo: bigint;
  marketId?: Hex;
}

/** The background scan's progress, kept in localStorage so a return visit reads only
 *  the blocks added since (bigints as decimal strings). */
export interface ProposalScanStore {
  cover?: Cover;
  feeds: Record<string, ProposalFeedRecord>;
}

/** At most this many feed records are kept (the newest by block). */
export const PROPOSAL_STORE_MAX = 1000;

export function serializeProposalStore(s: ProposalScanStore): string {
  return JSON.stringify({
    cover: s.cover ? { lo: s.cover.lo.toString(), hi: s.cover.hi.toString() } : undefined,
    feeds: Object.values(s.feeds).map((f) => ({ ...f, block: f.block.toString(), marketTo: f.marketTo.toString() })),
  });
}

const DEC_RE = /^\d{1,20}$/;
const B32_RE = /^0x[0-9a-f]{64}$/;

/** A stored scan, or an empty one when missing or malformed (then it scans afresh). */
export function parseProposalStore(raw: string | null): ProposalScanStore {
  const empty: ProposalScanStore = { feeds: {} };
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw) as { cover?: { lo?: unknown; hi?: unknown }; feeds?: unknown };
    const out: ProposalScanStore = { feeds: {} };
    const c = j.cover;
    if (c !== undefined) {
      if (typeof c.lo !== "string" || typeof c.hi !== "string" || !DEC_RE.test(c.lo) || !DEC_RE.test(c.hi) || BigInt(c.lo) > BigInt(c.hi)) return empty;
      out.cover = { lo: BigInt(c.lo), hi: BigInt(c.hi) };
    }
    if (!Array.isArray(j.feeds)) return empty;
    const recs: ProposalFeedRecord[] = [];
    for (const f of j.feeds as Array<Record<string, unknown>>) {
      if (!f || typeof f.feedId !== "string" || !B32_RE.test(f.feedId)) return empty;
      if (typeof f.block !== "string" || !DEC_RE.test(f.block) || typeof f.marketTo !== "string" || !DEC_RE.test(f.marketTo)) return empty;
      if (f.marketId !== undefined && (typeof f.marketId !== "string" || !B32_RE.test(f.marketId))) return empty;
      recs.push({ feedId: f.feedId as Hex, block: BigInt(f.block), marketTo: BigInt(f.marketTo), marketId: f.marketId as Hex | undefined });
    }
    return { ...out, feeds: newestFeeds(recs) };
  } catch {
    return empty;
  }
}

function newestFeeds(recs: readonly ProposalFeedRecord[], max = PROPOSAL_STORE_MAX): Record<string, ProposalFeedRecord> {
  const sorted = [...recs].sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0));
  return Object.fromEntries(sorted.slice(0, max).map((f) => [f.feedId, f]));
}

/** The store without what can no longer show: feeds older than the scan's floor (a
 *  proposal's deadline is at most a year after its feed, so past the floor its market,
 *  opened or not, is over); then the newest PROPOSAL_STORE_MAX by block. A feed whose
 *  market search came up empty stays: the agent may still open it (a retried open, or
 *  one waiting on its float), and the page's own scan catches that on a feed in its book. */
export function pruneProposalStore(s: ProposalScanStore, floor: bigint, max = PROPOSAL_STORE_MAX): ProposalScanStore {
  const keep = Object.values(s.feeds).filter((f) => f.block >= floor);
  return { cover: s.cover, feeds: newestFeeds(keep, max) };
}

/** The sum of NanoLedger InternalTransfer amounts (the agent's forwarded creator share). */
export function sumTransfers(logs: readonly { args: { amount?: bigint } }[]): bigint {
  return logs.reduce((s, l) => s + (l.args.amount ?? 0n), 0n);
}

// ───────────────────────────── formatting ─────────────────────────────

/** A scaled integer as a decimal string with thousands separators:
 *  formatScaled(8396735n, 2) -> "83,967.35". */
export function formatScaled(value: bigint, decimals: number, group = true): string {
  const neg = value < 0n;
  const a = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = (a / base).toString();
  const frac = decimals > 0 ? (a % base).toString().padStart(decimals, "0") : "";
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** A live price as the agent would scale it: round(price * 10^decimals). */
export function toScaled(price: number, decimals: number): bigint {
  return BigInt(Math.round(price * 10 ** decimals));
}

/** A live price formatted at the asset's attested precision. */
export function formatPrice(price: number, decimals: number): string {
  return formatScaled(toScaled(price, decimals), decimals);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "20:05" (UTC). */
export function clockUtc(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** A round's window: "20:05–20:10 UTC". */
export function roundLabel(start: number, end: number): string {
  return `${clockUtc(start)}–${clockUtc(end)} UTC`;
}

/** "4:05" under an hour, "1h 02m" under a day, else "3d 4h". Never negative. */
export function timeLeft(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 3600) return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

/** A round's change, signed: "+190.00", "−0.35", "±0.00" (a tie is Down). */
export function formatChange(value: bigint, decimals: number): string {
  const abs = formatScaled(value < 0n ? -value : value, decimals);
  return value > 0n ? `+${abs}` : value < 0n ? `−${abs}` : `±${abs}`;
}

/** Where the live price sits against the strike (both at the asset's scale). */
export function strikeDelta(live: bigint, strike: bigint): { dir: "above" | "below" | "at"; diff: bigint; pct: number } {
  const diff = live - strike;
  const pct = strike === 0n ? 0 : (Number(diff) / Number(strike)) * 100;
  return { dir: diff > 0n ? "above" : diff < 0n ? "below" : "at", diff, pct };
}

/** A 1e18-scaled price as a percentage number (0..100). */
export function impliedPct(price1e18: bigint): number {
  return Number(price1e18) / 1e16;
}

/** Deadline for a signed trade: a short validity window, and never past the
 *  market's close (a round trade that has not filled by then must not fill). */
export function roundTradeDeadline(chainNow: bigint, expiry: bigint, windowSecs: bigint = ROUND_TRADE_WINDOW_SECS): bigint {
  const d = chainNow + windowSecs;
  return d < expiry ? d : expiry;
}

/** Coinbase Exchange /products/<id>/ticker -> price, or undefined. */
export function parseCoinbaseTicker(json: unknown): number | undefined {
  if (!json || typeof json !== "object") return undefined;
  const p = Number((json as { price?: unknown }).price);
  return Number.isFinite(p) && p > 0 ? p : undefined;
}

/** Coinbase Exchange 1-minute candles ([[time, low, high, open, close, volume], ...])
 *  -> the close of the minute ending exactly at `at` (as the agent reads it), or undefined. */
export function candleCloseAt(json: unknown, at: number): number | undefined {
  if (!Array.isArray(json)) return undefined;
  for (const r of json) {
    if (Array.isArray(r) && r.length >= 5 && Number(r[0]) + 60 === at) {
      const c = Number(r[4]);
      return Number.isFinite(c) && c > 0 ? c : undefined;
    }
  }
  return undefined;
}

/** Start of the round a boundary-aligned expiry closes (legacy price rounds). */
export const roundStart = (expiry: number, roundSecs: number = ROUNDS.roundSecs) => expiry - roundSecs;

/** The next 5-minute boundary after `now` (when a new round opens). */
export const nextBoundary = (now: number, roundSecs: number = ROUNDS.roundSecs) => (Math.floor(now / roundSecs) + 1) * roundSecs;
