/**
 * The points pilot's guarded SQL, in one place: lib/pilot.ts and lib/pilot-auth.ts run these, and
 * scripts/d1-guard-check.mjs runs the same strings against the remote D1 (on scratch copies of the tables)
 * before the pilot opens, to prove the changes()-guarded batches behave there as in the tests.
 * Ordered `?` parameters only (D1). No imports: the guard script loads this file directly.
 */

export const TABLES = [
  "accounts", "positions", "orders", "bars", "gaps", "funding", "mark", "used_nonces", "ratelimit",
  "rates", "ledger", "pools", "splits", "house_hours",
] as const;
export const INDEXES = ["positions_wallet", "positions_open", "positions_market", "orders_pending", "orders_wallet", "bars_l", "bars_h", "ledger_ref", "ledger_kind_ts"] as const;
/** Migration 0004 rebuilds these tables through a `<name>_v4` copy (the guard check prefixes those names too). */
export const REBUILT = ["mark", "bars", "gaps", "rates", "house_hours", "pools", "splits"] as const;
/** The migrations, in order (the guard check and the D1 test double apply all of them). */
export const MIGRATIONS = ["0001_pilot.sql", "0002_pilot_v3.sql", "0003_pilot_premium.sql", "0004_pilot_markets.sql"] as const;

/**
 * The guards (R4), each a row `g` that exists only for the batch that owns the event: a position settled under its
 * token, a rates / house_hours / splits row written by its post. Markets (migration 0004): a ledger row and its pool
 * take their market from that row (g.market), never from a separate bind, so an event is always booked in the market
 * it belongs to.
 */
const BY_SETTLE = "FROM positions g WHERE g.id = ? AND g.settle = ?";
const BY_RATES = "FROM rates g WHERE g.market = ? AND g.hour = ? AND g.post = ?";
const BY_HOUR = "FROM house_hours g WHERE g.market = ? AND g.hour = ? AND g.post = ?";
const BY_SPLIT = "FROM splits g WHERE g.market = ? AND g.week = ? AND g.post = ?";
/**
 * One ledger row plus the matching pools update, under the same guard. Ledger bind: ts, kind, amount, ref, …guard;
 * pools bind: amount, gross, kind, …guard (gross = 0 for the weekly split's own rows).
 */
const ledgerUnder = (guard: string) => `INSERT INTO ledger (ts, kind, amount, ref, market) SELECT ?, ?, ?, ?, g.market ${guard}`;
const poolUnder = (guard: string) => `UPDATE pools SET balance = balance + ?, gross = gross + ? WHERE kind = ? AND market = (SELECT g.market ${guard})`;
/** What the insurance of market `m` (an SQL expression) can cover of a loss `?`: never more than its balance, never below 0. */
const cover = (m: string) => `MIN(?, MAX(0, (SELECT COALESCE(SUM(i.balance), 0) FROM pools i WHERE i.market = ${m} AND i.kind IN ('split_insurance', 'insurance_draw'))))`;

export const SQL = {
  /**
   * Open fill, 1/3 — bind: cost, wallet, cost, wallet, market, maxOpen, wallet, market, side, orderId. Debits the one
   * balance only while the order is pending, the wallet holds no open position on the other side in this market (no
   * hedging; one direction per market) and has room for another position in this market (RULES.maxOpen per market).
   */
  openDebit:
    "UPDATE accounts SET balance = balance - ? WHERE wallet = ? AND balance >= ? " +
    "AND (SELECT COUNT(*) FROM positions WHERE wallet = ? AND closed_at IS NULL AND market = ?) < ? " +
    "AND NOT EXISTS (SELECT 1 FROM positions WHERE wallet = ? AND closed_at IS NULL AND market = ? AND side <> ?) " +
    "AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')",
  /** Open fill, 2/3 — bind: wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to (= opened_at). Only after the debit. */
  openInsert:
    "INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 RETURNING id",
  /** Open fill, 3/3 — bind: fill_px, filled_at, orderId. Only after the insert. */
  openFilled:
    "UPDATE orders SET status = 'filled', position_id = last_insert_rowid(), fill_px = ?, filled_at = ? " +
    "WHERE id = ? AND status = 'pending' AND changes() = 1",
  /**
   * Open fill, 4–5: the open fee to the ledger and the fee pool of the order's market, only after the order was marked
   * filled — bind: ts, fee, orderId; then pools: fee, fee, orderId.
   */
  openFeeLedger: "INSERT INTO ledger (ts, kind, amount, ref, market) SELECT ?, 'fee', ?, 'open:' || o.position_id, o.market FROM orders o WHERE o.id = ? AND changes() = 1",
  openFeePool: "UPDATE pools SET balance = balance + ?, gross = gross + ? WHERE kind = 'fee' AND market = (SELECT market FROM orders WHERE id = ?) AND changes() = 1",
  /**
   * Close fill, 1/3 — bind: closed_at, exit, pnl, accrued, closeFee, returned, borrow, fill, settle, booked, booked_cut,
   * booked_to, positionId, wallet, booked_to (as read), orderId. Settles only an open position whose booking has not
   * moved since it was read, while the close order is pending.
   */
  closeSettle:
    "UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, accrued = ?, fee = fee + ?, returned = ?, borrow = ?, fill = ?, settle = ?, " +
    "booked = ?, booked_cut = ?, booked_to = ?, reason = 'close' " +
    "WHERE id = ? AND wallet = ? AND closed_at IS NULL AND booked_to = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')",
  /** Close fill, 2/3 — bind: returned, wallet. Credits only when the settle changed a row. */
  closeCredit: "UPDATE accounts SET balance = balance + ? WHERE wallet = ? AND changes() = 1",
  /** Close fill, 3/3 — bind: fill_px, filled_at, orderId. */
  closeFilled: "UPDATE orders SET status = 'filled', fill_px = ?, filled_at = ? WHERE id = ? AND status = 'pending' AND changes() = 1",
  /** bind: error, orderId. */
  refuse: "UPDATE orders SET status = 'refused', error = ? WHERE id = ? AND status = 'pending'",
  /**
   * Liquidation at the liquidation price, nothing returned — bind: closed_at, exit, pnl, accrued, borrow, fill, settle,
   * booked, booked_cut, booked_to, positionId, booked_to (as read).
   */
  liquidate:
    "UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, accrued = ?, borrow = ?, fill = ?, settle = ?, booked = ?, booked_cut = ?, booked_to = ?, " +
    "returned = 0, reason = 'liquidation' WHERE id = ? AND closed_at IS NULL AND booked_to = ?",
  /**
   * The ingest's in-batch liquidation: only if this post won the mark row of the position's own market (a post of
   * another market never liquidates it) — bind: as `liquidate`, then post.
   */
  liquidateIfPost:
    "UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, accrued = ?, borrow = ?, fill = ?, settle = ?, booked = ?, booked_cut = ?, booked_to = ?, " +
    "returned = 0, reason = 'liquidation' WHERE id = ? AND closed_at IS NULL AND booked_to = ? AND (SELECT post FROM mark WHERE market = positions.market) = ?",
  /** A settlement's ledger rows (in the position's market): only under the token its settle statement wrote — guard bind: positionId, token. */
  ledgerSettled: ledgerUnder(BY_SETTLE),
  poolSettled: poolUnder(BY_SETTLE),
  /**
   * R2: the market hour's rates, once (the first non-null trend wins), only by the post that won the market's mark
   * row (the row's market is the mark row's) — bind: hour, long, short, skew, r, r_max, cut, house_exposure,
   * house_funding, trend, sigma_1h, L, S, fixed_at, post, premium, market, post (premium: §9.15, migration 0003).
   */
  ratesInsert:
    "INSERT INTO rates (market, hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post, premium) " +
    "SELECT m.market, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM mark m WHERE m.market = ? AND m.post = ? ON CONFLICT (market, hour) DO NOTHING",
  /** Ledger rows of a rate fix (the projected cut): only if this post's rates insert won — guard bind: market, hour, post. */
  ledgerByRates: ledgerUnder(BY_RATES),
  poolByRates: poolUnder(BY_RATES),
  /**
   * The market's booked hour, once, only by the post whose rates insert won (in the rates row's market) — bind: hour,
   * open, close, exposure, price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq,
   * upto_id, booked_at, post, market, rates hour, post.
   */
  houseHourInsert:
    "INSERT INTO house_hours (market, hour, open, close, exposure, price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id, booked_at, post) " +
    `SELECT g.market, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${BY_RATES} ON CONFLICT (market, hour) DO NOTHING`,
  /** Ledger rows of a booked hour — guard bind: market, hour, post. */
  ledgerByHour: ledgerUnder(BY_HOUR),
  poolByHour: poolUnder(BY_HOUR),
  /**
   * The house's claim on a position still open at a booked hour's end, under the rates of the position's own market —
   * bind: booked, booked_cut, booked_to, positionId, booked_to (as read), rates hour, post. Must change one row:
   * followed by `abortUnlessChanged`.
   */
  bookPosition:
    "UPDATE positions SET booked = ?, booked_cut = ?, booked_to = ? " +
    "WHERE id = ? AND closed_at IS NULL AND booked_to = ? AND (SELECT post FROM rates WHERE market = positions.market AND hour = ?) = ?",
  /**
   * Fails the whole batch (NOT NULL) unless the statement before it changed a row: the hour's ledger amounts were
   * computed from what was read, so a position that moved meanwhile must not be booked half. The post is retried.
   */
  abortUnlessChanged: "INSERT INTO ledger (ts, kind, amount, ref, market) SELECT NULL, NULL, NULL, NULL, 'abi' WHERE changes() = 0",
  /**
   * A gap loss s (> 0) of a settled position: the insurance of the position's market covers C = min(s, its balance,
   * never below 0), that market's house takes s − C. Evaluated inside the batch, so concurrent gaps never overdraw
   * insurance. Write in this order (the insurance balance is unchanged until the last statement, so C is the same in
   * all four): gapHouseLedger — bind: ts, kind, s, s, ref, positionId, token; gapHousePool — bind: s, s, s, s, kind,
   * positionId, token; gapCoverLedger — bind: ts, s, ref, positionId, token; gapCoverPool — bind: s, s, positionId, token.
   */
  gapHouseLedger: `INSERT INTO ledger (ts, kind, amount, ref, market) SELECT ?, ?, ${cover("g.market")} - ?, ?, g.market ${BY_SETTLE}`,
  gapHousePool: `UPDATE pools SET balance = balance + (${cover("pools.market")} - ?), gross = gross + (${cover("pools.market")} - ?) WHERE kind = ? AND market = (SELECT g.market ${BY_SETTLE})`,
  gapCoverLedger: `INSERT INTO ledger (ts, kind, amount, ref, market) SELECT ?, 'insurance_draw', -${cover("g.market")}, ?, g.market ${BY_SETTLE}`,
  gapCoverPool: `UPDATE pools SET balance = balance - ${cover("pools.market")}, gross = gross - ${cover("pools.market")} WHERE kind = 'insurance_draw' AND market = (SELECT g.market ${BY_SETTLE})`,
  /** R5: the market's week split, once — bind: market, week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post. */
  splitInsert:
    "INSERT INTO splits (market, week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (market, week) DO NOTHING",
  /** The split's ledger rows: only if this request's insert won — guard bind: market, week, post. */
  ledgerBySplit: ledgerUnder(BY_SPLIT),
  poolBySplit: poolUnder(BY_SPLIT),
  /** bind: nonce, exp. changes = 1 only for the first use. */
  nonceUse: "INSERT INTO used_nonces (nonce, exp) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING",
  /**
   * bind: key, slot, limit. RETURNING the count in this window; no row (and no write at all) once the window's count
   * has reached the limit (audit SS-2: a request refused 429 costs no D1 write).
   */
  rateHit:
    "INSERT INTO ratelimit (k, slot, n) VALUES (?, ?, 1) ON CONFLICT (k) DO UPDATE SET " +
    "n = CASE WHEN ratelimit.slot = excluded.slot THEN ratelimit.n + 1 ELSE 1 END, slot = excluded.slot " +
    "WHERE ratelimit.slot <> excluded.slot OR ratelimit.n < ? RETURNING n",
  /**
   * bind: market, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate,
   * base_pending, base_step_ts, milestone_ts, bars_minute, swept_minute, candle, post. Moves forward only (per market).
   */
  markUpsert:
    "INSERT INTO mark (market, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, base_pending, " +
    "base_step_ts, milestone_ts, bars_minute, swept_minute, candle, post) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (market) DO UPDATE SET px = excluded.px, ts = excluded.ts, " +
    "received_ms = excluded.received_ms, head = excluded.head, hour_start = excluded.hour_start, ch24 = excluded.ch24, ch1 = excluded.ch1, " +
    "sigma_1h = excluded.sigma_1h, sigma_24h = excluded.sigma_24h, funding_known = excluded.funding_known, funding_rate = excluded.funding_rate, base_pending = excluded.base_pending, " +
    "base_step_ts = excluded.base_step_ts, milestone_ts = excluded.milestone_ts, bars_minute = excluded.bars_minute, swept_minute = excluded.swept_minute, " +
    "candle = excluded.candle, post = excluded.post WHERE excluded.ts > mark.ts",
  /**
   * bind: minute, h, l, c, market, post. Written only by the post that won the market's mark row (into that row's
   * market); merges (high and low only widen), and an unchanged bar (a re-sent minute) is not rewritten: no row write.
   */
  barUpsert:
    "INSERT INTO bars (market, minute, h, l, c) SELECT m.market, ?, ?, ?, ? FROM mark m WHERE m.market = ? AND m.post = ? " +
    "ON CONFLICT (market, minute) DO UPDATE SET h = max(bars.h, excluded.h), l = min(bars.l, excluded.l), c = excluded.c " +
    "WHERE excluded.h > bars.h OR excluded.l < bars.l OR excluded.c <> bars.c",
  /** bind: minute_from, minute_to, market, post. An earlier-hour gap no closed candle covers yet. */
  gapOpen:
    "INSERT INTO gaps (market, minute_from, minute_to) SELECT m.market, ?, ? FROM mark m WHERE m.market = ? AND m.post = ? " +
    "ON CONFLICT (market, minute_from) DO NOTHING",
  /** bind: market, minute_from, post. The gap got its gap bar in the same batch (by the post that won the gap's market). */
  gapClose: "DELETE FROM gaps WHERE market = ? AND minute_from = ? AND (SELECT post FROM mark WHERE market = gaps.market) = ?",
  /** bind: wallet. Ends every session of the wallet. */
  sessionBump: "UPDATE accounts SET session_epoch = session_epoch + 1 WHERE wallet = ?",
  /** Liquidation candidates (a superset; the engine decides), one page of LIQ_PAGE from a cursor — bind: market, bound, from minute. */
  liqCandidatesLong: "SELECT minute AS t, h, l, c FROM bars INDEXED BY bars_l WHERE market = ? AND l <= ? AND minute >= ? ORDER BY minute LIMIT 500",
  liqCandidatesShort: "SELECT minute AS t, h, l, c FROM bars INDEXED BY bars_h WHERE market = ? AND h >= ? AND minute >= ? ORDER BY minute LIMIT 500",
} as const;

/** The same SQL on scratch tables: every table and index name prefixed (table names never collide with columns). */
/** The page size of SQL.liqCandidates*: the caller pages on with the minute after the last one. */
export const LIQ_PAGE = 500;

export function scratch(sql: string, prefix = "_guard_"): string {
  const names = [...TABLES, ...INDEXES, ...REBUILT.map((t) => `${t}_v4`)].join("|");
  return sql.replace(new RegExp(`\\b(${names})\\b`, "g"), `${prefix}$1`);
}
