/* ABI points pilot: trading rules (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md).
 * Pure functions, no I/O: the builder site's /api/pilot handlers call these with the stored account,
 * positions and the latest signed mark. Points only; nothing here moves money. */
(function (root) {
  const RULES = {
    startBalance: 10000,
    levels: [1, 2, 3],
    feeRate: 0.0006,          // on notional, at open and at close
    mm: 0.02,                 // maintenance margin, share of notional
    minMargin: 10,
    maxOpen: 5,
    markMaxAgeS: 15,
    capSteps: [[0.10, 3], [0.25, 2], [Infinity, 1]],   // |24h move| below → max leverage
    pauseHourMove: 0.04,
  };

  function maxLeverage({ ch24, ch1 }) {
    const a = Math.abs(ch24 || 0);
    const max = RULES.capSteps.find(([lim]) => a < lim)[1];
    return { max, paused: Math.abs(ch1 || 0) > RULES.pauseHourMove };
  }

  function liqPrice(side, entry, lev) {
    const d = 1 / lev - RULES.mm;
    return side === "long" ? entry * (1 - d) : entry * (1 + d);
  }

  /* account: { balance, open } (open = number of open positions). Returns { ok, position, fee, balance } or { error }. */
  function open(account, { side, margin, lev, mark, now, ch24, ch1 }) {
    if (side !== "long" && side !== "short") return { error: "bad side" };
    if (!RULES.levels.includes(lev)) return { error: "leverage not allowed" };
    if (!(margin >= RULES.minMargin)) return { error: "margin below minimum" };
    if (!(mark > 0)) return { error: "no mark price" };
    const cap = maxLeverage({ ch24, ch1 });
    if (cap.paused) return { error: "trading paused" };
    if (lev > cap.max) return { error: "leverage above the current cap" };
    if (account.open >= RULES.maxOpen) return { error: "too many open positions" };
    const notional = margin * lev, fee = notional * RULES.feeRate;
    if (margin + fee > account.balance) return { error: "insufficient balance" };
    const position = { side, margin, lev, notional, entry: mark, liq: liqPrice(side, mark, lev), openedAt: now };
    return { ok: true, position, fee, balance: account.balance - margin - fee };
  }

  function pnl(pos, mark) {
    const r = mark / pos.entry - 1;
    return pos.notional * (pos.side === "long" ? r : -r);
  }

  /* Closing at `mark`: what returns to the balance (margin + PnL − close fee, never below 0). */
  function close(pos, mark) {
    const p = pnl(pos, mark), fee = (pos.notional + p) * RULES.feeRate;
    return { pnl: p, fee, payout: Math.max(0, pos.margin + p - Math.max(0, fee)) };
  }

  /* First one-minute bar opened after the position whose low (long) / high (short) crosses the liquidation price.
   * bars: [{ t: minute start (unix s), h, l, c }] ascending. Returns { t, price } or null. */
  function liquidation(pos, bars) {
    for (const b of bars) {
      if (b.t < pos.openedAt) continue;
      if (pos.side === "long" ? b.l <= pos.liq : b.h >= pos.liq) return { t: b.t, price: pos.liq };
    }
    return null;
  }

  function equity(balance, positions, mark) {
    return positions.reduce((e, p) => e + Math.max(0, p.margin + pnl(p, mark)), balance);
  }

  const api = { RULES, maxLeverage, liqPrice, open, pnl, close, liquidation, equity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ABIPilot = api;
})(typeof window !== "undefined" ? window : globalThis);
