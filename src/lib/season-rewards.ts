/**
 * Season rewards, distribution rule v1 ("building progress traders
 * confirmed") — pure. Spec: docs/superpowers/specs/2026-09-24-builder-income-tax-design.md
 * ("SeasonPool"). scripts/season-rewards.ts does the chain reads; everything
 * that decides who gets what is here, so it is unit-tested and anyone can
 * re-derive a published root.
 *
 *  - eligible: builders verified (caretaker = the operator, an active builder
 *    with an active project) holding a non-lapsed Verified Builder Badge at
 *    the season's last block;
 *  - points: for each MarketsPerennial market on one of the builder's project
 *    milestone feeds (`registrai-milestone:<source>`, created by the operator)
 *    that RESOLVED YES inside the season with at least $500 of counted volume,
 *    sqrt(volume in USD). Counted volume is every Bought (collateralIn) and
 *    Sold (collateralOut + fee: the gross curve amount) of the market, except
 *    trades by the builder's owner wallet, the market's creator and its agent;
 *  - allocation: pro rata by points, at most 20% of the season total per
 *    builder (SeasonPool.CAP_BPS), the excess re-spread over the uncapped until
 *    stable; each amount floored to the 6-decimal unit. The rounding dust (and
 *    anything the cap leaves unassignable, e.g. with fewer than five builders)
 *    is claimed by no one: it stays in the season until the Safe reclaims it to
 *    the unallocated balance after the deadline.
 *
 * All arithmetic is bigint: points are sqrt(USD) with 6 decimals, floored
 * (isqrt(volumeUnits * 1e6)), so the output is bit-for-bit reproducible.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { isqrt } from "./perennial-market";

export const RULE_VERSION = "v1";
/** Minimum counted volume of a market for points: $500 (6-decimal USDC). */
export const MIN_MARKET_VOLUME = 500_000_000n;
/** SeasonPool.CAP_BPS */
export const CAP_BPS = 2_000n;
const BPS = 10_000n;
export const LEAF_ENCODING = ["uint256", "uint256", "uint256"] as const;

// ───────────────────────────── points ─────────────────────────────

export interface Trade {
  marketId: string;
  trader: string;
  /** Gross USDC of the trade: Bought.collateralIn, or Sold.collateralOut + fee. */
  gross: bigint;
}

export interface MarketFacts {
  marketId: string;
  builderId: number;
  feedId: string;
  creator: string;
  agent: string;
  /** Resolved inside the season with YES winning. */
  resolvedYesInSeason: boolean;
}

/** sqrt(volume in USD), 6 decimals, floored: isqrt(volumeUnits * 1e6). */
export function volumePoints(volumeUnits: bigint): bigint {
  return volumeUnits <= 0n ? 0n : isqrt(volumeUnits * 1_000_000n);
}

/** A market's counted volume: every trade except the builder owner's, the creator's and the agent's. */
export function countedVolume(trades: readonly Trade[], excluded: readonly string[]): bigint {
  const skip = new Set(excluded.map((a) => a.toLowerCase()));
  let v = 0n;
  for (const t of trades) if (!skip.has(t.trader.toLowerCase())) v += t.gross;
  return v;
}

export interface EligibleBuilder {
  builderId: number;
  owner: string;
  /** The milestone feeds of the builder's projects (lowercase or not). */
  feeds: string[];
}

export interface MarketScore {
  marketId: string;
  builderId: number;
  feedId: string;
  volume: bigint;
  points: bigint;
}

/**
 * Score every qualifying market: on an eligible builder's own project feed,
 * resolved YES in the season, counted volume ≥ $500. Returns builderId ->
 * points, plus the per-market detail (for the output file).
 */
export function scoreMarkets(
  builders: readonly EligibleBuilder[],
  markets: readonly MarketFacts[],
  tradesByMarket: ReadonlyMap<string, readonly Trade[]>,
  minVolume = MIN_MARKET_VOLUME,
): { points: Map<number, bigint>; markets: MarketScore[] } {
  const byId = new Map(builders.map((b) => [b.builderId, b]));
  const points = new Map<number, bigint>();
  const scored: MarketScore[] = [];
  const sorted = [...markets].sort((a, b) => (a.marketId.toLowerCase() < b.marketId.toLowerCase() ? -1 : 1));
  for (const m of sorted) {
    const b = byId.get(m.builderId);
    if (!b || !m.resolvedYesInSeason) continue;
    if (!b.feeds.some((f) => f.toLowerCase() === m.feedId.toLowerCase())) continue;
    const volume = countedVolume(tradesByMarket.get(m.marketId.toLowerCase()) ?? [], [b.owner, m.creator, m.agent]);
    if (volume < minVolume) continue;
    const p = volumePoints(volume);
    scored.push({ marketId: m.marketId.toLowerCase(), builderId: m.builderId, feedId: m.feedId.toLowerCase(), volume, points: p });
    points.set(m.builderId, (points.get(m.builderId) ?? 0n) + p);
  }
  return { points, markets: scored };
}

// ───────────────────────────── allocation ─────────────────────────────

export interface Allocation {
  builderId: number;
  points: bigint;
  amount: bigint;
  capped: boolean;
}

/** SeasonPool.capOf for a season total. */
export function capFor(total: bigint): bigint {
  return (total * CAP_BPS) / BPS;
}

/**
 * Pro rata by points with a per-builder cap, the excess re-spread over the
 * uncapped until no share exceeds the cap; amounts floored. Deterministic:
 * input order does not matter (rows come back by builderId). Builders with no
 * points get nothing and are left out.
 */
export function allocate(points: ReadonlyMap<number, bigint>, total: bigint, cap = capFor(total)): Allocation[] {
  if (total < 0n) throw new Error("total must be >= 0");
  const ids = [...points.keys()].filter((id) => (points.get(id) ?? 0n) > 0n).sort((a, b) => a - b);
  const capped = new Set<number>();
  let open = ids;
  let budget = total;
  // Each round caps at least one more builder, or ends.
  for (;;) {
    const sum = open.reduce((s, id) => s + points.get(id)!, 0n);
    if (sum === 0n) break;
    // share > cap  <=>  budget * p > cap * sum  (exact, before flooring)
    const over = open.filter((id) => budget * points.get(id)! > cap * sum);
    if (over.length === 0) break;
    for (const id of over) capped.add(id);
    budget -= cap * BigInt(over.length);
    open = open.filter((id) => !capped.has(id));
    if (budget <= 0n) { budget = 0n; break; }
  }
  const sum = open.reduce((s, id) => s + points.get(id)!, 0n);
  return ids.map((id) => {
    const p = points.get(id)!;
    if (capped.has(id)) return { builderId: id, points: p, amount: cap, capped: true };
    return { builderId: id, points: p, amount: sum === 0n ? 0n : (budget * p) / sum, capped: false };
  });
}

// ───────────────────────────── merkle ─────────────────────────────

/** SeasonPool.leafOf: keccak256(bytes.concat(keccak256(abi.encode(seasonId, builderId, amount)))). */
export function leafOf(seasonId: bigint, builderId: bigint, amount: bigint): Hex {
  const inner = keccak256(encodeAbiParameters(LEAF_ENCODING.map((type) => ({ type })), [seasonId, builderId, amount]));
  return keccak256(inner);
}

export interface SeasonTree {
  root: Hex;
  rows: { builderId: number; amount: bigint; leaf: Hex; proof: Hex[] }[];
}

/** OZ StandardMerkleTree over (seasonId, builderId, amount) — what SeasonPool.claim verifies. */
export function buildSeasonTree(seasonId: bigint, rows: readonly { builderId: number; amount: bigint }[]): SeasonTree {
  const paid = rows.filter((r) => r.amount > 0n).sort((a, b) => a.builderId - b.builderId);
  if (paid.length === 0) throw new Error("nothing to publish: no builder has an amount");
  const values = paid.map((r) => [seasonId.toString(), r.builderId.toString(), r.amount.toString()]);
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  return {
    root: tree.root as Hex,
    rows: paid.map((r, i) => ({ builderId: r.builderId, amount: r.amount, leaf: tree.leafHash(values[i]) as Hex, proof: tree.getProof(i) as Hex[] })),
  };
}

// ───────────────────────────── Safe transaction ─────────────────────────────

export const seasonPoolWriteAbi = parseAbi(["function publishSeason(uint256 seasonId, bytes32 root, uint256 total, uint64 deadline)"]);

/** A Safe Transaction Builder file with the one publishSeason call. */
export function publishSeasonSafeJson(o: {
  chainId: number;
  seasonPool: Address;
  seasonId: bigint;
  root: Hex;
  total: bigint;
  deadline: bigint;
  createdAt: number;
  description?: string;
}) {
  return {
    version: "1.0",
    chainId: String(o.chainId),
    createdAt: o.createdAt,
    meta: {
      name: `Registrai season ${o.seasonId} rewards`,
      description: o.description ?? `SeasonPool.publishSeason(${o.seasonId}, ${o.root}, ${o.total}, ${o.deadline})`,
      createdFromSafeAddress: "",
      createdFromOwnerAddress: "",
    },
    transactions: [
      {
        to: o.seasonPool,
        value: "0",
        data: encodeFunctionData({ abi: seasonPoolWriteAbi, functionName: "publishSeason", args: [o.seasonId, o.root, o.total, o.deadline] }),
      },
    ],
  };
}

// ───────────────────────────── season file ─────────────────────────────

export interface SeasonFileInput {
  seasonId: bigint;
  total: bigint;
  deadline: bigint;
  chainId: number;
  params: Record<string, unknown>;
  eligible: readonly EligibleBuilder[];
  scored: readonly MarketScore[];
  allocations: readonly Allocation[];
  tree: SeasonTree;
}

/** season-<N>.json: the root, the total, per-builder rows with points, amount and proof, and the parameters. */
export function seasonFile(i: SeasonFileInput) {
  const allocated = i.allocations.reduce((s, a) => s + a.amount, 0n);
  const byId = new Map(i.tree.rows.map((r) => [r.builderId, r]));
  return {
    season: i.seasonId.toString(),
    rule: RULE_VERSION,
    chainId: i.chainId,
    root: i.tree.root,
    total: i.total.toString(),
    allocated: allocated.toString(),
    unassigned: (i.total - allocated).toString(),
    capPerBuilder: capFor(i.total).toString(),
    deadline: i.deadline.toString(),
    leafEncoding: [...LEAF_ENCODING],
    params: i.params,
    builders: i.allocations.map((a) => {
      const b = i.eligible.find((e) => e.builderId === a.builderId);
      const t = byId.get(a.builderId);
      return {
        builderId: a.builderId,
        owner: b?.owner.toLowerCase() ?? null,
        points: a.points.toString(),
        amount: a.amount.toString(),
        capped: a.capped,
        leaf: t?.leaf ?? null,
        proof: t?.proof ?? [],
        markets: i.scored.filter((m) => m.builderId === a.builderId).map((m) => ({ marketId: m.marketId, feedId: m.feedId, volume: m.volume.toString(), points: m.points.toString() })),
      };
    }),
    eligible: i.eligible.map((e) => e.builderId),
  };
}
