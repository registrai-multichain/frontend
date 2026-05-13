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
import { DEFAULT_CHAIN, txUrl as txUrlFor, addrUrl as addrUrlFor } from "./chains";

export const CONTRACTS = DEFAULT_CHAIN.contracts;
export const EXPLORER = DEFAULT_CHAIN.explorer.url;

export const txUrl = (hash: string) => txUrlFor(DEFAULT_CHAIN, hash);
export const addrUrl = (addr: string) => addrUrlFor(DEFAULT_CHAIN, addr);

// Backward-compat re-export.
export { ARC_TESTNET } from "./chains";
