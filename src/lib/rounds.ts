/**
 * Common markets: Registrai's 5-minute Up/Down price rounds and event markets
 * on MarketsV4, run by the rounds agent (keeper/rounds.py).
 *
 * Pure logic only (discovery log parsing, round grouping, status derivation,
 * formatting) so all of it is unit-tested; the page does the I/O.
 *
 * How a round works on chain: at each 5-minute boundary B the agent attests the
 * asset's price as of B (the exchange's 1-minute close ending at B) and opens a
 * market "strictly higher at B+5m than the strike?" (YES = Up, comparator
 * GreaterThan, so a tie is Down) with that reading as the strike. The reading
 * at B+5m settles it: final after the feed's challenge window, then resolved.
 */
import type { Address, Hex } from "viem";
import deployment from "./deployments/arc-testnet-rounds.json";
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
}

export interface RoundsDeployment {
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

export function loadDeployment(raw: typeof deployment): RoundsDeployment {
  return {
    chainId: raw.chainId,
    rpc: raw.rpc,
    explorer: raw.explorer,
    deployBlock: BigInt(raw.deployBlock),
    roundSecs: raw.roundSecs,
    settlementWindow: raw.settlementWindow,
    contracts: raw.contracts as RoundsDeployment["contracts"],
    agent: raw.agent as Address,
    descriptionPrefix: raw.descriptionPrefix,
    assets: raw.assets,
    events: raw.events.map((e) => ({ ...e, marketId: (e.marketId ?? null) as Hex | null })),
    feeds: raw.feeds as RoundsDeployment["feeds"],
  };
}

export const ROUNDS: RoundsDeployment = loadDeployment(deployment);

/** Rounds shown per asset in the results strip. */
export const RECENT_ROUNDS = 6;
/** Arc testnet makes a block about every 0.5 s. */
export const BLOCK_SECS = 0.5;
/** How far back the page scans for rounds: ~2 hours of blocks. */
export const LOG_WINDOW_BLOCKS = 15_000n;
/** The Arc RPC caps eth_getLogs ranges; never ask for more than this. */
export const LOG_CHUNK_BLOCKS = 5_000n;
/** How long a signed round trade stays valid (capped at the round's close). */
export const ROUND_TRADE_WINDOW_SECS = 120n;

// ───────────────────────────── discovery: feeds ─────────────────────────────

/** "registrai-data:btc-usd" -> "btc-usd"; anything else -> null. */
export function feedKeyFromDescription(desc: string | undefined, prefix = ROUNDS.descriptionPrefix): string | null {
  if (!desc || !desc.startsWith(prefix)) return null;
  const key = desc.slice(prefix.length).trim();
  return /^[a-z0-9][a-z0-9-]*$/.test(key) ? key : null;
}

export interface AgentFeed {
  key: string;
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
    const feed: AgentFeed = { key, feedId: f.feedId.toLowerCase() as Hex, disputeWindow: f.disputeWindow, blockNumber: -1n };
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
  /** The feed's key (asset or event). */
  key: string;
  agent: Address;
  threshold: bigint;
  comparator: number;
  /** Unix seconds. For a round: its close; the round opened at expiry − roundSecs. */
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
    const id = a.marketId.toLowerCase() as Hex;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      marketId: id,
      feedId: feed.feedId,
      key: feed.key,
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

export interface AssetRounds {
  /** The round trading now: phase Trading and expiry > now (earliest such). */
  current?: RoundMarket;
  /** Closed rounds, newest first, at most RECENT_ROUNDS. */
  recent: RoundMarket[];
}

/**
 * Per asset: the current round and the recent ones. `phases` (marketId ->
 * phase) is optional: an unread market counts as trading until its expiry.
 */
export function groupRounds(
  markets: readonly RoundMarket[],
  assetKeys: readonly string[],
  now: number,
  phases: Record<string, number | undefined> = {},
  recent: number = RECENT_ROUNDS,
): Record<string, AssetRounds> {
  const out: Record<string, AssetRounds> = {};
  for (const key of assetKeys) out[key] = { recent: [] };
  for (const m of markets) {
    const g = out[m.key];
    if (!g) continue;
    const phase = phases[m.marketId];
    if (m.expiry > now) {
      if (phase !== undefined && phase !== PHASE.Trading) continue;
      if (!g.current || m.expiry < g.current.expiry || (m.expiry === g.current.expiry && m.blockNumber > g.current.blockNumber)) {
        g.current = m;
      }
    } else {
      g.recent.push(m);
    }
  }
  for (const key of Object.keys(out)) {
    out[key].recent.sort((a, b) => b.expiry - a.expiry || (a.blockNumber < b.blockNumber ? 1 : a.blockNumber > b.blockNumber ? -1 : 0));
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

export type RoundStatusKey = "live" | "awaiting-reading" | "settling" | "resolved-up" | "resolved-down" | "voided";

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
    return { key: "live", label: "Live", detail: "Trading until the close." };
  }
  const r = s.reading;
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
      label: "Closed",
      detail: "Trading closed. Waiting for the agent's reading of the close.",
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

/** Start of the round a boundary-aligned expiry closes. */
export const roundStart = (expiry: number, roundSecs: number = ROUNDS.roundSecs) => expiry - roundSecs;

/** The next 5-minute boundary after `now` (when a new round opens). */
export const nextBoundary = (now: number, roundSecs: number = ROUNDS.roundSecs) => (Math.floor(now / roundSecs) + 1) * roundSecs;
