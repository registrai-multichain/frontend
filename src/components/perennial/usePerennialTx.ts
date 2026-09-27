"use client";

import { useMemo, useState } from "react";
import { mutate } from "swr";
import { createWalletClient, custom, type Address, type Hex, type TransactionReceipt } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { nanoLedgerAbi, usdcAbi } from "@/lib/abi";
import { txUrl as txUrlFor } from "@/lib/chains";
import { explainMinedRevert, humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { perennialClient } from "@/lib/perennial-client";
import { PERENNIAL } from "@/lib/perennial-network";
import { pushToast } from "@/lib/toast-store";
import { activeProvider } from "@/lib/wallets";

export { perennialClient };

export const D = PERENNIAL;
export const CHAIN = D.chain;
export const HUMAN = { testnet: CHAIN.testnet, networkName: D.label };
export const txUrl = (hash: string) => txUrlFor(CHAIN, hash);
export const addressUrl = (a: string) => `${CHAIN.explorer.url.replace(/\/$/, "")}/address/${a}`;

/** An error whose message is already user-facing (a decoded mined revert). */
class HumanError extends Error {}

/** Re-read everything the paper pages show (every SWR key starts with "perennial-"). */
export function refreshPerennial() {
  return mutate((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("perennial-"));
}

export interface RunOpts {
  /** Approvals etc., sent before the main transaction. */
  before?: () => Promise<void>;
  after?: (r: TransactionReceipt) => void;
  /** The success note, e.g. "Bought 33.3 Yes for $10". */
  done?: string;
}

export function usePerennialTx() {
  const { address, walletChainId, connect, switchChain } = useWallet();
  const publicClient = perennialClient();
  const onPerennialChain = walletChainId === CHAIN.id;
  // Writes go through the wallet, bound to the Perennial chain.
  const walletClient = useMemo(() => {
    const eth = activeProvider();
    if (!eth || !address || !onPerennialChain) return undefined;
    return createWalletClient({ chain: CHAIN.viemChain, transport: custom(eth), account: address });
  }, [address, onPerennialChain]);

  const [pending, setPending] = useState("");
  const busy = pending !== "" || !PERENNIAL_WRITES_ENABLED;
  const needsConnect = !address || !onPerennialChain;
  const connectOrSwitch = () => void (address ? switchChain(CHAIN.id) : connect());

  const fail = (text: string): false => {
    pushToast({ kind: "error", text });
    return false;
  };

  async function waitOk(hash: Hex) {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new HumanError(await explainMinedRevert(publicClient, hash, HUMAN));
    return r;
  }

  async function run(label: string, fn: () => Promise<Hex>, opts: RunOpts = {}): Promise<boolean> {
    if (!PERENNIAL_WRITES_ENABLED) return fail("Perennial transactions are paused.");
    if (!walletClient || !address) return fail(`Connect a wallet on ${D.label} first.`);
    setPending(label);
    try {
      if (opts.before) await opts.before();
      const hash = await fn();
      const r = await waitOk(hash);
      opts.after?.(r);
      pushToast({ kind: "ok", text: opts.done ?? "Done.", href: txUrl(hash) });
      await refreshPerennial();
      return true;
    } catch (e) {
      return fail(e instanceof HumanError ? e.message : humanizeError(e, HUMAN));
    } finally {
      setPending("");
    }
  }

  const w = () => ({ chain: walletClient!.chain, account: walletClient!.account! });

  // Exact-amount allowances, per token. Never an unlimited approval.
  async function ensureUsdcAllowance(spender: Address, needed: bigint) {
    const usdc = D.contracts.USDC!;
    const a = (await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "allowance", args: [address!, spender] })) as bigint;
    if (a >= needed) return;
    await waitOk(await walletClient!.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [spender, needed], ...w() }));
  }
  async function ensureLedgerAllowance(spender: Address, needed: bigint) {
    const nl = D.contracts.NanoLedger!;
    const a = (await publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "allowance", args: [address!, spender] })) as bigint;
    if (a >= needed) return;
    await waitOk(await walletClient!.writeContract({ address: nl, abi: nanoLedgerAbi, functionName: "approveSpender", args: [spender, needed], ...w() }));
  }
  const latestChainTime = async () => (await publicClient.getBlock({ blockTag: "latest" })).timestamp;

  return {
    address, onPerennialChain, needsConnect, connectOrSwitch, publicClient, walletClient, pending, busy,
    run, fail, w, ensureUsdcAllowance, ensureLedgerAllowance, latestChainTime,
  };
}
export type PerennialTx = ReturnType<typeof usePerennialTx>;
