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

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const PILOT_COPY = {
  heading: "Points pilot",
  closed: "The points pilot is not open yet.",
  holdRegi: "Hold REGI to join the points pilot.",
  signIn: "Sign in",
  signingIn: "Check your wallet…",
  signOut: "Sign out",
  signInTip:
    "Sign a one-time message with a wallet that holds at least 1 REGI on Arc. It is not a transaction and costs nothing. The session lasts 12 hours.",
  rulesTip:
    `Market orders at the server's ABI mark, updated every 5 s; an order needs a mark at most ${RULES.markMaxAgeS} s old. ` +
    `Leverage 1–3×: 3× while ABI's 24h move is under ${pct(RULES.capSteps[0][0])}, 2× under ${pct(RULES.capSteps[1][0])}, 1× above. ` +
    `New orders pause while the last hour moved more than ${pct(RULES.pauseHourMove)}. ` +
    `Fee ${(RULES.feeRate * 100).toFixed(2)}% of size on open and on close. Maintenance margin ${pct(RULES.mm)}; liquidation is checked on one-minute bars. ` +
    `Minimum margin ${RULES.minMargin} pts, up to ${RULES.maxOpen} open positions. Starting balance ${RULES.startBalance.toLocaleString("en-US")} pts, once per wallet. No funding.`,
  leaderboardTip: "Balance plus open positions at the latest mark. Top 50, refreshed every 30 s.",
  priceUpdating: "Price updating",
  paused: `Paused: ABI moved more than ${pct(RULES.pauseHourMove)} in the last hour.`,
  capped: (max: number) => `Max ${max}× while ABI's 24h move is large.`,
  signInForPositions: "Sign in to see your positions.",
  noPositions: "No open positions.",
  noHistory: "No closed positions yet.",
  noLeaderboard: "No accounts yet.",
  liquidated: "Liquidated",
  closedReason: "Closed",
} as const;

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
