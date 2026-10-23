/**
 * The builder economy of the Perennial markets — pure.
 * Spec: docs/superpowers/specs/2026-09-24-builder-income-tax-design.md;
 * contracts: BuilderFund + SeasonPool (contracts 5367015).
 *
 *  - Every buy and sell pays a 1% trading fee: 30% to the market creator
 *    (paid on the trade), 20% to the bonded agent (held until settlement; on a
 *    void it goes to the successful challenger, else the season pool), 50% to
 *    the builder the market is about, credited as that builder's income for
 *    the current epoch in the BuilderFund.
 *  - Once an epoch has ended, anyone may `claimFor(epoch, builderId)`:
 *      tax = progressiveTax(gross, the schedule of that epoch)  -> SeasonPool
 *      fee = 1% of (gross - tax)                                 -> protocol treasury
 *      net = gross - tax - fee                                   -> the builder's payout
 *  - The SeasonPool pays seasonal rewards from Safe-published merkle roots, at
 *    most 20% of a season's total to one builder.
 *
 * Every function here mirrors the contract's integer math exactly (floor
 * division per bracket slice), so what the site shows is what claimFor pays.
 */

/** One marginal bracket: the rate applies to the income slice up to `upTo`. */
export interface Bracket {
  /** Upper bound of the slice, 6-decimal USDC. The last is type(uint128).max. */
  upTo: bigint;
  /** Marginal rate on the slice, basis points. */
  rateBps: number;
}

export const BPS = 10_000n;
/** Registrai's 1% of every builder payout (of the after-tax income). */
export const PROTOCOL_FEE_BPS = 100n;
/** On-chain bound: no bracket above 40%. */
export const MAX_RATE_BPS = 4_000;
/** A new schedule applies SCHEDULE_DELAY epochs after the epoch it is set in. */
export const SCHEDULE_DELAY = 2n;
/** SeasonPool: one builder's claim may not exceed 20% of the season total. */
export const SEASON_CAP_BPS = 2_000n;
export const MAX_UINT128 = (1n << 128n) - 1n;
const USDC = 1_000_000n;

/** The launch schedule (contracts/script/lib/LaunchSchedule.sol): 0% to $1,000;
 *  10% to $10,000; 20% to $50,000; 30% above — per builder, per epoch. */
export const LAUNCH_SCHEDULE: readonly Bracket[] = [
  { upTo: 1_000n * USDC, rateBps: 0 },
  { upTo: 10_000n * USDC, rateBps: 1_000 },
  { upTo: 50_000n * USDC, rateBps: 2_000 },
  { upTo: MAX_UINT128, rateBps: 3_000 },
];

/** The fee split of MarketsPerennial (bps of the 1% fee). */
export const FEE_SPLIT = { tradeFeeBps: 100, creatorBps: 3_000, agentBps: 2_000, builderBps: 5_000 } as const;

/**
 * BuilderFund.progressiveTax, exactly: each rate applies to the slice of
 * income inside its bracket, floored per slice; income above the last `upTo`
 * is taxed at the last rate.
 */
export function progressiveTax(gross: bigint, brackets: readonly Bracket[]): bigint {
  let tax = 0n;
  let lower = 0n;
  const n = brackets.length;
  for (let i = 0; i < n && gross > lower; i++) {
    const last = i === n - 1;
    const upper = last ? null : brackets[i].upTo; // null = type(uint256).max
    const top = upper === null || gross < upper ? gross : upper;
    tax += ((top - lower) * BigInt(brackets[i].rateBps)) / BPS;
    if (upper === null) break;
    lower = upper;
  }
  return tax;
}

export interface IncomeSplit {
  gross: bigint;
  tax: bigint;
  fee: bigint;
  net: bigint;
}

/** BuilderFund._split: what claimFor pays out of `gross` under `brackets`. */
export function splitIncome(gross: bigint, brackets: readonly Bracket[]): IncomeSplit {
  const tax = progressiveTax(gross, brackets);
  const fee = ((gross - tax) * PROTOCOL_FEE_BPS) / BPS;
  return { gross, tax, fee, net: gross - tax - fee };
}

/** The rate on the next dollar of income at `gross` (the bracket it falls in;
 *  a gross exactly on a bound is taxed at the next bracket's rate). */
export function marginalRateBps(gross: bigint, brackets: readonly Bracket[]): number {
  for (let i = 0; i < brackets.length - 1; i++) {
    if (gross < brackets[i].upTo) return brackets[i].rateBps;
  }
  return brackets[brackets.length - 1]?.rateBps ?? 0;
}

/** tax / gross as a fraction (0 for no income). Display only. */
export function effectiveRate(s: Pick<IncomeSplit, "gross" | "tax">): number {
  return s.gross === 0n ? 0 : Number((s.tax * 1_000_000n) / s.gross) / 1_000_000;
}

export interface TaxRow {
  from: bigint;
  /** null = no upper bound (the last bracket). */
  to: bigint | null;
  rateBps: number;
  /** Tax on a fully used bracket (null for the unbounded last one). */
  bracketTax: bigint | null;
}

/** Display rows for a schedule. */
export function taxTable(brackets: readonly Bracket[]): TaxRow[] {
  let from = 0n;
  return brackets.map((b, i) => {
    const last = i === brackets.length - 1;
    const row: TaxRow = {
      from,
      to: last ? null : b.upTo,
      rateBps: b.rateBps,
      bracketTax: last ? null : ((b.upTo - from) * BigInt(b.rateBps)) / BPS,
    };
    from = b.upTo;
    return row;
  });
}

/** Normalise a schedule as viem returns it (`{upTo, rateBps}` with number or bigint rates). */
export function toBrackets(raw: readonly { upTo: bigint; rateBps: number | bigint }[]): Bracket[] {
  return raw.map((b) => ({ upTo: BigInt(b.upTo), rateBps: Number(b.rateBps) }));
}

/** The launch schedule's on-chain rule set (BuilderFund._validate), for tests and the admin. */
export function scheduleProblem(b: readonly Bracket[], minFreeUpTo = 100n * USDC): string | null {
  if (b.length === 0 || b.length > 8) return "1 to 8 brackets";
  if (b[0].rateBps !== 0 || b[0].upTo < minFreeUpTo) return "the first bracket must be 0% up to at least $100";
  if (b[b.length - 1].upTo !== MAX_UINT128) return "the last bracket must be unbounded";
  for (let i = 0; i < b.length; i++) {
    if (b[i].rateBps > MAX_RATE_BPS) return "no rate above 40%";
    if (i > 0 && b[i].upTo <= b[i - 1].upTo) return "bounds must increase";
    if (i > 0 && b[i].rateBps < b[i - 1].rateBps) return "rates must not decrease";
  }
  return null;
}

// ───────────────────────────── epochs ─────────────────────────────

/** BuilderFund.currentEpoch at chain time `t`. */
export function epochAt(t: bigint, start: bigint, length: bigint): bigint {
  return t <= start || length === 0n ? 0n : (t - start) / length;
}

/** BuilderFund.epochEnd: the first second after `epoch` (its income is claimable from then). */
export function epochEnd(epoch: bigint, start: bigint, length: bigint): bigint {
  return start + (epoch + 1n) * length;
}

/** "3d 4h", "5h 10m", "12m" — for "ends in". */
export function durationText(seconds: bigint | number): string {
  const s = Math.max(0, Number(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, s > 0 ? 1 : 0)}m`;
}

/** "$60,000.5" — 6-decimal USDC as dollars with thousands separators, `dp` decimals at most (trailing zeros trimmed). */
export function formatUsd(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / USDC).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (a % USDC).toString().padStart(6, "0").slice(0, dp).replace(/0+$/, "");
  return `${neg ? "-" : ""}$${whole}${frac ? `.${frac}` : ""}`;
}

/** SeasonPool.capOf: the largest amount one builder may claim from a season. */
export function seasonCap(total: bigint): bigint {
  return (total * SEASON_CAP_BPS) / BPS;
}

// ───────────────────────────── claimable epochs ─────────────────────────────

export interface EpochIncome extends IncomeSplit {
  epoch: bigint;
  /** claimed[epoch][builderId] — true after claimFor OR sweepFrozen. */
  claimed: boolean;
  /** The epoch has ended: claimFor may run (if not claimed). */
  ended: boolean;
  /** Frozen income swept to the season pool (from FrozenSwept), when known. */
  swept?: boolean;
  /** The payout address of the Claimed event, when known. */
  payout?: string;
}

export type EpochState = "open" | "claimable" | "claimed" | "swept";

export function epochState(e: Pick<EpochIncome, "claimed" | "ended" | "swept">): EpochState {
  if (e.swept) return "swept";
  if (e.claimed) return "claimed";
  return e.ended ? "claimable" : "open";
}
