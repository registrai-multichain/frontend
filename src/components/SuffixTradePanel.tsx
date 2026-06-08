"use client";

import { useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { usdcAbi, suffixTreasuryAbi, suffixTradeAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import type { SuffixPool } from "@/lib/suffix-pools";

// $ai (senior) trading only. $aiLP (junior) is a security and is intentionally
// NOT tradeable here. The floor is a cash-backed buyback policy, not a
// redemption right / profit promise; domain backing is a future roadmap item.

type Mode = "buy" | "sell";
type Status = "idle" | "approving" | "submitting" | "success" | "error";

const fmt = (w: bigint, dp = 2) => (Number(w) / 1e6).toFixed(dp);
const px = (w: bigint) => `$${(Number(w) / 1e6).toFixed(3)}`;

export function SuffixTradePanel({ pool }: { pool: SuffixPool }) {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } = useWallet();
  const treasury = pool.treasury;
  const ai = pool.senior;
  const usdc = CONTRACTS.USDC;
  const sym = pool.symbol;

  const [mode, setMode] = useState<Mode>("buy");
  const [amount, setAmount] = useState("");
  const [spot, setSpot] = useState<bigint>(0n);
  const [floor, setFloor] = useState<bigint>(0n);
  const [usdcBal, setUsdcBal] = useState<bigint>(0n);
  const [aiBal, setAiBal] = useState<bigint>(0n);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const refresh = useCallback(async () => {
    if (!treasury || !ai) return;
    try {
      const [sp, fl] = (await Promise.all([
        publicClient.readContract({ address: treasury, abi: suffixTreasuryAbi, functionName: "aiSpotPrice" }),
        publicClient.readContract({ address: treasury, abi: suffixTreasuryAbi, functionName: "seniorFloorPrice" }),
      ])) as bigint[];
      setSpot(sp); setFloor(fl);
      if (address) {
        const [ub, ab] = (await Promise.all([
          publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: ai, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
        ])) as bigint[];
        setUsdcBal(ub); setAiBal(ab);
      }
    } catch (e) { console.error("suffix trade refresh", e); }
  }, [treasury, ai, usdc, publicClient, address]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => void refresh(), 12_000); return () => clearInterval(id); }, [refresh]);

  const needsConnect = !address || !isOnSupportedChain;

  async function ensureApproved(token: `0x${string}`, needed: bigint) {
    const allowance = (await publicClient.readContract({
      address: token, abi: usdcAbi, functionName: "allowance", args: [address!, treasury!],
    })) as bigint;
    if (allowance >= needed) return;
    setStatus("approving");
    const hash = await walletClient!.writeContract({
      address: token, abi: usdcAbi, functionName: "approve",
      args: [treasury!, 2n ** 256n - 1n], chain: walletClient!.chain, account: walletClient!.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function run(fn: () => Promise<`0x${string}`>) {
    if (!walletClient || !address) return;
    setError(undefined); setTxHash(undefined);
    try {
      setStatus("submitting");
      const hash = await fn();
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success"); setAmount(""); await refresh();
    } catch (e) { setStatus("error"); setError(humanizeError(e)); }
  }

  async function doTrade() {
    const wei = parseUnits(amount || "0", 6);
    if (wei === 0n) { setError("amount required"); setStatus("error"); return; }
    if (mode === "buy") {
      await ensureApproved(usdc, wei);
      await run(() => walletClient!.writeContract({
        address: treasury!, abi: suffixTradeAbi, functionName: "buyAi",
        args: [wei, 0n], chain: walletClient!.chain, account: walletClient!.account!,
      }));
    } else {
      await ensureApproved(ai!, wei);
      await run(() => walletClient!.writeContract({
        address: treasury!, abi: suffixTradeAbi, functionName: "sellAi",
        args: [wei, 0n], chain: walletClient!.chain, account: walletClient!.account!,
      }));
    }
  }

  async function doRedeemFloor() {
    const wei = parseUnits(amount || "0", 6);
    if (wei === 0n) { setError("amount required"); setStatus("error"); return; }
    await run(() => walletClient!.writeContract({
      address: treasury!, abi: suffixTradeAbi, functionName: "redeemSeniorAtFloor",
      args: [wei], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  const busy = status === "approving" || status === "submitting";

  return (
    <div className="border border-line/60 bg-bg-elev/20 p-5 mb-px">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-[18px]">{`Trade $${sym}`}</h3>
        <div className="inline-flex border border-line/60 text-2xs" role="group" aria-label="buy / sell">
          {(["buy", "sell"] as Mode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`px-3 py-1 ${mode === m ? "bg-accent/90 text-bg" : "text-fg-dim hover:text-fg"}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 text-[13px] mb-3">
        <span>spot <span className="text-accent">{spot ? px(spot) : "—"}</span></span>
        <span>floor <span className="text-emerald-400">{floor ? px(floor) : "—"}</span></span>
      </div>

      <input
        value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
        aria-label={mode === "buy" ? "USDC to spend" : `$${sym} to sell`}
        placeholder={mode === "buy" ? "USDC in" : `$${sym} in`}
        className="w-full bg-bg-elev/40 border border-line/60 px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      <div className="caption text-2xs text-fg-dim mt-1">
        {mode === "buy" ? `wallet: ${fmt(usdcBal)} USDC` : `wallet: ${fmt(aiBal)} $${sym}`} · 0.30% fee → floor
      </div>

      <button
        onClick={needsConnect ? (address ? () => switchChain() : connect) : doTrade}
        disabled={busy}
        className="mt-3 w-full py-2.5 text-[13px] bg-accent/90 text-bg hover:bg-accent disabled:opacity-40 transition-colors"
      >
        {needsConnect ? (address ? "Switch to Arc" : "Connect") : mode === "buy" ? `Buy $${sym}` : `Sell $${sym}`}
      </button>

      {/* floor backstop */}
      <div className="mt-3 border-t border-line/30 pt-3">
        <div className="caption text-2xs text-fg-dim mb-1">
          floor backstop — sell ${sym} to the treasury at {floor ? px(floor) : "—"} (cash-backed). Use
          when the pool dips below the floor.
        </div>
        <button
          onClick={needsConnect ? (address ? () => switchChain() : connect) : doRedeemFloor}
          disabled={busy}
          className="w-full py-2 text-2xs border border-line hover:border-accent/60 disabled:opacity-40"
        >{`Redeem at floor (amount = $${sym} above)`}</button>
      </div>

      {status !== "idle" && (
        <div className="mt-2 text-2xs" aria-live="polite">
          {status === "approving" && <span className="text-fg-dim">approving…</span>}
          {status === "submitting" && <span className="text-fg-dim">submitting…</span>}
          {status === "success" && <span className="text-emerald-400">done. {txHash && <a className="underline" href={txUrl(txHash)} target="_blank" rel="noreferrer">tx</a>}</span>}
          {status === "error" && <span className="text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
