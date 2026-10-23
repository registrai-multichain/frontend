"use client";

import { useWallet } from "./WalletProvider";
import { shortAddr } from "@/lib/format";

/**
 * `chain` pins the button to one network (e.g. the Perennial network, which may
 * be mainnet while the rest of the app runs on testnet).
 */
export function WalletButton({ chain }: { chain?: { id: number; name: string; shortName: string } } = {}) {
  const {
    address,
    isConnecting,
    isOnSupportedChain: onAppChain,
    walletChainId,
    currentChain: appChain,
    connect,
    disconnect,
    switchChain,
    error,
  } = useWallet();
  const isOnSupportedChain = chain ? walletChainId === chain.id : onAppChain;
  const currentChain = chain ?? appChain;

  if (!address) {
    return (
      <button
        type="button"
        onClick={connect}
        disabled={isConnecting}
        className="px-3 py-1.5 border border-accent/50 text-accent text-[11px] tracking-[0.16em] uppercase hover:bg-accent hover:text-bg transition-colors disabled:opacity-50"
      >
        {isConnecting ? "connecting…" : "connect"}
      </button>
    );
  }

  if (!isOnSupportedChain) {
    return (
      <button
        type="button"
        onClick={() => switchChain(chain?.id)}
        className="px-3 py-1.5 border border-down/50 text-down text-[11px] tracking-[0.16em] uppercase hover:bg-down hover:text-bg transition-colors"
        title={error}
      >
        switch to {chain ? currentChain.name : currentChain.shortName}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={disconnect}
      className="flex items-center gap-2 px-3 py-1.5 border border-line text-fg text-[11px] tracking-[0.12em] hover:border-line-strong transition-colors group"
      title={`${currentChain.name} · click to disconnect`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-up dot-pulse" />
      <span className="tnum">{shortAddr(address)}</span>
      <span className="text-fg-dim group-hover:text-down transition-colors text-[10px]">×</span>
    </button>
  );
}
