"use client";

import { useCallback, useEffect, useState } from "react";
import { keccak256, toBytes } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl, addrUrl } from "@/lib/chain";
import { usdcAbi, registryAbi, attestationAbi, disputeAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import type { SlashFeed } from "@/lib/slash-demo";

// Watch the bonded-oracle trust loop: an agent's attestations, the live bond,
// and the challenge -> resolve -> slash flow. A wrong attestation that the
// resolver rules invalid moves the agent's bond to the challenger and disables
// the agent. Fully on-chain.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type Att = {
  id: `0x${string}`;
  value: bigint;
  timestamp: bigint;
  finalizedAt: bigint;
  status: number; // 0 None, 1 Pending, 2 ResolvedValid, 3 ResolvedInvalid
  disputeId: `0x${string}`;
  outcome: number; // dispute outcome: 0 Pending, 1 Valid, 2 Invalid
};

const ATT_STATUS = ["unchallenged", "challenged", "upheld", "SLASHED"];
const fmtU = (w: bigint) => (Number(w) / 1e6).toFixed(2);
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function SlashLabPanel({ feed }: { feed: SlashFeed }) {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } = useWallet();
  const registry = CONTRACTS.RegistryV2 ?? CONTRACTS.Registry;
  const attestation = CONTRACTS.AttestationV2 ?? CONTRACTS.Attestation;
  const dispute = CONTRACTS.DisputeV2 ?? CONTRACTS.Dispute;
  const usdc = CONTRACTS.USDC;

  const [bond, setBond] = useState<bigint>(0n);
  const [locked, setLocked] = useState<bigint>(0n);
  const [slashed, setSlashed] = useState(false);
  const [resolver, setResolver] = useState<`0x${string}`>();
  const [atts, setAtts] = useState<Att[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const refresh = useCallback(async () => {
    if (!registry || !attestation || !dispute) return;
    try {
      const [agent, feedInfo, n] = await Promise.all([
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getAgent", args: [feed.feedId, feed.agent] }) as Promise<{ bond: bigint; lockedBond: bigint; slashed: boolean }>,
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getFeed", args: [feed.feedId] }) as Promise<{ resolver: `0x${string}` }>,
        publicClient.readContract({ address: attestation, abi: attestationAbi, functionName: "historyLength", args: [feed.feedId, feed.agent] }) as Promise<bigint>,
      ]);
      setBond(agent.bond); setLocked(agent.lockedBond); setSlashed(agent.slashed); setResolver(feedInfo.resolver);

      const count = Number(n);
      const rows: Att[] = [];
      for (let i = count - 1; i >= 0 && rows.length < 6; i--) {
        const id = (await publicClient.readContract({ address: attestation, abi: attestationAbi, functionName: "historyAt", args: [feed.feedId, feed.agent, BigInt(i)] })) as `0x${string}`;
        const a = (await publicClient.readContract({ address: attestation, abi: attestationAbi, functionName: "getAttestation", args: [id] })) as { value: bigint; timestamp: bigint; finalizedAt: bigint; status: number };
        const disputeId = (await publicClient.readContract({ address: dispute, abi: disputeAbi, functionName: "disputeOf", args: [id] })) as `0x${string}`;
        let outcome = 0;
        if (disputeId !== ZERO) {
          const d = (await publicClient.readContract({ address: dispute, abi: disputeAbi, functionName: "getDispute", args: [disputeId] })) as { outcome: number };
          outcome = Number(d.outcome);
        }
        rows.push({ id, value: a.value, timestamp: a.timestamp, finalizedAt: a.finalizedAt, status: Number(a.status), disputeId, outcome });
      }
      setAtts(rows); setLoaded(true);
    } catch (e) { console.error("slash lab refresh", e); }
  }, [registry, attestation, dispute, feed.feedId, feed.agent, publicClient]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => void refresh(), 8_000); return () => clearInterval(id); }, [refresh]);

  const available = bond > locked ? bond - locked : 0n;
  const isResolver = !!address && !!resolver && address.toLowerCase() === resolver.toLowerCase();
  const busy = status === "approving" || status === "submitting";
  const now = BigInt(Math.floor(Date.now() / 1000));

  async function run(fn: () => Promise<`0x${string}`>) {
    if (!walletClient || !address) return;
    setError(undefined); setTxHash(undefined);
    try {
      setStatus("submitting");
      const hash = await fn(); setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success"); await refresh();
    } catch (e) { setStatus("error"); setError(humanizeError(e)); }
  }

  async function challenge(a: Att) {
    if (available === 0n) { setError("agent has no available bond to challenge"); setStatus("error"); return; }
    // challenger must post a matching (symmetric) stake = the agent's available bond
    const allowance = (await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "allowance", args: [address!, dispute!] })) as bigint;
    if (allowance < available) {
      setStatus("approving");
      const h = await walletClient!.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [dispute!, 2n ** 256n - 1n], chain: walletClient!.chain, account: walletClient!.account! });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
    await run(() => walletClient!.writeContract({ address: dispute!, abi: disputeAbi, functionName: "challenge", args: [a.id, keccak256(toBytes(`evidence:${a.id}`))], chain: walletClient!.chain, account: walletClient!.account! }));
  }
  async function resolveInvalid(a: Att) {
    await run(() => walletClient!.writeContract({ address: dispute!, abi: disputeAbi, functionName: "resolve", args: [a.disputeId, 2], chain: walletClient!.chain, account: walletClient!.account! }));
  }

  return (
    <div className="border border-line bg-bg-elev p-5 mb-px">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-serif text-[18px]">{feed.label}</h3>
        {slashed ? (
          <span className="text-2xs px-2 py-0.5 bg-down/15 text-down border border-down/30">agent slashed</span>
        ) : (
          <span className="text-2xs text-up">bonded {fmtU(bond)} USDC</span>
        )}
      </div>
      <p className="text-2xs text-fg-dim mb-3 max-w-[60ch]">{feed.blurb}</p>
      <div className="flex gap-4 text-2xs text-fg-dim mb-3">
        <span>bond <span className="text-fg tabular-nums">{fmtU(bond)}</span></span>
        <span>available <span className="text-fg tabular-nums">{fmtU(available)}</span></span>
        <a href={addrUrl(feed.agent)} target="_blank" rel="noreferrer" className="hover:text-accent">agent ↗</a>
      </div>

      <div className="space-y-px">
        {!loaded && <div className="text-2xs text-fg-dim">loading…</div>}
        {loaded && atts.length === 0 && <div className="text-2xs text-fg-dim">no attestations yet</div>}
        {atts.map((a) => {
          const inWindow = now < a.finalizedAt;
          const challengeable = a.status === 0 && inWindow && available > 0n && !slashed;
          const pending = a.status === 1 && a.outcome === 0;
          return (
            <div key={a.id} className="border border-line bg-bg p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 text-[13px]">
                <div className="tabular-nums">value {a.value.toString()}</div>
                <div className={`caption text-2xs ${a.status === 3 ? "text-down" : "text-fg-dim"}`}>
                  {ATT_STATUS[a.status] ?? "?"}
                  {a.status === 0 && (inWindow ? " · in window" : " · finalized")}
                </div>
              </div>
              <div className="shrink-0">
                {challengeable && address && isOnSupportedChain && (
                  <button onClick={() => challenge(a)} disabled={busy}
                    className="px-3 py-1 bg-accent/90 text-bg text-2xs hover:bg-accent transition-colors disabled:opacity-50">
                    challenge ({fmtU(available)} USDC)
                  </button>
                )}
                {pending && isResolver && (
                  <button onClick={() => resolveInvalid(a)} disabled={busy}
                    className="px-3 py-1 bg-down/80 text-bg text-2xs hover:bg-down transition-colors disabled:opacity-50">
                    resolve invalid → slash
                  </button>
                )}
                {pending && !isResolver && <span className="text-2xs text-accent">challenged · awaiting resolver</span>}
                {a.status === 3 && <span className="text-2xs text-down">bond slashed</span>}
              </div>
            </div>
          );
        })}
      </div>

      {!address && (
        <button onClick={() => connect()} className="mt-3 w-full bg-accent/90 text-bg py-2 text-[13px] hover:bg-accent transition-colors">connect to challenge</button>
      )}
      {address && !isOnSupportedChain && (
        <button onClick={() => switchChain()} className="mt-3 w-full bg-accent/90 text-bg py-2 text-[13px] hover:bg-accent transition-colors">switch to Arc testnet</button>
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
