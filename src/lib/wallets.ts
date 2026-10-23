/**
 * Which browser wallet the site talks to. `window.ethereum` holds ONE wallet,
 * whichever extension grabbed it first: with MetaMask next to Rabby, Phantom,
 * Core or another EVM wallet, a connect request can go to a wallet the user
 * does not use, and MetaMask never opens ("MetaMask encountered an error
 * setting the global Ethereum provider"). EIP-6963 fixes that: every wallet
 * announces itself and the user picks one. The pick is remembered (by rdns)
 * and every wallet call goes through activeProvider().
 */

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

/** An EIP-6963 announcement. */
export interface InjectedWallet {
  uuid: string;
  name: string;
  /** A data: URI (the spec requires it). */
  icon: string;
  /** Reverse-DNS id, e.g. io.metamask, io.rabby, app.phantom. */
  rdns: string;
  provider: EthereumProvider;
}

export const LAST_WALLET_KEY = "registrai:wallet";

let active: EthereumProvider | null = null;

/** The wallet the user picked, else the legacy window.ethereum (a phone wallet's browser, an old extension). */
export function activeProvider(): EthereumProvider | undefined {
  if (active) return active;
  return typeof window === "undefined" ? undefined : window.ethereum;
}

export function setActiveProvider(p: EthereumProvider | null): void {
  active = p;
}

/** Pure: one entry per wallet (by rdns, first announcement wins), in announcement order. */
export function dedupeWallets(ws: readonly InjectedWallet[]): InjectedWallet[] {
  const seen = new Set<string>();
  const out: InjectedWallet[] = [];
  for (const w of ws) {
    const key = w.rdns || w.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/**
 * Pure: the wallet to use without asking: the one picked last time if it is
 * still installed, else the only one installed; null = ask (several, none picked).
 */
export function defaultWallet(ws: readonly InjectedWallet[], lastRdns: string | null): InjectedWallet | null {
  if (lastRdns) {
    const last = ws.find((w) => w.rdns === lastRdns);
    if (last) return last;
  }
  return ws.length === 1 ? ws[0] : null;
}

/** Pure: a wallet announcement worth keeping (the spec's shape, an image data: URI icon). */
export function isAnnouncement(d: unknown): d is { info: Omit<InjectedWallet, "provider">; provider: EthereumProvider } {
  if (!d || typeof d !== "object") return false;
  const { info, provider } = d as { info?: Record<string, unknown>; provider?: { request?: unknown } };
  return (
    Boolean(info && provider) &&
    typeof info!.uuid === "string" &&
    typeof info!.name === "string" &&
    typeof info!.rdns === "string" &&
    typeof info!.icon === "string" &&
    /^data:image\//i.test(info!.icon as string) &&
    typeof provider!.request === "function"
  );
}

/** Browser: listen for EIP-6963 announcements and ask wallets to announce. Returns the unsubscribe. */
export function discoverWallets(onChange: (ws: InjectedWallet[]) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let found: InjectedWallet[] = [];
  const onAnnounce = (ev: Event) => {
    const d = (ev as CustomEvent).detail;
    if (!isAnnouncement(d)) return;
    found = dedupeWallets([...found, { ...d.info, provider: d.provider }]);
    onChange(found);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}

export function readLastWallet(): string | null {
  try {
    return window.localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
}

export function saveLastWallet(rdns: string | null): void {
  try {
    if (rdns) window.localStorage.setItem(LAST_WALLET_KEY, rdns);
    else window.localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    // storage blocked: the user picks again next time
  }
}
