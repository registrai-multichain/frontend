/**
 * Points pilot (ABI, AII and AEI): the page copy and number formats. Plain labels; explanations sit behind an "i"
 * bubble; the disclaimers are always visible above the order button (plan R7; economy v3 plan R8; audit L4).
 * The copy lint (src/lib/abi-pilot-copy.test.ts) bans prize-type words everywhere in pilot copy except
 * inside these two exact disclaimer strings.
 */
import { RULES } from "./abi-pilot";
import { fmtUsd, holdUsdText, lockUsdText } from "./abi-pilot-api";

export const PILOT_DISCLAIMER = "Points only. No deposits, no prizes; points have no value.";
export const PILOT_LIQ_NOTE = "Liquidation only takes the position's margin.";
/** Audit L4: the risk that decides outcomes at high leverage, inline (never only behind "i"). Index-neutral: every market. */
export const PILOT_JUMP_NOTE = "Recorded milestones move the index at once and can liquidate leveraged positions.";
export const PILOT_DISCLAIMERS = [PILOT_DISCLAIMER, PILOT_LIQ_NOTE, PILOT_JUMP_NOTE] as const;

const pct = (x: number) => `${+(x * 100).toFixed(3)}%`;
const top = RULES.levels[RULES.levels.length - 1];

/**
 * Owner decisions 2026-10-13: $10 of REGI (PILOT_ADMIT_USD) at sign-in and when each order is placed, at the 24 h
 * median price. snapshot: a PILOT_REGI_SNAPSHOT_BLOCK is set, so the wallet must also have held the amount there.
 */
const regiRule = (usd: number, snapshot = false) =>
  `The wallet needs at least ${fmtUsd(usd)} of REGI on Arc at sign-in and when it places each order${snapshot ? ", and must have held that amount at the pilot snapshot block" : ""}. ` +
  "REGI is priced at the median of the REGI/USDC pool over the last 24 hours. The leaderboard shows only wallets that currently hold the amount.";
const SIGN_IN_NOTE = "Sign in with a one-time message: it is not a transaction and costs nothing. The session lasts 12 hours. Smart-contract wallets aren't supported yet.";

/** Plan 2026-10-12 R9: what the pilot trades and what is shared or per market (the rules page, the Terms, the "i"). */
const MARKETS_RULE =
  "The pilot trades ABI, AII and AEI. One points balance per wallet covers all three markets. " +
  `You hold one direction at a time in each market, and up to ${RULES.maxOpen} open positions per market. ` +
  "Each market has its own mark, funding rates, house, fee pool, insurance and weekly split.";

export const PILOT_COPY = {
  heading: "Points pilot",
  marketsRule: MARKETS_RULE,
  closed: "The points pilot is not open yet.",
  misconfigured: "The points pilot is misconfigured; new orders are refused.",
  /** "Hold at least $10 of REGI to join the points pilot." */
  holdRegi: holdUsdText,
  notAtSnapshot: "This wallet didn't hold REGI at the pilot snapshot block.",
  regiUnchecked: "Couldn't check REGI right now",
  signIn: "Sign in",
  /** "I'm 18 or older and accept the Terms and the Privacy notice." with the two links */
  agreeBefore: "I'm 18 or older and accept the ",
  agreeTerms: "Terms",
  agreeAnd: " and the ",
  agreePrivacy: "Privacy notice",
  agreeAfter: ".",
  signingIn: "Check your wallet…",
  signOut: "Sign out",
  /** The REGI rule, behind the sign-in "i" and on the Pilot rules page. */
  regiRule,
  /** Sign-in itself (the Pilot rules page lists it apart from the REGI rule). */
  signInNote: SIGN_IN_NOTE,
  signInTip: (usd: number, snapshot = false) => `${regiRule(usd, snapshot)} ${SIGN_IN_NOTE}`,
  rulesTip:
    `Market orders fill at the first mark of the order's index posted after the order (the mark updates every 5 s); with no mark within ${RULES.markMaxAgeS} s the order is refused. ` +
    `Leverage ${RULES.levels.join(", ")}×, capped at the lower of ${RULES.volTarget} ÷ σ_24h and 1 ÷ (${pct(RULES.jump)} + ${pct(RULES.mm)}), so a ${pct(RULES.jump)} milestone step stays inside the margin; from 1× to ${top}×. ` +
    `New orders pause while the index moved more than max(${RULES.pauseSigmas}σ_1h, ${pct(RULES.pauseFloor)}) in the last hour, and for a minute around each hour's base sample (ABI and AEI; AII has no base layer). Orders and closes wait for each hour's funding to be set (about 15 s); liquidation checks don't. ` +
    `Fee ${(RULES.feeRate * 100).toFixed(2)}% of size per side. Borrow ${pct(RULES.borrowApr)} a year on size − margin, per hour held. ` +
    `Maintenance margin ${pct(RULES.mm)}; liquidation is checked on one-minute bars and moves with funding and borrow. ` +
    "One direction at a time in each market: close your longs there before opening a short, and the reverse. " +
    `Minimum margin ${RULES.minMargin} pts. Starting balance ${RULES.startBalance.toLocaleString("en-US")} pts, once per wallet.`,
  fundingTip:
    "Each market's rates are set at the start of every hour from its open positions, per point of size per hour held. " +
    `Trend: longs pay and shorts receive the index's mean hourly move over the last ${RULES.window} closed hours, with milestone steps taken out. ` +
    `Milestone premium: longs also pay the mean hourly milestone step of the last ${RULES.premiumWindow / 24} days, to the house; it is part of the long rate. ` +
    `Skew: the larger side pays up to max(${RULES.rMaxMult}σ_1h, ${pct(RULES.rMinFloor)}) an hour, in proportion to the imbalance; ` +
    `the smaller side and the house receive ${pct(1 - RULES.fundingCut)} of that per point and the pilot keeps ${pct(RULES.fundingCut)}. ` +
    "Funding counts toward equity, closing and liquidation.",
  borrowTip: `${pct(RULES.borrowApr)} a year on the borrowed part (size − margin), charged per hour held and settled at close.`,
  liqTip: "Funding and borrow paid move the liquidation price toward the mark. The second figure assumes 24 h at this hour's rates.",
  bookTip: "Each side's share of open size, averaged over the hour before the rates were set. The larger side pays the skew rate.",
  houseLinesTip:
    "Price: the house's side of the book times the index move. Funding: what positions paid and received, less the pilot's cut. " +
    "True-up: the difference to the exact result of each position, booked every hour and when it closes. " +
    "Liquidations: equity left at a liquidation, less gaps insurance could not cover.",
  economyTip:
    "Each market has its own house, fee pool, insurance and weekly split; this tab shows the market of the index above. " +
    "The house takes the other side of the net imbalance between longs and shorts, under the same funding rules. " +
    "Trading fees, borrow, the funding cut and the house's realized result (from closed and liquidated positions) form the fee pool; " +
    "its result on open positions stays in its book until they close, and a loss carries over. " +
    `Each Monday 00:00 UTC the pool splits: ${pct(RULES.split.insurance)} to insurance and ${pct(RULES.split.treasury)} to the treasury, ` +
    `${pct(RULES.split.buybackOfTreasury)} of which is set aside for a REGI buyback. All in points; nothing is bought during the pilot.`,
  insuranceTip: "Covers losses beyond a position's margin when the index jumps past its liquidation price, up to its balance; the house carries the rest. No position loses more than its margin.",
  noEconomy: "No economy data yet.",
  leaderboardTip: "Balance plus open positions in every market (with funding and borrow), each at its market's latest mark. Only wallets that currently hold the REGI needed to join. Top 50, refreshed every minute.",
  priceUpdating: "Price updating",
  paused: `Paused: the index moved more than max(${RULES.pauseSigmas}σ_1h, ${pct(RULES.pauseFloor)}) in the last hour.`,
  basePaused: "Paused for a minute around the hour's base sample.",
  milestonePaused: "Paused: index milestone",
  milestoneTip: "Recorded milestones change the index at once; orders pause for a minute so nobody trades on stale prices.",
  /** "Max 5× at AII's current volatility." */
  capped: (max: number, code = "ABI") => `Max ${max}× at ${code}'s current volatility.`,
  closeFirst: (held: "long" | "short") => `Close your ${held} first`,
  filling: "Filling at the next mark…",
  signInForPositions: "Sign in to see your positions.",
  noPositions: "No open positions.",
  noHistory: "No closed positions yet.",
  noLeaderboard: "No accounts yet.",
  noFunding: "No funding rates yet.",
  liquidated: "Liquidated",
  closedReason: "Closed",
  /** History: a position the site closed because the wallet withdrew REGI below its lock requirement (plan 2026-10-13 R4). */
  lockClosed: "Lock withdrawn",

  // REGI in dollars and the REGI lock (plan 2026-10-13 R2, R3, R6)
  regiPriceUpdating: "REGI price updating",
  priceTip: "REGI is priced at the median of the REGI/USDC pool over the last 24 hours, sampled every 10 minutes. The dollar amounts are converted at that price.",
  /** "Lock at least $50 of REGI to trade with leverage." */
  lockNeeded: lockUsdText,
  lockNotLive: "Leverage above 1× opens when the REGI lock is live.",
  lockHeading: "REGI lock",
  lockTip: (usd: number) =>
    "Each wallet gets its own vault contract. Only that wallet can move REGI out of it; the pilot only reads how much it holds. " +
    `Leverage above 1× needs at least ${fmtUsd(usd)} of REGI locked, at the 24 h median price. Each leveraged position keeps the amount needed when it opened; ` +
    "a withdrawal that leaves less than that closes the position at the next price.",
  /** Owner copy (R6), inline next to the lock button. */
  lockNote: "Locked REGI stays yours. You can withdraw it at any time; withdrawing closes your leveraged positions.",
  /** R6: inline with the withdraw button. */
  withdrawWarn: "Withdrawing closes your leveraged positions at the next price.",
  lockButton: "Lock REGI",
  withdrawButton: "Withdraw",
  /** R6: vault.claimRewards; the copy lint bans the contract's word, so the label says what it is. */
  claimButton: "Claim holder distributions",
  claimTip: "REGI in your vault still collects its REGI holder distributions from the launch portal. This sends them to your wallet.",
  wrongWallet: "Switch your wallet to the signed-in address to lock or withdraw.",
  txApprove: "Approve REGI in your wallet…",
  txConfirm: "Confirm in your wallet…",
  txWaiting: "Waiting for confirmation…",
  txLocked: "Locked.",
  txWithdrawn: "Withdrawn.",
  txClaimed: "Claimed.",
  txFailed: "Transaction failed.",
  notEnoughRegi: "Not enough REGI in the wallet",
} as const;

/** "+0.0123%/h" */
export const fmtRate = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${(Math.abs(r) * 100).toFixed(4)}%/h`;
/** A side's rate with its direction: "pays 0.0123%/h", "receives 0.0110%/h" (+ = pays). */
export const fmtSideRate = (r: number) => (r > 0 ? `pays ${fmtRate(r).slice(1)}` : r < 0 ? `receives ${fmtRate(r).slice(1)}` : fmtRate(0));
/** The book as each side's share of open notional (review S4): a 75/25 book is "75% long · 25% short", not skew 0.5. */
export const fmtBook = (L: number, S: number) => {
  const oi = L + S;
  if (!(oi > 0)) return "No positions";
  const l = Math.round((L / oi) * 100);
  return `${l}% long · ${100 - l}% short`;
};
/** Borrow per day at a size: (size − margin) × APR / 365. */
export const borrowPerDay = (notional: number, margin: number) => (notional - margin) * RULES.borrowApr / 365;
/** "14:00" (UTC) */
export const fmtHour = (unixS: number) => {
  const d = new Date(unixS * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** "Open long AII 2×": the button names the market it trades (plan 2026-10-12 R8). */
export const openLabel = (side: "long" | "short", lev: number, code = "ABI") => `Open ${side} ${code} ${lev}×`;

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
