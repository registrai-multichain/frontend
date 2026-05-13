"use client";

import { useWallet } from "./WalletProvider";
import { shortAddr } from "@/lib/format";

export function WalletButton() {
  const { address, isConnecting, isOnArc, connect, disconnect, switchToArc, error } = useWallet();

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

  if (!isOnArc) {
    return (
      <button
        type="button"
        onClick={switchToArc}
        className="px-3 py-1.5 border border-down/50 text-down text-[11px] tracking-[0.16em] uppercase hover:bg-down hover:text-bg transition-colors"
        title={error}
      >
        switch to arc
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={disconnect}
      className="flex items-center gap-2 px-3 py-1.5 border border-line text-fg text-[11px] tracking-[0.12em] hover:border-line-strong transition-colors group"
      title="click to disconnect"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-up dot-pulse" />
      <span className="tnum">{shortAddr(address)}</span>
      <span className="text-fg-dim group-hover:text-down transition-colors text-[10px]">×</span>
    </button>
  );
}
