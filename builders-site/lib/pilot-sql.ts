/**
 * The points pilot's guarded SQL, in one place: lib/pilot.ts and lib/pilot-auth.ts run these, and
 * scripts/d1-guard-check.mjs runs the same strings against the remote D1 (on scratch copies of the tables)
 * before the pilot opens, to prove the changes()-guarded batches behave there as in the tests.
 * Ordered `?` parameters only (D1). No imports: the guard script loads this file directly.
 */

export const TABLES = ["accounts", "positions", "orders", "bars", "gaps", "funding", "mark", "used_nonces", "ratelimit"] as const;
export const INDEXES = ["positions_wallet", "positions_open", "orders_pending", "orders_wallet", "bars_l", "bars_h"] as const;

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
  /** Open fill, 2/3 — bind: wallet, side, margin, lev, notional, entry, liq, opened_at, fee. Only after the debit. */
  openInsert:
    "INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 RETURNING id",
  /** Open fill, 3/3 — bind: fill_px, filled_at, orderId. Only after the insert. */
  openFilled:
    "UPDATE orders SET status = 'filled', position_id = last_insert_rowid(), fill_px = ?, filled_at = ? " +
    "WHERE id = ? AND status = 'pending' AND changes() = 1",
  /** Close fill, 1/3 — bind: closed_at, exit, pnl, accrued, closeFee, returned, positionId, wallet, orderId. */
  closeSettle:
    "UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, accrued = ?, fee = fee + ?, returned = ?, reason = 'close' " +
    "WHERE id = ? AND wallet = ? AND closed_at IS NULL AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')",
  /** Close fill, 2/3 — bind: returned, wallet. Credits only when the settle changed a row. */
  closeCredit: "UPDATE accounts SET balance = balance + ? WHERE wallet = ? AND changes() = 1",
  /** Close fill, 3/3 — bind: fill_px, filled_at, orderId. */
  closeFilled: "UPDATE orders SET status = 'filled', fill_px = ?, filled_at = ? WHERE id = ? AND status = 'pending' AND changes() = 1",
  /** bind: error, orderId. */
  refuse: "UPDATE orders SET status = 'refused', error = ? WHERE id = ? AND status = 'pending'",
  /** Liquidation at the liquidation price, nothing returned — bind: closed_at, exit, pnl, accrued, positionId. */
  liquidate: "UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, accrued = ?, returned = 0, reason = 'liquidation' WHERE id = ? AND closed_at IS NULL",
  /** bind: nonce, exp. changes = 1 only for the first use. */
  nonceUse: "INSERT INTO used_nonces (nonce, exp) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING",
  /** bind: key, slot. RETURNING the count in this window. */
  rateHit:
    "INSERT INTO ratelimit (k, slot, n) VALUES (?, ?, 1) ON CONFLICT (k) DO UPDATE SET " +
    "n = CASE WHEN ratelimit.slot = excluded.slot THEN ratelimit.n + 1 ELSE 1 END, slot = excluded.slot RETURNING n",
  /** bind: px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, base_pending, base_step_ts, candle, post. Moves forward only. */
  markUpsert:
    "INSERT INTO mark (id, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, base_pending, base_step_ts, candle, post) " +
    "VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET px = excluded.px, ts = excluded.ts, " +
    "received_ms = excluded.received_ms, head = excluded.head, hour_start = excluded.hour_start, ch24 = excluded.ch24, ch1 = excluded.ch1, " +
    "sigma_1h = excluded.sigma_1h, sigma_24h = excluded.sigma_24h, funding_known = excluded.funding_known, base_pending = excluded.base_pending, base_step_ts = excluded.base_step_ts, " +
    "candle = excluded.candle, post = excluded.post WHERE excluded.ts > mark.ts",
  /** bind: minute, h, l, c, post. Written only by the post that won the mark row; merges (high and low only widen). */
  barUpsert:
    "INSERT INTO bars (minute, h, l, c) SELECT ?, ?, ?, ? WHERE (SELECT post FROM mark WHERE id = 1) = ? " +
    "ON CONFLICT (minute) DO UPDATE SET h = max(bars.h, excluded.h), l = min(bars.l, excluded.l), c = excluded.c",
  /** bind: hour_start, rate, post. Written once per hour: the first rate posted for an hour stands. */
  fundingInsert:
    "INSERT INTO funding (hour_start, rate) SELECT ?, ? WHERE (SELECT post FROM mark WHERE id = 1) = ? " +
    "ON CONFLICT (hour_start) DO NOTHING",
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
