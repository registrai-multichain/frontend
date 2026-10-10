/* ABI points pilot: trading rules, economy v2 (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md §8).
 * Pure functions, no I/O: the builder site's /api/pilot handlers call these with the stored account, positions,
 * the published hourly closes / funding rates and minute bars. Points only; nothing here moves money.
 *
 * Funding: the rate in force during hour [t, t+1h) is F = mean hourly return of the 6 closed hours ending at t
 * (RULES.window; σ for the leverage cap and the pause uses the last 24 closed hours, RULES.sigmaWindow).
 * A long accrues −F × notional per hour held, a short +F × notional (pro rata to the time held), so a steady
 * trend is paid back to the side it runs against and only beating or missing the trend earns points. */
(function (root) {
  const RULES = {
    startBalance: 10000,
    levels: [1, 2, 3, 5, 10, 20],
    feeRate: 0.0001,          // per side, on notional at open and on exit notional at close (§8.6: half a typical day's move at 20×, 2× the leftover drift edge)
    mm: 0.005,                // maintenance margin, share of notional
    minMargin: 10,
    maxOpen: 5,
    markMaxAgeS: 10,          // fills use the first mark after the order, at most this late
    volTarget: 0.10,          // max_lev = clamp(floor(volTarget / σ_24h), 1, 20)
    pauseSigmas: 5, pauseFloor: 0.005,
    window: 6,                // funding = mean hourly return of the last 6 closed hours (24 h lagged a falling trend: §8.6 table)
    sigmaWindow: 24,          // σ for the leverage cap and the pause: last 24 closed hours
  };

  /* closes: hourly closes, ascending (last = latest closed hour). */
  function returns(closes) {
    const r = [];
    for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
    return r;
  }
  function risk(closes) {
    const all = returns(closes);
    const rf = all.slice(-RULES.window), rs = all.slice(-RULES.sigmaWindow);
    if (!rs.length) return { funding: null, sigma1h: null, sigma24: null };   // no data: callers refuse orders
    const funding = rf.reduce((a, b) => a + b, 0) / rf.length;
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
    return { funding, sigma1h: sd, sigma24: sd * Math.sqrt(24) };
  }

  function maxLeverage({ sigma24, sigma1h, ch1 }) {
    const raw = sigma24 > 0 ? Math.floor(RULES.volTarget / sigma24) : RULES.levels[RULES.levels.length - 1];
    const cap = Math.max(1, Math.min(20, raw));
    const max = RULES.levels.filter(l => l <= cap).pop();
    const limit = Math.max(RULES.pauseSigmas * (sigma1h || 0), RULES.pauseFloor);
    return { max, paused: Math.abs(ch1 || 0) > limit };
  }

  /* Funding accrued by a position from openedAt to `to` (unix s). rates: [{ t: hour start, rate }] (rate in force
   * during [t, t+3600)). Positive = credited to the position. */
  function fundingAccrued(pos, rates, to) {
    const dir = pos.side === "long" ? -1 : 1;
    let f = 0;
    for (const { t, rate } of rates) {
      const a = Math.max(t, pos.openedAt), b = Math.min(t + 3600, to);
      if (b > a) f += dir * rate * pos.notional * (b - a) / 3600;
    }
    return f;
  }

  function pnl(pos, mark) {
    const r = mark / pos.entry - 1;
    return pos.notional * (pos.side === "long" ? r : -r);
  }

  /* Liquidation price given funding accrued so far: where margin + PnL + funding = mm × notional. */
  function liqPrice(pos, funding = 0) {
    const d = (pos.margin + funding - RULES.mm * pos.notional) / pos.notional;
    return pos.side === "long" ? pos.entry * (1 - d) : pos.entry * (1 + d);
  }

  /* account: { balance, open, side } (side = the direction of the wallet's open positions, if any; one direction
   * per wallet at a time, owner 2026-10-10: no hedging). Returns { ok, position, fee, balance } or { error }. */
  function open(account, { side, margin, lev, mark, now, risk: rk = {} }) {
    if (side !== "long" && side !== "short") return { error: "bad side" };
    if (!RULES.levels.includes(lev)) return { error: "leverage not allowed" };
    if (!(margin >= RULES.minMargin)) return { error: "margin below minimum" };
    if (!(mark > 0)) return { error: "no mark price" };
    const cap = maxLeverage(rk);
    if (cap.paused) return { error: "trading paused" };
    if (lev > cap.max) return { error: "leverage above the current cap" };
    if (account.open >= RULES.maxOpen) return { error: "too many open positions" };
    if (account.open > 0 && account.side && account.side !== side) return { error: "one direction at a time" };
    const notional = margin * lev, fee = notional * RULES.feeRate;
    if (margin + fee > account.balance) return { error: "insufficient balance" };
    const position = { side, margin, lev, notional, entry: mark, openedAt: now };
    position.liq = liqPrice(position, 0);
    return { ok: true, position, fee, balance: account.balance - margin - fee };
  }

  /* Closing at `mark` at time `now`: margin + PnL + funding − fee on the exit notional, never below 0. */
  function close(pos, mark, now, rates = []) {
    const p = pnl(pos, mark), f = fundingAccrued(pos, rates, now);
    const fee = pos.notional * (mark / pos.entry) * RULES.feeRate;      // on the exit notional
    return { pnl: p, funding: f, fee, payout: Math.max(0, pos.margin + p + f - fee) };
  }

  /* First one-minute bar starting at or after the open whose low (long) / high (short) crosses the liquidation
   * price, with funding accrued to the end of that bar. bars: [{ t, h, l, c }] ascending. → { t, price } | null */
  function liquidation(pos, bars, rates = []) {
    for (const b of bars) {
      if (b.t < pos.openedAt) continue;
      const lp = liqPrice(pos, fundingAccrued(pos, rates, b.t + 60));
      if (pos.side === "long" ? b.l <= lp : b.h >= lp) return { t: b.t, price: lp };
    }
    return null;
  }

  function equity(balance, positions, mark, now, rates = []) {
    return positions.reduce((e, p) => e + Math.max(0, p.margin + pnl(p, mark) + fundingAccrued(p, rates, now)), balance);
  }

  const api = { RULES, returns, risk, maxLeverage, fundingAccrued, pnl, liqPrice, open, close, liquidation, equity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ABIPilot = api;
})(typeof window !== "undefined" ? window : globalThis);
