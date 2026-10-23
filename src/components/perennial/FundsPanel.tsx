"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Address } from "viem";
import { Dialog } from "@/components/paper/Dialog";
import { nanoLedgerAbi, usdcAbi } from "@/lib/abi";
import { formatUsdc, maxDeposit, parseUsdcInput } from "@/lib/perennial-market";
import { usdText } from "@/lib/plain-words";
import { CHAIN, D, perennialClient, usePerennialTx } from "./usePerennialTx";

/** The trading balance (NanoLedger) and the wallet's USDC, shared by the top-bar pill and this panel. */
export function useFunds(address?: Address) {
  return useSWR(
    D.deployed && address ? ["perennial-funds", CHAIN.id, address] : null,
    async () => {
      const c = perennialClient();
      const [ledger, wallet] = await Promise.all([
        c.readContract({ address: D.contracts.NanoLedger!, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address!] }) as Promise<bigint>,
        c.readContract({ address: D.contracts.USDC!, abi: usdcAbi, functionName: "balanceOf", args: [address!] }) as Promise<bigint>,
      ]);
      return { ledger, wallet };
    },
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );
}

export function FundsPanel({ onClose }: { onClose: () => void }) {
  const tx = usePerennialTx();
  const { data, error } = useFunds(tx.address);
  const [amt, setAmt] = useState("");
  const nl = D.contracts.NanoLedger!;
  const walletBal = data?.wallet ?? 0n;
  const depositMax = maxDeposit(walletBal);

  async function deposit() {
    const p = parseUsdcInput(amt, { max: depositMax, label: "deposit" });
    if (!p.ok) return tx.fail(depositMax === 0n && amt.trim() ? "Your wallet needs to keep a little USDC for gas; nothing left to add." : p.error);
    const ok = await tx.run(
      "deposit",
      () => tx.walletClient!.writeContract({ address: nl, abi: nanoLedgerAbi, functionName: "deposit", args: [p.value], ...tx.w() }),
      { before: () => tx.ensureUsdcAllowance(nl, p.value), done: `Added ${usdText(p.value)} to trade with.` },
    );
    if (ok) setAmt("");
  }

  async function withdraw() {
    // Read fresh at click time: the cached balance can be 30s stale.
    const fresh = (await tx.publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [tx.address!] })) as bigint;
    if (fresh === 0n) return tx.fail("Nothing to withdraw.");
    await tx.run("withdraw", () => tx.walletClient!.writeContract({ address: nl, abi: nanoLedgerAbi, functionName: "withdraw", args: [fresh], ...tx.w() }), {
      done: `Moved ${usdText(fresh)} back to your wallet.`,
    });
  }

  return (
    <Dialog title="Your trading balance" onClose={onClose}>
      {tx.needsConnect ? (
        <div className="pa-stack">
          <p className="pa-muted">{tx.address ? `Switch your wallet to ${D.label} to add funds.` : "Connect a wallet to add funds."}</p>
          <button type="button" className="pa-btn pa-btn--block pu-btn pu-btn--primary" onClick={tx.connectOrSwitch}>
            {tx.address ? `Switch to ${D.label}` : "Connect wallet"}
          </button>
        </div>
      ) : (
        <div className="pa-stack">
          <div className="pa-kv"><span>To trade</span><b>{data ? usdText(data.ledger) : error ? "couldn't read" : "…"}</b></div>
          <div className="pa-kv"><span>In your wallet</span><b>{data ? usdText(walletBal) : "…"}</b></div>
          <label className="pa-field pu-input">
            <span>Add</span>
            <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Amount to add in USDC" />
            <span>USDC</span>
          </label>
          <div className="pa-chips">
            {["5", "10", "25"].map((v) => (
              <button key={v} type="button" className="pa-chip" onClick={() => setAmt(v)}>${v}</button>
            ))}
            <button type="button" className="pa-chip" onClick={() => setAmt(formatUsdc(depositMax, 6))}>Max {usdText(depositMax)}</button>
          </div>
          <button type="button" className="pa-btn pa-btn--block pu-btn pu-btn--primary" onClick={deposit} disabled={tx.busy || !data}>
            {tx.pending === "deposit" ? "Adding…" : "Add funds"}
          </button>
          <button type="button" className="pa-btn pa-btn--quiet pa-btn--block pu-btn pu-btn--quiet" onClick={withdraw} disabled={tx.busy || !data}>
            {tx.pending === "withdraw" ? "Withdrawing…" : "Withdraw all"}
          </button>
          <p className="pa-muted pa-small">Moving funds in takes one approval and one transaction. Your wallet keeps $0.10 for gas.</p>
          {CHAIN.testnet && (
            <p className="pa-small">
              Need test USDC? <a className="pa-link" href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com ↗</a>
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
