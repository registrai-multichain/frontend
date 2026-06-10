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
    treasury: "0x007F263C90e93B40238523abdCaeC0E4c39749c1" as Address,
    senior: "0xc8fCBd2A4003Bb47c36D08B349bc8ca4E863f2B4" as Address,
    junior: "0xF64EC77AB4C2F97B05126188454fC1591d297fe6" as Address,
    live: true,
  },
  {
    symbol: "fun",
    name: "Suffix FUN",
    tagline: "have fun, keep the floor",
    blurb:
      "Themed on the .fun aftermarket. Same cash-floored engine — trade above the floor, never below it.",
    treasury: "0x4156288c4078f2d425BC6Dc94B6C9eD71cb191EA" as Address,
    senior: "0xAaaC0a2287b62ed039C879f27b20a2ee137A2347" as Address,
    junior: "0x3fe865d66ecd3Aed25BB5d861AD564Eb3bf15Bdd" as Address,
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
