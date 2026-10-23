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
import { isMobileUserAgent, metamaskDappLink } from "@/lib/verify-invite";
import {
  defaultWallet,
  discoverWallets,
  readLastWallet,
  saveLastWallet,
  setActiveProvider,
  type EthereumProvider,
  type InjectedWallet,
} from "@/lib/wallets";


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
  /** Browser wallets that announced themselves (EIP-6963). */
  wallets: InjectedWallet[];
  /** Open the wallet picker (to switch to another installed wallet). */
  pickWallet: () => void;
  /** Switch the wallet to a chain the app knows (Arc testnet or mainnet),
   *  adding it with the official RPC if the wallet lacks it. Defaults to the
   *  protocol's default chain (Arc testnet today). */
  switchChain: (chainId?: number) => Promise<void>;
  publicClient: PublicClient;
  walletClient: WalletClient | undefined;
}

const Ctx = createContext<WalletContextValue | undefined>(undefined);

const CONNECT_TIMEOUT_MS = 20_000;
const WALLET_PENDING_HINT =
  "Your wallet hasn't answered. Open the wallet extension (e.g. click the MetaMask icon): a connection request may be waiting there. Then try again, or choose a different wallet.";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | undefined>();
  const [walletChainId, setWalletChainId] = useState<number | undefined>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // EIP-6963: every installed wallet, and the one in use (window.ethereum is
  // only whichever extension grabbed it; see src/lib/wallets.ts).
  const [wallets, setWallets] = useState<InjectedWallet[]>([]);
  const [prov, setProv] = useState<EthereumProvider | undefined>();
  const [picking, setPicking] = useState(false);
  useEffect(() => discoverWallets(setWallets), []);
  const selectProvider = useCallback((p: EthereumProvider | undefined) => {
    setActiveProvider(p ?? null);
    setProv(p);
  }, []);
  // The wallet picked last time (or the only one) is used without asking.
  useEffect(() => {
    if (prov) return;
    const d = defaultWallet(wallets, readLastWallet());
    if (d) selectProvider(d.provider);
  }, [wallets, prov, selectProvider]);
  /** The provider calls go to: the chosen wallet, else the legacy window.ethereum. */
  const eth = prov ?? (typeof window === "undefined" ? undefined : window.ethereum);

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
    if (!eth || !address) return undefined;
    return createWalletClient({
      chain: currentChain.viemChain,
      transport: custom(eth),
      account: address,
    });
  }, [address, currentChain, eth]);

  const refreshChain = useCallback(async () => {
    if (!eth) return;
    try {
      const hex = (await eth.request({ method: "eth_chainId" })) as string;
      setWalletChainId(parseInt(hex, 16));
    } catch {
      // ignore
    }
  }, [eth]);

  /** Ask `target` for accounts (the picked wallet, or the default one). */
  /** Ask one wallet for its accounts; give up waiting after CONNECT_TIMEOUT_MS. */
  const requestAccounts = useCallback(
    async (target: EthereumProvider) => {
      setIsConnecting(true);
      setError(undefined);
      // A wallet whose approval window was closed or is hidden behind the browser
      // may never answer. Stop waiting after CONNECT_TIMEOUT_MS so the button works
      // again; a late approval still lands through the accountsChanged listener.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CONNECT_TIMEOUT_MS);
      });
      try {
        const accounts = await Promise.race([target.request({ method: "eth_requestAccounts" }) as Promise<Address[]>, timeout]);
        if (accounts === "timeout") {
          setError(WALLET_PENDING_HINT);
        } else if (accounts && accounts[0]) {
          setAddress(accounts[0]);
          const hex = (await target.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
          if (hex) setWalletChainId(parseInt(hex, 16));
        }
      } catch (e) {
        // -32002: a connection request is already waiting in the wallet.
        setError((e as { code?: number }).code === -32002 ? WALLET_PENDING_HINT : (e as Error).message);
      } finally {
        clearTimeout(timer);
        setIsConnecting(false);
      }
    },
    [],
  );

  /** Connect: the chosen wallet; with several installed and none chosen yet, the picker. */
  const connect = useCallback(async () => {
    if (typeof window === "undefined") return;
    const d = prov ? null : defaultWallet(wallets, readLastWallet());
    if (d) selectProvider(d.provider);
    const target = prov ?? d?.provider ?? (wallets.length === 0 ? window.ethereum : undefined);
    if (!target && wallets.length > 1) {
      setError(undefined);
      setPicking(true);
      return;
    }
    if (!target) {
      // A phone with no wallet in this browser: reopen the page in MetaMask's.
      const mm = isMobileUserAgent(navigator.userAgent) ? metamaskDappLink(window.location.href) : null;
      if (mm) {
        window.location.href = mm;
        return;
      }
      setError("No wallet found. Install MetaMask or another EVM wallet.");
      return;
    }
    await requestAccounts(target);
  }, [prov, wallets, selectProvider, requestAccounts]);

  /** The user picked a wallet in the picker: remember it and connect with it. */
  const choose = useCallback(
    async (w: InjectedWallet) => {
      setPicking(false);
      saveLastWallet(w.rdns);
      setAddress(undefined);
      selectProvider(w.provider);
      await requestAccounts(w.provider);
    },
    [selectProvider, requestAccounts],
  );

  const pickWallet = useCallback(() => {
    setError(undefined);
    if (wallets.length > 1) setPicking(true);
  }, [wallets]);

  const disconnect = useCallback(() => {
    setAddress(undefined);
  }, []);

  const switchChain = useCallback(
    async (targetId?: number) => {
      if (!eth) return;
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
    [refreshChain, eth],
  );

  useEffect(() => {
    if (!eth) return;

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
  }, [refreshChain, eth]);

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
    wallets,
    pickWallet,
    switchChain,
    publicClient,
    walletClient,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {picking && <WalletPicker wallets={wallets} onPick={choose} onClose={() => setPicking(false)} />}
    </Ctx.Provider>
  );
}

/** The installed wallets (EIP-6963), each with its own icon: the user picks the one to use. */
function WalletPicker({ wallets, onPick, onClose }: { wallets: InjectedWallet[]; onPick: (w: InjectedWallet) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="wallet-picker-backdrop" role="presentation" onClick={onClose}>
      <div className="wallet-picker" role="dialog" aria-modal="true" aria-label="Choose a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="wallet-picker-head">
          <b>Choose a wallet</b>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p>Several wallets are installed in this browser. Pick the one to connect.</p>
        <ul>
          {wallets.map((w) => (
            <li key={w.uuid}>
              <button type="button" onClick={() => onPick(w)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI from the wallet itself */}
                <img src={w.icon} alt="" width={28} height={28} />
                <span>{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
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
