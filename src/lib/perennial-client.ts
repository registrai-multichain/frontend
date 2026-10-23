import { createPublicClient, type Address, type PublicClient } from "viem";
import { transportFor } from "./chains";
import { PERENNIAL } from "./perennial-network";

/** Multicall3's canonical address; deployed on Arc testnet and mainnet. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

let client: PublicClient | undefined;
/**
 * Reads are pinned to the Perennial network regardless of the wallet's chain.
 * Concurrent contract reads fold into one Multicall3 eth_call: a page load fires
 * ~16 reads at once, and Arc's RPC answers that burst with 429s.
 */
export function perennialClient(): PublicClient {
  const chain = PERENNIAL.chain.viemChain;
  client ??= createPublicClient({
    chain: { ...chain, contracts: { ...chain.contracts, multicall3: { address: MULTICALL3 } } },
    transport: transportFor(PERENNIAL.chain, { batch: true }),
    batch: { multicall: { wait: 16 } },
  }) as PublicClient;
  return client;
}
