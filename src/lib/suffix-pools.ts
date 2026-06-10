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
  {
    symbol: "xyz",
    name: "Suffix XYZ",
    tagline: "the everything suffix, floored",
    blurb:
      "Themed on the .xyz aftermarket. Same engine as $ai — a protocol-owned pool with a cash buyback floor that ratchets from real revenue.",
    treasury: "0x41fFAf360C0F3120732BF69530a667Eec57FD7E3" as Address,
    senior: "0x6a75077c05B216e8e0edCb6c46749A8F25eD7a7F" as Address,
    junior: "0x430E2e619531c9a550AD2Db9EB29428769BC31f6" as Address,
    live: true,
  },
  {
    symbol: "fun",
    name: "Suffix FUN",
    tagline: "have fun, keep the floor",
    blurb:
      "Themed on the .fun aftermarket. Same cash-floored engine — trade above the floor, never below it.",
    treasury: "0xcA9D317c846186F0B3f8446D8df94d6Ca826B1EB" as Address,
    senior: "0x4eD56ffF54c40825e52Cd9d3Be128668F3870922" as Address,
    junior: "0x7CA294950F3Ff30DCD4b98f1bb9b02920f691E14" as Address,
    live: true,
  },
];

export function getPool(symbol: string): SuffixPool | undefined {
  return SUFFIX_POOLS.find((p) => p.symbol === symbol.toLowerCase());
}

/** Pools that are actually deployed + tradeable (have addresses). */
export function livePools(): SuffixPool[] {
  return SUFFIX_POOLS.filter((p) => p.live && p.treasury);
}
