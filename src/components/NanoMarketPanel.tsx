"use client";

import { useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { nanoLedgerAbi, marketsV4Abi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import type { NanoMarket } from "@/lib/nano-markets";

// Trade a MarketsV4 market that settles entirely on NanoLedger. Buying pulls
// collateral from your ledger balance (deposit on this page first), the fee is
// one accrual write, and fee recipients claim from the ledger.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type Side = "Yes" | "No";

const fmt = (w: bigint, dp = 4) => (Number(w) / 1e6).toFixed(dp).replace(/\.?0+$/, "");
const pct = (w: bigint) => `${(Number(w) / 1e16).toFixed(1)}%`; // 1e18 -> %

export function NanoMarketPanel({ market }: { market: NanoMarket }) {
  const { address, publicClient, walletClient, isOnSupportedChain } = useWallet();
  const nl = CONTRACTS.NanoLedger;
  const mv4 = CONTRACTS.MarketsV4nano;

  const [yesPrice, setYesPrice] = useState<bigint>(0n);
  const [phase, setPhase] = useState<number>(0);
  const [yesWon, setYesWon] = useState(false);
  const [yesBal, setYesBal] = useState<bigint>(0n);
  const [noBal, setNoBal] = useState<bigint>(0n);
  const [ledgerBal, setLedgerBal] = useState<bigint>(0n);
  const [feeClaimable, setFeeClaimable] = useState<bigint>(0n);

  const [side, setSide] = useState<Side>("Yes");
  const [amt, setAmt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const refresh = useCallback(async () => {
    if (!nl || !mv4) return;
    try {
      const [yp, m] = await Promise.all([
        publicClient.readContract({ address: mv4, abi: marketsV4Abi, functionName: "priceOf", args: [market.marketId, 0] }) as Promise<bigint>,
        publicClient.readContract({ address: mv4, abi: marketsV4Abi, functionName: "getMarket", args: [market.marketId] }) as Promise<{ phase: number; yesWon: boolean }>,
      ]);
      setYesPrice(yp); setPhase(Number(m.phase)); setYesWon(m.yesWon);
      if (address) {
        const [yb, nb, lb, fee] = await Promise.all([
          publicClient.readContract({ address: mv4, abi: marketsV4Abi, functionName: "yesBalance", args: [market.marketId, address] }) as Promise<bigint>,
          publicClient.readContract({ address: mv4, abi: marketsV4Abi, functionName: "noBalance", args: [market.marketId, address] }) as Promise<bigint>,
          publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
          publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "claimablePool", args: [market.marketId, address] }) as Promise<bigint>,
        ]);
        setYesBal(yb); setNoBal(nb); setLedgerBal(lb); setFeeClaimable(fee);
      }
    } catch (e) { console.error("nano market refresh", e); }
  }, [nl, mv4, market.marketId, publicClient, address]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => void refresh(), 6_000); return () => clearInterval(id); }, [refresh]);

  const busy = status === "approving" || status === "submitting";
  const resolved = phase === 1;

  async function ensureSpender(needed: bigint) {
    const a = (await publicClient.readContract({ address: nl!, abi: nanoLedgerAbi, functionName: "allowance", args: [address!, mv4!] })) as bigint;
    if (a >= needed) return;
    setStatus("approving");
    const hash = await walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "approveSpender", args: [mv4!, 2n ** 256n - 1n], chain: walletClient!.chain, account: walletClient!.account! });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  async function run(fn: () => Promise<`0x${string}`>) {
    if (!walletClient || !address) return;
    setError(undefined); setTxHash(undefined);
    try {
      setStatus("submitting");
      const hash = await fn(); setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success"); setAmt(""); await refresh();
    } catch (e) { setStatus("error"); setError(humanizeError(e)); }
  }
  const w = (fn: string, args: unknown[]) => walletClient!.writeContract({ address: mv4!, abi: marketsV4Abi, functionName: fn, args, chain: walletClient!.chain, account: walletClient!.account! } as never);

  async function doBuy() {
    const wei = parseUnits(amt || "0", 6);
    if (wei === 0n) { setError("amount required"); setStatus("error"); return; }
    if (wei > ledgerBal) { setError("deposit into the ledger first (above)"); setStatus("error"); return; }
    await ensureSpender(wei);
    await run(() => w("buy", [market.marketId, side === "Yes" ? 0 : 1, wei, 0n]));
  }
  async function doSell() {
    const wei = parseUnits(amt || "0", 6);
    const have = side === "Yes" ? yesBal : noBal;
    if (wei === 0n || wei > have) { setError("not enough shares"); setStatus("error"); return; }
    await run(() => w("sell", [market.marketId, side === "Yes" ? 0 : 1, wei, 0n]));
  }
  async function doClaimFee() {
    await run(() => walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "claim", args: [market.marketId], chain: walletClient!.chain, account: walletClient!.account! }));
  }

  if (!mv4) return null;

  return (
    <div className="border border-line bg-bg-elev p-5 mt-px">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-serif text-[18px]">{market.question}</h3>
        <span className="text-2xs text-fg-dim">{resolved ? (yesWon ? "resolved YES" : "resolved NO") : "trading"}</span>
      </div>
      <p className="text-2xs text-fg-dim mb-3">{market.hint}</p>

      <div className="mb-3">
        <div className="flex items-center justify-between text-2xs mb-1">
          <span className="text-up">YES {pct(yesPrice)}</span>
          {feeClaimable > 0n && <span className="text-accent">fees {fmt(feeClaimable)} USDC</span>}
          <span className="text-down">NO {pct(10n ** 18n - yesPrice)}</span>
        </div>
        <div className="h-2 w-full bg-down/15 overflow-hidden flex">
          <div className="bg-up/80 h-full transition-all" style={{ width: `${Number(yesPrice) / 1e16}%` }} />
        </div>
      </div>

      {!resolved && address && isOnSupportedChain && (
        <>
          <div className="inline-flex border border-line text-2xs mb-2" role="group">
            {(["Yes", "No"] as Side[]).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}
                className={`px-3 py-1 ${side === s ? "bg-accent/90 text-bg" : "text-fg-dim hover:text-fg"}`}>{s}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder={`USDC in / ${side} shares`}
              className="flex-1 bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
            <button onClick={doBuy} disabled={busy} className="px-4 bg-accent/90 text-bg text-[14px] hover:bg-accent transition-colors disabled:opacity-50">buy</button>
            <button onClick={doSell} disabled={busy} className="px-4 border border-line text-[14px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">sell</button>
          </div>
          <div className="caption text-2xs text-fg-dim mt-1">
            ledger balance {fmt(ledgerBal)} USDC · your shares: YES {fmt(yesBal)} / NO {fmt(noBal)}
          </div>
        </>
      )}

      {resolved && address && (
        <button onClick={() => run(() => w("redeem", [market.marketId]))} disabled={busy}
          className="w-full bg-accent/90 text-bg py-2 text-[14px] hover:bg-accent transition-colors disabled:opacity-50">
          redeem winning shares
        </button>
      )}

      {feeClaimable > 0n && address && (
        <button onClick={doClaimFee} disabled={busy}
          className="mt-2 w-full border border-line py-2 text-[13px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">
          claim {fmt(feeClaimable)} USDC fees from the ledger
        </button>
      )}

      {(error || txHash || status === "success") && (
        <div className="mt-2 text-2xs">
          {status === "success" && <span className="text-up">done. </span>}
          {error && <span className="text-down">{error} </span>}
          {txHash && <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">view tx ↗</a>}
        </div>
      )}
    </div>
  );
}
