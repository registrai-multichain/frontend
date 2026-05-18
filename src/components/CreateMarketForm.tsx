"use client";

import { useEffect, useMemo, useState } from "react";
import { postMarketDescription } from "@/lib/hooks/useMarketDescription";
import { useRouter, useSearchParams } from "next/navigation";
import { decodeEventLog, parseUnits, type Address, type Hex } from "viem";
import { useWallet } from "./WalletProvider";
import { CREATABLE_FEEDS, type CreatableFeed } from "@/lib/demo";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { marketsAbi, usdcAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
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
  const { address, isOnSupportedChain, walletClient, publicClient, connect, switchChain } = useWallet();

  // Pre-fill from query string (proposed-market deploy links).
  const qFeed = searchParams?.get("feedId");
  const qThreshold = searchParams?.get("threshold");
  const qComparator = searchParams?.get("comparator");
  const qDays = searchParams?.get("days");

  const [selectedFeedId, setSelectedFeedId] = useState<string>(
    qFeed ?? (CREATABLE_FEEDS[0]?.id ?? ""),
  );
  // Free-form paste for custom feeds (e.g. one you just created via
  // /agents/create that isn't in the static manifest yet).
  const [customFeedMode, setCustomFeedMode] = useState(false);
  const [customFeedId, setCustomFeedId] = useState("");
  const [customFeedIsVerifiable, setCustomFeedIsVerifiable] = useState(true);

  const feed: CreatableFeed | undefined = useMemo(
    () => CREATABLE_FEEDS.find((f) => f.id.toLowerCase() === selectedFeedId.toLowerCase()),
    [selectedFeedId],
  );
  // Effective feed metadata for the rest of the form: from the manifest,
  // or synthesised when the user pastes a custom feedId.
  const isVerifiableFeed = customFeedMode ? customFeedIsVerifiable : !!feed?.rule;
  const effectiveDisplayDivisor = customFeedMode ? 1 : (feed?.displayDivisor ?? 1);
  const effectiveUnit = customFeedMode ? "feed units" : (feed?.unit ?? "");
  const effectiveDecimals = customFeedMode ? 0 : (feed?.decimals ?? 0);

  const defaultExpiry = useMemo(() => {
    const days = qDays ? Number(qDays) : 30;
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }, [qDays]);

  const [thresholdStr, setThresholdStr] = useState<string>(qThreshold ?? "");
  const [comparator, setComparator] = useState<number>(qComparator ? Number(qComparator) : 0);
  const [expiryDate, setExpiryDate] = useState<string>(defaultExpiry);
  const [liquidityStr, setLiquidityStr] = useState<string>("10");
  const [collateral, setCollateral] = useState<Collateral>("USDC");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const [tokenBalance, setTokenBalance] = useState<bigint | undefined>();

  // Default threshold suggestion when a feed is picked but threshold is blank
  useEffect(() => {
    if (customFeedMode || !feed || thresholdStr.length > 0) return;
    // Reasonable defaults: PLN/sqm → 17,500, bps → 400 (4.00%)
    setThresholdStr(feed.displayDivisor > 1 ? "4.00" : "17500");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.id, customFeedMode]);

  const tokenAddress: Address =
    collateral === "USDC" ? CONTRACTS.USDC : (CONTRACTS.EURC ?? CONTRACTS.USDC);

  // Verifiable (rule-bound) feeds live on Markets v1.1. Plain feeds use
  // v1.0. EURC pathway unchanged.
  const marketsContract: Address | undefined = useMemo(() => {
    if (collateral === "EURC") return CONTRACTS.MarketsEURC;
    if (isVerifiableFeed) return CONTRACTS.MarketsV11 ?? CONTRACTS.Markets;
    return CONTRACTS.Markets;
  }, [collateral, isVerifiableFeed]);

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

  // The number the contract stores. Form input is human units (e.g.
  // "4.00" for CPI %), contract wants `int256` in feed-native units
  // (basis points for CPI/ECB, integer PLN/sqm for Warsaw).
  const threshold = useMemo(() => {
    const v = Number(thresholdStr);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * effectiveDisplayDivisor);
  }, [thresholdStr, effectiveDisplayDivisor]);

  const customFeedIdValid =
    customFeedId.length === 66 && customFeedId.startsWith("0x");
  const canSubmit =
    (customFeedMode ? customFeedIdValid : !!feed) &&
    address &&
    isOnSupportedChain &&
    threshold > 0 &&
    expiryTs > Math.floor(Date.now() / 1000) &&
    liquidityWei >= 5_000_000n &&
    !!marketsContract &&
    status !== "approving" &&
    status !== "creating";

  const summary = useMemo(() => {
    if (!customFeedMode && !feed) return "";
    const cmp = COMPARATORS[comparator]!;
    const dateStr = new Date(expiryTs * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (customFeedMode) {
      return `Will the feed value ${cmp.label} ${fmtInt(threshold)} (raw) by ${dateStr}?`;
    }
    const subject = feed!.symbol.includes("WARSAW")
      ? "Warsaw residential price"
      : feed!.symbol.includes("CPI")
        ? "Polish CPI Y/Y"
        : feed!.symbol.includes("ECB")
          ? "the ECB main refi rate"
          : feed!.name;
    const valStr =
      effectiveDisplayDivisor > 1
        ? `${Number(thresholdStr || "0").toFixed(effectiveDecimals)}%`
        : `${fmtInt(threshold)} ${effectiveUnit}`;
    return `Will ${subject} ${cmp.label} ${valStr} by ${dateStr}?`;
  }, [feed, customFeedMode, comparator, expiryTs, threshold, thresholdStr, effectiveDisplayDivisor, effectiveDecimals, effectiveUnit]);

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
        args: [
          (customFeedMode ? customFeedId : feed!.id) as `0x${string}`,
          (customFeedMode ? address : feed!.agent) as `0x${string}`,
          BigInt(threshold), comparator, BigInt(expiryTs), liquidityWei,
        ],
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

      // Best-effort: persist the creator's description to the Worker KV.
      // Signature-gated — Worker verifies signer is the market creator
      // by reading getMarket(marketId) on chain. Failure to save the
      // description doesn't undo the market creation; we just log.
      if (newMarketId && description.trim().length > 0 && walletClient && walletClient.account) {
        const account = walletClient.account;
        postMarketDescription({
          marketId: newMarketId,
          description: description.trim(),
          signMessage: (message) => walletClient.signMessage({ account, message }),
        }).then((r) => {
          if (!r.ok) console.warn("market description not persisted:", r.error);
        });
      }

      if (newMarketId) {
        // Give the success state a beat to render, then redirect.
        setTimeout(() => router.push(`/markets/${newMarketId}/`), 1200);
      }
    } catch (e) {
      setError(humanizeError(e));
      setStatus("error");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
      {/* Form */}
      <div className="space-y-8">
        <Field
          label="01 · feed"
          hint="Pick the data feed this market will resolve against. Verifiable feeds use an onchain rule contract for aggregation. Or paste any feedId you just created on /agents/create."
        >
          <div className="space-y-2">
            {CREATABLE_FEEDS.map((f) => {
              const active = !customFeedMode && f.id === selectedFeedId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setCustomFeedMode(false);
                    setSelectedFeedId(f.id);
                    setThresholdStr(""); // reset to feed-appropriate default
                  }}
                  className={`w-full text-left p-3 transition-colors border ${
                    active
                      ? "bg-bg-elev/60 border-accent"
                      : "bg-bg-elev/20 border-line hover:border-line-strong"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="caption text-accent">{f.symbol}</span>
                      {f.rule && (
                        <span className="caption text-[10px] text-up border border-up/40 px-1.5 py-0.5">
                          verifiable
                        </span>
                      )}
                      {f.registryVersion && (
                        <span className="caption text-[10px] text-fg-dim">
                          v{f.registryVersion}
                        </span>
                      )}
                    </div>
                    <span className="text-2xs text-fg-mute">
                      {f.displayDivisor > 1 ? "%" : f.unit}
                    </span>
                  </div>
                  <p className="text-2xs text-fg-mute leading-snug mt-1.5 max-w-[58ch]">
                    {f.description}
                  </p>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setCustomFeedMode(true);
                setThresholdStr("");
              }}
              className={`w-full text-left p-3 transition-colors border ${
                customFeedMode
                  ? "bg-bg-elev/60 border-accent"
                  : "bg-bg-elev/20 border-line border-dashed hover:border-line-strong"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="caption text-fg">paste a custom feedId</span>
                <span className="text-2xs text-fg-dim">advanced · BYO feed</span>
              </div>
              <p className="text-2xs text-fg-mute leading-snug mt-1.5 max-w-[58ch]">
                Use this for a feed you just created on /agents/create, or any
                feedId that isn&apos;t in the picker yet.
              </p>
            </button>
            {customFeedMode && (
              <div className="space-y-3 p-3 border border-line bg-bg-elev/30">
                <input
                  type="text"
                  value={customFeedId}
                  onChange={(e) => setCustomFeedId(e.target.value.trim())}
                  placeholder="0x… (64 hex chars)"
                  className="w-full bg-bg border border-line px-3 py-2 text-[13px] tnum focus:outline-none focus:border-accent break-all"
                />
                <label className="flex items-start gap-2 text-2xs text-fg-mute leading-relaxed cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customFeedIsVerifiable}
                    onChange={(e) => setCustomFeedIsVerifiable(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    feed lives on Registry v1.1 (rule-bound / verifiable). Uncheck
                    if it&apos;s on the v1.0 plain-trust Registry.
                  </span>
                </label>
                <div className="text-2xs text-fg-dim leading-relaxed">
                  Threshold is entered as the raw int256 value the rule contract
                  outputs (e.g. for a PLN/USD feed in 4-decimal bps, enter{" "}
                  <code className="text-fg-mute">39500</code> for 3.95).
                </div>
              </div>
            )}
          </div>
        </Field>

        <Field
          label="02 · threshold"
          hint={
            customFeedMode
              ? "Raw int256 value the rule contract outputs. No display conversion — enter exactly what gets compared on chain."
              : feed?.displayDivisor && feed.displayDivisor > 1
                ? `Value to compare against at expiry, in ${feed.unit}. Enter in human units (e.g. "4.00" for 4.00%).`
                : "Value to compare against at expiry, in feed-native units."
          }
        >
          <div className="border border-line bg-bg flex items-baseline">
            <input
              type="number"
              value={thresholdStr}
              onChange={(e) => setThresholdStr(e.target.value)}
              step={!customFeedMode && effectiveDisplayDivisor > 1 ? "0.01" : "1"}
              className="flex-1 bg-transparent px-4 py-3 text-[19px] tnum tracking-tightest outline-none focus:border-accent"
              placeholder={customFeedMode ? "39500" : effectiveDisplayDivisor > 1 ? "4.00" : "17500"}
            />
            <span className="text-fg-dim text-[11px] px-3">
              {customFeedMode
                ? "int256"
                : effectiveDisplayDivisor > 1
                  ? "%"
                  : effectiveUnit}
            </span>
          </div>
          {!customFeedMode && effectiveDisplayDivisor > 1 && thresholdStr && (
            <div className="text-2xs text-fg-dim mt-1.5 tnum">
              onchain · {threshold} {effectiveUnit}
            </div>
          )}
        </Field>

        <Field label="03 · comparator" hint="How the attested value is compared.">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
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

        <Field
          label="07 · description"
          hint="Plain-English context for visitors who don't know what this market is about. Why is the threshold interesting? What would push it up or down? Persists onchain-attested (signed by your wallet, stored off-chain in KV). Optional but strongly recommended."
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. 'Razor-line on the next ECB meeting — current rate is exactly 2.75%. YES wins if the ECB cuts at the next decision; NO if they hold or hike.'"
            className="w-full bg-bg border border-line px-4 py-3 text-[13.5px] leading-relaxed focus:outline-none focus:border-accent resize-y"
          />
          <div className="text-2xs text-fg-dim mt-1.5 tnum">
            {description.length}/2000 · {description.length > 0 && walletClient
              ? "you'll be asked to sign a message after the market tx confirms"
              : "skip if you want — visitors will only see the auto-generated feed explainer"}
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
        ) : !isOnSupportedChain ? (
          <button
            type="button"
            onClick={() => switchChain()}
            className="w-full py-3 border border-down/60 text-down text-[12.5px] tracking-wide hover:bg-down hover:text-bg transition-colors"
          >
            switch network
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
