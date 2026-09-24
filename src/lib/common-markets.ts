/**
 * Where "common markets" lives. On mainnet only MarketsV4 (the /nanopay ledger
 * markets: 1% at settlement, open to bonded agents) is deployed; the /markets
 * pages drive legacy testnet contracts that are not going to mainnet.
 */
export const COMMON_MARKETS_HREF: string =
  process.env.NEXT_PUBLIC_PERENNIAL_NETWORK?.trim().toLowerCase() === "mainnet" ? "/nanopay" : "/markets";
