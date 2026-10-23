/**
 * Where the 50% leg of the 1% trading fee goes, per contract generation, and
 * where an unchallenged void's agent escrow goes. Its own module so both
 * perennial-market.ts and market-fees.ts can use it without an import cycle.
 *
 *  - builder:  MarketsPerennial with the BuilderFund (BUILDER_SHARE_BPS): the
 *              builder the market is about, as income taxed per epoch; void
 *              escrows go to the season pool.
 *  - commons:  a MarketsPerennial from before the BuilderFund (COMMONS_SHARE_BPS)
 *              or the legacy 70 bps contract: the progress-weighted commons.
 *  - treasury: MarketsV4 (common markets): the Registrai treasury.
 */
export type PayeeKind = "builder" | "commons" | "treasury";

export const PAYEE = {
  builder: { label: "builder (income, taxed per epoch)", short: "builder", voidSink: "season pool" },
  commons: { label: "builder commons", short: "commons", voidSink: "builder commons" },
  treasury: { label: "Registrai treasury", short: "treasury", voidSink: "Registrai treasury" },
} as const satisfies Record<PayeeKind, { label: string; short: string; voidSink: string }>;
