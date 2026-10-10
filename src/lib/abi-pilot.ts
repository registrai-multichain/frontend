/**
 * ABI points pilot: the trading rules, economy v2 (spec §8). A TypeScript port of the reference engine
 * research/arc-builders-index/pilot/pilot.js (vendored for the parity tests at
 * builders-site/test/reference/pilot.cjs with its node tests). Every function must give exactly the
 * reference's results; builders-site/test/abi-pilot-engine.test.ts runs both.
 *
 * Funding: the rate in force during hour [t, t+1h) is F = mean hourly return of the last 6 closed hours
 * ending at t. A long accrues −F × notional per hour held, a short +F × notional (pro rata to the time held).
 *
 * Pure, no I/O. Points only; nothing here moves money.
 * RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */

export type Side = "long" | "short";

export const RULES = {
  startBalance: 10000,
  levels: [1, 2, 3, 5, 10, 20] as number[],
  /** Per side: on notional at open and on the exit notional at close. */
  feeRate: 0.0001,
  /** Maintenance margin, share of notional. */
  mm: 0.005,
  minMargin: 10,
  maxOpen: 5,
  /** Fills use the first mark after the order, at most this late (s). */
  markMaxAgeS: 10,
  /** max_lev = clamp(floor(volTarget / σ_24h), 1, 20), snapped down to an allowed level. */
  volTarget: 0.10,
  pauseSigmas: 5,
  pauseFloor: 0.005,
  /** Funding = mean hourly return of the last `window` closed hours. */
  window: 6,
  /** σ for the leverage cap and the pause: the last `sigmaWindow` closed hours. */
  sigmaWindow: 24,
};

export interface PilotPosition {
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  liq: number;
  openedAt: number;
}

/** Rate in force during [t, t + 3600). */
export interface FundingRate {
  t: number;
  rate: number;
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

export type OpenResult =
  | { ok: true; position: PilotPosition; fee: number; balance: number; error?: undefined }
  | { error: string; ok?: undefined };

type Pos = Pick<PilotPosition, "side" | "entry" | "notional">;
type PosM = Pos & Pick<PilotPosition, "margin">;
type PosT = Pick<PilotPosition, "side" | "notional" | "openedAt">;

/** closes: hourly closes, ascending (last = latest closed hour). */
export function returns(closes: readonly number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}

export function risk(closes: readonly number[]): { funding: number; sigma1h: number; sigma24: number } {
  const all = returns(closes);
  const rf = all.slice(-RULES.window), rs = all.slice(-RULES.sigmaWindow);
  if (!rs.length) return { funding: 0, sigma1h: 0, sigma24: 0 };
  const funding = rf.reduce((a, b) => a + b, 0) / rf.length;
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  return { funding, sigma1h: sd, sigma24: sd * Math.sqrt(24) };
}

export function maxLeverage({ sigma24, sigma1h, ch1 }: Risk): { max: number; paused: boolean } {
  const raw = (sigma24 as number) > 0 ? Math.floor(RULES.volTarget / (sigma24 as number)) : RULES.levels[RULES.levels.length - 1];
  const cap = Math.max(1, Math.min(20, raw));
  const max = RULES.levels.filter((l) => l <= cap).pop() as number;
  const limit = Math.max(RULES.pauseSigmas * (sigma1h || 0), RULES.pauseFloor);
  return { max, paused: Math.abs(ch1 || 0) > limit };
}

/** Funding accrued from openedAt to `to` (unix s). Positive = credited to the position. */
export function fundingAccrued(pos: PosT, rates: readonly FundingRate[], to: number): number {
  const dir = pos.side === "long" ? -1 : 1;
  let f = 0;
  for (const { t, rate } of rates) {
    const a = Math.max(t, pos.openedAt), b = Math.min(t + 3600, to);
    if (b > a) f += dir * rate * pos.notional * (b - a) / 3600;
  }
  return f;
}

export function pnl(pos: Pos, mark: number): number {
  const r = mark / pos.entry - 1;
  return pos.notional * (pos.side === "long" ? r : -r);
}

/** Liquidation price given funding accrued so far: where margin + PnL + funding = mm × notional. */
export function liqPrice(pos: PosM, funding = 0): number {
  const d = (pos.margin + funding - RULES.mm * pos.notional) / pos.notional;
  return pos.side === "long" ? pos.entry * (1 - d) : pos.entry * (1 + d);
}

/** account: { balance, open } (open = number of open positions). */
export function open(
  account: { balance: number; open: number },
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
  const notional = margin * lev, fee = notional * RULES.feeRate;
  if (margin + fee > account.balance) return { error: "insufficient balance" };
  const position = { side, margin, lev, notional, entry: mark, openedAt: now } as PilotPosition;
  position.liq = liqPrice(position, 0);
  return { ok: true, position, fee, balance: account.balance - margin - fee };
}

/** Closing at `mark` at time `now`: margin + PnL + funding − fee on the exit notional, never below 0. */
export function close(pos: PosM & PosT, mark: number, now: number, rates: readonly FundingRate[] = []): { pnl: number; funding: number; fee: number; payout: number } {
  const p = pnl(pos, mark), f = fundingAccrued(pos, rates, now);
  const fee = pos.notional * (mark / pos.entry) * RULES.feeRate;
  return { pnl: p, funding: f, fee, payout: Math.max(0, pos.margin + p + f - fee) };
}

/**
 * First one-minute bar starting at or after the open whose low (long) / high (short) crosses the liquidation
 * price, with funding accrued to the end of that bar. bars ascending. → { t, price } | null
 */
export function liquidation(pos: PosM & PosT, bars: readonly MinuteBar[], rates: readonly FundingRate[] = []): { t: number; price: number } | null {
  for (const b of bars) {
    if (b.t < pos.openedAt) continue;
    const lp = liqPrice(pos, fundingAccrued(pos, rates, b.t + 60));
    if (pos.side === "long" ? b.l <= lp : b.h >= lp) return { t: b.t, price: lp };
  }
  return null;
}

export function equity(balance: number, positions: readonly (PosM & PosT)[], mark: number, now: number, rates: readonly FundingRate[] = []): number {
  return positions.reduce((e, p) => e + Math.max(0, p.margin + pnl(p, mark) + fundingAccrued(p, rates, now)), balance);
}
