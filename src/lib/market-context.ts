/**
 * Plain-English context layered over the markets and feeds. Two maps:
 *
 *   FEED_EXPLAINERS  — one paragraph per feed explaining what the metric
 *                      actually measures and why anyone would care.
 *   MARKET_HOOKS     — one sentence per marketId framing why THIS strike
 *                      is interesting given the current value.
 *
 * Both are optional. The market detail page renders them when present,
 * but every market still works without an entry here.
 */

export interface FeedExplainer {
  /** One-sentence headline ("What is this?"). */
  headline: string;
  /** Longer explainer paragraph ("Why does it move?"). */
  body: string;
  /** Where the data comes from, plain-English. */
  source: string;
}

export const FEED_EXPLAINERS: Record<string, FeedExplainer> = {
  WARSAW_RESI_PLN_SQM: {
    headline:
      "Warsaw apartment prices, in Polish złoty per square meter.",
    body:
      "Tracked from public secondary-market listings on Otodom.pl, Poland's largest real estate site. Warsaw prices have climbed sharply since 2020 — driven by inflation, supply shortage, and post-pandemic urban demand. The question on most strikes is whether the rate of climb sustains or finally cools.",
    source:
      "Otodom secondary-market listings, daily 14:00 UTC cron · v1.0 calibrates the median to the official NBP-published average.",
  },
  POLAND_CPI_YOY_BPS: {
    headline:
      "Poland's official year-over-year consumer price inflation.",
    body:
      "Published monthly by GUS (Główny Urząd Statystyczny), Poland's central statistics office. One of Europe's most volatile inflation readings — peaked above 18% in early 2023, then fell sharply under tight monetary policy from the National Bank of Poland (NBP). NBP targets 2.5% ± 1pp; ECB area target is 2%. Each monthly print can swing markets by 25–50 bp.",
    source: "GUS monthly inflation report, agent re-publishes daily 14:00 UTC.",
  },
  ECB_MAIN_REFI_BPS: {
    headline:
      "The European Central Bank's main refinancing rate — the headline interest-rate benchmark for the euro area.",
    body:
      "ECB sets this rate at meetings every six weeks. It's currently descending in 25 bp steps from the 4.5% pandemic-cycle peak as inflation cools. Market consensus expects further cuts but recent inflation prints have been sticky, leaving each meeting genuinely uncertain.",
    source: "ECB Statistical Data Warehouse, agent re-publishes daily 14:00 UTC.",
  },
  WARSAW_RESI_MEDIAN_VERIFIABLE: {
    headline:
      "Same Warsaw market as v1.0, but the median is computed onchain — no government anchor, no off-chain calibration.",
    body:
      "Identical data source as the v1.0 Warsaw feed (Otodom listings), but the v1.0 feed multiplies the median by a calibration factor to match an NBP-published government figure. This v1.1 verifiable feed skips that step: it submits the raw listing prices to an onchain MedianRule contract, which computes the median deterministically. Anyone can re-derive the value from chain data alone. The two feeds will drift apart over time — the spread is itself interesting.",
    source:
      "Otodom listings → onchain MedianRule, daily 14:00 UTC. Methodology is bytecode, not a markdown file.",
  },
};

export const MARKET_HOOKS: Record<string, string> = {
  // Warsaw resi v1.0 (current attested value ~17,300 PLN/sqm)
  "0xf772846d9e7a9044bc061e45a26b4e887040a30888fcdffeb8f7a13763f9f604":
    "Aggressive bull bet — needs ~4% appreciation from the current ~17,300 PLN/sqm in under three months.",
  "0xfc859f75aed881985b11b6e1f80d6939cb000b8de1bf0aabda563c17d7a1955e":
    "Bear bet — needs a ~2% pullback by early July, against the macro trend of tight supply and rising rents.",
  "0x0f0759df600278b16abf508380fc508f5d73cf427bea09656f3014ef02e4b2db":
    "Mid-conviction bull — current price is already at the strike, the question is whether it holds for ~5 months.",

  // Polish CPI Y/Y (current 4.10%)
  "0x356d4ade7b44881b46759fe577138766c2263b68c4b7ea6a1ba91a36b0ce3381":
    "Inflation re-acceleration bet. Last print was 4.10%; clearing 4.50% would require a meaningful upward surprise on the next release.",
  "0xe6e373bed03061a5d9ccbf5ef9f08f322033f1338e5a72e6437184644aade535":
    "Disinflation continuation bet — assumes tight NBP policy holds and energy prices stay cool through summer.",
  "0xd32c3c9d694e62e0ac3a9aa717bcb64ea7de489016e8ad99bdf3a62a7620e36c":
    "Near-the-line. Current reading is 4.10%; one CPI release between now and expiry decides it either way.",

  // ECB main refi (current 2.75%)
  "0x50aba04fc82cfb7db2fff037e02f1c9a0d636db51da5f90cba549d32d05f6c2a":
    "Bet on at least one 25 bp cut before mid-summer. Current rate is 2.75%; would require ECB to cut to 2.50% or below.",
  "0xebb95e0f817b404b2472bcaf3d17172e71a276d3f43bea0cb91d270ed4104dd0":
    "Bet on a hawkish pivot or hold — assumes ECB pauses cuts or signals reversal in coming meetings.",
  "0xe3813a7225852519e1b70a6ecdf8bda8178c0aa0f2d85cd505d00f57113df24a":
    "Razor-line. Current rate is exactly 2.75% — this market resolves on whether ECB cuts at the next meeting.",

  // Verifiable Warsaw (current onchain median 17,371)
  "0x2b86b315ba7503948963b3d6927a883e6a2c5f6e660720bcdff68f1d831dc486":
    "Mild bull on the verifiable feed. Onchain median is currently 17,371 — slightly above strike, but a soft month of listings could flip it.",
  "0xa0ac98055e595585ec8eccfdb9ec80b1db0c3111435fc048768d3cd8770100d2":
    "Tight bull — strike is just below the current onchain reading (17,371). Mid-conviction either way.",
  "0xd82bc80c3f5171a07030152cc99ab9233f052c935dcf12d7195e15ba8366e0a0":
    "Status-quo bear. Strike is well above the current 17,371 median — would need a ~3.5% pop to flip NO.",
};
