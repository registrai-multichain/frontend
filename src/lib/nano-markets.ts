// Live MarketsV4 markets (settled on NanoLedger). The panel reads reserves,
// price, expiry, and phase from chain; this config only supplies the marketId
// and a human-readable question.
export interface NanoMarket {
  marketId: `0x${string}`;
  question: string;
  hint: string;
}

export const NANO_MARKETS: NanoMarket[] = [
  {
    marketId: "0x2d9248a87f5d4cff2a1b33baf8e0d5670a6218cbb04bc9addf87f1b71110c366",
    question: "BTC/USD ≥ 50,000 at expiry?",
    hint: "Demo market, resolves against a bonded oracle feed. Every trade settles on the ledger with no trading fee; 1% is charged once, at settlement.",
  },
];
