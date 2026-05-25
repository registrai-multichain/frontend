/**
 * Single-chain convenience aliases for the default deployment.
 *
 * Day-to-day code in components reads `useWallet().currentChain.contracts`
 * which is multichain-aware. These aliases exist for static contexts
 * (build-time scripts, demo data files) that aren't inside the React tree
 * and don't need chain switching.
 *
 * NEVER import these from a component that should support chain switching —
 * always go through `useWallet().currentChain`.
 */
import type { Address } from "viem";
import { DEFAULT_CHAIN, txUrl as txUrlFor, addrUrl as addrUrlFor } from "./chains";

export const CONTRACTS = DEFAULT_CHAIN.contracts;
export const EXPLORER = DEFAULT_CHAIN.explorer.url;

export const txUrl = (hash: string) => txUrlFor(DEFAULT_CHAIN, hash);
export const addrUrl = (addr: string) => addrUrlFor(DEFAULT_CHAIN, addr);

/**
 * Resolve the right Markets contract address for a given market based on its
 * marketsVersion tag. v2 markets earn points; v1.1 verifiable markets and
 * v1.0 legacy markets continue to work against their original contracts.
 */
export function marketsAddressFor(
  marketsVersion: string | undefined,
): Address {
  if (marketsVersion === "2.0" || marketsVersion === "2") {
    return CONTRACTS.MarketsV2 ?? CONTRACTS.Markets;
  }
  if (marketsVersion === "1.1") {
    return CONTRACTS.MarketsV11 ?? CONTRACTS.Markets;
  }
  return CONTRACTS.Markets;
}

// Backward-compat re-export.
export { ARC_TESTNET } from "./chains";
