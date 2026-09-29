/**
 * Registrai's prediction markets are frozen (2026-09-29): no new markets and no
 * new trades on any site. Balances and settled positions can still be withdrawn
 * and claimed on app.registrai.cc/rounds/, so nobody's money is locked in.
 */
export const MARKETS_FROZEN = true;

export const FREEZE = {
  title: "Prediction markets are frozen",
  text: "We've paused Registrai's prediction markets over legal concerns: no new markets and no new trades. A strategic update will be announced soon.",
  funds:
    "Your money stays yours. Withdraw your trading balance and claim settled positions at any time; positions in markets that are still open can be claimed once they settle or void.",
  withdrawHref: "https://app.registrai.cc/rounds/",
} as const;
