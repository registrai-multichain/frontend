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
import { ARC_TESTNET } from "@/lib/chain";

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
  address: Address | undefined;
  chainId: number | undefined;
  isOnArc: boolean;
  isConnecting: boolean;
  error: string | undefined;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToArc: () => Promise<void>;
  publicClient: PublicClient;
  walletClient: WalletClient | undefined;
}

const Ctx = createContext<WalletContextValue | undefined>(undefined);

const ARC_CHAIN_ID_HEX = `0x${ARC_TESTNET.id.toString(16)}`;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Public client is always available, no wallet needed.
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: ARC_TESTNET,
        transport: http(),
      }),
    [],
  );

  const walletClient = useMemo(() => {
    if (typeof window === "undefined" || !window.ethereum || !address) return undefined;
    return createWalletClient({
      chain: ARC_TESTNET,
      transport: custom(window.ethereum),
      account: address,
    });
  }, [address]);

  const refreshChain = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    try {
      const hex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      setChainId(parseInt(hex, 16));
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

  const switchToArc = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID_HEX }],
      });
    } catch (e) {
      // 4902 = chain not added to wallet
      const code = (e as { code?: number }).code;
      if (code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ARC_CHAIN_ID_HEX,
              chainName: ARC_TESTNET.name,
              nativeCurrency: ARC_TESTNET.nativeCurrency,
              rpcUrls: ARC_TESTNET.rpcUrls.default.http,
              blockExplorerUrls: [ARC_TESTNET.blockExplorers.default.url],
            },
          ],
        });
      } else {
        setError((e as Error).message);
      }
    }
    await refreshChain();
  }, [refreshChain]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as Address[];
      setAddress(accounts[0]);
    };
    const onChainChanged = (...args: unknown[]) => {
      const hex = args[0] as string;
      setChainId(parseInt(hex, 16));
    };

    // Auto-pick up existing connection without prompting.
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
    chainId,
    isOnArc: chainId === ARC_TESTNET.id,
    isConnecting,
    error,
    connect,
    disconnect,
    switchToArc,
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
