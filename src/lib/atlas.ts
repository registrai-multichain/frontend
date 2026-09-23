/**
 * Atlas aggregation. Pure functions only — no chain access, no fetch — so the
 * density and scaling rules are testable without a node.
 *
 * Country is SELF-DECLARED and unverified. Everything here treats it as
 * decoration: it never gates a payout and it lives in its own field so the UI
 * can label it differently from the verified on-chain numbers beside it.
 */

export type BuilderAggregate = {
  builderId: number;
  address: string;
  /** Summed from ProgressAdded events — NOT progressWeight, which resets each epoch. */
  lifetimeProgress: number;
  /** Trade notional across every market tagged to this builder, in USDC base units (6dp). */
  volume: bigint;
  /** ISO-3166-1 alpha-2, or null when the builder has not declared one. */
  country: string | null;
};

export type CountryCell = {
  code: string;
  builders: number;
  progress: number;
  volume: bigint;
  /** True for the catch-all cell holding undeclared and below-floor builders. */
  suppressed: boolean;
};

/**
 * Disclosure control. A country rendered with one builder effectively publishes
 * that person's approximate location — builders are bound to a public repo, so
 * the cell is close to a name. Below this floor a country folds into the
 * unattributed cell instead of being drawn.
 */
export const MIN_BUILDERS_PER_CELL = 3;

/** Catch-all cell code for undeclared and suppressed builders. */
export const UNATTRIBUTED = "??";

export function aggregateByCountry(builders: BuilderAggregate[]): CountryCell[] {
  const byCode = new Map<string, CountryCell>();

  for (const b of builders) {
    const code = b.country ?? UNATTRIBUTED;
    const cell =
      byCode.get(code) ??
      { code, builders: 0, progress: 0, volume: 0n, suppressed: false };
    cell.builders += 1;
    cell.progress += b.lifetimeProgress;
    cell.volume += b.volume;
    byCode.set(code, cell);
  }

  const out: CountryCell[] = [];
  const unattributed: CountryCell = {
    code: UNATTRIBUTED,
    builders: 0,
    progress: 0,
    volume: 0n,
    suppressed: true,
  };

  for (const cell of byCode.values()) {
    if (cell.code === UNATTRIBUTED || cell.builders < MIN_BUILDERS_PER_CELL) {
      unattributed.builders += cell.builders;
      unattributed.progress += cell.progress;
      unattributed.volume += cell.volume;
      continue;
    }
    out.push(cell);
  }

  if (unattributed.builders > 0) out.push(unattributed);
  return out.sort((a, b) => b.builders - a.builders);
}

/**
 * Steepness of the density curve. `log1p(ratio * K) / log1p(K)` maps 0→0 and
 * 1→1, and the larger K is the more the low end is lifted. K = 99 puts a
 * country holding a tenth of the builders at roughly half brightness rather
 * than at the floor.
 *
 * This matters more than it looks: with one country dominating, a linear scale
 * (and a shallow log — `log1p(ratio * (e-1))` was the first attempt) rounds
 * every other cell to zero and the map reads as empty when it is not.
 */
const DENSITY_CURVE = 99;

/**
 * Five brightness steps, log-scaled. Returns 0..4.
 */
export function densityBucket(builders: number, max: number): number {
  if (builders <= 0 || max <= 0) return 0;
  const ratio = Math.min(builders / max, 1);
  const scaled = Math.log1p(ratio * DENSITY_CURVE) / Math.log1p(DENSITY_CURVE);
  return Math.max(0, Math.min(4, Math.round(scaled * 4)));
}

export type DeclaredMeta = Record<string, { country?: string }>;

/**
 * Overlay self-declared metadata onto chain-derived aggregates. Returns new
 * objects — callers hold chain-derived data that must not be mutated.
 *
 * A country is accepted only as a two-letter code; anything else is dropped
 * rather than guessed at, because a wrong flag is worse than no flag.
 */
export function mergeDeclaredMeta(
  builders: BuilderAggregate[],
  meta: DeclaredMeta,
): BuilderAggregate[] {
  return builders.map((b) => {
    const declared = meta[b.address.toLowerCase()]?.country;
    const country =
      declared && /^[A-Za-z]{2}$/.test(declared) ? declared.toUpperCase() : null;
    return { ...b, country };
  });
}

export type PerennialMarket = {
  marketId: string;
  builderId: number;
  expiry: number;
  phase: "trading" | "resolved" | "voided";
  yesWon: boolean;
  /** CPMM reserves, USDC base units, as decimal strings (bigint is not JSON-safe). */
  yesReserve: string;
  noReserve: string;
};

/**
 * CPMM implied probability of YES.
 *
 * Buying YES adds collateral to both reserves then removes the bought shares
 * from yesReserve, so a DRAINED yes side means the crowd is betting yes:
 * P(yes) = no / (yes + no).
 */
export function impliedYes(yesReserve: bigint, noReserve: bigint): number {
  const total = yesReserve + noReserve;
  if (total === 0n) return 0.5;
  return Number(noReserve) / Number(total);
}

export function marketsForBuilders(
  markets: PerennialMarket[],
  builderIds: number[],
): PerennialMarket[] {
  const wanted = new Set(builderIds);
  return markets.filter((m) => wanted.has(m.builderId));
}
