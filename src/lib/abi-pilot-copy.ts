/**
 * ABI points pilot: the page copy and number formats. Plain labels; explanations sit behind an "i"
 * bubble; the two disclaimers are always visible above the order button (plan R7; economy v3 plan R8).
 * The copy lint (src/lib/abi-pilot-copy.test.ts) bans prize-type words everywhere in pilot copy except
 * inside these two exact disclaimer strings.
 */
import { RULES } from "./abi-pilot";

export const PILOT_DISCLAIMER = "Points only. No deposits, no prizes; points have no value.";
export const PILOT_LIQ_NOTE = "Liquidation only takes the position's margin.";
export const PILOT_DISCLAIMERS = [PILOT_DISCLAIMER, PILOT_LIQ_NOTE] as const;

const pct = (x: number) => `${+(x * 100).toFixed(3)}%`;
const top = RULES.levels[RULES.levels.length - 1];

export const PILOT_COPY = {
  heading: "Points pilot",
  closed: "The points pilot is not open yet.",
  holdRegi: "Hold REGI to join the points pilot.",
  notAtSnapshot: "This wallet didn't hold REGI at the pilot snapshot block.",
  regiUnchecked: "Couldn't check REGI right now",
  signIn: "Sign in",
  signingIn: "Check your wallet…",
  signOut: "Sign out",
  signInTip:
    "Sign a one-time message with a wallet that held at least 1 REGI on Arc at the pilot snapshot block and still does. It is not a transaction and costs nothing. The session lasts 12 hours. Smart-contract wallets aren't supported yet.",
  rulesTip:
    `Market orders fill at the first ABI mark posted after the order (the mark updates every 5 s); with no mark within ${RULES.markMaxAgeS} s the order is refused. ` +
    `Leverage ${RULES.levels.join(", ")}×, capped at the lower of ${RULES.volTarget} ÷ σ_24h and 1 ÷ (${pct(RULES.jump)} + ${pct(RULES.mm)}), so a ${pct(RULES.jump)} milestone step stays inside the margin; from 1× to ${top}×. ` +
    `New orders pause while the last hour moved more than max(${RULES.pauseSigmas}σ_1h, ${pct(RULES.pauseFloor)}), for a minute around each hour's base sample, and until the hour's funding is set. ` +
    `Fee ${(RULES.feeRate * 100).toFixed(2)}% of size per side. Borrow ${pct(RULES.borrowApr)} a year on size − margin, per hour held. ` +
    `Maintenance margin ${pct(RULES.mm)}; liquidation is checked on one-minute bars and moves with funding and borrow. ` +
    "One direction at a time: close your longs before opening a short, and the reverse. " +
    `Minimum margin ${RULES.minMargin} pts, up to ${RULES.maxOpen} open positions. Starting balance ${RULES.startBalance.toLocaleString("en-US")} pts, once per wallet.`,
  fundingTip:
    "Each hour's rates are set at the start of the hour from the open positions, per point of size per hour held. " +
    `Trend: longs pay and shorts receive ABI's mean hourly move over the last ${RULES.window} closed hours, with milestone steps taken out. ` +
    `Skew: the larger side pays up to max(${RULES.rMaxMult}σ_1h, ${pct(RULES.rMinFloor)}) an hour, in proportion to the imbalance; ` +
    `the smaller side and the house receive ${pct(1 - RULES.fundingCut)} of that per point and the pilot keeps ${pct(RULES.fundingCut)}. ` +
    "Funding counts toward equity, closing and liquidation.",
  borrowTip: `${pct(RULES.borrowApr)} a year on the borrowed part (size − margin), charged per hour held and settled at close.`,
  liqTip: "Funding and borrow paid move the liquidation price toward the mark. The second figure assumes 24 h at this hour's rates.",
  economyTip:
    "The house takes the other side of the net imbalance between longs and shorts, under the same funding rules. " +
    "Trading fees, borrow, the funding cut and the house's positive result form the fee pool. " +
    `Each Monday 00:00 UTC the pool splits: ${pct(RULES.split.insurance)} to insurance and ${pct(RULES.split.treasury)} to the treasury, ` +
    `${pct(RULES.split.buybackOfTreasury)} of which is set aside for a REGI buyback. All in points; nothing is bought during the pilot.`,
  insuranceTip: "Covers losses beyond a position's margin when the index jumps past its liquidation price. It can run below zero until the next split.",
  noEconomy: "No economy data yet.",
  leaderboardTip: "Balance plus open positions (with funding and borrow) at the latest mark. Top 50, refreshed every minute.",
  priceUpdating: "Price updating",
  paused: `Paused: ABI moved more than max(${RULES.pauseSigmas}σ_1h, ${pct(RULES.pauseFloor)}) in the last hour.`,
  basePaused: "Paused for a minute around the hour's base sample.",
  milestonePaused: "Paused: index milestone",
  milestoneTip: "Recorded milestones change the index at once; orders pause for a minute so nobody trades on stale prices.",
  capped: (max: number) => `Max ${max}× at ABI's current volatility.`,
  closeFirst: (held: "long" | "short") => `Close your ${held} first`,
  filling: "Filling at the next mark…",
  signInForPositions: "Sign in to see your positions.",
  noPositions: "No open positions.",
  noHistory: "No closed positions yet.",
  noLeaderboard: "No accounts yet.",
  noFunding: "No funding rates yet.",
  liquidated: "Liquidated",
  closedReason: "Closed",
} as const;

/** "+0.0123%/h" */
export const fmtRate = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${(Math.abs(r) * 100).toFixed(4)}%/h`;
/** A side's rate with its direction: "pays 0.0123%/h", "receives 0.0110%/h" (+ = pays). */
export const fmtSideRate = (r: number) => (r > 0 ? `pays ${fmtRate(r).slice(1)}` : r < 0 ? `receives ${fmtRate(r).slice(1)}` : fmtRate(0));
/** "+0.42" → skew as a signed share: "+42% long" / "−30% short" / "0%". */
export const fmtSkew = (s: number) => (s > 0 ? `${Math.round(s * 100)}% long` : s < 0 ? `${Math.round(-s * 100)}% short` : "0%");
/** Borrow per day at a size: (size − margin) × APR / 365. */
export const borrowPerDay = (notional: number, margin: number) => (notional - margin) * RULES.borrowApr / 365;
/** "14:00" (UTC) */
export const fmtHour = (unixS: number) => {
  const d = new Date(unixS * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** "Open long 2×" */
export const openLabel = (side: "long" | "short", lev: number) => `Open ${side} ${lev}×`;

export function fmtPts(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtSigned(n: number): string {
  const s = fmtPts(Math.abs(n));
  return n > 0.004 ? `+${s}` : n < -0.004 ? `−${s}` : s;
}
export const fmtPx = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "10 Oct 14:05" (UTC) */
export function fmtWhen(unixS: number): string {
  const d = new Date(unixS * 1000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
