/**
 * Rotating competition seasons.
 *
 * A season is a block range and nothing more. Every score here is a windowed
 * re-aggregation of events the deployed contracts already emit, so seasons cost
 * no contract changes, no migration and no new trust assumptions — and a past
 * season can be recomputed from chain by anyone who disagrees with the numbers.
 *
 * Nothing in this file may gate a payout. The boards are a scoreboard; the
 * country board in particular is built on self-declared, unverified data.
 */

import { MIN_BUILDERS_PER_CELL, UNATTRIBUTED } from "./atlas";

export type Season = {
  id: number;
  label: string;
  /** First block of the season, inclusive. */
  startBlock: number;
  /** Last block, inclusive. null while the season is still running. */
  endBlock: number | null;
  startedAt: number;
  endsAt: number;
};

export const SEASON_DAYS = 28;

const DAY = 86_400;

/**
 * The season calendar from a fixed anchor to now: back-to-back windows of
 * SEASON_DAYS, the last one still running.
 *
 * Time, not block height, defines a season — Arc's block time is regular but
 * not guaranteed, and "Season 3 ends on the 14th" has to stay true even if the
 * chain drifts. Sync resolves each boundary to an actual block afterwards.
 */
export function seasonWindows(
  anchoredAt: number,
  now: number,
  days = SEASON_DAYS,
): Array<{ id: number; label: string; startedAt: number; endsAt: number }> {
  const span = days * DAY;
  const elapsed = Math.max(0, now - anchoredAt);
  const count = Math.floor(elapsed / span) + 1;
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Season ${i + 1}`,
    startedAt: anchoredAt + i * span,
    endsAt: anchoredAt + (i + 1) * span,
  }));
}

/** Fraction of the current season elapsed, 0..1. */
export function seasonElapsed(season: { startedAt: number; endsAt: number }, now: number): number {
  const span = season.endsAt - season.startedAt;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (now - season.startedAt) / span));
}

/** The season a block falls in, or null if it precedes every season. */
export function seasonAt(block: number, seasons: Season[]): Season | null {
  for (const s of seasons) {
    if (block >= s.startBlock && (s.endBlock === null || block <= s.endBlock)) return s;
  }
  return null;
}

/* ── trader realised P&L ─────────────────────────────────────────────────── */

export type Trade =
  | {
      kind: "buy" | "sell";
      block: number;
      seq: number;
      trader: string;
      marketId: string;
      /**
       * Matches `enum Outcome { Yes, No }` in MarketsPerennial — so 0 is YES and
       * 1 is NO. Worth stating: the intuitive reading is the opposite one, and
       * getting it backwards inverts every trader's result at resolution
       * without failing anything obvious.
       */
      outcome: number;
      /** Buy: gross collateral paid, fee included. Sell: net proceeds received. */
      collateral: bigint;
      shares: bigint;
    }
  | { kind: "resolve"; block: number; seq: number; marketId: string; yesWon: boolean };

/** MarketsPerennial declares `enum Outcome { Yes, No }`, so YES is zero. */
export const OUTCOME_YES = 0;

type Position = { shares: bigint; cost: bigint };

/**
 * Everything the P&L fold needs to resume, in a JSON-safe shape.
 *
 * Seasons replay the whole trade history in order, which on Arc is hundreds of
 * thousands of blocks. Carrying this state between syncs turns that into a fold
 * over only the new logs — and because the fold is associative over ordered
 * input, resuming gives byte-identical results to a cold replay.
 */
export type PnlState = {
  /** "marketId|trader|outcome" -> position. */
  positions: Record<string, { shares: string; cost: string }>;
  /** seasonId -> trader -> realised, all as strings; bigint is not JSON. */
  realised: Record<string, Record<string, string>>;
};

export const EMPTY_PNL: PnlState = { positions: {}, realised: {} };

/**
 * Fold trades into P&L state. Two events realise a gain or loss, and both are
 * booked to the season they happened in:
 *
 *   SELL      proceeds - (average cost of the shares sold)
 *   RESOLVE   winning shares redeem 1:1, so the position is worth its share
 *             count; the losing side is worth nothing. Booked at resolution
 *             rather than at `Redeemed`, because a trader who never bothers to
 *             redeem has still made the money — and one holding the losing side
 *             would otherwise never book the loss at all.
 *
 * Fees need no special handling: a buy's `collateralIn` is gross and a sell's
 * `collateralOut` is net, so both sit on the trader's side of the ledger
 * already.
 */
export function foldTrades(prior: PnlState, trades: Trade[], seasons: Season[]): PnlState {
  const positions = new Map<string, Position>(
    Object.entries(prior.positions).map(([k, v]) => [k, { shares: BigInt(v.shares), cost: BigInt(v.cost) }]),
  );
  const realised = new Map<number, Map<string, bigint>>(
    Object.entries(prior.realised).map(([sid, board]) => [
      Number(sid),
      new Map(Object.entries(board).map(([addr, v]) => [addr, BigInt(v)])),
    ]),
  );

  const book = (block: number, trader: string, delta: bigint) => {
    const s = seasonAt(block, seasons);
    if (!s || delta === 0n) return;
    let board = realised.get(s.id);
    if (!board) realised.set(s.id, (board = new Map()));
    board.set(trader, (board.get(trader) ?? 0n) + delta);
  };

  // Chronological order is not optional: an average-cost basis is path
  // dependent, so replaying out of order silently produces wrong numbers.
  const ordered = [...trades].sort((a, b) => a.block - b.block || a.seq - b.seq);

  for (const t of ordered) {
    if (t.kind === "resolve") {
      for (const [key, pos] of [...positions]) {
        const [marketId, trader, outcomeStr] = key.split("|");
        if (marketId !== t.marketId) continue;
        const won = (Number(outcomeStr) === OUTCOME_YES) === t.yesWon;
        book(t.block, trader, won ? pos.shares - pos.cost : -pos.cost);
        positions.delete(key);
      }
      continue;
    }

    const key = `${t.marketId}|${t.trader}|${t.outcome}`;
    const pos = positions.get(key) ?? { shares: 0n, cost: 0n };

    if (t.kind === "buy") {
      positions.set(key, { shares: pos.shares + t.shares, cost: pos.cost + t.collateral });
      continue;
    }

    // Sell. Guard against selling more than we saw bought — possible when the
    // scan window opens mid-history — by treating the unexplained shares as
    // zero-cost rather than inventing a basis.
    const sold = t.shares > pos.shares ? pos.shares : t.shares;
    const basis = pos.shares > 0n ? (pos.cost * sold) / pos.shares : 0n;
    book(t.block, t.trader, t.collateral - basis);
    positions.set(key, { shares: pos.shares - sold, cost: pos.cost - basis });
  }

  return {
    positions: Object.fromEntries(
      [...positions]
        // A closed position carries no information; dropping it keeps the
        // cursor from growing without bound as markets resolve.
        .filter(([, v]) => v.shares !== 0n || v.cost !== 0n)
        .map(([k, v]) => [k, { shares: v.shares.toString(), cost: v.cost.toString() }]),
    ),
    realised: Object.fromEntries(
      [...realised].map(([sid, board]) => [
        String(sid),
        Object.fromEntries([...board].map(([addr, v]) => [addr, v.toString()])),
      ]),
    ),
  };
}

/** Full replay from nothing. Convenience over {@link foldTrades}. */
export function realisedPnl(trades: Trade[], seasons: Season[]): Map<number, Map<string, bigint>> {
  const state = foldTrades(EMPTY_PNL, trades, seasons);
  return new Map(
    Object.entries(state.realised).map(([sid, board]) => [
      Number(sid),
      new Map(Object.entries(board).map(([addr, v]) => [addr, BigInt(v)])),
    ]),
  );
}

/* ── boards ──────────────────────────────────────────────────────────────── */

export type BoardRow = { key: string; label: string; value: bigint; detail?: string };

/** Descending by value, ties broken by key so the order is stable across syncs. */
export function rank(rows: BoardRow[], limit = 25): BoardRow[] {
  return [...rows]
    .filter((r) => r.value !== 0n)
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : a.key.localeCompare(b.key)))
    .slice(0, limit);
}

export type SeasonProgress = { builderId: number; address: string; country: string | null; progress: number };

export function builderBoard(rows: SeasonProgress[], limit = 25): BoardRow[] {
  return rank(
    rows.map((r) => ({
      key: String(r.builderId),
      label: `builder #${r.builderId}`,
      value: BigInt(r.progress),
      detail: r.address,
    })),
    limit,
  );
}

/**
 * Country board. Carries the same disclosure floor as the atlas: a country with
 * fewer than MIN_BUILDERS_PER_CELL builders is folded into the unattributed
 * bucket rather than named, because a one-builder country publishes where that
 * person lives. Country is self-declared and unverified, so this board can never
 * decide a reward.
 */
export function countryBoard(rows: SeasonProgress[], limit = 25): BoardRow[] {
  const byCountry = new Map<string, { progress: number; builders: number }>();
  for (const r of rows) {
    const code = r.country ?? UNATTRIBUTED;
    const cur = byCountry.get(code) ?? { progress: 0, builders: 0 };
    byCountry.set(code, { progress: cur.progress + r.progress, builders: cur.builders + 1 });
  }

  let hidden = { progress: 0, builders: 0 };
  const named: BoardRow[] = [];
  for (const [code, agg] of byCountry) {
    if (code === UNATTRIBUTED || agg.builders < MIN_BUILDERS_PER_CELL) {
      hidden = { progress: hidden.progress + agg.progress, builders: hidden.builders + agg.builders };
      continue;
    }
    named.push({
      key: code,
      label: code,
      value: BigInt(agg.progress),
      detail: `${agg.builders} builder${agg.builders === 1 ? "" : "s"}`,
    });
  }

  const board = rank(named, limit);
  if (hidden.builders > 0) {
    board.push({
      key: UNATTRIBUTED,
      label: "unattributed",
      value: BigInt(hidden.progress),
      detail: `${hidden.builders} builder${hidden.builders === 1 ? "" : "s"}`,
    });
  }
  return board;
}

export function traderBoard(pnl: Map<string, bigint>, limit = 25): BoardRow[] {
  return rank(
    [...pnl].map(([addr, v]) => ({ key: addr, label: addr, value: v })),
    limit,
  );
}
