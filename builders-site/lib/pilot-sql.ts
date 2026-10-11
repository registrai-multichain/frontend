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
export const INDEXES = ["positions_wallet", "positions_open", "orders_pending", "orders_wallet", "bars_l", "bars_h", "ledger_ref", "ledger_kind_ts"] as const;
/** The migrations, in order (the guard check and the D1 test double apply all of them). */
export const MIGRATIONS = ["0001_pilot.sql", "0002_pilot_v3.sql"] as const;

/**
 * One ledger row plus the matching pools update, under the same guard (R4): `<guard>` is a SQL condition true only
 * for the batch that owns the event. Ledger bind: ts, kind, amount, ref, …guard; pools bind: amount, gross, kind,
 * …guard (gross = 0 for the weekly split's own rows).
 */
const ledgerUnder = (guard: string) => `INSERT INTO ledger (ts, kind, amount, ref) SELECT ?, ?, ?, ? WHERE ${guard}`;
const poolUnder = (guard: string) => `UPDATE pools SET balance = balance + ?, gross = gross + ? WHERE kind = ? AND ${guard}`;
const BY_SETTLE = "(SELECT settle FROM positions WHERE id = ?) = ?";
const BY_RATES = "(SELECT post FROM rates WHERE hour = ?) = ?";
const BY_HOUR = "(SELECT post FROM house_hours WHERE hour = ?) = ?";
const BY_SPLIT = "(SELECT post FROM splits WHERE week = ?) = ?";
/** What insurance can cover of a loss `?`: never more than its balance, never below 0. */
const COVER = "MIN(?, MAX(0, (SELECT COALESCE(SUM(balance), 0) FROM pools WHERE kind IN ('split_insurance', 'insurance_draw'))))";

export const SQL = {
  /**
   * Open fill, 1/3 — bind: cost, wallet, cost, wallet, maxOpen, wallet, side, orderId. Debits only while the order is
   * pending, the wallet holds no open position on the other side (no hedging) and has room for another position.
   */
  openDebit:
    "UPDATE accounts SET balance = balance - ? WHERE wallet = ? AND balance >= ? " +
    "AND (SELECT COUNT(*) FROM positions WHERE wallet = ? AND closed_at IS NULL) < ? " +
    "AND NOT EXISTS (SELECT 1 FROM positions WHERE wallet = ? AND closed_at IS NULL AND side <> ?) " +
    "AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')",
  /** Open fill, 2/3 — bind: wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to (= opened_at). Only after the debit. */
  openInsert:
    "INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 RETURNING id",
  /** Open fill, 3/3 — bind: fill_px, filled_at, orderId. Only after the insert. */
  openFilled:
    "UPDATE orders SET status = 'filled', position_id = last_insert_rowid(), fill_px = ?, filled_at = ? " +
    "WHERE id = ? AND status = 'pending' AND changes() = 1",
  /** Open fill, 4–5: the open fee to the ledger, only after the order was marked filled — bind: ts, fee, orderId; then pools: fee, fee. */
  openFeeLedger: "INSERT INTO ledger (ts, kind, amount, ref) SELECT ?, 'fee', ?, 'open:' || (SELECT position_id FROM orders WHERE id = ?) WHERE changes() = 1",
  openFeePool: "UPDATE pools SET balance = balance + ?, gross = gross + ? WHERE kind = 'fee' AND changes() = 1",
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
  /** The ingest's in-batch liquidation: only if this post won the mark row — bind: as `liquidate`, then post. */
  liquidateIfPost:
    "UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, accrued = ?, borrow = ?, fill = ?, settle = ?, booked = ?, booked_cut = ?, booked_to = ?, " +
    "returned = 0, reason = 'liquidation' WHERE id = ? AND closed_at IS NULL AND booked_to = ? AND (SELECT post FROM mark WHERE id = 1) = ?",
  /** A settlement's ledger rows: only under the token its settle statement wrote — guard bind: positionId, token. */
  ledgerSettled: ledgerUnder(BY_SETTLE),
  poolSettled: poolUnder(BY_SETTLE),
  /**
   * R2: the hour's rates, once (the first non-null trend wins), only by the post that won the mark row — bind: hour,
   * long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post, post.
   */
  ratesInsert:
    "INSERT INTO rates (hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT post FROM mark WHERE id = 1) = ? ON CONFLICT (hour) DO NOTHING",
  /** Ledger rows of a rate fix (the projected cut): only if this post's rates insert won — guard bind: hour, post. */
  ledgerByRates: ledgerUnder(BY_RATES),
  poolByRates: poolUnder(BY_RATES),
  /**
   * The house's booked hour, once, only by the post whose rates insert won — bind: hour, open, close, exposure,
   * price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id, booked_at, post,
   * rates hour, post.
   */
  houseHourInsert:
    "INSERT INTO house_hours (hour, open, close, exposure, price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id, booked_at, post) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT post FROM rates WHERE hour = ?) = ? ON CONFLICT (hour) DO NOTHING",
  /** Ledger rows of a booked hour — guard bind: hour, post. */
  ledgerByHour: ledgerUnder(BY_HOUR),
  poolByHour: poolUnder(BY_HOUR),
  /**
   * The house's claim on a position still open at a booked hour's end — bind: booked, booked_cut, booked_to,
   * positionId, booked_to (as read), rates hour, post. Must change one row: followed by `abortUnlessChanged`.
   */
  bookPosition:
    "UPDATE positions SET booked = ?, booked_cut = ?, booked_to = ? " +
    "WHERE id = ? AND closed_at IS NULL AND booked_to = ? AND (SELECT post FROM rates WHERE hour = ?) = ?",
  /**
   * Fails the whole batch (NOT NULL) unless the statement before it changed a row: the hour's ledger amounts were
   * computed from what was read, so a position that moved meanwhile must not be booked half. The post is retried.
   */
  abortUnlessChanged: "INSERT INTO ledger (ts, kind, amount, ref) SELECT NULL, NULL, NULL, NULL WHERE changes() = 0",
  /**
   * A gap loss s (> 0) of a settled position: insurance covers C = min(s, its balance, never below 0), the house
   * takes s − C. Evaluated inside the batch, so concurrent gaps never overdraw insurance. Write in this order (the
   * insurance balance is unchanged until the last statement, so C is the same in all four):
   * gapHouseLedger — bind: ts, kind, s, s, ref, positionId, token; gapHousePool — bind: s, s, s, s, kind, positionId, token;
   * gapCoverLedger — bind: ts, s, ref, positionId, token; gapCoverPool — bind: s, s, positionId, token.
   */
  gapHouseLedger: `INSERT INTO ledger (ts, kind, amount, ref) SELECT ?, ?, ${COVER} - ?, ? WHERE ${BY_SETTLE}`,
  gapHousePool: `UPDATE pools SET balance = balance + (${COVER} - ?), gross = gross + (${COVER} - ?) WHERE kind = ? AND ${BY_SETTLE}`,
  gapCoverLedger: `INSERT INTO ledger (ts, kind, amount, ref) SELECT ?, 'insurance_draw', -${COVER}, ? WHERE ${BY_SETTLE}`,
  gapCoverPool: `UPDATE pools SET balance = balance - ${COVER}, gross = gross - ${COVER} WHERE kind = 'insurance_draw' AND ${BY_SETTLE}`,
  /** R5: the week's split, once — bind: week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post. */
  splitInsert:
    "INSERT INTO splits (week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (week) DO NOTHING",
  /** The split's ledger rows: only if this request's insert won — guard bind: week, post. */
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
   * bind: px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, base_pending,
   * base_step_ts, milestone_ts, bars_minute, swept_minute, candle, post. Moves forward only.
   */
  markUpsert:
    "INSERT INTO mark (id, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, base_pending, " +
    "base_step_ts, milestone_ts, bars_minute, swept_minute, candle, post) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET px = excluded.px, ts = excluded.ts, " +
    "received_ms = excluded.received_ms, head = excluded.head, hour_start = excluded.hour_start, ch24 = excluded.ch24, ch1 = excluded.ch1, " +
    "sigma_1h = excluded.sigma_1h, sigma_24h = excluded.sigma_24h, funding_known = excluded.funding_known, funding_rate = excluded.funding_rate, base_pending = excluded.base_pending, " +
    "base_step_ts = excluded.base_step_ts, milestone_ts = excluded.milestone_ts, bars_minute = excluded.bars_minute, swept_minute = excluded.swept_minute, " +
    "candle = excluded.candle, post = excluded.post WHERE excluded.ts > mark.ts",
  /**
   * bind: minute, h, l, c, post. Written only by the post that won the mark row; merges (high and low only widen), and
   * an unchanged bar (a re-sent minute) is not rewritten: no row write.
   */
  barUpsert:
    "INSERT INTO bars (minute, h, l, c) SELECT ?, ?, ?, ? WHERE (SELECT post FROM mark WHERE id = 1) = ? " +
    "ON CONFLICT (minute) DO UPDATE SET h = max(bars.h, excluded.h), l = min(bars.l, excluded.l), c = excluded.c " +
    "WHERE excluded.h > bars.h OR excluded.l < bars.l OR excluded.c <> bars.c",
  /** bind: minute_from, minute_to, post. An earlier-hour gap no closed candle covers yet. */
  gapOpen:
    "INSERT INTO gaps (minute_from, minute_to) SELECT ?, ? WHERE (SELECT post FROM mark WHERE id = 1) = ? " +
    "ON CONFLICT (minute_from) DO NOTHING",
  /** bind: minute_from, post. The gap got its gap bar in the same batch. */
  gapClose: "DELETE FROM gaps WHERE minute_from = ? AND (SELECT post FROM mark WHERE id = 1) = ?",
  /** bind: wallet. Ends every session of the wallet. */
  sessionBump: "UPDATE accounts SET session_epoch = session_epoch + 1 WHERE wallet = ?",
  /** Liquidation candidates (a superset; the engine decides), one page of LIQ_PAGE from a cursor — bind: bound, from minute. */
  liqCandidatesLong: "SELECT minute AS t, h, l, c FROM bars INDEXED BY bars_l WHERE l <= ? AND minute >= ? ORDER BY minute LIMIT 500",
  liqCandidatesShort: "SELECT minute AS t, h, l, c FROM bars INDEXED BY bars_h WHERE h >= ? AND minute >= ? ORDER BY minute LIMIT 500",
} as const;

/** The same SQL on scratch tables: every table and index name prefixed (table names never collide with columns). */
/** The page size of SQL.liqCandidates*: the caller pages on with the minute after the last one. */
export const LIQ_PAGE = 500;

export function scratch(sql: string, prefix = "_guard_"): string {
  const names = [...TABLES, ...INDEXES].join("|");
  return sql.replace(new RegExp(`\\b(${names})\\b`, "g"), `${prefix}$1`);
}
