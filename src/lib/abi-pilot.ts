/**
 * ABI points pilot: the trading rules, economy v3 (spec §9, revised §9.13). A TypeScript port of the reference
 * engine research/arc-builders-index/pilot/pilot.js v3 (vendored for the parity tests at
 * builders-site/test/reference/pilot.cjs with its node tests and fixtures-v3.json). Every function must give
 * exactly the reference's results, at full double precision; builders-site/test/abi-pilot-engine.test.ts runs both.
 *
 * Funding (§9.13): each closed hour fixes the next hour's rates. Trend term: every position pays (long) or receives
 * (short) the ex-milestone drift (mean hourly return of the last 6 closed hours, milestone steps divided out). Skew
 * term: the heavier side pays |r| = r_max · |skew|, r_max = max(1.5 · σ_1h, 0.005%/h); the lighter side, including
 * the house (always the counterparty to the net imbalance), receives 90% of that per unit; the protocol keeps 10%.
 * Milestone premium (§9.15, audit PE-2): longs also pay the trailing 30-day mean hourly log milestone step, to the house.
 * Rates are stored per hour as { t, long, short }: points per unit of notional per hour, + = pays.
 * Borrow fee (§9.3): APR on notional − margin, hourly pro rata. Leverage (§9.4): min(volatility cap, jump cap).
 *
 * Pure, no I/O. Points only; nothing here moves money.
 * RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */

export type Side = "long" | "short";

export const RULES = {
  startBalance: 10000,
  levels: [1, 2, 3, 5, 10, 20, 30] as number[],
  /** Per side: on notional at open and on the exit notional at close. */
  feeRate: 0.0001,
  /** Maintenance margin, share of notional. */
  mm: 0.005,
  minMargin: 10,
  maxOpen: 5,
  /** Fills use the first mark after the order, at most this late (s). */
  markMaxAgeS: 10,
  /** Volatility cap = floor(volTarget / σ_24h). */
  volTarget: 0.10,
  /** Largest one-step milestone move to survive: jump cap = floor(1 / (jump + mm)). */
  jump: 0.025,
  pauseSigmas: 5,
  pauseFloor: 0.005,
  /** Trend: mean hourly return of the last `window` closed hours (milestone steps removed). */
  window: 6,
  /** σ for the leverage cap and the pause: the last `sigmaWindow` closed hours. */
  sigmaWindow: 24,
  /** Full-skew funding = rMaxMult · σ_1h … */
  rMaxMult: 1.5,
  /** … but at least this per hour, so a lopsided book always pays something. */
  rMinFloor: 0.00005,
  /** Protocol share of every skew-funding payment. */
  fundingCut: 0.10,
  borrowApr: 0.10,
  split: { insurance: 0.2, treasury: 0.8, buybackOfTreasury: 0.5 },
  /** §9.15 milestone premium: mean hourly log milestone step over the last 30 days (720 h). */
  premiumWindow: 720,
};

export interface PilotPosition {
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  openedAt: number;
  liq: number;
}

/**
 * Rates in force during [t, t + 3600): points per unit of notional per hour, + = pays. The v2 form { t, rate }
 * (long = rate, short = −rate) is still accepted, as in the reference.
 */
export interface FundingRate {
  t: number;
  long?: number | null;
  short?: number | null;
  rate?: number;
}

export interface MinuteBar {
  /** Minute start, unix seconds. */
  t: number;
  h: number;
  l: number;
  c: number;
}

export interface Risk {
  sigma24?: number | null;
  sigma1h?: number | null;
  ch1?: number | null;
}

export interface FundingRates {
  skew: number;
  rMax: number;
  /** > 0: longs heavy, longs pay. */
  r: number;
  heavy: Side | null;
  /** Per unit of notional per hour, + = pays. */
  long: number;
  short: number;
  /** Protocol cut, points per hour. */
  cut: number;
  /** Skew funding the heavy side pays, points per hour. */
  paid: number;
  /** The house's signed notional (+ = long): always S − L. */
  houseExposure: number;
  houseSkew: number;
  houseTrend: number;
  /** §9.15: the milestone premium the longs pay the house, points per hour (premium · L). */
  housePremium: number;
  /** Points per hour to the house and the fee pool (cut and premium included). */
  houseFunding: number;
}

export type OpenResult =
  | { ok: true; position: PilotPosition; fee: number; balance: number; error?: undefined }
  | { error: string; ok?: undefined };

type Pos = Pick<PilotPosition, "side" | "entry" | "notional">;
type PosM = Pos & Pick<PilotPosition, "margin">;
type PosT = Pick<PilotPosition, "side" | "notional" | "openedAt">;
type PosB = Pick<PilotPosition, "notional" | "margin" | "openedAt">;
type PosAll = PosM & PosT;

/**
 * closes: hourly closes, ascending. steps (optional): { i: factor } = the milestone factor applied in the return
 * closes[i-1] → closes[i]; it is divided out so a one-off step doesn't feed funding.
 */
export function returns(closes: readonly number[], steps: Readonly<Record<number, number>> = {}): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] / (steps[i] || 1) - 1);
  return r;
}

/** Fewer than 2 closes: everything unknown (null), not zero; callers refuse orders. */
export function risk(
  closes: readonly number[],
  steps: Readonly<Record<number, number>> = {},
): { trend: number | null; funding: number | null; sigma1h: number | null; sigma24: number | null; premium: number | null } {
  const all = returns(closes, steps);
  const rf = all.slice(-RULES.window), rs = all.slice(-RULES.sigmaWindow);
  if (!rs.length) return { trend: null, funding: null, sigma1h: null, sigma24: null, premium: null };
  const trend = rf.reduce((a, b) => a + b, 0) / rf.length;
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  return { trend, funding: trend, sigma1h: sd, sigma24: sd * Math.sqrt(24), premium: premium(closes.length, steps) };
}

/**
 * §9.15 (audit PE-2): milestone steps only go up and the trend divides them out, so longs held a free option the
 * house paid for. Longs pay the expected step instead: Σ ln(step) over the milestone steps in the last
 * premiumWindow hourly returns, ÷ premiumWindow, per hour per unit of notional. steps: { i: factor } as in
 * returns(); n = closes.length.
 */
export function premium(n: number, steps: Readonly<Record<number, number>> = {}): number {
  let s = 0;
  for (const k in steps) {
    const i = +k;
    if (i > n - 1 - RULES.premiumWindow && i <= n - 1 && steps[k] > 0) s += Math.log(steps[k]);
  }
  return Math.max(0, s / RULES.premiumWindow); // never negative (every milestone tier is a rise), as pilot.js
}

export function maxLeverage({ sigma24, sigma1h, ch1 }: Risk): { max: number; paused: boolean } {
  const top = RULES.levels[RULES.levels.length - 1];
  const vol = (sigma24 as number) > 0 ? Math.floor(RULES.volTarget / (sigma24 as number)) : top;
  const jump = Math.floor(1 / (RULES.jump + RULES.mm));
  const cap = Math.max(1, Math.min(top, vol, jump));
  const max = RULES.levels.filter((l) => l <= cap).pop() as number;
  const limit = Math.max(RULES.pauseSigmas * (sigma1h || 0), RULES.pauseFloor);
  return { max, paused: Math.abs(ch1 || 0) > limit };
}

/**
 * The next hour's rates from the traders' book at the close (L, S: long / short open notional). The house is the
 * counterparty to the net imbalance (pool model): it always holds S − L, i.e. it fills the light side.
 * - Trend term (every position): long pays `trend`, short pays −trend per unit per hour; the house collects
 *   trend · (L − S), exactly the drift on its own exposure.
 * - Skew term: r = r_max · skew; the heavy side pays |r| per unit; the light side, house included, receives
 *   (1 − cut) · |r| per unit; the protocol keeps cut · |r| · H.
 */
export function fundingRates({ L, S, trend, sigma1h, premium = 0 }: { L: number; S: number; trend?: number | null; sigma1h?: number | null; premium?: number | null }): FundingRates {
  const oi = L + S, skew = oi > 0 ? (L - S) / oi : 0;
  const rMax = Math.max(RULES.rMaxMult * (sigma1h || 0), RULES.rMinFloor);
  const r = rMax * skew;
  const heavy: Side | null = r > 0 ? "long" : r < 0 ? "short" : null;
  const H = heavy === "long" ? L : S;
  const paid = Math.abs(r) * H, cut = RULES.fundingCut * paid;
  const recv = (1 - RULES.fundingCut) * Math.abs(r);
  const tr = trend || 0;
  const pm = premium || 0; // §9.15: longs only, the house collects it
  const long = tr + pm + (heavy === "long" ? Math.abs(r) : heavy === "short" ? -recv : 0);
  const short = -tr + (heavy === "short" ? Math.abs(r) : heavy === "long" ? -recv : 0);
  const houseExposure = S - L;
  const houseSkew = recv * Math.abs(houseExposure);
  const houseTrend = tr * (L - S);
  const housePremium = pm * L;
  return { skew, rMax, r, heavy, long, short, cut, paid, houseExposure, houseSkew, houseTrend, housePremium, houseFunding: houseSkew + houseTrend + housePremium + cut };
}

/**
 * §9.14a: the book that fixes the next hour's rates, time-weighted over the closing hour [from, to): each side's
 * notional × overlap / (to − from), closed positions included (closedAt: close or liquidation time; absent = open).
 */
export function bookTW(positions: readonly { side: Side | string; notional: number; openedAt: number; closedAt?: number | null }[], from: number, to: number): { L: number; S: number } {
  let L = 0, S = 0;
  for (const p of positions) {
    const a = Math.max(from, p.openedAt), b = Math.min(to, p.closedAt != null ? p.closedAt : to);
    if (b <= a) continue;
    const w = p.notional * (b - a) / (to - from);
    if (p.side === "long") L += w; else S += w;
  }
  return { L, S };
}

/** The house's hour: PnL of its exposure over the hour plus its funding receipts (points; cut included). */
export function houseHour({ L, S, open, close, trend, sigma1h, premium = 0 }: { L: number; S: number; open: number; close: number; trend?: number | null; sigma1h?: number | null; premium?: number | null }): {
  pricePnl: number; funding: number; total: number; exposure: number;
} {
  const fr = fundingRates({ L, S, trend, sigma1h, premium });
  const pricePnl = fr.houseExposure * (close / open - 1);
  return { pricePnl, funding: fr.houseFunding, total: pricePnl + fr.houseFunding, exposure: fr.houseExposure };
}

/** Points a position paid for funding from openedAt to `to` (negative = received). */
export function fundingPaid(pos: PosT, rates: readonly FundingRate[], to: number): number {
  let f = 0;
  for (const x of rates) {
    const a = Math.max(x.t, pos.openedAt), b = Math.min(x.t + 3600, to);
    if (b <= a) continue;
    const rate = x.long != null ? (pos.side === "long" ? x.long : (x.short as number)) : (pos.side === "long" ? (x.rate as number) : -(x.rate as number));
    f += rate * pos.notional * (b - a) / 3600;
  }
  return f;
}

/** The v2 name: funding credited (positive = received). */
export const fundingAccrued = (pos: PosT, rates: readonly FundingRate[], to: number): number => -fundingPaid(pos, rates, to);

/** Borrow fee paid from openedAt to `to`: APR on notional − margin, pro rata. */
export function borrowPaid(pos: PosB, to: number): number {
  const hours = Math.max(0, to - pos.openedAt) / 3600;
  return (pos.notional - pos.margin) * RULES.borrowApr / 8760 * hours;
}

export function pnl(pos: Pos, mark: number): number {
  const r = mark / pos.entry - 1;
  return pos.notional * (pos.side === "long" ? r : -r);
}

/** Liquidation price given costs paid so far (funding + borrow): margin + PnL − costs = mm × notional. */
export function liqPrice(pos: PosM, costs = 0): number {
  const d = (pos.margin - costs - RULES.mm * pos.notional) / pos.notional;
  return pos.side === "long" ? pos.entry * (1 - d) : pos.entry * (1 + d);
}

/**
 * account: { balance, open, side }: open = number of open positions, side = their direction, if any (one direction
 * per wallet at a time: no hedging).
 */
export function open(
  account: { balance: number; open: number; side?: Side | string | null },
  { side, margin, lev, mark, now, risk: rk = {} }: { side: string; margin: number; lev: number; mark: number; now: number; risk?: Risk },
): OpenResult {
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
  const position = { side, margin, lev, notional, entry: mark, openedAt: now } as PilotPosition;
  position.liq = liqPrice(position, 0);
  return { ok: true, position, fee, balance: account.balance - margin - fee };
}

/** Closing at `mark` at `now`: margin + PnL − funding paid − borrow − exit fee, never below 0. */
export function close(pos: PosAll, mark: number, now: number, rates: readonly FundingRate[] = []): {
  pnl: number; funding: number; borrow: number; fee: number; payout: number;
} {
  const p = pnl(pos, mark), fp = fundingPaid(pos, rates, now), bp = borrowPaid(pos, now);
  const fee = pos.notional * (mark / pos.entry) * RULES.feeRate;
  return { pnl: p, funding: -fp, borrow: bp, fee, payout: Math.max(0, pos.margin + p - fp - bp - fee) };
}

/**
 * First minute bar at or after the open whose low (long) / high (short) crosses the liquidation price, with funding
 * and borrow accrued to the end of that bar. → { t, price, shortfall } | null (shortfall: loss beyond the margin if
 * the bar gapped through, for the insurance pool).
 */
export function liquidation(pos: PosAll, bars: readonly MinuteBar[], rates: readonly FundingRate[] = []): { t: number; price: number; shortfall: number } | null {
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

export function equity(balance: number, positions: readonly PosAll[], mark: number, now: number, rates: readonly FundingRate[] = []): number {
  return positions.reduce((e, p) => e + Math.max(0, p.margin + pnl(p, mark) - fundingPaid(p, rates, now) - borrowPaid(p, now)), balance);
}

/** §9.6 weekly split of the fee pool (points). buyback is the earmark inside the treasury share. */
export function splitFees(pool: number): { insurance: number; treasury: number; buyback: number } {
  const ins = pool * RULES.split.insurance, tre = pool - ins;
  return { insurance: ins, treasury: tre, buyback: tre * RULES.split.buybackOfTreasury };
}
