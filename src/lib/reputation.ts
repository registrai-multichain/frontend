/**
 * Agent reputation & bond coverage — pure logic, no I/O.
 *
 * Design: docs/superpowers/specs/2026-09-24-agent-reputation-design.md. A SOFT
 * system: nothing here blocks a trade or gates a payout. It tells a trader how
 * much of an agent's track record and bond stands behind the money at risk.
 *
 *  - Score = trading volume (USDC, 6 dec) of markets the agent settled correctly
 *    (the market emitted Resolved; voids never count). A market's volume is
 *    Σ buys collateralIn + Σ sells (collateralOut + fee) — Sold's collateralOut
 *    is net of the 1% trading fee.
 *  - Caught = a dispute ruled AttestationInvalid against one of its answers.
 *    The score is wiped to 0, and only markets resolved AFTER the ruling's block
 *    rebuild it.
 *  - Level (0–5) from the score; the level sets the multiplier behind the
 *    recommended bond; coverage = bond ÷ recommended.
 *
 * Everything is integer USDC base units (bigint); the fold's state has a
 * JSON-safe form (bigints as decimal strings) so it can live in live-data.json
 * and be resumed.
 */

// ───────────────────────────── levels ─────────────────────────────

const USDC = 1_000_000n;

/** Score thresholds (6-dec USDC) for levels 2, 3, 4, 5. */
export const LEVEL_THRESHOLDS = [
  10_000n * USDC,
  100_000n * USDC,
  1_000_000n * USDC,
  10_000_000n * USDC,
] as const;

export type Level = 0 | 1 | 2 | 3 | 4 | 5;

/** Multiplier per level, in bps (10_000 = 1.0×). */
export const MULTIPLIER_BPS: Record<Level, bigint> = {
  0: 20_000n,
  1: 10_000n,
  2: 7_500n,
  3: 5_000n,
  4: 2_500n,
  5: 1_000n,
};

/**
 * Level from the table: ≥ $10M → 5, ≥ $1M → 4, ≥ $100k → 3, ≥ $10k → 2; below
 * $10k a caught agent is 0 and any other agent 1. A caught agent that rebuilds
 * past $10k moves up by the table (the flag stays visible, not in the level).
 */
export function levelOf(score: bigint, caught: boolean): Level {
  if (score >= LEVEL_THRESHOLDS[3]) return 5;
  if (score >= LEVEL_THRESHOLDS[2]) return 4;
  if (score >= LEVEL_THRESHOLDS[1]) return 3;
  if (score >= LEVEL_THRESHOLDS[0]) return 2;
  return caught ? 0 : 1;
}

export function multiplierBps(level: Level): bigint {
  return MULTIPLIER_BPS[level];
}

/** "2.0×", "0.75×", "0.1×" */
export function multiplierLabel(level: Level): string {
  const bps = Number(MULTIPLIER_BPS[level]);
  const x = bps / 10_000;
  return `${Number.isInteger(x) ? x.toFixed(1) : String(x)}×`;
}

// ───────────────────────────── coverage ─────────────────────────────

/**
 * Recommended bond = $50 × multiplier × (open collateral ÷ $1,000), in integer
 * USDC units, floored: `50e6 * multBps * collateral / (10_000 * 1_000e6)`.
 */
export function recommendedBond(collateral: bigint, level: Level): bigint {
  if (collateral <= 0n) return 0n;
  return (50n * USDC * MULTIPLIER_BPS[level] * collateral) / (10_000n * 1_000n * USDC);
}

/** bond ÷ recommended as a ratio; Infinity when nothing is at risk. */
export function coverage(bond: bigint, recommended: bigint): number {
  if (recommended <= 0n) return Number.POSITIVE_INFINITY;
  // Integer bps first so the ratio never rounds UP across a tier boundary.
  return Number((bond * 10_000n) / recommended) / 10_000;
}

/** Whole-percent coverage, floored (99.99% shows as 99%, never 100%). null = nothing at risk. */
export function coveragePct(bond: bigint, recommended: bigint): number | null {
  if (recommended <= 0n) return null;
  const pct = (bond * 100n) / recommended;
  return pct > 1_000_000n ? 1_000_000 : Number(pct);
}

export type CoverageTier = "full" | "partial" | "thin";

/** ≥ 100% (or nothing at risk) full; 50–100% partial; < 50% thin. Exact bigint comparisons. */
export function coverageTier(bond: bigint, recommended: bigint): CoverageTier {
  if (recommended <= 0n || bond >= recommended) return "full";
  if (bond * 2n >= recommended) return "partial";
  return "thin";
}

// ───────────────────────────── the fold ─────────────────────────────

/** Normalized, block/logIndex-ordered event stream. `market` is an opaque key
 *  (the indexer uses `${contract}:${marketId}`, lowercased, so two market
 *  contracts can never collide). Addresses are compared lowercased. */
export type ReputationEvent =
  | { kind: "created"; block: number; seq: number; market: string; agent: string; feed: string }
  | { kind: "trade"; block: number; seq: number; market: string; volume: bigint }
  | { kind: "resolved"; block: number; seq: number; market: string }
  /** Not required for correctness (only Resolved credits) — it lets the fold
   *  forget a void market instead of carrying it forever. */
  | { kind: "voided"; block: number; seq: number; market: string }
  | {
      kind: "invalidated";
      block: number;
      seq: number;
      agent: string;
      disputeId: string;
      attestationId: string;
      /** The ruling's transaction, for an explorer link. */
      tx?: string;
    };

export interface AgentRecord {
  score: bigint;
  caught: boolean;
  /** Block of the latest AttestationInvalid ruling, if ever caught. */
  caughtAt?: number;
  lastDisputeId?: string;
  caughtTx?: string;
  /** Lifetime count of markets it settled correctly (a catch wipes the score,
   *  not the history). */
  settledMarkets: number;
}

export interface OpenMarket {
  agent: string;
  feed: string;
  /** Volume so far; credited to the agent only if the market resolves. */
  volume: bigint;
}

export interface ReputationState {
  agents: Record<string, AgentRecord>;
  /** Markets seen created and not yet resolved or voided. */
  open: Record<string, OpenMarket>;
}

export const EMPTY_REPUTATION: ReputationState = { agents: {}, open: {} };

const lc = (s: string) => s.toLowerCase();

export function marketKey(contract: string, marketId: string): string {
  return `${lc(contract)}:${lc(marketId)}`;
}

function cloneState(s: ReputationState): ReputationState {
  const agents: Record<string, AgentRecord> = {};
  for (const [k, v] of Object.entries(s.agents)) agents[k] = { ...v };
  const open: Record<string, OpenMarket> = {};
  for (const [k, v] of Object.entries(s.open)) open[k] = { ...v };
  return { agents, open };
}

const rec = (s: ReputationState, agent: string): AgentRecord =>
  (s.agents[agent] ??= { score: 0n, caught: false, settledMarkets: 0 });

/**
 * Fold events into a prior state. Resumable: fold(fold(S, a), b) == fold(S, a ++ b)
 * whenever every event of `b` comes after every event of `a` (the indexer's
 * cursor guarantees that). The prior is never mutated.
 */
export function foldReputation(prior: ReputationState, events: readonly ReputationEvent[]): ReputationState {
  const s = cloneState(prior);
  const ordered = [...events].sort((a, b) => a.block - b.block || a.seq - b.seq);
  for (const e of ordered) {
    switch (e.kind) {
      case "created": {
        // Markets never change agent; a duplicate create is ignored.
        const k = lc(e.market);
        if (!s.open[k]) s.open[k] = { agent: lc(e.agent), feed: lc(e.feed), volume: 0n };
        break;
      }
      case "trade": {
        // A trade on a market we never saw created cannot be attributed — it is
        // dropped rather than guessed onto some agent.
        const m = s.open[lc(e.market)];
        if (m && e.volume > 0n) m.volume += e.volume;
        break;
      }
      case "resolved": {
        const k = lc(e.market);
        const m = s.open[k];
        if (!m) break;
        delete s.open[k];
        const r = rec(s, m.agent);
        r.settledMarkets += 1;
        // After a catch, only markets resolved after the ruling's block count.
        if (r.caught && r.caughtAt !== undefined && e.block <= r.caughtAt) break;
        r.score += m.volume;
        break;
      }
      case "voided":
        delete s.open[lc(e.market)];
        break;
      case "invalidated": {
        const r = rec(s, lc(e.agent));
        r.score = 0n;
        r.caught = true;
        r.caughtAt = e.block;
        r.lastDisputeId = lc(e.disputeId);
        if (e.tx) r.caughtTx = lc(e.tx);
        else delete r.caughtTx;
        break;
      }
    }
  }
  return s;
}

/** Dispute.DisputeOutcome */
export const DISPUTE_OUTCOME = { Pending: 0, AttestationValid: 1, AttestationInvalid: 2 } as const;

/**
 * Join Dispute.Resolved → Dispute.Challenged → Attestation.Attested into
 * `invalidated` events. Only AttestationInvalid rulings produce one; a ruling
 * whose dispute or attestation cannot be traced is returned in `unresolved`
 * rather than silently dropped.
 */
export function invalidationsFromRulings(
  rulings: readonly { disputeId: string; outcome: number; block: number; seq: number; tx?: string }[],
  attestationOf: (disputeId: string) => string | undefined,
  agentOf: (attestationId: string) => string | undefined,
): { events: ReputationEvent[]; unresolved: string[] } {
  const events: ReputationEvent[] = [];
  const unresolved: string[] = [];
  for (const r of rulings) {
    if (r.outcome !== DISPUTE_OUTCOME.AttestationInvalid) continue;
    const attestationId = attestationOf(lc(r.disputeId));
    const agent = attestationId ? agentOf(lc(attestationId)) : undefined;
    if (!attestationId || !agent) {
      unresolved.push(lc(r.disputeId));
      continue;
    }
    events.push({
      kind: "invalidated",
      block: r.block,
      seq: r.seq,
      agent: lc(agent),
      disputeId: lc(r.disputeId),
      attestationId: lc(attestationId),
      tx: r.tx,
    });
  }
  return { events, unresolved };
}

/** A market's volume contribution: buys count collateralIn, sells collateralOut + fee. */
export function tradeVolume(t: { kind: "buy"; collateralIn: bigint } | { kind: "sell"; collateralOut: bigint; fee: bigint }): bigint {
  return t.kind === "buy" ? t.collateralIn : t.collateralOut + t.fee;
}

// ───────────────────────────── JSON form ─────────────────────────────

export interface AgentRecordJson {
  score: string;
  level: Level;
  caught: boolean;
  caughtAt: number | null;
  lastDisputeId: string | null;
  caughtTx: string | null;
  settledMarkets: number;
}

export interface ReputationStateJson {
  agents: Record<string, AgentRecordJson>;
  open: Record<string, { agent: string; feed: string; volume: string }>;
}

const sortedKeys = <T,>(o: Record<string, T>) => Object.keys(o).sort();

export function agentRecordJson(r: AgentRecord): AgentRecordJson {
  return {
    score: r.score.toString(),
    level: levelOf(r.score, r.caught),
    caught: r.caught,
    caughtAt: r.caughtAt ?? null,
    lastDisputeId: r.lastDisputeId ?? null,
    caughtTx: r.caughtTx ?? null,
    settledMarkets: r.settledMarkets,
  };
}

/** JSON-safe, key-sorted (so two equal states serialize identically). */
export function serializeReputation(s: ReputationState): ReputationStateJson {
  const agents: Record<string, AgentRecordJson> = {};
  for (const k of sortedKeys(s.agents)) agents[k] = agentRecordJson(s.agents[k]);
  const open: ReputationStateJson["open"] = {};
  for (const k of sortedKeys(s.open)) {
    const m = s.open[k];
    open[k] = { agent: m.agent, feed: m.feed, volume: m.volume.toString() };
  }
  return { agents, open };
}

export function parseReputation(j: ReputationStateJson | undefined | null): ReputationState {
  if (!j) return { agents: {}, open: {} };
  const agents: Record<string, AgentRecord> = {};
  for (const [k, v] of Object.entries(j.agents ?? {})) {
    agents[lc(k)] = {
      score: BigInt(v.score),
      caught: Boolean(v.caught),
      ...(v.caughtAt !== null && v.caughtAt !== undefined ? { caughtAt: v.caughtAt } : {}),
      ...(v.lastDisputeId ? { lastDisputeId: v.lastDisputeId } : {}),
      ...(v.caughtTx ? { caughtTx: v.caughtTx } : {}),
      settledMarkets: v.settledMarkets ?? 0,
    };
  }
  const open: Record<string, OpenMarket> = {};
  for (const [k, v] of Object.entries(j.open ?? {})) {
    open[lc(k)] = { agent: lc(v.agent), feed: lc(v.feed), volume: BigInt(v.volume) };
  }
  return { agents, open };
}

// ───────────────────────────── snapshot (live-data.json) ─────────────────────────────

/** Bump when the fold or the cursor changes shape or meaning: an older cursor is
 *  rescanned from the anchor, never resumed. */
export const REPUTATION_CURSOR_VERSION = 1;

export interface ReputationContractsStamp {
  MarketsPerennial: string | null;
  MarketsV4: string | null;
  Attestation: string;
  Dispute: string;
}

export interface ReputationCursor {
  version: number;
  chainId: number;
  contracts: ReputationContractsStamp;
  /** First block the fold covers. */
  fromBlock: string;
  /** Last block folded, inclusive. */
  lastScannedBlock: string;
  state: ReputationStateJson;
  /** disputeId → attestationId, from Challenged (a ruling may land a run later). */
  challenges: Record<string, string>;
  /** attestationId → agent, for challenged attestations only. */
  attesters: Record<string, string>;
}

export interface ReputationSnapshot {
  agents: Record<string, AgentRecordJson>;
  cursor: ReputationCursor;
}

/**
 * The snapshot, only if it describes this chain and this market contract. A
 * testnet snapshot must never speak for mainnet, and a cursor from an older
 * fold version is not trusted. null = no usable snapshot (the UI then shows the
 * live bond/coverage and says reputation isn't indexed).
 */
export function snapshotFor(
  raw: unknown,
  want: { chainId: number; market?: string | null },
): ReputationSnapshot | null {
  const r = raw as Partial<ReputationSnapshot> | undefined | null;
  const c = r?.cursor;
  if (!r || !c || typeof r.agents !== "object" || r.agents === null) return null;
  if (c.version !== REPUTATION_CURSOR_VERSION || c.chainId !== want.chainId) return null;
  if (want.market) {
    const m = lc(want.market);
    const stamped = [c.contracts?.MarketsPerennial, c.contracts?.MarketsV4].filter(Boolean).map((x) => lc(x!));
    if (!stamped.includes(m)) return null;
  }
  return r as ReputationSnapshot;
}

/** Snapshot's open markets of (contract, agent, feed) — ids only. */
export function openMarketsFor(snap: ReputationSnapshot | null, contract: string, agent: string, feed: string): string[] {
  if (!snap) return [];
  const prefix = `${lc(contract)}:`;
  const out: string[] = [];
  for (const [k, m] of Object.entries(snap.cursor.state.open ?? {})) {
    if (k.startsWith(prefix) && lc(m.agent) === lc(agent) && lc(m.feed) === lc(feed)) out.push(k.slice(prefix.length));
  }
  return out;
}

/** Leaderboard rows: score desc, then settled markets desc, then address. */
export function leaderboard(snap: { agents: Record<string, AgentRecordJson> } | null | undefined): Array<AgentRecordJson & { agent: string }> {
  if (!snap) return [];
  return Object.entries(snap.agents)
    .map(([agent, r]) => ({ ...r, agent }))
    .sort((a, b) => {
      const d = BigInt(b.score) - BigInt(a.score);
      if (d !== 0n) return d > 0n ? 1 : -1;
      return b.settledMarkets - a.settledMarkets || a.agent.localeCompare(b.agent);
    });
}

// ───────────────────────────── assessment (UI) ─────────────────────────────

export interface FreshCatch {
  disputeId: string;
  block: number;
  tx?: string;
}

export interface AgentAssessment {
  /** false = no snapshot (or not indexed); level/score then assume a new agent. */
  indexed: boolean;
  score: bigint;
  level: Level;
  caught: boolean;
  caughtTx?: string;
  disputeId?: string;
  settledMarkets: number;
  /** Undefined when the deployment can't tell (legacy: no collateralOf) — hide coverage. */
  openCollateral?: bigint;
  bond?: bigint;
  recommended?: bigint;
  coverage?: number;
  coveragePct?: number | null;
  tier?: CoverageTier;
}

/**
 * Combine the build-time snapshot with live reads. A fresh AttestationInvalid
 * ruling found after the snapshot's cursor wipes the score just as the fold
 * would. Without a snapshot the agent is treated as a new agent (level 1, 1.0×)
 * — unknown history earns no discount.
 */
export function assessAgent(input: {
  record?: AgentRecordJson | null;
  indexed: boolean;
  fresh?: FreshCatch | null;
  bond?: bigint;
  openCollateral?: bigint;
}): AgentAssessment {
  const r = input.record;
  let score = r ? BigInt(r.score) : 0n;
  let caught = r?.caught ?? false;
  let caughtTx = r?.caughtTx ?? undefined;
  let disputeId = r?.lastDisputeId ?? undefined;
  if (input.fresh) {
    score = 0n;
    caught = true;
    caughtTx = input.fresh.tx;
    disputeId = input.fresh.disputeId;
  }
  const level = levelOf(score, caught);
  const out: AgentAssessment = {
    indexed: input.indexed,
    score,
    level,
    caught,
    caughtTx,
    disputeId,
    settledMarkets: r?.settledMarkets ?? 0,
  };
  if (input.openCollateral !== undefined && input.bond !== undefined) {
    const recommended = recommendedBond(input.openCollateral, level);
    out.openCollateral = input.openCollateral;
    out.bond = input.bond;
    out.recommended = recommended;
    out.coverage = coverage(input.bond, recommended);
    out.coveragePct = coveragePct(input.bond, recommended);
    out.tier = coverageTier(input.bond, recommended);
  } else if (input.bond !== undefined) {
    out.bond = input.bond;
  }
  return out;
}

// ───────────────────────────── copy ─────────────────────────────

/** "$12,345.67" — whole-dollar grouping, cents floored. */
export function usd(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / USDC).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = dp > 0 ? `.${(a % USDC).toString().padStart(6, "0").slice(0, dp)}` : "";
  return `${neg ? "-" : ""}$${whole}${frac}`;
}

export const CAUGHT_BANNER = "This market's agent gave a proven wrong answer on another market";

/**
 * The coverage warning, with the exact numbers — or undefined when fully
 * covered (or coverage can't be computed).
 */
export function coverageWarning(a: Pick<AgentAssessment, "tier" | "bond" | "recommended" | "openCollateral" | "coveragePct" | "level">): string | undefined {
  if (!a.tier || a.tier === "full" || a.bond === undefined || a.recommended === undefined || a.openCollateral === undefined) return undefined;
  const word = a.tier === "thin" ? "thinly covered" : "partially covered";
  return (
    `This agent's bond is ${word}: ${usd(a.bond)} bonded vs ${usd(a.recommended)} recommended ` +
    `(${a.coveragePct ?? 0}%) for ${usd(a.openCollateral)} open on this feed at level ${a.level} (${multiplierLabel(a.level)}).`
  );
}

/** Short coverage label for the badge. */
export function coverageLabel(a: Pick<AgentAssessment, "tier" | "coveragePct">): string | undefined {
  if (!a.tier) return undefined;
  if (a.coveragePct === null || a.coveragePct === undefined) return "fully covered · nothing at risk";
  return `${a.coveragePct.toLocaleString("en-US")}% covered`;
}
