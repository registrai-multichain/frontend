"use client";

import { useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, addrUrl, txUrl } from "@/lib/chain";
import { usdcAbi, vaultAbi } from "@/lib/abi";

type Mode = "deposit" | "withdraw";
type Status = "idle" | "approving" | "submitting" | "success" | "error";

interface VaultStats {
  nav: bigint;
  totalShares: bigint;
  pricePerShare: bigint;
  yourShares: bigint;
  yourValue: bigint;
  yourUsdcBalance: bigint;
}

const fmtUsdc = (wei: bigint) => (Number(wei) / 1e6).toFixed(2);

export function VaultPanel() {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } =
    useWallet();

  const vault = CONTRACTS.MarketMakerVault;
  const usdc = CONTRACTS.USDC;

  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [stats, setStats] = useState<VaultStats | undefined>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const refresh = useCallback(async () => {
    if (!vault) return;
    const calls = [
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "nav" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalShares" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pricePerShare" }),
    ];
    if (address) {
      calls.push(
        publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "sharesOf", args: [address] }),
        publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
      );
    }
    const out = (await Promise.all(calls)) as bigint[];
    const nav = out[0]!;
    const totalShares = out[1]!;
    const pricePerShare = out[2]!;
    const yourShares = out[3] ?? 0n;
    const yourUsdcBalance = out[4] ?? 0n;
    const yourValue = totalShares > 0n ? (yourShares * nav) / totalShares : 0n;
    setStats({ nav, totalShares, pricePerShare, yourShares, yourValue, yourUsdcBalance });
  }, [vault, publicClient, usdc, address]);

  useEffect(() => {
    refresh().catch(() => {});
    const interval = setInterval(() => refresh().catch(() => {}), 12_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const submit = async () => {
    if (!vault || !walletClient || !address) return;
    setError(undefined);
    try {
      if (mode === "deposit") {
        const wei = parseUnits(amount || "0", 6);
        if (wei <= 0n) throw new Error("enter an amount");

        const allowance = (await publicClient.readContract({
          address: usdc, abi: usdcAbi, functionName: "allowance", args: [address, vault],
        })) as bigint;
        if (allowance < wei) {
          setStatus("approving");
          const h = await walletClient.writeContract({
            address: usdc, abi: usdcAbi, functionName: "approve", args: [vault, wei],
            chain: walletClient.chain, account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash: h });
        }

        setStatus("submitting");
        const h = await walletClient.writeContract({
          address: vault, abi: vaultAbi, functionName: "deposit", args: [wei],
          chain: walletClient.chain, account: walletClient.account!,
        });
        setTxHash(h);
        await publicClient.waitForTransactionReceipt({ hash: h });
      } else {
        // Withdraw — interpret amount as USDC, convert to shares via pricePerShare
        const usdcWei = parseUnits(amount || "0", 6);
        if (usdcWei <= 0n) throw new Error("enter an amount");
        if (!stats) throw new Error("vault state not loaded");
        // shares = amount * totalShares / nav
        const sharesToBurn = (usdcWei * stats.totalShares) / stats.nav;
        if (sharesToBurn > stats.yourShares) throw new Error("you don't have that much");

        setStatus("submitting");
        const h = await walletClient.writeContract({
          address: vault, abi: vaultAbi, functionName: "withdraw", args: [sharesToBurn],
          chain: walletClient.chain, account: walletClient.account!,
        });
        setTxHash(h);
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setStatus("success");
      setAmount("");
      await refresh();
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  };

  if (!vault) {
    return (
      <div className="border border-dashed border-line p-6 text-fg-mute text-[13px]">
        Vault not configured on this chain.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
        <Stat label="NAV" value={stats ? `${fmtUsdc(stats.nav)} USDC` : "—"} />
        <Stat
          label="price · share"
          value={stats ? `${(Number(stats.pricePerShare) / 1e6).toFixed(4)}` : "—"}
        />
        <Stat
          label="your shares"
          value={stats ? fmtUsdc(stats.yourShares) : "—"}
        />
        <Stat
          label="your value"
          value={stats ? `${fmtUsdc(stats.yourValue)} USDC` : "—"}
          accent
        />
      </div>

      {/* Form */}
      <div className="border border-line p-5 min-w-[280px] bg-bg-elev/40">
        <div className="flex items-center gap-px bg-line mb-4">
          <button
            onClick={() => setMode("deposit")}
            className={`flex-1 caption py-2 transition-colors ${
              mode === "deposit" ? "bg-bg text-accent" : "bg-bg-elev text-fg-mute"
            }`}
          >
            deposit
          </button>
          <button
            onClick={() => setMode("withdraw")}
            className={`flex-1 caption py-2 transition-colors ${
              mode === "withdraw" ? "bg-bg text-accent" : "bg-bg-elev text-fg-mute"
            }`}
          >
            withdraw
          </button>
        </div>

        <label className="caption text-fg-dim mb-2 block">amount · USDC</label>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-bg border border-line px-3 py-2 text-[15px] tnum mb-3 focus:outline-none focus:border-accent"
        />

        {address && stats && (
          <div className="text-2xs text-fg-dim mb-3 tnum">
            {mode === "deposit"
              ? `wallet · ${fmtUsdc(stats.yourUsdcBalance)} USDC`
              : `available · ${fmtUsdc(stats.yourValue)} USDC`}
          </div>
        )}

        {!address ? (
          <button
            onClick={() => connect().catch(() => {})}
            className="w-full bg-accent text-bg py-2 caption hover:bg-accent/90 transition-colors"
          >
            connect wallet
          </button>
        ) : !isOnSupportedChain ? (
          <button
            onClick={() => switchChain().catch(() => {})}
            className="w-full bg-accent text-bg py-2 caption hover:bg-accent/90 transition-colors"
          >
            switch to Arc
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={status === "approving" || status === "submitting"}
            className="w-full bg-accent text-bg py-2 caption hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {status === "approving"
              ? "approving…"
              : status === "submitting"
                ? "submitting…"
                : mode === "deposit"
                  ? "deposit"
                  : "withdraw"}
          </button>
        )}

        {status === "success" && txHash && (
          <a
            href={txUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="block mt-3 text-2xs text-accent hover:underline"
          >
            confirmed · view on explorer ↗
          </a>
        )}
        {status === "error" && error && (
          <div className="mt-3 text-2xs text-down break-all">{error}</div>
        )}

        <a
          href={addrUrl(vault)}
          target="_blank"
          rel="noreferrer"
          className="block mt-4 text-2xs text-fg-dim hover:text-accent transition-colors tnum"
        >
          {vault.slice(0, 8)}…{vault.slice(-6)} ↗
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-bg p-4">
      <div className="caption text-fg-dim mb-1.5">{label}</div>
      <div className={`text-[17px] tnum tracking-tightest ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}
