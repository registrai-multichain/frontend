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
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  CHAINS,
  DEFAULT_CHAIN_ID,
  getChain,
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
  /** Switch the wallet to a specific supported chain. Defaults to the
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
        transport: http(),
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
      const target = getChain(targetId ?? DEFAULT_CHAIN_ID);
      if (!target) {
        setError("Unknown chain.");
        return;
      }
      const hexId = `0x${target.id.toString(16)}`;
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexId }],
        });
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code === 4902) {
          // Chain not in wallet — add it.
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: target.name,
                nativeCurrency: target.nativeCurrency,
                rpcUrls: target.rpcUrls,
                blockExplorerUrls: [target.explorer.url],
              },
            ],
          });
        } else {
          setError((e as Error).message);
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

export function useWallet(): WalletContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
