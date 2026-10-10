/**
 * ABI points pilot: the trading rules. A TypeScript port of the reference engine
 * research/arc-builders-index/pilot/pilot.js (vendored for the equivalence tests at
 * builders-site/test/reference/pilot.cjs). Every function must give exactly the
 * reference's results; builders-site/test/abi-pilot-engine.test.ts runs both.
 *
 * Pure, no I/O. Points only; nothing here moves money.
 * RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */

export type Side = "long" | "short";

export const RULES = {
  startBalance: 10000,
  levels: [1, 2, 3] as number[],
  /** On notional, at open and at close. */
  feeRate: 0.0006,
  /** Maintenance margin, share of notional. */
  mm: 0.02,
  minMargin: 10,
  maxOpen: 5,
  markMaxAgeS: 15,
  /** |24h move| below → max leverage. */
  capSteps: [[0.10, 3], [0.25, 2], [Infinity, 1]] as [number, number][],
  pauseHourMove: 0.04,
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

export interface MinuteBar {
  /** Minute start, unix seconds. */
  t: number;
  h: number;
  l: number;
  c: number;
}

export type OpenResult =
  | { ok: true; position: PilotPosition; fee: number; balance: number; error?: undefined }
  | { error: string; ok?: undefined };

export function maxLeverage({ ch24, ch1 }: { ch24?: number | null; ch1?: number | null }): { max: number; paused: boolean } {
  const a = Math.abs(ch24 || 0);
  const max = RULES.capSteps.find(([lim]) => a < lim)![1];
  return { max, paused: Math.abs(ch1 || 0) > RULES.pauseHourMove };
}

export function liqPrice(side: Side | string, entry: number, lev: number): number {
  const d = 1 / lev - RULES.mm;
  return side === "long" ? entry * (1 - d) : entry * (1 + d);
}

/** account: { balance, open } (open = number of open positions). */
export function open(
  account: { balance: number; open: number },
  { side, margin, lev, mark, now, ch24, ch1 }: { side: string; margin: number; lev: number; mark: number; now: number; ch24?: number | null; ch1?: number | null },
): OpenResult {
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
  const position: PilotPosition = { side, margin, lev, notional, entry: mark, liq: liqPrice(side, mark, lev), openedAt: now };
  return { ok: true, position, fee, balance: account.balance - margin - fee };
}

export function pnl(pos: Pick<PilotPosition, "side" | "entry" | "notional">, mark: number): number {
  const r = mark / pos.entry - 1;
  return pos.notional * (pos.side === "long" ? r : -r);
}

/** Closing at `mark`: what returns to the balance (margin + PnL − close fee, never below 0). */
export function close(pos: Pick<PilotPosition, "side" | "entry" | "notional" | "margin">, mark: number): { pnl: number; fee: number; payout: number } {
  const p = pnl(pos, mark), fee = (pos.notional + p) * RULES.feeRate;
  return { pnl: p, fee, payout: Math.max(0, pos.margin + p - Math.max(0, fee)) };
}

/**
 * First one-minute bar opened after the position whose low (long) / high (short) crosses the
 * liquidation price. bars ascending. Returns { t, price } or null.
 */
export function liquidation(pos: Pick<PilotPosition, "side" | "liq" | "openedAt">, bars: readonly MinuteBar[]): { t: number; price: number } | null {
  for (const b of bars) {
    if (b.t < pos.openedAt) continue;
    if (pos.side === "long" ? b.l <= pos.liq : b.h >= pos.liq) return { t: b.t, price: pos.liq };
  }
  return null;
}

export function equity(balance: number, positions: readonly Pick<PilotPosition, "side" | "entry" | "notional" | "margin">[], mark: number): number {
  return positions.reduce((e, p) => e + Math.max(0, p.margin + pnl(p, mark)), balance);
}
