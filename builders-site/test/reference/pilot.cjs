/* ABI points pilot: trading rules, economy v3 (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md §9).
 * Pure functions, no I/O: the builder site's /api/pilot handlers call these with the stored account, positions,
 * the published hourly rates and minute bars. Points only; nothing here moves money. (v2: pilot.v2.js)
 *
 * Funding (§9.1, §9.2, revised §9.13): each closed hour fixes the next hour's rates. Trend term: every position pays
 * (long) or receives (short) the ex-milestone drift (mean hourly return of the last 6 closed hours, milestone steps
 * divided out). Skew term: the heavier side pays |r| = r_max · |skew|, r_max = max(1.5 · σ_1h, 0.005%/h); the
 * lighter side, including the house (always the counterparty to the net imbalance), receives 90% of that per unit;
 * the protocol keeps 10%. Rates are stored per hour as { t, long, short }: points per unit of notional, + = pays.
 * Borrow fee (§9.3): APR on notional − margin, hourly pro rata. Leverage (§9.4): min(volatility cap, jump cap). */
(function (root) {
  const RULES = {
    startBalance: 10000,
    levels: [1, 2, 3, 5, 10, 20, 30],
    feeRate: 0.0001,          // per side, on notional at open and on exit notional at close
    mm: 0.005,                // maintenance margin, share of notional
    minMargin: 10,
    maxOpen: 5,
    markMaxAgeS: 10,
    volTarget: 0.10,          // vol cap = floor(volTarget / σ_24h)
    jump: 0.025,              // largest one-step milestone move to survive: jump cap = floor(1 / (jump + mm))
    pauseSigmas: 5, pauseFloor: 0.005,
    window: 6,                // trend: mean hourly return of the last 6 closed hours (milestone steps removed)
    sigmaWindow: 24,
    rMaxMult: 1.5,            // full-skew funding = 1.5 · σ_1h (the drift is handled by the trend term)
    rMinFloor: 0.00005,       // …but at least 0.005%/h, so a lopsided book always pays something
    fundingCut: 0.10,         // protocol share of every skew-funding payment
    borrowApr: 0.10,
    split: { insurance: 0.2, treasury: 0.8, buybackOfTreasury: 0.5 },
    premiumWindow: 720,       // §9.15 milestone premium: mean hourly log milestone step over the last 30 days (720 h)
  };

  /* closes: hourly closes, ascending. steps (optional): {i: factor} = the milestone factor applied in the return
   * closes[i-1] → closes[i]; it is divided out so a one-off step doesn't feed funding. */
  function returns(closes, steps = {}) {
    const r = [];
    for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] / (steps[i] || 1) - 1);
    return r;
  }
  function risk(closes, steps = {}) {
    const all = returns(closes, steps);
    const rf = all.slice(-RULES.window), rs = all.slice(-RULES.sigmaWindow);
    if (!rs.length) return { trend: null, funding: null, sigma1h: null, sigma24: null, premium: null };   // no data: callers refuse orders
    const trend = rf.reduce((a, b) => a + b, 0) / rf.length;
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
    return { trend, funding: trend, sigma1h: sd, sigma24: sd * Math.sqrt(24), premium: premium(closes.length, steps) };
  }

  /* §9.15 (audit PE-2): milestone steps only go up and the trend divides them out, so longs held a free option the
   * house paid for. Longs pay the expected step instead: Σ ln(step) over the milestone steps in the last 720 hourly
   * returns, ÷ 720, per hour per unit of notional. steps: {i: factor} as in returns(); n = closes.length. */
  function premium(n, steps = {}) {
    let s = 0;
    for (const k in steps) { const i = +k; if (i > n - 1 - RULES.premiumWindow && i <= n - 1 && steps[k] > 0) s += Math.log(steps[k]); }
    return Math.max(0, s / RULES.premiumWindow);          // never negative (every milestone tier is a rise)
  }

  function maxLeverage({ sigma24, sigma1h, ch1 }) {
    const top = RULES.levels[RULES.levels.length - 1];
    const vol = sigma24 > 0 ? Math.floor(RULES.volTarget / sigma24) : top;
    const jump = Math.floor(1 / (RULES.jump + RULES.mm));
    const cap = Math.max(1, Math.min(top, vol, jump));
    const max = RULES.levels.filter(l => l <= cap).pop();
    const limit = Math.max(RULES.pauseSigmas * (sigma1h || 0), RULES.pauseFloor);
    return { max, paused: Math.abs(ch1 || 0) > limit };
  }

  /* The next hour's rates from the traders' book at the close (L, S: long / short open notional). The house is the
   * counterparty to the net imbalance (pool model): it always holds S − L, i.e. it fills the light side.
   * - Trend term (every position, any book size): long pays `trend`, short pays −trend per unit per hour. The house
   *   collects trend · (L − S): exactly the drift on its own exposure, so it is drift-neutral and nobody earns the
   *   predictable drift.
   * - Skew term: r = r_max · skew; the heavy side pays |r| per unit; the light side, house included, receives
   *   (1 − cut) · |r| per unit (light traders + house exposure = heavy notional); the protocol keeps cut · |r| · H. */
  function fundingRates({ L, S, trend, sigma1h, premium = 0 }) {
    const oi = L + S, skew = oi > 0 ? (L - S) / oi : 0;
    const rMax = Math.max(RULES.rMaxMult * (sigma1h || 0), RULES.rMinFloor);
    const r = rMax * skew;                               // > 0: longs heavy, longs pay
    const heavy = r > 0 ? "long" : r < 0 ? "short" : null;
    const H = heavy === "long" ? L : S, Lt = heavy === "long" ? S : L;
    const paid = Math.abs(r) * H, cut = RULES.fundingCut * paid;
    const recv = (1 - RULES.fundingCut) * Math.abs(r);   // per unit on the light side
    const tr = trend || 0;
    const pm = premium || 0;                             // §9.15: longs only, the house collects it
    const long = tr + pm + (heavy === "long" ? Math.abs(r) : heavy === "short" ? -recv : 0);
    const short = -tr + (heavy === "short" ? Math.abs(r) : heavy === "long" ? -recv : 0);
    const houseExposure = S - L;                        // signed notional, + = house long
    const houseSkew = recv * Math.abs(houseExposure);    // its light-side receipt
    const houseTrend = tr * (L - S);                     // drift compensation (trend · traders' net long)
    const housePremium = pm * L;
    return { skew, rMax, r, heavy, long, short, cut, paid, houseExposure, houseSkew, houseTrend, housePremium,
             houseFunding: houseSkew + houseTrend + housePremium + cut };   // per hour, points, to the house / fee pool
  }

  /* §9.14a: the book that fixes the next hour's rates is time-weighted over the closing hour [from, to), not a
   * snapshot at the close, so closing just before and reopening just after doesn't lower the skew. positions:
   * { side, notional, openedAt, closedAt? } (closedAt: close or liquidation time; absent = still open). */
  function bookTW(positions, from, to) {
    let L = 0, S = 0;
    for (const p of positions) {
      const a = Math.max(from, p.openedAt), b = Math.min(to, p.closedAt != null ? p.closedAt : to);
      if (b <= a) continue;
      const w = p.notional * (b - a) / (to - from);
      if (p.side === "long") L += w; else S += w;
    }
    return { L, S };
  }

  /* The house's hour: PnL of its exposure over the hour plus its funding receipts (points). */
  function houseHour({ L, S, open, close, trend, sigma1h, premium = 0 }) {
    const fr = fundingRates({ L, S, trend, sigma1h, premium });
    const pricePnl = fr.houseExposure * (close / open - 1);
    return { pricePnl, funding: fr.houseFunding, total: pricePnl + fr.houseFunding, exposure: fr.houseExposure };
  }

  /* Points a position paid for funding from openedAt to `to` (negative = received). rates: [{ t, long, short }]
   * (or v2 { t, rate }: long = rate, short = −rate), each in force during [t, t+3600). */
  function fundingPaid(pos, rates, to) {
    let f = 0;
    for (const x of rates) {
      const a = Math.max(x.t, pos.openedAt), b = Math.min(x.t + 3600, to);
      if (b <= a) continue;
      const rate = x.long != null ? (pos.side === "long" ? x.long : x.short) : (pos.side === "long" ? x.rate : -x.rate);
      f += rate * pos.notional * (b - a) / 3600;
    }
    return f;
  }
  const fundingAccrued = (pos, rates, to) => -fundingPaid(pos, rates, to);   // v2 name: credit (positive = received)

  function borrowPaid(pos, to) {
    const hours = Math.max(0, to - pos.openedAt) / 3600;
    return (pos.notional - pos.margin) * RULES.borrowApr / 8760 * hours;
  }

  function pnl(pos, mark) {
    const r = mark / pos.entry - 1;
    return pos.notional * (pos.side === "long" ? r : -r);
  }

  /* Liquidation price given costs paid so far (funding + borrow): margin + PnL − costs = mm × notional. */
  function liqPrice(pos, costs = 0) {
    const d = (pos.margin - costs - RULES.mm * pos.notional) / pos.notional;
    return pos.side === "long" ? pos.entry * (1 - d) : pos.entry * (1 + d);
  }

  /* account: { balance, open, side }. Returns { ok, position, fee, balance } or { error }. */
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

  /* Closing at `mark` at `now`: margin + PnL − funding paid − borrow − exit fee, never below 0. */
  function close(pos, mark, now, rates = []) {
    const p = pnl(pos, mark), fp = fundingPaid(pos, rates, now), bp = borrowPaid(pos, now);
    const fee = pos.notional * (mark / pos.entry) * RULES.feeRate;
    return { pnl: p, funding: -fp, borrow: bp, fee, payout: Math.max(0, pos.margin + p - fp - bp - fee) };
  }

  /* First minute bar at or after the open whose low (long) / high (short) crosses the liquidation price, with funding
   * and borrow accrued to the end of that bar. → { t, price, shortfall } | null (shortfall: loss beyond the margin
   * if the bar gapped through, for the insurance pool). */
  function liquidation(pos, bars, rates = []) {
    for (const b of bars) {
      if (b.t < pos.openedAt) continue;
      const end = b.t + 60, costs = fundingPaid(pos, rates, end) + borrowPaid(pos, end);
      const lp = liqPrice(pos, costs);
      if (pos.side === "long" ? b.l <= lp : b.h >= lp) {
        const worst = pos.side === "long" ? b.l : b.h;
        const shortfall = Math.max(0, -(pos.margin + pnl(pos, worst) - costs));
        return { t: b.t, price: lp, shortfall };
      }
    }
    return null;
  }

  function equity(balance, positions, mark, now, rates = []) {
    return positions.reduce((e, p) => e + Math.max(0, p.margin + pnl(p, mark) - fundingPaid(p, rates, now) - borrowPaid(p, now)), balance);
  }

  /* §9.6 weekly split of the fee pool (points). */
  function splitFees(pool) {
    const ins = pool * RULES.split.insurance, tre = pool - ins;
    return { insurance: ins, treasury: tre, buyback: tre * RULES.split.buybackOfTreasury };
  }

  const api = { RULES, returns, risk, premium, maxLeverage, fundingRates, fundingPaid, fundingAccrued, borrowPaid, pnl, liqPrice,
                open, close, liquidation, equity, bookTW, houseHour, splitFees };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ABIPilot = api;
})(typeof window !== "undefined" ? window : globalThis);
