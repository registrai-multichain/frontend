"use client";

import { useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { usdcAbi, nanoLedgerAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";

// NanoLedger demo: value moves as internal accounting, so a sub-cent payment
// costs the same as a large one and real USDC only moves at deposit/withdraw.
// Streams are reserve-funded and virtual (zero gas while running), settled
// lazily. Fully on-chain, trustless: the contract custodies, no operator.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type StreamRow = {
  id: number; from: `0x${string}`; to: `0x${string}`;
  cap: bigint; settled: bigint; claimable: bigint; closed: boolean;
};

const fmt = (w: bigint, dp = 6) => (Number(w) / 1e6).toFixed(dp).replace(/\.?0+$/, "");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function NanoPayPanel() {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } = useWallet();
  const nl = CONTRACTS.NanoLedger;
  const usdc = CONTRACTS.USDC;

  const [bal, setBal] = useState<bigint>(0n);
  const [walletBal, setWalletBal] = useState<bigint>(0n);
  const [totalOwed, setTotalOwed] = useState<bigint>(0n);
  const [held, setHeld] = useState<bigint>(0n);
  const [streams, setStreams] = useState<StreamRow[]>([]);

  const [depAmt, setDepAmt] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [strTo, setStrTo] = useState("");
  const [strPerDay, setStrPerDay] = useState("");
  const [strCap, setStrCap] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const refresh = useCallback(async () => {
    if (!nl) return;
    try {
      const [owed, h] = (await Promise.all([
        publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "totalOwed" }),
        publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [nl] }),
      ])) as bigint[];
      setTotalOwed(owed); setHeld(h);

      if (address) {
        const [b, wb] = (await Promise.all([
          publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
        ])) as bigint[];
        setBal(b); setWalletBal(wb);

        const count = Number((await publicClient.readContract({
          address: nl, abi: nanoLedgerAbi, functionName: "streamCount",
        })) as bigint);
        const rows: StreamRow[] = [];
        for (let i = Math.max(0, count - 40); i < count; i++) {
          const s = (await publicClient.readContract({
            address: nl, abi: nanoLedgerAbi, functionName: "streams", args: [BigInt(i)],
          })) as [`0x${string}`, `0x${string}`, bigint, bigint, bigint, number, boolean];
          const mine = s[0].toLowerCase() === address.toLowerCase() || s[1].toLowerCase() === address.toLowerCase();
          if (!mine || s[6]) continue;
          const claimable = (await publicClient.readContract({
            address: nl, abi: nanoLedgerAbi, functionName: "claimableStream", args: [BigInt(i)],
          })) as bigint;
          rows.push({ id: i, from: s[0], to: s[1], cap: s[3], settled: s[4], claimable, closed: s[6] });
        }
        setStreams(rows);
      }
    } catch (e) { console.error("nanopay refresh", e); }
  }, [nl, usdc, publicClient, address]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => void refresh(), 6_000); return () => clearInterval(id); }, [refresh]);

  const needsConnect = !address || !isOnSupportedChain;
  const busy = status === "approving" || status === "submitting";

  async function ensureApproved(needed: bigint) {
    const allowance = (await publicClient.readContract({
      address: usdc, abi: usdcAbi, functionName: "allowance", args: [address!, nl!],
    })) as bigint;
    if (allowance >= needed) return;
    setStatus("approving");
    const hash = await walletClient!.writeContract({
      address: usdc, abi: usdcAbi, functionName: "approve",
      args: [nl!, 2n ** 256n - 1n], chain: walletClient!.chain, account: walletClient!.account!,
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
      setStatus("success"); await refresh();
    } catch (e) { setStatus("error"); setError(humanizeError(e)); }
  }

  const w = (functionName: string, args: unknown[]) =>
    walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName, args, chain: walletClient!.chain, account: walletClient!.account! } as never);

  async function doDeposit() {
    const wei = parseUnits(depAmt || "0", 6);
    if (wei === 0n) { setError("amount required"); setStatus("error"); return; }
    await ensureApproved(wei);
    await run(() => w("deposit", [wei]));
    setDepAmt("");
  }
  async function doWithdraw() {
    if (bal === 0n) { setError("nothing to withdraw"); setStatus("error"); return; }
    await run(() => w("withdraw", [bal]));
  }
  async function doPay() {
    const wei = parseUnits(payAmt || "0", 6);
    if (!payTo || wei === 0n) { setError("recipient + amount required"); setStatus("error"); return; }
    await run(() => w("internalTransfer", [payTo as `0x${string}`, wei]));
    setPayAmt("");
  }
  async function doOpenStream() {
    const perDay = parseUnits(strPerDay || "0", 6);
    const cap = parseUnits(strCap || "0", 6);
    const ratePerSec = perDay / 86400n;
    if (!strTo || ratePerSec === 0n || cap === 0n) { setError("need recipient, rate/day, cap"); setStatus("error"); return; }
    await run(() => w("openStream", [strTo as `0x${string}`, ratePerSec, cap]));
    setStrPerDay(""); setStrCap("");
  }

  if (!nl) {
    return <div className="border border-line bg-bg-elev p-5 text-[13px] text-fg-dim">NanoLedger is not configured on this chain yet.</div>;
  }

  return (
    <div className="space-y-px">
      {/* solvency banner */}
      <div className="border border-line bg-bg-elev p-4 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        <span>ledger holds <span className="text-accent tabular-nums">{fmt(held)} USDC</span></span>
        <span>owed <span className="tabular-nums">{fmt(totalOwed)} USDC</span></span>
        <span className={held >= totalOwed ? "text-up" : "text-down"}>
          {held >= totalOwed ? "solvent ✓" : "INSOLVENT"}
        </span>
      </div>

      {/* balance + deposit/withdraw */}
      <div className="border border-line bg-bg-elev p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-[18px]">Your ledger balance</h3>
          <span className="tabular-nums text-accent text-[16px]">{fmt(bal)} USDC</span>
        </div>
        {needsConnect ? (
          <button onClick={() => (address ? switchChain() : connect())}
            className="w-full bg-accent/90 text-bg py-2.5 text-[14px] hover:bg-accent transition-colors">
            {address ? "switch to Arc testnet" : "connect wallet"}
          </button>
        ) : (
          <div className="flex gap-2">
            <input value={depAmt} onChange={(e) => setDepAmt(e.target.value)} inputMode="decimal" placeholder="USDC to deposit"
              className="flex-1 bg-bg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60" />
            <button onClick={doDeposit} disabled={busy} className="px-4 bg-accent/90 text-bg text-[14px] hover:bg-accent transition-colors disabled:opacity-50">deposit</button>
            <button onClick={doWithdraw} disabled={busy || bal === 0n} className="px-4 border border-line text-[14px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-40">withdraw all</button>
          </div>
        )}
        <div className="caption text-2xs text-fg-dim mt-1">wallet: {fmt(walletBal)} USDC · real USDC only moves on deposit/withdraw</div>
      </div>

      {!needsConnect && (
        <>
          {/* internal pay */}
          <div className="border border-line bg-bg-elev p-5">
            <h3 className="font-serif text-[18px] mb-1">Pay (internal)</h3>
            <p className="text-2xs text-fg-dim mb-3">Pure accounting. A 0.000001 USDC payment costs the same gas as a large one.</p>
            <div className="space-y-2">
              <input value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="recipient address (0x…)"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
              <div className="flex gap-2">
                <input value={payAmt} onChange={(e) => setPayAmt(e.target.value)} inputMode="decimal" placeholder="USDC (try 0.000001)"
                  className="flex-1 bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
                <button onClick={doPay} disabled={busy} className="px-4 bg-accent/90 text-bg text-[14px] hover:bg-accent transition-colors disabled:opacity-50">pay</button>
              </div>
            </div>
          </div>

          {/* streams */}
          <div className="border border-line bg-bg-elev p-5">
            <h3 className="font-serif text-[18px] mb-1">Open a stream</h3>
            <p className="text-2xs text-fg-dim mb-3">Reserves the cap from your balance now. Virtual while it runs (zero gas), settle anytime.</p>
            <div className="space-y-2">
              <input value={strTo} onChange={(e) => setStrTo(e.target.value)} placeholder="recipient address (0x…)"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
              <div className="flex gap-2">
                <input value={strPerDay} onChange={(e) => setStrPerDay(e.target.value)} inputMode="decimal" placeholder="USDC / day"
                  className="flex-1 bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
                <input value={strCap} onChange={(e) => setStrCap(e.target.value)} inputMode="decimal" placeholder="total cap (USDC)"
                  className="flex-1 bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
                <button onClick={doOpenStream} disabled={busy} className="px-4 bg-accent/90 text-bg text-[14px] hover:bg-accent transition-colors disabled:opacity-50">stream</button>
              </div>
            </div>

            {streams.length > 0 && (
              <div className="mt-4 space-y-px">
                {streams.map((s) => {
                  const outgoing = s.from.toLowerCase() === address!.toLowerCase();
                  return (
                    <div key={s.id} className="border border-line bg-bg p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[13px]">
                        <div>{outgoing ? `→ ${short(s.to)}` : `← ${short(s.from)}`} · stream #{s.id}</div>
                        <div className="caption text-2xs text-fg-dim">
                          claimable {fmt(s.claimable)} · of cap {fmt(s.cap)} USDC
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => run(() => w("settleStream", [BigInt(s.id)]))} disabled={busy}
                          className="px-3 py-1 bg-accent/90 text-bg text-2xs hover:bg-accent transition-colors disabled:opacity-50">settle</button>
                        {outgoing && (
                          <button onClick={() => run(() => w("cancelStream", [BigInt(s.id)]))} disabled={busy}
                            className="px-3 py-1 border border-line text-2xs text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">cancel</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {(error || txHash || status === "success") && (
        <div className="border border-line bg-bg-elev p-3 text-2xs">
          {status === "success" && <span className="text-up">done. </span>}
          {error && <span className="text-down">{error} </span>}
          {txHash && <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">view tx ↗</a>}
        </div>
      )}
    </div>
  );
}
