"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, parseUnits } from "viem";
import useSWR from "swr";
import { useWallet } from "./WalletProvider";
import { transportFor, txUrl as txUrlFor } from "@/lib/chains";
import { PERENNIAL } from "@/lib/perennial-network";
import { usdcAbi, nanoLedgerAbi, builderRegistryAbi, progressPoolAbi, marketsPerennialAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import {
  PERENNIAL_BUILDERS, CREATE_FEED, PERENNIAL_DEPLOYMENT_NOTICE,
  PERENNIAL_WRITES_ENABLED, type PerennialBuilder,
} from "@/lib/perennial";
import { BuilderProfile, findDigest } from "./BuilderProfile";

// Perennial end-to-end: bettors trade builder-milestone markets (fees pool into
// the commons); builders register, accrue progress from verified artifacts, and
// claim a progress-weighted share. The hype pays for the grind.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type Role = "bet" | "build";
type MarketView = "new" | "trending" | "featured" | "closing";
type BuilderView = "new" | "star" | "veteran";
type MarketMeta = {
  yesPrice: bigint;
  expiry: bigint;
  createdAt: bigint;
  phase: number;
  yesReserve: bigint;
  noReserve: bigint;
};
type Snapshot = {
  pendingPot: bigint;
  epoch: bigint;
  ledgerBal: bigint;
  walletBal: bigint;
  yesPrice: bigint;
  milestoneYesPrice: bigint;
  yesBal: bigint;
  noBal: bigint;
  registered: boolean;
  myWeight: bigint;
  claims: { epoch: number; amount: bigint }[];
  weights: Record<string, bigint>;
  markets: Record<string, MarketMeta>;
};
const CLAIM_SCAN_LIMIT = 52n;
const fmt = (w: bigint, dp = 2) => (Number(w) / 1e6).toFixed(dp).replace(/\.?0+$/, "");
const yesPctNum = (w: bigint) => Math.round(Number(w) / 1e16);

// Perennial runs on the build-selected network (PERENNIAL), independent of the
// app-wide DEFAULT_CHAIN that powers the oracle/feed/markets pages.
const PERENNIAL_CHAIN = PERENNIAL.chain;
const PERENNIAL_CHAIN_ID = PERENNIAL.chain.id;
const P = PERENNIAL.contracts;
const txUrl = (hash: string) => txUrlFor(PERENNIAL_CHAIN, hash);

export function PerennialPanel() {
  // Nothing on this network yet: say so, and make no contract calls at all.
  if (!PERENNIAL.deployed) return <PerennialNotDeployed />;
  return <PerennialLive />;
}

function PerennialNotDeployed() {
  return (
    <div className="pp-notice border border-line bg-bg-elev p-5 text-[13px] text-fg-dim">
      <strong className="text-fg">Perennial is not deployed on {PERENNIAL.label} yet.</strong>{" "}
      Markets, deposits and builder payouts open here once the contracts are live. Nothing on
      this page reads or writes {PERENNIAL.label} until then.
    </div>
  );
}

function PerennialLive() {
  const { address, walletChainId, walletClient, connect, switchChain } = useWallet();

  // Reads are pinned to the Perennial chain regardless of what chain the wallet
  // sits on, so the panel shows Arc state even before the user switches.
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: PERENNIAL_CHAIN.viemChain,
        transport: transportFor(PERENNIAL_CHAIN),
      }),
    [],
  );
  // Writes need the wallet actually on the Perennial chain.
  const onPerennialChain = walletChainId === PERENNIAL_CHAIN_ID;

  const nl = P.NanoLedger;
  const pool = P.ProgressPool;
  const reg = P.BuilderRegistry;
  const mp = P.MarketsPerennial;
  const usdc = P.USDC!;

  const [role, setRole] = useState<Role>("bet");
  const [selected, setSelected] = useState<PerennialBuilder>(PERENNIAL_BUILDERS[0]);
  const [selectedMarketKind, setSelectedMarketKind] = useState<"primary" | "milestone">("primary");
  const [marketView, setMarketView] = useState<MarketView>("trending");
  const [builderView, setBuilderView] = useState<BuilderView>("star");
  const [now, setNow] = useState(0);
  const [createdMarkets, setCreatedMarkets] = useState<Record<string, `0x${string}`>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [cDays, setCDays] = useState("7");
  const [cLiq, setCLiq] = useState("5");

  const [depAmt, setDepAmt] = useState("");
  const [betAmt, setBetAmt] = useState("");
  const [side, setSide] = useState<"Yes" | "No">("Yes");
  const [repo, setRepo] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [pending, setPending] = useState<string>(""); // which action is busy
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedPrimaryId = createdMarkets[selected.address] ?? selected.marketId;
  const selectedMilestoneId = selected.milestoneMarketId;
  const selectedMarketId = selectedMarketKind === "milestone" ? selectedMilestoneId : selectedPrimaryId;
  const selectedQuestion = selectedMarketKind === "milestone"
    ? (selected.milestoneQuestion ?? "Ships a new release this cycle?")
    : selected.marketQuestion;

  const marketIds = useMemo(() => {
    const ids = new Set<string>();
    for (const builder of PERENNIAL_BUILDERS) {
      const primary = createdMarkets[builder.address] ?? builder.marketId;
      if (primary) ids.add(primary);
      if (builder.milestoneMarketId) ids.add(builder.milestoneMarketId);
    }
    return [...ids] as `0x${string}`[];
  }, [createdMarkets]);

  const readSnapshot = useCallback(async (): Promise<Snapshot> => {
    if (!pool || !nl || !reg || !mp || !usdc) throw new Error("Perennial contracts are not configured");
    const [pendingPot, epoch] = (await Promise.all([
      publicClient.readContract({ address: pool, abi: progressPoolAbi, functionName: "pendingPot" }),
      publicClient.readContract({ address: pool, abi: progressPoolAbi, functionName: "currentEpoch" }),
    ])) as bigint[];

    const weightsPromise = Promise.all(PERENNIAL_BUILDERS.map(async (builder) => [
      builder.address,
      await publicClient.readContract({
        address: pool, abi: progressPoolAbi, functionName: "progressWeight",
        args: [epoch, builder.address],
      }) as bigint,
    ] as const));

    const marketsPromise = Promise.all(marketIds.map(async (marketId) => {
      const [price, raw] = await Promise.all([
        publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "priceOf", args: [marketId, 0] }) as Promise<bigint>,
        publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "getMarket", args: [marketId] }),
      ]);
      const market = raw as {
        expiry: bigint; createdAt: bigint; phase: number;
        yesReserve: bigint; noReserve: bigint;
      };
      return [marketId, {
        yesPrice: price,
        expiry: market.expiry,
        createdAt: market.createdAt,
        phase: Number(market.phase),
        yesReserve: market.yesReserve,
        noReserve: market.noReserve,
      }] as const;
    }));

    if (!address) {
      const [marketPairs, weightPairs] = await Promise.all([
        marketsPromise, weightsPromise,
      ]);
      const weights = Object.fromEntries(weightPairs) as Record<string, bigint>;
      const markets = Object.fromEntries(marketPairs) as Record<string, MarketMeta>;
      const yesPrice = selectedMarketId ? markets[selectedMarketId]?.yesPrice ?? 0n : 0n;
      const milestoneYesPrice = selectedMilestoneId ? markets[selectedMilestoneId]?.yesPrice ?? 0n : 0n;
      return { pendingPot, epoch, ledgerBal: 0n, walletBal: 0n, yesPrice, milestoneYesPrice,
        yesBal: 0n, noBal: 0n, registered: false, myWeight: 0n, claims: [], weights, markets };
    }

    const firstEpoch = epoch > CLAIM_SCAN_LIMIT ? epoch - CLAIM_SCAN_LIMIT : 0n;
    const claimEpochs = Array.from({ length: Number(epoch - firstEpoch) }, (_, i) => firstEpoch + BigInt(i));
    const claimPromises = claimEpochs.map(async (claimEpoch) => ({
      epoch: Number(claimEpoch),
      amount: await publicClient.readContract({
        address: pool, abi: progressPoolAbi, functionName: "claimable", args: [claimEpoch, address],
      }) as bigint,
    }));
    const [ledgerBal, walletBal, registered, myWeight, marketPairs, balances, claimRows, weightPairs] = await Promise.all([
      publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
      publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
      publicClient.readContract({ address: reg, abi: builderRegistryAbi, functionName: "isRegistered", args: [address] }) as Promise<boolean>,
      publicClient.readContract({ address: pool, abi: progressPoolAbi, functionName: "progressWeight", args: [epoch, address] }) as Promise<bigint>,
      marketsPromise,
      selectedMarketId ? Promise.all([
        publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "yesBalance", args: [selectedMarketId, address] }) as Promise<bigint>,
        publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "noBalance", args: [selectedMarketId, address] }) as Promise<bigint>,
      ]) : Promise.resolve([0n, 0n]),
      Promise.all(claimPromises),
      weightsPromise,
    ]);
    const weights = Object.fromEntries(weightPairs) as Record<string, bigint>;
    const markets = Object.fromEntries(marketPairs) as Record<string, MarketMeta>;
    const yesPrice = selectedMarketId ? markets[selectedMarketId]?.yesPrice ?? 0n : 0n;
    const milestoneYesPrice = selectedMilestoneId ? markets[selectedMilestoneId]?.yesPrice ?? 0n : 0n;
    return {
      pendingPot, epoch, ledgerBal, walletBal, registered, myWeight, yesPrice, milestoneYesPrice,
      yesBal: balances[0], noBal: balances[1], claims: claimRows.filter((row) => row.amount > 0n), weights, markets,
    };
  }, [pool, nl, reg, mp, usdc, publicClient, address, selectedMarketId, selectedMilestoneId, marketIds]);

  const snapshotKey = pool && nl && reg && mp && usdc
    ? ["perennial", PERENNIAL_CHAIN_ID, address ?? "guest", selectedMarketId ?? "none", selectedMilestoneId ?? "none"]
    : null;
  const { data, mutate } = useSWR(snapshotKey, readSnapshot, {
    refreshInterval: 30_000,
    dedupingInterval: 10_000,
    revalidateOnFocus: false,
    refreshWhenHidden: false,
    onError: (e) => console.error("perennial refresh", e),
  });
  const loaded = Boolean(data);
  const pendingPot = data?.pendingPot ?? 0n;
  const epoch = data?.epoch ?? 0n;
  const ledgerBal = data?.ledgerBal ?? 0n;
  const walletBal = data?.walletBal ?? 0n;
  const yesPrice = data?.yesPrice ?? 0n;
  const milestoneYesPrice = data?.milestoneYesPrice ?? 0n;
  const yesBal = data?.yesBal ?? 0n;
  const noBal = data?.noBal ?? 0n;
  const registered = data?.registered ?? false;
  const myWeight = data?.myWeight ?? 0n;
  const claims = data?.claims ?? [];
  const weights = data?.weights ?? {};
  const markets = data?.markets ?? {};

  const busy = status === "approving" || status === "submitting" || !PERENNIAL_WRITES_ENABLED;
  const needsConnect = !address || !onPerennialChain;
  // A live market for the selected builder — created this session or seeded in
  // config. On a fresh deployment there may be none yet, so the bet card
  // shows an invite-to-create empty state instead of odds against nothing.
  const hasMarket = Boolean(selectedMarketId);
  const yp = yesPctNum(yesPrice);
  const stat = (v: string) => (loaded ? v : "—");

  // Per-builder caretaker digest from the keeper's directory.json (display layer).
  const digest = findDigest(PERENNIAL_CHAIN_ID, selected.address);

  async function run(
    label: string,
    fn: () => Promise<`0x${string}`>,
    before?: () => Promise<void>,
  ): Promise<boolean> {
    if (!PERENNIAL_WRITES_ENABLED) {
      setStatus("error");
      setError(PERENNIAL_DEPLOYMENT_NOTICE);
      return false;
    }
    if (!walletClient || !address) return false;
    setError(undefined); setTxHash(undefined); setPending(label);
    try {
      if (before) {
        setStatus("approving");
        await before();
      }
      setStatus("submitting");
      const hash = await fn(); setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success"); await mutate();
      return true;
    } catch (e) { setStatus("error"); setError(humanizeError(e)); return false; }
    finally { setPending(""); }
  }
  // Exact-amount allowance, per token. The two tokens name their approval
  // differently: ERC-20 USDC has `approve`, NanoLedger only `approveSpender`
  // (it has no `approve`, so a generic mapping threw before the wallet prompt).
  // No unlimited approvals: each action approves exactly what it spends.
  async function ensureUsdcAllowance(spender: `0x${string}`, needed: bigint) {
    const a = (await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "allowance", args: [address!, spender] })) as bigint;
    if (a >= needed) return;
    const h = await walletClient!.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [spender, needed], chain: walletClient!.chain, account: walletClient!.account! });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: h });
    if (receipt.status !== "success") throw new Error("approval reverted");
  }
  async function ensureLedgerAllowance(spender: `0x${string}`, needed: bigint) {
    const a = (await publicClient.readContract({ address: nl!, abi: nanoLedgerAbi, functionName: "allowance", args: [address!, spender] })) as bigint;
    if (a >= needed) return;
    const h = await walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "approveSpender", args: [spender, needed], chain: walletClient!.chain, account: walletClient!.account! });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: h });
    if (receipt.status !== "success") throw new Error("approval reverted");
  }

  async function doDeposit() {
    const wei = parseUnits(depAmt || "0", 6);
    if (wei === 0n) { setError("enter an amount"); setStatus("error"); return; }
    const ok = await run(
      "deposit",
      () => walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "deposit", args: [wei], chain: walletClient!.chain, account: walletClient!.account! }),
      () => ensureUsdcAllowance(nl!, wei),
    );
    if (ok) setDepAmt("");
  }
  async function doMint() {
    await run("mint", () => walletClient!.writeContract({
      address: usdc, abi: usdcAbi, functionName: "mint", args: [address!, 100_000_000n],
      chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }
  async function doWithdraw() {
    if (ledgerBal === 0n) return;
    await run("withdraw", () => walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "withdraw", args: [ledgerBal], chain: walletClient!.chain, account: walletClient!.account! }));
  }
  async function doBet() {
    const wei = parseUnits(betAmt || "0", 6);
    const marketId = selectedMarketId;
    if (!marketId || wei === 0n) { setError("enter an amount"); setStatus("error"); return; }
    if (wei > ledgerBal) { setError("not enough balance, deposit first"); setStatus("error"); return; }
    const outcome = side === "Yes" ? 0 : 1;
    const ok = await run(
      "bet",
      async () => {
        const quote = await publicClient.simulateContract({
          address: mp!, abi: marketsPerennialAbi, functionName: "buy",
          args: [marketId, outcome, wei, 0n], account: address!,
        });
        const minSharesOut = (quote.result * 99n) / 100n;
        return walletClient!.writeContract({
          address: mp!, abi: marketsPerennialAbi, functionName: "buy",
          args: [marketId, outcome, wei, minSharesOut],
          chain: walletClient!.chain, account: walletClient!.account!,
        });
      },
      () => ensureLedgerAllowance(mp!, wei),
    );
    if (ok) setBetAmt("");
  }
  async function doCreate() {
    if (!PERENNIAL_WRITES_ENABLED) {
      setStatus("error"); setError(PERENNIAL_DEPLOYMENT_NOTICE); return;
    }
    const liq = parseUnits(cLiq || "0", 6);
    const days = Number(cDays || "0");
    if (liq < 5_000_000n) { setError("min liquidity is 5 USDC"); setStatus("error"); return; }
    if (liq > ledgerBal) { setError("deposit enough for liquidity first"); setStatus("error"); return; }
    if (days < 1) { setError("expiry must be at least 1 day"); setStatus("error"); return; }
    if (!walletClient || !address) return;
    setError(undefined); setTxHash(undefined); setPending("create");
    try {
      setStatus("approving");
      await ensureLedgerAllowance(mp!, liq);
      setStatus("submitting");
      const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86400);
      const hash = await walletClient.writeContract({ address: mp!, abi: marketsPerennialAbi, functionName: "createMarket", args: [BigInt(selected.builderId), CREATE_FEED.feedId, CREATE_FEED.agent, 1n, 1, expiry, liq], chain: walletClient.chain, account: walletClient.account! });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      const log = r.logs.find((l) => l.address.toLowerCase() === mp!.toLowerCase());
      if (log && log.topics[1]) setCreatedMarkets((m) => ({ ...m, [selected.address]: log.topics[1] as `0x${string}` }));
      setStatus("success"); setShowCreate(false); await mutate();
    } catch (e) { setStatus("error"); setError(humanizeError(e)); }
    finally { setPending(""); }
  }
  async function doRegister() {
    if (!repo.trim()) { setError("add your repo / project link"); setStatus("error"); return; }
    await run("register", () => walletClient!.writeContract({ address: reg!, abi: builderRegistryAbi, functionName: "registerBuilder", args: [repo.trim()], chain: walletClient!.chain, account: walletClient!.account! }));
    setRepo("");
  }
  async function doClaim(e: number) {
    await run(`claim-${e}`, () => walletClient!.writeContract({ address: pool!, abi: progressPoolAbi, functionName: "claim", args: [BigInt(e)], chain: walletClient!.chain, account: walletClient!.account! }));
  }

  if (!pool || !mp) return <div className="border border-line bg-bg-elev p-5 text-[13px] text-fg-dim">Perennial is not configured on this chain yet.</div>;

  const Chip = ({ v, set }: { v: string; set: (s: string) => void }) => (
    <button type="button" onClick={() => set(v)} className="pp-chip">${v}</button>
  );

  // Shared market/odds rendering: a YES/NO probability bar for one market. Used
  // for both the primary builder market and the optional milestone market.
  const MarketOdds = ({ yes }: { yes: number }) => (
    <>
      <div className="mt-2 mb-1 flex items-center justify-between text-2xs">
        <span className="text-up">YES {stat(`${yes}%`)}</span>
        <span className="text-down">NO {stat(`${100 - yes}%`)}</span>
      </div>
      <div className="pp-odds-track">
        <div className="pp-odds-fill h-full transition-all" style={{ width: `${loaded ? yes : 50}%` }} />
      </div>
    </>
  );

  const marketRows = PERENNIAL_BUILDERS.flatMap((builder) => {
    const primaryId = createdMarkets[builder.address] ?? builder.marketId;
    const rows: Array<{
      key: string;
      builder: PerennialBuilder;
      kind: "primary" | "milestone";
      id: `0x${string}`;
      question: string;
      meta: MarketMeta | undefined;
    }> = [];
    if (primaryId) rows.push({
      key: `${builder.address}:primary`, builder, kind: "primary", id: primaryId,
      question: builder.marketQuestion ?? "Builder milestone market", meta: markets[primaryId],
    });
    if (builder.milestoneMarketId) rows.push({
      key: `${builder.address}:milestone`,
      builder,
      kind: "milestone" as const,
      id: builder.milestoneMarketId,
      question: builder.milestoneQuestion ?? "Ships a new release this cycle?",
      meta: markets[builder.milestoneMarketId],
    });
    return rows;
  });

  const sortedMarkets = [...marketRows].sort((a, b) => {
    if (marketView === "new") return Number((b.meta?.createdAt ?? 0n) - (a.meta?.createdAt ?? 0n));
    if (marketView === "closing") {
      const aExpiry = a.meta?.expiry ?? (2n ** 63n);
      const bExpiry = b.meta?.expiry ?? (2n ** 63n);
      return Number(aExpiry - bExpiry);
    }
    if (marketView === "featured") {
      const kindRank = Number(a.kind === "milestone") - Number(b.kind === "milestone");
      if (kindRank) return kindRank;
      return Number((weights[b.builder.address] ?? 0n) - (weights[a.builder.address] ?? 0n));
    }
    const aDistance = Math.abs(50 - yesPctNum(a.meta?.yesPrice ?? 0n));
    const bDistance = Math.abs(50 - yesPctNum(b.meta?.yesPrice ?? 0n));
    return aDistance - bDistance;
  });

  const sortedBuilders = [...PERENNIAL_BUILDERS].sort((a, b) => {
    if (builderView === "new") return b.builderId - a.builderId;
    if (builderView === "veteran") return a.builderId - b.builderId;
    return Number((weights[b.address] ?? 0n) - (weights[a.address] ?? 0n));
  });

  const remaining = (expiry?: bigint) => {
    if (!expiry || !now) return "—";
    const seconds = Number(expiry) - now;
    if (seconds <= 0) return "closed";
    if (seconds < 86_400) return `${Math.max(1, Math.ceil(seconds / 3_600))}h left`;
    return `${Math.ceil(seconds / 86_400)}d left`;
  };

  const selectMarket = (builder: PerennialBuilder, kind: "primary" | "milestone") => {
    setSelected(builder);
    setSelectedMarketKind(kind);
    setRole("bet");
  };

  const selectedMeta = selectedMarketId ? markets[selectedMarketId] : undefined;

  return (
    <div className="perennial-panel space-y-3">
      {!PERENNIAL_WRITES_ENABLED && (
        <div className="pp-notice border border-down/35 bg-down/5 p-3 text-2xs text-down">
          {PERENNIAL_DEPLOYMENT_NOTICE} Live data remains available, but transactions are disabled.
        </div>
      )}

      <div className="pp-market-status">
        <div><span>commons balance</span><strong>${stat(fmt(pendingPot))}</strong></div>
        <div><span>open markets</span><strong>{loaded ? marketRows.length : "—"}</strong></div>
        <div><span>epoch</span><strong>{stat(epoch.toString())}</strong></div>
        <div><span>market fee</span><strong>35 bps</strong></div>
        <div><span>network</span><strong>Arc testnet</strong></div>
      </div>

      <div className="pp-terminal">
        <aside className="pp-terminal-sidebar">
          <div className="pp-mode-switch" aria-label="Perennial mode">
            <button onClick={() => setRole("bet")} aria-pressed={role === "bet"} className={role === "bet" ? "is-active" : ""}>Markets</button>
            <button onClick={() => setRole("build")} aria-pressed={role === "build"} className={role === "build" ? "is-active" : ""}>Build</button>
          </div>

          <section className="pp-discovery-section">
            <div className="pp-section-title"><span>Market explorer</span><b>{marketRows.length}</b></div>
            <div className="pp-filter-tabs" aria-label="Sort markets">
              {(["new", "trending", "featured", "closing"] as MarketView[]).map((view) => (
                <button key={view} onClick={() => setMarketView(view)} aria-pressed={marketView === view} className={marketView === view ? "is-active" : ""}>
                  {view === "closing" ? "closing soon" : view}
                </button>
              ))}
            </div>
            <div className="pp-market-list">
              {sortedMarkets.length ? sortedMarkets.map((market) => {
                const price = yesPctNum(market.meta?.yesPrice ?? 0n);
                const isSelected = market.builder.address === selected.address && market.kind === selectedMarketKind;
                return (
                  <button key={market.key} onClick={() => selectMarket(market.builder, market.kind)} className={`pp-market-row ${isSelected ? "is-selected" : ""}`}>
                    <div className="pp-market-row-top">
                      <span>{market.builder.name}</span>
                      <strong>{market.meta ? `${price}¢` : "—"}</strong>
                    </div>
                    <p>{market.question}</p>
                    <div className="pp-market-row-meta">
                      <span>{market.kind === "milestone" ? "milestone" : `builder #${market.builder.builderId}`}</span>
                      <span>{remaining(market.meta?.expiry)}</span>
                    </div>
                  </button>
                );
              }) : <div className="pp-empty-row">No live markets in this view.</div>}
            </div>
          </section>

          <section className="pp-discovery-section pp-builder-discovery">
            <div className="pp-section-title"><span>Builders</span><b>{PERENNIAL_BUILDERS.length}</b></div>
            <div className="pp-filter-tabs" aria-label="Sort builders">
              {(["new", "star", "veteran"] as BuilderView[]).map((view) => (
                <button key={view} onClick={() => setBuilderView(view)} aria-pressed={builderView === view} className={builderView === view ? "is-active" : ""}>{view}</button>
              ))}
            </div>
            <div className="pp-builder-list">
              {sortedBuilders.map((builder, index) => (
                <button key={builder.address} onClick={() => selectMarket(builder, "primary")} className={`pp-builder-compact ${builder.address === selected.address ? "is-selected" : ""}`}>
                  <span className="pp-builder-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pp-builder-name"><b>{builder.name}</b><small>{builder.repo}</small></span>
                  <span className="pp-builder-weight">{stat((weights[builder.address] ?? 0n).toString())}<small>pts</small></span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="pp-terminal-main">
          {role === "bet" ? (
            <>
              <div className="pp-market-focus">
                <div className="pp-market-focus-head">
                  <div>
                    <div className="pp-card-label">Live market · builder #{selected.builderId}</div>
                    <h2>{selectedQuestion}</h2>
                    <button className="pp-builder-link" onClick={() => setRole("build")}>{selected.name} <span>↗</span></button>
                  </div>
                  <div className="pp-market-price"><strong>{hasMarket ? stat(`${yp}¢`) : "—"}</strong><span>YES price</span></div>
                </div>
                {hasMarket ? <MarketOdds yes={yp} /> : <p className="mt-5 text-sm text-fg-dim">No open market yet.</p>}
                <div className="pp-market-facts">
                  <span><b>Status</b>{selectedMeta?.phase === 0 ? "trading" : selectedMeta?.phase === 2 ? "voided" : "settled"}</span>
                  <span><b>Closes</b>{remaining(selectedMeta?.expiry)}</span>
                  <span><b>Liquidity</b>${stat(fmt((selectedMeta?.yesReserve ?? 0n) + (selectedMeta?.noReserve ?? 0n)))}</span>
                  <span><b>Resolution</b>bonded oracle</span>
                </div>
              </div>

              <div className="pp-trading-grid">
                <div className="pp-action-card pp-order-ticket">
                  <div className="pp-panel-heading"><span>Order ticket</span><b>USDC</b></div>
                  {needsConnect ? (
                    <div className="pp-order-connect">
                      <p>{address ? "Switch your wallet to Arc testnet to trade." : "Connect a wallet to place an order."}</p>
                      <button onClick={() => (address ? switchChain(PERENNIAL_CHAIN_ID) : connect())}>{address ? "switch network" : "connect wallet"}</button>
                    </div>
                  ) : hasMarket ? (
                    <>
                      <div className="pp-side-select">
                        {(["Yes", "No"] as const).map((choice) => (
                          <button key={choice} onClick={() => setSide(choice)} aria-pressed={side === choice} className={side === choice ? `is-active is-${choice.toLowerCase()}` : ""}>
                            <span>Buy {choice}</span><b>{choice === "Yes" ? yp : 100 - yp}¢</b>
                          </button>
                        ))}
                      </div>
                      <label className="pp-amount-field"><span>Amount</span><input value={betAmt} onChange={(e) => setBetAmt(e.target.value)} inputMode="decimal" placeholder="0.00" /><b>USDC</b></label>
                      <div className="pp-quick-row">{["1", "5", "10"].map((v) => <Chip key={v} v={v} set={setBetAmt} />)}</div>
                      <button onClick={doBet} disabled={busy || ledgerBal === 0n} className="pp-submit-order">{pending === "bet" ? "placing order…" : `buy ${side}`}</button>
                      <div className="pp-order-foot"><span>Shares Y {fmt(yesBal)} · N {fmt(noBal)}</span><span>Max slippage 1%</span></div>
                    </>
                  ) : (
                    <button onClick={() => setShowCreate(true)} className="pp-submit-order">open this market</button>
                  )}
                </div>

                <div className="pp-action-card pp-account-panel">
                  <div className="pp-panel-heading"><span>Trading account</span><b>{onPerennialChain ? "connected" : "read only"}</b></div>
                  <div className="pp-account-balance"><span>Available to trade</span><strong>${needsConnect ? "—" : stat(fmt(ledgerBal))}</strong></div>
                  {!needsConnect ? (
                    <>
                      <label className="pp-amount-field"><span>Deposit</span><input value={depAmt} onChange={(e) => setDepAmt(e.target.value)} inputMode="decimal" placeholder="0.00" /><b>USDC</b></label>
                      <div className="pp-account-actions">
                        <button onClick={doDeposit} disabled={busy}>{pending === "deposit" || pending === "approving" ? "…" : "deposit"}</button>
                        <button onClick={doWithdraw} disabled={busy || ledgerBal === 0n}>{pending === "withdraw" ? "…" : "withdraw all"}</button>
                      </div>
                      <div className="pp-quick-row">{["5", "10", "25"].map((v) => <Chip key={v} v={v} set={setDepAmt} />)}</div>
                      <button onClick={doMint} disabled={busy} className="pp-test-funds">{pending === "mint" ? "minting…" : "get 100 test USDC"}</button>
                      <div className="pp-order-foot"><span>Wallet ${stat(fmt(walletBal))}</span><span>Arc testnet</span></div>
                    </>
                  ) : <p className="pp-read-only-copy">Market data stays live without a wallet. Connect from the order ticket when you are ready to trade.</p>}
                </div>
              </div>

              {digest && (
                <BuilderProfile digest={digest} milestone={<><span className="caption text-2xs text-fg-dim block mb-1">{selected.milestoneQuestion ?? "Ships a new release this cycle?"}</span><MarketOdds yes={yesPctNum(milestoneYesPrice)} /></>} />
              )}

              {!needsConnect && (
                <div className="pp-action-card pp-create-market">
                  <button onClick={() => setShowCreate((v) => !v)} className="w-full flex items-center justify-between text-[14px] text-fg-mute hover:text-fg transition-colors">
                    <span>Open a new market on {selected.name.split(" ")[0]}</span><span className="text-[18px] leading-none">{showCreate ? "−" : "+"}</span>
                  </button>
                  {showCreate && (
                    <div className="mt-3 space-y-2">
                      <p className="text-2xs text-fg-dim">Creator fee: 20bps. Commons fee: 35bps. Resolves YES when the bonded release feed attests 1 by expiry.</p>
                      <div className="grid gap-2 sm:grid-cols-[1fr_90px_110px]"><div><label className="caption text-[10px] text-fg-dim">condition</label><div className="w-full bg-bg border border-line px-3 py-2 text-[14px] text-fg-mute">release feed ≥ 1</div></div><div><label className="caption text-[10px] text-fg-dim">days</label><input value={cDays} onChange={(e) => setCDays(e.target.value)} inputMode="numeric" className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" /></div><div><label className="caption text-[10px] text-fg-dim">liquidity</label><input value={cLiq} onChange={(e) => setCLiq(e.target.value)} inputMode="decimal" className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" /></div></div>
                      <button onClick={doCreate} disabled={busy} className="w-full bg-accent/90 text-bg py-2 text-[14px] hover:bg-accent transition-colors disabled:opacity-50">{pending === "create" ? "…" : "create market"}</button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="pp-build-workspace">
              <div className="pp-workspace-title"><div className="pp-card-label">Builder workspace</div><h2>Ship work. Earn from verified progress.</h2></div>
              {needsConnect ? (
                <div className="pp-connect-card"><div><span>Wallet required</span><p>Connect on Arc testnet to register a project or claim an epoch.</p></div><button onClick={() => (address ? switchChain(PERENNIAL_CHAIN_ID) : connect())}>{address ? "switch to Arc testnet" : "connect wallet"}</button></div>
              ) : (
                <div className="pp-action-card">
                  {!registered ? (
                    <><h3>Register your project</h3><p className="text-2xs text-fg-dim mb-3">Add your repository. The keeper detects releases and tags and credits verified progress.</p><div className="flex flex-col gap-2 sm:flex-row"><input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/you/project" className="flex-1 bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" /><button onClick={doRegister} disabled={busy} className="px-4 bg-accent/90 text-bg text-[14px] disabled:opacity-50">{pending === "register" ? "…" : "register"}</button></div></>
                  ) : (
                    <><div className="flex items-center justify-between mb-3"><h3>Your progress</h3><span className="text-2xs px-2 py-0.5 bg-up/10 text-up border border-up/25">registered</span></div><div className="pp-progress-total"><strong>{stat(myWeight.toString())}</strong><span>progress points · epoch {stat(epoch.toString())}</span></div>{claims.length === 0 ? <p className="text-2xs text-fg-dim border-t border-line pt-3">Nothing to claim yet. Progress becomes claimable when the epoch closes.</p> : claims.map((claim) => <div key={claim.epoch} className="pp-claim-row"><span>epoch {claim.epoch} · ${fmt(claim.amount)}</span><button onClick={() => doClaim(claim.epoch)} disabled={busy}>{pending === `claim-${claim.epoch}` ? "…" : "claim"}</button></div>)}</>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {(error || txHash || status === "success") && (
        <div className="pp-transaction-status border border-line bg-bg-elev p-3 text-2xs">{status === "success" && <span className="text-up">done. </span>}{error && <span className="text-down">{error} </span>}{txHash && <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">view tx ↗</a>}</div>
      )}
    </div>
  );
}
