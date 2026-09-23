"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  CHAINS,
  DEFAULT_CHAIN_ID,
  transportFor,
  getChain,
  getWalletChain,
  isSupportedChain,
  type ChainEntry,
} from "@/lib/chains";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface WalletContextValue {
  /** User's connected address, if any. */
  address: Address | undefined;
  /** Whatever chain the wallet is currently on. */
  walletChainId: number | undefined;
  /** True if the wallet is on a chain Registrai supports. */
  isOnSupportedChain: boolean;
  /** The active chain we're driving the UI against — defaults to the wallet's
   *  current chain if supported, else the protocol's default chain. Contains
   *  all addresses, explorer info, native-currency info. */
  currentChain: ChainEntry;
  /** Every supported chain — for future chain-switcher UI. */
  supportedChains: ChainEntry[];
  isConnecting: boolean;
  error: string | undefined;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Switch the wallet to a chain the app knows (Arc testnet or mainnet),
   *  adding it with the official RPC if the wallet lacks it. Defaults to the
   *  protocol's default chain (Arc testnet today). */
  switchChain: (chainId?: number) => Promise<void>;
  publicClient: PublicClient;
  walletClient: WalletClient | undefined;
}

const Ctx = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | undefined>();
  const [walletChainId, setWalletChainId] = useState<number | undefined>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // The chain we drive contract reads/writes against. If the wallet is on
  // one we support, follow it; otherwise pin to the protocol's default chain
  // (so reads still work — only writes need a supported chain).
  const currentChain = useMemo<ChainEntry>(() => {
    if (walletChainId !== undefined && isSupportedChain(walletChainId)) {
      return getChain(walletChainId)!;
    }
    return getChain(DEFAULT_CHAIN_ID)!;
  }, [walletChainId]);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: currentChain.viemChain,
        // Per-chain read transport: the chain's official RPC only.
        transport: transportFor(currentChain),
      }),
    [currentChain],
  );

  const walletClient = useMemo(() => {
    if (typeof window === "undefined" || !window.ethereum || !address) return undefined;
    return createWalletClient({
      chain: currentChain.viemChain,
      transport: custom(window.ethereum),
      account: address,
    });
  }, [address, currentChain]);

  const refreshChain = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    try {
      const hex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      setWalletChainId(parseInt(hex, 16));
    } catch {
      // ignore
    }
  }, []);

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setError("No wallet found. Install MetaMask or another EVM wallet.");
      return;
    }
    setIsConnecting(true);
    setError(undefined);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      if (accounts && accounts[0]) {
        setAddress(accounts[0]);
        await refreshChain();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsConnecting(false);
    }
  }, [refreshChain]);

  const disconnect = useCallback(() => {
    setAddress(undefined);
  }, []);

  const switchChain = useCallback(
    async (targetId?: number) => {
      if (typeof window === "undefined" || !window.ethereum) return;
      const eth = window.ethereum;
      // Any chain the app can point a wallet at (testnet and mainnet), not
      // only chains with the full contract stack.
      const target = getWalletChain(targetId ?? DEFAULT_CHAIN_ID);
      if (!target) {
        setError("Unknown chain.");
        return;
      }
      setError(undefined);
      const hexId = `0x${target.id.toString(16)}`;
      const doSwitch = () =>
        eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      try {
        await doSwitch();
      } catch (e) {
        if (!isUnknownChainError(e)) {
          setError(isUserRejection(e) ? "Network switch cancelled in your wallet." : (e as Error).message);
          await refreshChain();
          return;
        }
        // Chain not in the wallet yet — add it with Circle's official RPC only.
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: target.name,
                nativeCurrency: target.nativeCurrency,
                rpcUrls: [...target.rpcUrls],
                blockExplorerUrls: [target.explorer.url],
              },
            ],
          });
          // Some wallets add without switching; ask again (no-op if already on it).
          await doSwitch().catch(() => undefined);
        } catch (addErr) {
          setError(
            isUserRejection(addErr)
              ? `Adding ${target.name} was cancelled in your wallet.`
              : `Could not add ${target.name} to your wallet: ${(addErr as Error).message ?? "unknown error"}`,
          );
        }
      }
      await refreshChain();
    },
    [refreshChain],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as Address[];
      setAddress(accounts[0]);
    };
    const onChainChanged = (...args: unknown[]) => {
      const hex = args[0] as string;
      setWalletChainId(parseInt(hex, 16));
    };

    eth
      .request({ method: "eth_accounts" })
      .then((accs) => {
        const arr = accs as Address[];
        if (arr && arr[0]) {
          setAddress(arr[0]);
          refreshChain();
        }
      })
      .catch(() => undefined);

    eth.on?.("accountsChanged", onAccountsChanged);
    eth.on?.("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refreshChain]);

  const value: WalletContextValue = {
    address,
    walletChainId,
    isOnSupportedChain: isSupportedChain(walletChainId),
    currentChain,
    supportedChains: Object.values(CHAINS),
    isConnecting,
    error,
    connect,
    disconnect,
    switchChain,
    publicClient,
    walletClient,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function errCode(e: unknown): number | undefined {
  const x = e as { code?: number; data?: { originalError?: { code?: number } } };
  return x?.code ?? x?.data?.originalError?.code;
}

function isUnknownChainError(e: unknown): boolean {
  if (errCode(e) === 4902) return true;
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return msg.includes("unrecognized chain") || msg.includes("unknown chain");
}

function isUserRejection(e: unknown): boolean {
  if (errCode(e) === 4001) return true;
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return msg.includes("user rejected") || msg.includes("user denied");
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
