/**
 * Verified progress for the atlas and the season boards, from the milestone
 * feeds — pure.
 *
 * Progress used to be summed from ProgressPool.ProgressAdded (bonded progress
 * weights). The pool is gone (spec 2026-09-24-builder-income-tax-design.md);
 * what remains on chain is the milestone feed of each verified project
 * (`registrai-milestone:<source>`), whose value the operator attests: the
 * project's count of verified artifacts (releases and tags, or contracts its
 * deployers create). A builder's progress is therefore:
 *
 *   lifetime   = the sum, over its project feeds, of the latest attested count;
 *   per season = the sum of the count's increases attested inside the season
 *                (a first reading counts from 0; a lower reading adds nothing).
 *
 * Folded incrementally from Attestation.Attested logs (agent = the operator),
 * so scripts/sync.ts can carry the state in its cursor.
 */

export interface MilestoneReading {
  feedId: string;
  value: bigint;
  block: number;
  /** Log index, for ordering within a block. */
  seq: number;
}

export interface MilestoneState {
  /** feedId (lowercase) -> latest attested value (decimal string). */
  latestByFeed: Record<string, string>;
  /** seasonId -> builder owner (lowercase) -> progress attested in the season. */
  bySeason: Record<string, Record<string, number>>;
}

export const EMPTY_MILESTONES: MilestoneState = { latestByFeed: {}, bySeason: {} };

export interface SeasonBlocks {
  id: number;
  startBlock: number;
  endBlock: number | null;
}

/** Fold readings (any order; sorted here) into a new state. `ownerOf` maps a
 *  feed to the builder owner it belongs to (undefined: not a builder's feed). */
export function foldMilestones(
  prev: MilestoneState,
  readings: readonly MilestoneReading[],
  ownerOf: (feedId: string) => string | undefined,
  seasons: readonly SeasonBlocks[],
): MilestoneState {
  const latestByFeed = { ...prev.latestByFeed };
  const bySeason: MilestoneState["bySeason"] = Object.fromEntries(Object.entries(prev.bySeason).map(([k, v]) => [k, { ...v }]));
  const sorted = [...readings].sort((a, b) => a.block - b.block || a.seq - b.seq);
  for (const r of sorted) {
    const feed = r.feedId.toLowerCase();
    const before = BigInt(latestByFeed[feed] ?? "0");
    latestByFeed[feed] = r.value.toString();
    const owner = ownerOf(feed)?.toLowerCase();
    if (!owner || r.value <= before) continue;
    const season = seasons.find((s) => r.block >= s.startBlock && (s.endBlock === null || r.block <= s.endBlock));
    if (!season) continue;
    const board = (bySeason[String(season.id)] ??= {});
    board[owner] = (board[owner] ?? 0) + Number(r.value - before);
  }
  return { latestByFeed, bySeason };
}

/** Lifetime progress of one builder: the latest count of each of its feeds, summed. */
export function lifetimeProgress(state: MilestoneState, feeds: readonly (string | null | undefined)[]): number {
  let n = 0;
  for (const f of new Set(feeds.filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase()))) {
    const v = Number(state.latestByFeed[f] ?? "0");
    if (v > 0) n += v;
  }
  return n;
}
