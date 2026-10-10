/**
 * ABI points pilot: the page copy and number formats. Plain labels; explanations sit behind an "i"
 * bubble; the two disclaimers are always visible above the order button (plan R7).
 * The copy lint (src/lib/abi-pilot-copy.test.ts) bans prize-type words everywhere in pilot copy except
 * inside these two exact disclaimer strings.
 */
import { RULES } from "./abi-pilot";

export const PILOT_DISCLAIMER = "Points only. No deposits, no prizes; points have no value.";
export const PILOT_LIQ_NOTE = "Liquidation only takes the position's margin.";
export const PILOT_DISCLAIMERS = [PILOT_DISCLAIMER, PILOT_LIQ_NOTE] as const;

const pct = (x: number) => `${+(x * 100).toFixed(2)}%`;

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
    `Leverage ${RULES.levels.join(", ")}×, capped from ABI's volatility: max = ${RULES.volTarget} ÷ σ_24h, from 1× to 20×. ` +
    `New orders pause while the last hour moved more than max(${RULES.pauseSigmas}σ_1h, ${pct(RULES.pauseFloor)}), and for a minute around each hour's base sample. ` +
    `Fee ${(RULES.feeRate * 100).toFixed(2)}% of size per side. Maintenance margin ${pct(RULES.mm)}; liquidation is checked on one-minute bars and moves with funding. ` +
    "One direction at a time: close your longs before opening a short, and the reverse. " +
    `Minimum margin ${RULES.minMargin} pts, up to ${RULES.maxOpen} open positions. Starting balance ${RULES.startBalance.toLocaleString("en-US")} pts, once per wallet.`,
  fundingTip:
    `Each hour's funding rate is ABI's mean hourly move over the last ${RULES.window} closed hours. ` +
    "Longs accrue −rate × size per hour held and shorts +rate × size, pro rata, so a steady trend is paid back to the side it runs against. " +
    "Funding counts toward equity, closing and liquidation.",
  leaderboardTip: "Balance plus open positions (with funding) at the latest mark. Top 50, refreshed every minute.",
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
