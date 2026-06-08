import type { Address } from "viem";
import { CONTRACTS } from "./chain";

/**
 * Registry of suffix pools. Each suffix ($ai, $xyz, $fun, …) is its own
 * deployment: SuffixTreasury + senior + junior + protocol-owned pool. The whole
 * frontend is driven by this list — adding a new suffix is a config entry plus a
 * DeploySuffix run, not a code change.
 *
 * `live` gates trading; `comingSoon` entries render as teasers on the hub.
 */
export interface SuffixPool {
  /** Ticker without the `$`, also the URL slug, e.g. "ai" → /pool/ai, $ai. */
  symbol: string;
  /** Display name, e.g. "Suffix AI". */
  name: string;
  /** One-line hook. */
  tagline: string;
  /** What the suffix is about (the meme/theme). */
  blurb: string;
  treasury?: Address;
  senior?: Address;
  junior?: Address;
  /** Tradeable now. false ⇒ teaser only. */
  live: boolean;
}

export const SUFFIX_POOLS: SuffixPool[] = [
  {
    symbol: "ai",
    name: "Suffix AI",
    tagline: "the memecoin with a floor",
    blurb:
      "The first suffix pool. A cash-floored memecoin themed on the .ai aftermarket — trade freely above a buyback floor that ratchets up from real protocol revenue.",
    treasury: CONTRACTS.SuffixTreasury,
    senior: CONTRACTS.SuffixSenior,
    junior: CONTRACTS.SuffixJunior,
    live: true,
  },
  // Planned — each gets its own DeploySuffix run + addresses, then `live: true`.
  {
    symbol: "xyz",
    name: "Suffix XYZ",
    tagline: "the everything suffix, floored",
    blurb: "Same engine, $xyz theme. Deploys post-$ai.",
    live: false,
  },
  {
    symbol: "fun",
    name: "Suffix FUN",
    tagline: "have fun, keep the floor",
    blurb: "Same engine, $fun theme. Deploys post-$ai.",
    live: false,
  },
];

export function getPool(symbol: string): SuffixPool | undefined {
  return SUFFIX_POOLS.find((p) => p.symbol === symbol.toLowerCase());
}

/** Pools that are actually deployed + tradeable (have addresses). */
export function livePools(): SuffixPool[] {
  return SUFFIX_POOLS.filter((p) => p.live && p.treasury);
}
