"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { decodeEventLog, parseUnits, type Address, type Hex } from "viem";
import { useWallet } from "./WalletProvider";
import { DEMO_FEED } from "@/lib/demo";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { marketsAbi, usdcAbi } from "@/lib/abi";
import { fmtInt } from "@/lib/format";

type Collateral = "USDC" | "EURC";

const COMPARATORS = [
  { label: "exceed", short: ">", value: 0 },
  { label: "be at or above", short: "≥", value: 1 },
  { label: "be below", short: "<", value: 2 },
  { label: "be at or below", short: "≤", value: 3 },
] as const;

type Status = "idle" | "approving" | "creating" | "success" | "error";

export function CreateMarketForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isOnArc, walletClient, publicClient, connect, switchToArc } = useWallet();

  const feed = DEMO_FEED;
  const agent = feed.agents[0]!;

  // Pre-fill from query string (proposed-market deploy links).
  const qThreshold = searchParams?.get("threshold");
  const qComparator = searchParams?.get("comparator");
  const qDays = searchParams?.get("days");

  const defaultExpiry = useMemo(() => {
    const days = qDays ? Number(qDays) : 30;
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }, [qDays]);

  const [thresholdStr, setThresholdStr] = useState<string>(
    qThreshold ?? String(Math.round(agent.attestations[0]?.value ?? 17300)),
  );
  const [comparator, setComparator] = useState<number>(qComparator ? Number(qComparator) : 0);
  const [expiryDate, setExpiryDate] = useState<string>(defaultExpiry);
  const [liquidityStr, setLiquidityStr] = useState<string>("10");
  const [collateral, setCollateral] = useState<Collateral>("USDC");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const [tokenBalance, setTokenBalance] = useState<bigint | undefined>();

  const tokenAddress: Address =
    collateral === "USDC" ? CONTRACTS.USDC : CONTRACTS.EURC;
  const marketsContract: Address | undefined =
    collateral === "USDC" ? CONTRACTS.Markets : CONTRACTS.MarketsEURC;

  // Pull live token balance for UX.
  useEffect(() => {
    if (!address) return;
    publicClient
      .readContract({
        address: tokenAddress,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [address],
      })
      .then((b) => setTokenBalance(b as bigint))
      .catch(() => setTokenBalance(0n));
  }, [address, publicClient, tokenAddress]);

  const expiryTs = useMemo(() => {
    if (!expiryDate) return 0;
    // UTC 14:00 of the picked date — matches agent attestation cadence so a same-day attestation resolves the market.
    return Math.floor(new Date(`${expiryDate}T14:00:00Z`).getTime() / 1000);
  }, [expiryDate]);

  const liquidityWei = useMemo(() => {
    const v = Number(liquidityStr);
    if (!Number.isFinite(v) || v <= 0) return 0n;
    return parseUnits(liquidityStr || "0", 6);
  }, [liquidityStr]);

  const threshold = useMemo(() => {
    const v = Number(thresholdStr);
    return Number.isFinite(v) ? Math.round(v) : 0;
  }, [thresholdStr]);

  const canSubmit =
    address &&
    isOnArc &&
    threshold > 0 &&
    expiryTs > Math.floor(Date.now() / 1000) &&
    liquidityWei >= 5_000_000n &&
    status !== "approving" &&
    status !== "creating";

  const summary = useMemo(() => {
    const cmp = COMPARATORS[comparator]!;
    const dateStr = new Date(expiryTs * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `Will Warsaw residential price ${cmp.label} ${fmtInt(threshold)} ${feed.unit} by ${dateStr}?`;
  }, [comparator, expiryTs, threshold, feed.unit]);

  async function onSubmit() {
    if (!address || !walletClient || !marketsContract) {
      if (!marketsContract) setError("EURC markets contract not configured.");
      return;
    }
    setStatus("idle");
    setError(undefined);
    setTxHash(undefined);

    try {
      // 1. Check allowance, approve if insufficient.
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: usdcAbi,
        functionName: "allowance",
        args: [address, marketsContract],
      })) as bigint;

      if (allowance < liquidityWei) {
        setStatus("approving");
        const approveHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: usdcAbi,
          functionName: "approve",
          args: [marketsContract, liquidityWei],
          chain: walletClient.chain,
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2. createMarket.
      setStatus("creating");
      const hash = await walletClient.writeContract({
        address: marketsContract,
        abi: marketsAbi,
        functionName: "createMarket",
        args: [feed.id, agent.address, BigInt(threshold), comparator, BigInt(expiryTs), liquidityWei],
        chain: walletClient.chain,
        account: address,
      });
      setTxHash(hash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("createMarket reverted");

      // Find the MarketCreated event to extract the new market id.
      let newMarketId: Hex | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketsContract.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: [
              {
                type: "event",
                name: "MarketCreated",
                inputs: [
                  { name: "marketId", type: "bytes32", indexed: true },
                  { name: "creator", type: "address", indexed: true },
                  { name: "feedId", type: "bytes32", indexed: true },
                  { name: "agent", type: "address", indexed: false },
                  { name: "threshold", type: "int256", indexed: false },
                  { name: "comparator", type: "uint8", indexed: false },
                  { name: "expiry", type: "uint256", indexed: false },
                  { name: "liquidity", type: "uint256", indexed: false },
                ],
              },
            ],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "MarketCreated") {
            newMarketId = decoded.args.marketId as Hex;
            break;
          }
        } catch {
          // Not our event, keep walking.
        }
      }

      setStatus("success");
      if (newMarketId) {
        // Give the success state a beat to render, then redirect.
        setTimeout(() => router.push(`/markets/${newMarketId}/`), 1200);
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
      {/* Form */}
      <div className="space-y-8">
        <Field label="01 · feed" hint="Currently one feed registered — more coming.">
          <div className="border border-line bg-bg-elev/30 p-4 flex items-center justify-between">
            <div>
              <div className="caption text-accent">{feed.symbol}</div>
              <div className="text-2xs text-fg-mute mt-0.5">{feed.unit}</div>
            </div>
            <div className="text-2xs text-fg-dim">
              attested daily 14:00 UTC
            </div>
          </div>
        </Field>

        <Field label="02 · threshold" hint="The value to compare against at expiry.">
          <div className="border border-line bg-bg flex items-baseline">
            <input
              type="number"
              value={thresholdStr}
              onChange={(e) => setThresholdStr(e.target.value)}
              className="flex-1 bg-transparent px-4 py-3 text-[19px] tnum tracking-tightest outline-none focus:border-accent"
              placeholder="17500"
            />
            <span className="text-fg-dim text-[11px] px-3">{feed.unit}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(() => {
              const v = agent.attestations[0]?.value ?? 17300;
              return [
                { label: "current", val: v },
                { label: "+5%", val: Math.round(v * 1.05 / 50) * 50 },
                { label: "+10%", val: Math.round(v * 1.10 / 50) * 50 },
                { label: "-5%", val: Math.round(v * 0.95 / 50) * 50 },
                { label: "-10%", val: Math.round(v * 0.90 / 50) * 50 },
              ].map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setThresholdStr(String(c.val))}
                  className="px-2.5 py-1 border border-line text-[11px] tnum text-fg-mute hover:border-accent hover:text-accent transition-colors"
                >
                  {c.label} · {c.val.toLocaleString("en-US").replace(/,/g, " ")}
                </button>
              ));
            })()}
          </div>
        </Field>

        <Field label="03 · comparator" hint="How the attested value is compared.">
          <div className="grid grid-cols-4 gap-px bg-line">
            {COMPARATORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setComparator(c.value)}
                className={`bg-bg px-3 py-3 text-center transition-colors ${
                  comparator === c.value
                    ? "border-l border-r border-t border-accent text-accent"
                    : "text-fg-mute hover:text-fg"
                }`}
              >
                <div className="text-[17px] tnum mb-0.5">{c.short}</div>
                <div className="text-2xs caption">{c.label}</div>
              </button>
            ))}
          </div>
        </Field>

        <Field label="04 · expiry" hint="Resolves at 14:00 UTC on this date.">
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
            className="w-full border border-line bg-bg px-4 py-3 text-[14px] tnum outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[
              { label: "1 week", days: 7 },
              { label: "1 month", days: 30 },
              { label: "3 months", days: 90 },
              { label: "6 months", days: 180 },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() =>
                  setExpiryDate(new Date(Date.now() + c.days * 86_400_000).toISOString().slice(0, 10))
                }
                className="px-2.5 py-1 border border-line text-[11px] text-fg-mute hover:border-accent hover:text-accent transition-colors"
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="05 · collateral" hint="Markets settle in this stablecoin. Both deployed.">
          <div className="grid grid-cols-2 gap-px bg-line">
            {(["USDC", "EURC"] as Collateral[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCollateral(c)}
                disabled={c === "EURC" && !CONTRACTS.MarketsEURC}
                className={`bg-bg px-3 py-3 text-center transition-colors disabled:opacity-30 ${
                  collateral === c
                    ? "border-l border-r border-t border-accent text-accent"
                    : "text-fg-mute hover:text-fg"
                }`}
              >
                <div className="text-[15px] tnum mb-0.5">{c}</div>
                <div className="text-2xs caption">
                  {c === "USDC" ? "US dollar" : "EU euro"}
                </div>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="06 · initial liquidity"
          hint={
            tokenBalance !== undefined
              ? `Your ${collateral} balance: ${(Number(tokenBalance) / 1e6).toFixed(2)}. Min 5.`
              : `Minimum 5 ${collateral}. Higher liquidity → lower slippage for traders.`
          }
        >
          <div className="border border-line bg-bg flex items-baseline">
            <input
              type="number"
              value={liquidityStr}
              onChange={(e) => setLiquidityStr(e.target.value)}
              step="1"
              min="5"
              className="flex-1 bg-transparent px-4 py-3 text-[19px] tnum tracking-tightest outline-none focus:border-accent"
            />
            <span className="text-fg-dim text-[11px] px-3">{collateral}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["5", "10", "25", "50"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setLiquidityStr(v)}
                className="px-2.5 py-1 border border-line text-[11px] tnum text-fg-mute hover:border-accent hover:text-accent transition-colors"
              >
                {v} {collateral}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* Right rail — preview + submit */}
      <aside className="space-y-6">
        <div className="border border-accent/30 bg-bg-elev/30 p-5">
          <div className="caption text-accent mb-3">market preview</div>
          <p className="font-serif text-[17px] leading-snug mb-4">{summary}</p>
          <div className="space-y-2 text-2xs text-fg-mute">
            <Row k="resolves" v={new Date(expiryTs * 1000).toUTCString()} />
            <Row k="liquidity" v={`${liquidityStr || "0"} ${collateral}`} />
            <Row k="initial odds" v="50 / 50" />
            <Row k="resolution" v={`Attestation.valueAt at expiry`} />
          </div>
        </div>

        {!address ? (
          <button
            type="button"
            onClick={connect}
            className="w-full py-3 border border-accent/60 text-accent text-[12.5px] tracking-wide hover:bg-accent hover:text-bg transition-colors"
          >
            connect wallet to create →
          </button>
        ) : !isOnArc ? (
          <button
            type="button"
            onClick={switchToArc}
            className="w-full py-3 border border-down/60 text-down text-[12.5px] tracking-wide hover:bg-down hover:text-bg transition-colors"
          >
            switch to Arc testnet
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full py-3 border border-accent/60 text-accent text-[12.5px] tracking-wide hover:bg-accent hover:text-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "approving"
              ? "approving USDC…"
              : status === "creating"
                ? "creating market…"
                : status === "success"
                  ? "✓ created — redirecting…"
                  : "create market →"}
          </button>
        )}

        {error && (
          <div className="border border-down/40 bg-bg-elev/30 p-4 text-2xs text-down leading-relaxed">
            {error.length > 200 ? `${error.slice(0, 200)}…` : error}
          </div>
        )}

        {txHash && (
          <a
            href={txUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="block text-2xs text-fg-dim hover:text-accent transition-colors"
          >
            tx: {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
          </a>
        )}

        <p className="text-2xs text-fg-dim leading-relaxed">
          Need testnet USDC? Get it from the{" "}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
          >
            Circle Faucet
          </a>
          .
        </p>
      </aside>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="caption mb-2">{label}</div>
      {children}
      {hint && <div className="text-2xs text-fg-dim mt-1.5">{hint}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="caption text-fg-dim">{k}</span>
      <span className="text-right text-fg break-all">{v}</span>
    </div>
  );
}
