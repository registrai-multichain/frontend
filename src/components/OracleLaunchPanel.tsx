"use client";

import { useCallback, useEffect, useState } from "react";
import { keccak256, parseUnits, toBytes } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { usdcAbi, oracleStakeAbi, registryAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";

// Launch an oracle straight from the UI: stake USDC once, then stand up feeds
// up to your tier quota. OracleStake is the on-chain feed creator AND bonded
// agent of record for every feed, so each feed carries its own real Registry
// bond (a slash of one never touches the others) and attestation flows through
// one contract. No package to ship.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type Tier = { minStake: bigint; maxOracles: bigint };
type Feed = {
  id: `0x${string}`;
  description: string;
  minBond: bigint;
  bond: bigint;
  dead: boolean;
};

const fmt = (w: bigint, dp = 2) => (Number(w) / 1e6).toFixed(dp);
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const WINDOWS: { label: string; secs: number }[] = [
  { label: "1 hour", secs: 3600 },
  { label: "6 hours", secs: 21600 },
  { label: "24 hours", secs: 86400 },
];

export function OracleLaunchPanel() {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } =
    useWallet();
  const os = CONTRACTS.OracleStake;
  const registry = CONTRACTS.RegistryV2 ?? CONTRACTS.Registry;
  const usdc = CONTRACTS.USDC;

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [floorConst, setFloorConst] = useState<bigint>(20_000_000n);
  const [deposit, setDeposit] = useState<bigint>(0n);
  const [quota, setQuota] = useState<bigint>(0n);
  const [active, setActive] = useState<bigint>(0n);
  const [free, setFree] = useState<bigint>(0n);
  const [usdcBal, setUsdcBal] = useState<bigint>(0n);
  const [feeds, setFeeds] = useState<Feed[]>([]);

  const [stakeAmt, setStakeAmt] = useState("");
  const [desc, setDesc] = useState("");
  const [methodology, setMethodology] = useState("");
  const [minBond, setMinBond] = useState("10");
  const [windowSecs, setWindowSecs] = useState(WINDOWS[0].secs);
  const [attestVals, setAttestVals] = useState<Record<string, string>>({});

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const refresh = useCallback(async () => {
    if (!os) return;
    try {
      const count = (await publicClient.readContract({
        address: os, abi: oracleStakeAbi, functionName: "tierCount",
      })) as bigint;
      const ts: Tier[] = [];
      for (let i = 0n; i < count; i++) {
        const r = (await publicClient.readContract({
          address: os, abi: oracleStakeAbi, functionName: "tiers", args: [i],
        })) as [bigint, bigint];
        ts.push({ minStake: r[0], maxOracles: r[1] });
      }
      setTiers(ts);
      const fc = (await publicClient.readContract({
        address: os, abi: oracleStakeAbi, functionName: "floorConst",
      })) as bigint;
      setFloorConst(fc);

      if (!address) return;
      const [dep, q, act, fr, bal] = (await Promise.all([
        publicClient.readContract({ address: os, abi: oracleStakeAbi, functionName: "depositOf", args: [address] }),
        publicClient.readContract({ address: os, abi: oracleStakeAbi, functionName: "quotaOf", args: [address] }),
        publicClient.readContract({ address: os, abi: oracleStakeAbi, functionName: "activeOf", args: [address] }),
        publicClient.readContract({ address: os, abi: oracleStakeAbi, functionName: "freeOf", args: [address] }),
        publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
      ])) as bigint[];
      setDeposit(dep); setQuota(q); setActive(act); setFree(fr); setUsdcBal(bal);

      const ids = (await publicClient.readContract({
        address: os, abi: oracleStakeAbi, functionName: "liveFeeds", args: [address],
      })) as `0x${string}`[];
      const list = await Promise.all(
        ids.map(async (id) => {
          const [f, dead, agent] = await Promise.all([
            publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getFeed", args: [id] }) as Promise<{ description: string; minBond: bigint }>,
            publicClient.readContract({ address: os, abi: oracleStakeAbi, functionName: "feedDead", args: [id] }) as Promise<boolean>,
            publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getAgent", args: [id, os] }) as Promise<{ bond: bigint }>,
          ]);
          return { id, description: f.description, minBond: f.minBond, bond: agent.bond, dead };
        }),
      );
      setFeeds(list);
    } catch (e) {
      console.error("oracle launch refresh", e);
    }
  }, [os, registry, usdc, publicClient, address]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => void refresh(), 15_000); return () => clearInterval(id); }, [refresh]);

  const needsConnect = !address || !isOnSupportedChain;
  const busy = status === "approving" || status === "submitting";
  const currentTier = [...tiers].reverse().find((t) => deposit >= t.minStake);
  const nextTier = tiers.find((t) => deposit < t.minStake);

  async function ensureApproved(needed: bigint) {
    const allowance = (await publicClient.readContract({
      address: usdc, abi: usdcAbi, functionName: "allowance", args: [address!, os!],
    })) as bigint;
    if (allowance >= needed) return;
    setStatus("approving");
    const hash = await walletClient!.writeContract({
      address: usdc, abi: usdcAbi, functionName: "approve",
      args: [os!, 2n ** 256n - 1n], chain: walletClient!.chain, account: walletClient!.account!,
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

  async function doStake() {
    const wei = parseUnits(stakeAmt || "0", 6);
    if (wei === 0n) { setError("amount required"); setStatus("error"); return; }
    await ensureApproved(wei);
    await run(() => walletClient!.writeContract({
      address: os!, abi: oracleStakeAbi, functionName: "stake",
      args: [wei], chain: walletClient!.chain, account: walletClient!.account!,
    }));
    setStakeAmt("");
  }

  async function doWithdraw() {
    if (free === 0n) { setError("no free balance to withdraw"); setStatus("error"); return; }
    await run(() => walletClient!.writeContract({
      address: os!, abi: oracleStakeAbi, functionName: "withdraw",
      args: [free], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  async function doDeploy() {
    if (!desc.trim()) { setError("describe what the feed reports"); setStatus("error"); return; }
    const mb = parseUnits(minBond || "0", 6);
    const methHash = keccak256(toBytes(methodology.trim() || desc.trim()));
    await run(() => walletClient!.writeContract({
      address: os!, abi: oracleStakeAbi, functionName: "deployFeed",
      args: [desc.trim(), methHash, mb, BigInt(windowSecs)],
      chain: walletClient!.chain, account: walletClient!.account!,
    }));
    setDesc(""); setMethodology("");
  }

  async function doAttest(feedId: string) {
    const raw = attestVals[feedId];
    if (raw === undefined || raw.trim() === "") { setError("value required"); setStatus("error"); return; }
    let v: bigint;
    try { v = BigInt(raw.trim()); } catch { setError("value must be an integer"); setStatus("error"); return; }
    const inputHash = keccak256(toBytes(`${feedId}:${raw}`));
    await run(() => walletClient!.writeContract({
      address: os!, abi: oracleStakeAbi, functionName: "attest",
      args: [feedId as `0x${string}`, v, inputHash],
      chain: walletClient!.chain, account: walletClient!.account!,
    }));
    setAttestVals((m) => ({ ...m, [feedId]: "" }));
  }

  async function doExit(feedId: string) {
    await run(() => walletClient!.writeContract({
      address: os!, abi: oracleStakeAbi, functionName: "exitFeed",
      args: [feedId as `0x${string}`], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  if (!os) {
    return (
      <div className="border border-line bg-bg-elev p-5 text-[13px] text-fg-dim">
        OracleStake is not configured on this chain yet.
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {/* Tier ladder */}
      <div className="border border-line bg-bg-elev p-5">
        <h3 className="font-serif text-[18px] mb-1">Staking tiers</h3>
        <p className="text-2xs text-fg-dim mb-4">
          Stake USDC once. Your tier sets how many live feeds you can run. Each
          feed reserves a {fmt(floorConst)} USDC floor bond from your deposit;
          the rest stays free to withdraw any time.
        </p>
        <div className="grid grid-cols-3 gap-px">
          {tiers.map((t, i) => {
            const isCurrent = currentTier && t.minStake === currentTier.minStake;
            return (
              <div
                key={i}
                className={`border p-3 ${isCurrent ? "border-accent/70 bg-accent/5" : "border-line bg-bg"}`}
              >
                <div className="caption text-[10px] text-fg-dim">
                  {["starter", "builder", "pro"][i] ?? `tier ${i + 1}`}
                </div>
                <div className="font-serif text-[20px] tabular-nums">{fmt(t.minStake, 0)}</div>
                <div className="text-2xs text-fg-dim">USDC staked</div>
                <div className="mt-2 text-[13px] text-accent tabular-nums">
                  {t.maxOracles.toString()} oracles
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Your position */}
      <div className="border border-line bg-bg-elev p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-[18px]">Your stake</h3>
          {currentTier ? (
            <span className="text-2xs text-up">
              {active.toString()} / {currentTier.maxOracles.toString()} oracles used
            </span>
          ) : (
            <span className="text-2xs text-fg-dim">below starter tier</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 text-[13px] mb-4">
          <div><div className="caption text-[10px] text-fg-dim">deposit</div><div className="tabular-nums">{fmt(deposit)}</div></div>
          <div><div className="caption text-[10px] text-fg-dim">free</div><div className="tabular-nums text-accent">{fmt(free)}</div></div>
          <div><div className="caption text-[10px] text-fg-dim">quota</div><div className="tabular-nums">{quota.toString()}</div></div>
        </div>

        {needsConnect ? (
          <button
            onClick={() => (address ? switchChain() : connect())}
            className="w-full bg-accent/90 text-bg py-2.5 text-[14px] hover:bg-accent transition-colors"
          >
            {address ? "switch to Arc testnet" : "connect wallet"}
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              value={stakeAmt} onChange={(e) => setStakeAmt(e.target.value)} inputMode="decimal"
              aria-label="USDC to stake" placeholder="USDC to stake"
              className="flex-1 bg-bg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60"
            />
            <button onClick={doStake} disabled={busy}
              className="px-4 bg-accent/90 text-bg text-[14px] hover:bg-accent transition-colors disabled:opacity-50">
              stake
            </button>
            <button onClick={doWithdraw} disabled={busy || free === 0n}
              className="px-4 border border-line text-[14px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-40">
              withdraw free
            </button>
          </div>
        )}
        <div className="caption text-2xs text-fg-dim mt-1">wallet: {fmt(usdcBal)} USDC{nextTier ? ` · ${fmt(nextTier.minStake - deposit)} more to ${["starter","builder","pro"][tiers.indexOf(nextTier)] ?? "next tier"}` : ""}</div>
      </div>

      {/* Launch a feed */}
      {!needsConnect && (
        <div className="border border-line bg-bg-elev p-5">
          <h3 className="font-serif text-[18px] mb-1">Launch a feed</h3>
          <p className="text-2xs text-fg-dim mb-4">
            Reserves a {fmt(floorConst)} USDC floor bond (or the feed minBond, whichever is higher) from your free balance.
            Disputes resolve to the protocol&apos;s neutral resolver, never to you.
          </p>
          <div className="space-y-2">
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              aria-label="feed description" placeholder="what does this feed report? e.g. BTC/USD spot, hourly"
              className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
            <input value={methodology} onChange={(e) => setMethodology(e.target.value)}
              aria-label="methodology" placeholder="methodology / data source (hashed on-chain) — optional"
              className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="caption text-[10px] text-fg-dim">min bond (USDC)</label>
                <input value={minBond} onChange={(e) => setMinBond(e.target.value)} inputMode="decimal"
                  className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
              </div>
              <div className="flex-1">
                <label className="caption text-[10px] text-fg-dim">dispute window</label>
                <select value={windowSecs} onChange={(e) => setWindowSecs(Number(e.target.value))}
                  className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60">
                  {WINDOWS.map((w) => <option key={w.secs} value={w.secs}>{w.label}</option>)}
                </select>
              </div>
            </div>
            <button onClick={doDeploy} disabled={busy || quota === 0n || active >= quota}
              className="w-full bg-accent/90 text-bg py-2.5 text-[14px] hover:bg-accent transition-colors disabled:opacity-50">
              {quota === 0n ? "stake to unlock a tier" : active >= quota ? "tier quota reached" : "launch feed"}
            </button>
          </div>
        </div>
      )}

      {/* Your feeds */}
      {!needsConnect && feeds.length > 0 && (
        <div className="border border-line bg-bg-elev p-5">
          <h3 className="font-serif text-[18px] mb-4">Your live feeds</h3>
          <div className="space-y-px">
            {feeds.map((f) => (
              <div key={f.id} className="border border-line bg-bg p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] truncate">{f.description || short(f.id)}</div>
                    <div className="caption text-2xs text-fg-dim">
                      {short(f.id)} · bond {fmt(f.bond)} USDC{f.dead ? " · slashed" : ""}
                    </div>
                  </div>
                  <span className={`text-2xs shrink-0 ${f.dead ? "text-down" : "text-up"}`}>
                    {f.dead ? "slashed" : "live"}
                  </span>
                </div>
                {!f.dead && (
                  <div className="flex gap-2 mt-2">
                    <input
                      value={attestVals[f.id] ?? ""} onChange={(e) => setAttestVals((m) => ({ ...m, [f.id]: e.target.value }))}
                      inputMode="numeric" aria-label="value to attest" placeholder="value (integer)"
                      className="flex-1 bg-bg border border-line px-3 py-1.5 text-[13px] outline-none focus:border-accent/60" />
                    <button onClick={() => doAttest(f.id)} disabled={busy}
                      className="px-3 bg-accent/90 text-bg text-[13px] hover:bg-accent transition-colors disabled:opacity-50">
                      attest
                    </button>
                    <button onClick={() => doExit(f.id)} disabled={busy}
                      className="px-3 border border-line text-[13px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">
                      exit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="caption text-2xs text-fg-dim mt-3">
            Exit returns a feed&apos;s bond to your free balance after the 7-day
            Registry cooldown and any open dispute window. Markets consume these
            feeds with agent = the OracleStake contract.
          </p>
        </div>
      )}

      {/* tx status */}
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
