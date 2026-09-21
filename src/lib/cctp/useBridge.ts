"use client";

/**
 * Wallet plumbing for the bridge.
 *
 * Deliberately independent of the app's WalletProvider: that provider is
 * pinned to the Registrai chain registry (Arc), whereas the bridge
 * has to drive eleven chains and switch between them mid-flow. Keeping it
 * separate means the bridge cannot destabilise the rest of the app.
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, fallback, http, type Address, type Hex } from "viem";
import { type CctpChain, chainByChainId } from "./domains";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

function provider(): Eip1193 {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No wallet found. Install MetaMask or a compatible wallet.");
  return eth;
}

export function useBridgeWallet() {
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();

  useEffect(() => {
    const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!eth) return;

    eth.request({ method: "eth_accounts" }).then((a) => {
      const accs = a as Address[];
      if (accs?.length) setAddress(accs[0]);
    });
    eth.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c as string)));

    const onAccounts = (...args: unknown[]) => {
      const accs = args[0] as Address[];
      setAddress(accs?.length ? accs[0] : undefined);
    };
    const onChain = (...args: unknown[]) => setChainId(Number(args[0] as string));

    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const [error, setError] = useState<string>();

  const connect = useCallback(async () => {
    setError(undefined);
    try {
      const accs = (await provider().request({ method: "eth_requestAccounts" })) as Address[];
      if (!accs?.length) throw new Error("Wallet returned no accounts.");
      setAddress(accs[0]);
      const c = await provider().request({ method: "eth_chainId" });
      setChainId(Number(c as string));
    } catch (e) {
      // A rejected or missing wallet used to fail silently, which looks
      // identical to a broken button. Say what happened.
      const err = e as { code?: number; message?: string };
      setError(
        err.code === 4001
          ? "Connection rejected in your wallet."
          : (err.message ?? "Could not connect a wallet."),
      );
    }
  }, []);

  /**
   * Switch the wallet, adding the chain if it is unknown to the wallet.
   * Arc is the common case here — most wallets have never heard of chain 5042.
   */
  const switchTo = useCallback(async (chain: CctpChain) => {
    const hexId = `0x${chain.chainId.toString(16)}`;
    try {
      await provider().request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 4902 && code !== -32603) throw err;
      // Never silently install an RPC we have not explicitly vetted. Whoever
      // serves a wallet's RPC controls every balance and confirmation the
      // user sees, so every endpoint here is intentional rather than scraped.
      if (!chain.walletRpcUrl) {
        throw new Error(
          `Add ${chain.name} (chain ${chain.chainId}) to your wallet manually, then retry. ` +
            `We do not have a vetted RPC to install on your behalf.`,
        );
      }
      await provider().request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: chain.name,
            rpcUrls: [chain.walletRpcUrl],
            blockExplorerUrls: [chain.explorer],
            // Arc's native gas token is USDC held at 18 decimals natively
            // (the 6-decimal ERC-20 at 0x3600 is a view of the same balance).
            // Every other chain here is 18 too.
            nativeCurrency: {
              name: chain.gasSymbol,
              symbol: chain.gasSymbol,
              decimals: 18,
            },
          },
        ],
      });
    }
    setChainId(chain.chainId);
  }, []);

  const sendTx = useCallback(
    async (to: Address, data: Hex, from: Address): Promise<Hex> => {
      return (await provider().request({
        method: "eth_sendTransaction",
        params: [{ from, to, data }],
      })) as Hex;
    },
    [],
  );

  return {
    address,
    chainId,
    chain: chainId ? chainByChainId(chainId) : undefined,
    error,
    connect,
    switchTo,
    sendTx,
  };
}

/**
 * Reads rotate across every configured endpoint. Arc needs this: the endpoints
 * that answer today have different method coverage, so a single one is not
 * dependable.
 */
export function readClient(chain: CctpChain) {
  return createPublicClient({
    transport: fallback(chain.readRpcUrls.map((u) => http(u))),
  });
}

export async function waitForReceipt(chain: CctpChain, hash: Hex) {
  const client = readClient(chain);
  return client.waitForTransactionReceipt({ hash, timeout: 180_000 });
}

export async function readAllowance(
  chain: CctpChain,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  const client = readClient(chain);
  return client.readContract({
    address: chain.usdc,
    abi: [
      {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
      },
    ] as const,
    functionName: "allowance",
    args: [owner, spender],
  });
}

export async function readUsdcBalance(chain: CctpChain, owner: Address): Promise<bigint> {
  const client = readClient(chain);
  return client.readContract({
    address: chain.usdc,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ] as const,
    functionName: "balanceOf",
    args: [owner],
  });
}
