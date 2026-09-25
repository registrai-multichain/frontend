"use client";

import { createWalletClient, custom, type Abi, type Address, type Hex } from "viem";
import { BUILDERS } from "@/lib/builders-network";
import { explainMinedRevert } from "@/lib/humanize-error";
import { activeProvider } from "@/lib/wallets";
import { buildersClient } from "./useMyBuilder";

const CHAIN = BUILDERS.chain;
export const HUMAN = { testnet: CHAIN.testnet, networkName: BUILDERS.label };

/**
 * Simulate, send and wait for one call on the builders network from the
 * connected wallet. Throws (humanizeError-able) on a revert, simulated or mined.
 * `onHash` fires as soon as the wallet returns the hash.
 */
export async function sendBuildersTx(o: {
  account: Address;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  onHash?: (hash: Hex) => void;
}): Promise<Hex> {
  const eth = activeProvider();
  if (!eth) throw new Error("No wallet found in this browser.");
  const pc = buildersClient();
  const call = { address: o.address, abi: o.abi, functionName: o.functionName, args: o.args, account: o.account } as const;
  await pc.simulateContract(call as never);
  const wallet = createWalletClient({ chain: CHAIN.viemChain, transport: custom(eth), account: o.account });
  const hash = await wallet.writeContract({ ...call, chain: CHAIN.viemChain } as never);
  o.onHash?.(hash);
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(await explainMinedRevert(pc, hash, HUMAN));
  return hash;
}
