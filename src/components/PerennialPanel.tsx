"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createPublicClient, createWalletClient, custom, type Address, type Hex, type PublicClient } from "viem";
import useSWR from "swr";
import { useWallet } from "./WalletProvider";
import { transportFor, txUrl as txUrlFor } from "@/lib/chains";
import { usdcAbi, nanoLedgerAbi, builderRegistryAbi, progressPoolAbi, marketsPerennialAbi } from "@/lib/abi";
import { explainMinedRevert, humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { PERENNIAL } from "@/lib/perennial-network";
import {
  COMPARATOR,
  OUTCOME,
  PHASE,
  formatUsdc,
  marketStatus,
  maxDeposit,
  minOutWithSlippage,
  nextMilestoneThreshold,
  parseDays,
  parseSlippagePct,
  parseUsdcInput,
  priceOf,
  questionText,
  quoteBuy,
  quoteSell,
  settlementRuleText,
  type MarketStatus,
} from "@/lib/perennial-market";
import {
  feeHeadline,
  feeSummary,
  mirrorClaimLP,
  mirrorRedeem,
  splitTradeFee,
  tradeFeeBps,
  voidIsProRata,
  voidRefundText,
  type FeeModel,
} from "@/lib/market-fees";
import { readHolderSettlement } from "@/lib/market-fees-chain";
import {
  marketIdFromLogs,
  probeAbi,
  readLatestValue,
  readOverview,
  rememberMarket,
  type BuilderRow,
  type ChainMarket,
  type Overview,
} from "@/lib/perennial-chain";
import { BuilderProfile, findDigest } from "./BuilderProfile";
import { AgentBadge, CaughtAgentBanner, useAgentReputation } from "./AgentBadge";
import { MilestoneDisclosure, VerifiedBadge } from "./VerifiedBadge";
import { milestoneMetric } from "@/lib/builder-verification";
import { parseBuilderParam } from "@/lib/verified-builder-badge";
import { BuilderBadgeSection } from "./BuilderBadgeSection";

// Perennial end-to-end: bettors trade builder-milestone markets (a 1% fee on
// every trade: 30% creator, 20% agent held until settlement, 50% builder commons);
// builders register, accrue progress from verified artifacts, and claim a
// progress-weighted share. The hype pays for the grind.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type Role = "bet" | "build";
type MarketView = "new" | "trending" | "featured" | "closing";
type BuilderView = "new" | "star" | "veteran";
type Position = {
  yes: bigint;
  no: bigint;
  lp: bigint;
  /** v3 views — undefined on the legacy contract. */
  netCost?: bigint;
  redeemable?: bigint;
  claimableLP?: bigint;
};
type Account = {
  ledgerBal: bigint;
  walletBal: bigint;
  registered: boolean;
  myWeight: bigint;
  claims: { epoch: number; amount: bigint }[];
  positions: Record<string, Position>;
};

const CLAIM_SCAN_LIMIT = 52n;
const D = PERENNIAL;
const P = D.contracts;
const CHAIN = D.chain;
const HUMAN = { testnet: CHAIN.testnet, networkName: D.label };
const txUrl = (hash: string) => txUrlFor(CHAIN, hash);
const fmt = (v: bigint, dp = 2) => formatUsdc(v, dp);
const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;
const cents = (x: number) => `${(x * 100).toFixed(1)}¢`;
const yesPct = (m: Pick<ChainMarket, "yesReserve" | "noReserve">) =>
  Math.round(Number(priceOf(m, OUTCOME.Yes)) / 1e16);
/** An error whose message is already user-facing (e.g. a decoded mined revert). */
class HumanError extends Error {}
const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function PerennialPanel() {
  // Nothing on this network yet: say so, and make no contract calls at all.
  if (!D.deployed) return <PerennialNotDeployed />;
  return <PerennialLive />;
}

function PerennialNotDeployed() {
  return (
    <div className="pp-notice border border-line bg-bg-elev p-5 text-[13px] text-fg-dim">
      <strong className="text-fg">Perennial is not deployed on {D.label} yet.</strong>{" "}
      Markets, deposits and builder payouts open here once the contracts are live. Until then this
      page makes no {D.label} contract calls.
    </div>
  );
}

/**
 * `?builder=<id>` (the badge's on-chain external_url). useSearchParams needs a
 * Suspense boundary in a static export, so it lives in this leaf and reports up.
 */
function BuilderParam({ onBuilder }: { onBuilder: (id: number) => void }) {
  const id = parseBuilderParam(useSearchParams()?.get("builder"));
  useEffect(() => {
    if (id) onBuilder(id);
  }, [id, onBuilder]);
  return null;
}

function PerennialLive() {
  const { address, walletChainId, connect, switchChain } = useWallet();
  const nl = P.NanoLedger!;
  const pool = P.ProgressPool!;
  const reg = P.BuilderRegistry!;
  const mp = P.MarketsPerennial!;
  const usdc = P.USDC!;

  // Reads are pinned to the Perennial network regardless of the wallet's chain.
  const publicClient = useMemo(
    () => createPublicClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN, { batch: true }) }) as PublicClient,
    [],
  );
  const onPerennialChain = walletChainId === CHAIN.id;
  // Writes go through the wallet, bound to the Perennial chain (which may not be
  // the app-wide chain the shared wallet client follows).
  const walletClient = useMemo(() => {
    if (typeof window === "undefined" || !window.ethereum || !address || !onPerennialChain) return undefined;
    return createWalletClient({ chain: CHAIN.viemChain, transport: custom(window.ethereum), account: address });
  }, [address, onPerennialChain]);

  const [role, setRole] = useState<Role>("bet");
  const [selectedId, setSelectedId] = useState<Hex>();
  const [marketView, setMarketView] = useState<MarketView>("trending");
  const [builderView, setBuilderView] = useState<BuilderView>("star");
  const [clientNow, setClientNow] = useState(0);

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<"Yes" | "No">("Yes");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [depAmt, setDepAmt] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [cBuilder, setCBuilder] = useState<number>();
  /** A builder picked from the list (or the ?builder= link); else the selected market's builder. */
  const [focusId, setFocusId] = useState<number>();
  const [linkedId, setLinkedId] = useState<number>();
  const [cDays, setCDays] = useState("7");
  const [cLiq, setCLiq] = useState("5");

  const [status, setStatus] = useState<Status>("idle");
  const [pending, setPending] = useState("");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<Hex>();

  useEffect(() => {
    const tick = () => setClientNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // ─────────────── reads ───────────────
  const {
    data: ov,
    error: ovError,
    mutate: mutateOverview,
  } = useSWR<Overview>(["perennial-overview", CHAIN.id, mp], () => readOverview(publicClient, D), {
    refreshInterval: 30_000,
    dedupingInterval: 10_000,
    revalidateOnFocus: false,
  });

  const markets = useMemo(() => ov?.markets ?? [], [ov]);
  const builders = useMemo(() => ov?.builders ?? [], [ov]);
  const marketIdsKey = markets.map((m) => m.id).join(",");

  const readAccount = async (): Promise<Account> => {
    const epoch = ov!.epoch;
    const firstEpoch = epoch > CLAIM_SCAN_LIMIT ? epoch - CLAIM_SCAN_LIMIT : 0n;
    const claimEpochs = Array.from({ length: Number(epoch - firstEpoch) }, (_, i) => firstEpoch + BigInt(i));
    const [ledgerBal, walletBal, registered, myWeight, claimRows, posRows] = await Promise.all([
      publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address!] }) as Promise<bigint>,
      publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address!] }) as Promise<bigint>,
      publicClient.readContract({ address: reg, abi: builderRegistryAbi, functionName: "isRegistered", args: [address!] }) as Promise<boolean>,
      publicClient.readContract({ address: pool, abi: progressPoolAbi, functionName: "progressWeight", args: [epoch, address!] }) as Promise<bigint>,
      Promise.all(claimEpochs.map(async (e) => ({
        epoch: Number(e),
        amount: (await publicClient.readContract({ address: pool, abi: progressPoolAbi, functionName: "claimable", args: [e, address!] })) as bigint,
      }))),
      Promise.all(markets.map(async (m) => {
        const [[yes, no, lp], v3] = await Promise.all([
          Promise.all([
            publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "yesBalance", args: [m.id, address!] }),
            publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "noBalance", args: [m.id, address!] }),
            publicClient.readContract({ address: mp, abi: marketsPerennialAbi, functionName: "lpShares", args: [m.id, address!] }),
          ]) as Promise<bigint[]>,
          // netCost / redeemable / claimableLP exist only on the v3 contract.
          ov!.feeModel.kind === "trade" ? readHolderSettlement(publicClient, mp, m.id, address!, m.phase) : Promise.resolve({}),
        ]);
        return [m.id, { yes, no, lp, ...v3 } satisfies Position] as const;
      })),
    ]);
    return {
      ledgerBal, walletBal, registered, myWeight,
      claims: claimRows.filter((r) => r.amount > 0n),
      positions: Object.fromEntries(posRows),
    };
  };
  const {
    data: acct,
    error: acctError,
    mutate: mutateAccount,
  } = useSWR<Account>(
    ov && address ? ["perennial-account", CHAIN.id, address, ov.epoch.toString(), marketIdsKey] : null,
    readAccount,
    { refreshInterval: 30_000, dedupingInterval: 10_000, revalidateOnFocus: false },
  );
  const refresh = async () => { await mutateOverview(); await mutateAccount(); };

  const loaded = Boolean(ov);
  const stat = (v: string) => (loaded ? v : ovError ? "error" : "—");
  const ledgerBal = acct?.ledgerBal ?? 0n;
  const walletBal = acct?.walletBal ?? 0n;

  // Chain time: the latest block's timestamp plus time elapsed since it was read
  // (the elapsed delta is clock-skew free). Never the raw client clock.
  const chainNow = ov && clientNow ? ov.chainNow + BigInt(Math.max(0, clientNow - ov.readAt)) : undefined;
  const statusOf = (m: ChainMarket): MarketStatus =>
    marketStatus({
      phase: m.phase, yesWon: m.yesWon, expiry: m.expiry, chainNow,
      settlement: m.settlement, supportsSettlement: Boolean(ov?.supportsSettlement), feeModel: ov?.feeModel,
    });

  // Default selection: first tradeable market, else the newest.
  useEffect(() => {
    if (!markets.length) return;
    if (selectedId && markets.some((m) => m.id === selectedId)) return;
    const firstOpen = markets.find((m) => m.phase === PHASE.Trading && ov && m.expiry > ov.chainNow);
    setSelectedId((firstOpen ?? [...markets].sort((a, b) => Number(b.createdAt - a.createdAt))[0]).id);
  }, [markets, selectedId, ov]);

  const selected = markets.find((m) => m.id === selectedId);
  const builderById = (id: bigint | number | undefined) => builders.find((b) => BigInt(b.builderId) === BigInt(id ?? -1));
  const selBuilder = builderById(selected?.builderId);
  const selStatus = selected ? statusOf(selected) : undefined;
  const pos: Position = (selected && acct?.positions[selected.id]) || { yes: 0n, no: 0n, lp: 0n };

  // The selected market's agent: snapshot reputation + live bond / coverage on
  // its feed. Soft warnings only — nothing here blocks a trade.
  const agentCandidates = useMemo(
    () =>
      selected
        ? markets
            .filter((m) => same(m.agent, selected.agent) && same(m.feedId, selected.feedId))
            .map((m) => ({ id: m.id, phase: m.phase, agent: m.agent, feed: m.feedId, collateral: m.collateral }))
        : [],
    [markets, selected],
  );
  const agentRep = useAgentReputation({
    client: publicClient,
    chainId: CHAIN.id,
    market: mp,
    flavor: "perennial",
    marketId: selected?.id,
    agent: selected?.agent,
    feed: selected?.feedId,
    candidates: agentCandidates,
    fallback: { attestation: ov?.attestation },
  });

  const subjectFor = (m: ChainMarket) => builderById(m.builderId)?.name ?? `Builder #${m.builderId}`;
  const isMilestoneMarket = (m: ChainMarket) => {
    const b = builderById(m.builderId);
    return Boolean(b?.milestoneFeedId && same(b.milestoneFeedId, m.feedId) && same(m.agent, D.operator));
  };
  const questionFor = (m: ChainMarket) =>
    questionText({
      subject: subjectFor(m),
      metric: isMilestoneMarket(m) ? "verified artifacts" : undefined,
      feedId: m.feedId, threshold: m.threshold, comparator: m.comparator, expiry: m.expiry,
      legacy: ov ? !ov.supportsSettlement : false,
    });

  // Who resolves it, and whether they are also a party to the market.
  const agentDisclosure = (m: ChainMarket): string | undefined => {
    const b = builderById(m.builderId);
    const roles: string[] = [];
    if (same(m.agent, b?.owner)) roles.push("the builder this market is about");
    if (same(m.agent, m.creator)) roles.push("this market's creator (earns the creator fee)");
    if (same(m.agent, D.operator)) roles.push("the protocol's caretaker operator");
    if (!roles.length) return undefined;
    return `The resolving agent is ${roles.join(" and ")}.`;
  };

  const remaining = (expiry: bigint) => {
    if (!chainNow) return "—";
    const seconds = Number(expiry - chainNow);
    if (seconds <= 0) return "closed";
    if (seconds < 3_600) return `${Math.max(1, Math.ceil(seconds / 60))}m left`;
    if (seconds < 86_400) return `${Math.ceil(seconds / 3_600)}h left`;
    return `${Math.ceil(seconds / 86_400)}d left`;
  };

  // ─────────────── quote ───────────────
  // TRADE_FEE_BPS (v3, 1%) or the legacy contract's per-trade fee; unknown -> no quote.
  const feeBps = tradeFeeBps(ov?.feeModel);
  const slip = parseSlippagePct(slippage);
  const outcome = side === "Yes" ? OUTCOME.Yes : OUTCOME.No;
  const held = side === "Yes" ? pos.yes : pos.no;
  const amt = amount.trim()
    ? parseUsdcInput(amount, mode === "buy" ? { max: ledgerBal, label: "amount" } : { max: held, label: "share amount" })
    : undefined;
  const buyQ = selected && feeBps !== undefined && mode === "buy" && amt?.ok ? quoteBuy(selected, outcome, amt.value, feeBps) : null;
  const sellQ = selected && feeBps !== undefined && mode === "sell" && amt?.ok ? quoteSell(selected, outcome, amt.value, feeBps) : null;
  const expectedOut = buyQ?.sharesOut ?? sellQ?.collateralOut;
  const minOut = expectedOut !== undefined && slip.ok ? minOutWithSlippage(expectedOut, slip.value) : undefined;
  const feeModel: FeeModel | undefined = ov?.feeModel;
  const feeParts = buyQ || sellQ ? splitTradeFee((buyQ ?? sellQ)!.fee, feeModel) : undefined;
  const isV3 = feeModel?.kind === "trade";
  const feeLine = feeSummary(feeModel);

  // ─────────────── tx plumbing ───────────────
  const busy = status === "approving" || status === "submitting" || !PERENNIAL_WRITES_ENABLED;
  const needsConnect = !address || !onPerennialChain;

  async function waitOk(hash: Hex) {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new HumanError(await explainMinedRevert(publicClient, hash, HUMAN));
    return r;
  }

  async function run(label: string, fn: () => Promise<Hex>, before?: () => Promise<void>, after?: (r: Awaited<ReturnType<typeof waitOk>>) => void): Promise<boolean> {
    if (!PERENNIAL_WRITES_ENABLED) { setStatus("error"); setError("Perennial transactions are paused."); return false; }
    if (!walletClient || !address) { setStatus("error"); setError(`Connect a wallet on ${D.label} first.`); return false; }
    setError(undefined); setTxHash(undefined); setPending(label);
    try {
      if (before) { setStatus("approving"); await before(); }
      setStatus("submitting");
      const hash = await fn();
      setTxHash(hash);
      const r = await waitOk(hash);
      after?.(r);
      setStatus("success");
      await refresh();
      return true;
    } catch (e) {
      setStatus("error");
      setError(e instanceof HumanError ? e.message : humanizeError(e, HUMAN));
      return false;
    } finally {
      setPending("");
    }
  }

  const fail = (msg: string) => { setStatus("error"); setError(msg); setTxHash(undefined); };
  const w = () => ({ chain: walletClient!.chain, account: walletClient!.account! });

  // Exact-amount allowances, per token. ERC-20 USDC names it `approve`,
  // NanoLedger `approveSpender`. Never an unlimited approval.
  async function ensureUsdcAllowance(spender: Address, needed: bigint) {
    const a = (await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "allowance", args: [address!, spender] })) as bigint;
    if (a >= needed) return;
    await waitOk(await walletClient!.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [spender, needed], ...w() }));
  }
  async function ensureLedgerAllowance(spender: Address, needed: bigint) {
    const a = (await publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "allowance", args: [address!, spender] })) as bigint;
    if (a >= needed) return;
    await waitOk(await walletClient!.writeContract({ address: nl, abi: nanoLedgerAbi, functionName: "approveSpender", args: [spender, needed], ...w() }));
  }

  async function latestChainTime() {
    return (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
  }

  // ─────────────── actions ───────────────
  const depositMax = maxDeposit(walletBal);

  async function doDeposit() {
    const p = parseUsdcInput(depAmt, { max: depositMax, label: "deposit" });
    if (!p.ok) return fail(depositMax === 0n && depAmt.trim() ? "Your wallet needs to keep a little USDC for gas; nothing left to deposit." : p.error);
    const ok = await run(
      "deposit",
      () => walletClient!.writeContract({ address: nl, abi: nanoLedgerAbi, functionName: "deposit", args: [p.value], ...w() }),
      () => ensureUsdcAllowance(nl, p.value),
    );
    if (ok) setDepAmt("");
  }

  async function doWithdraw() {
    // Read the balance fresh at click time — the cached one can be 30s stale.
    const fresh = (await publicClient.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address!] })) as bigint;
    if (fresh === 0n) return fail("Nothing to withdraw.");
    await run("withdraw", () => walletClient!.writeContract({ address: nl, abi: nanoLedgerAbi, functionName: "withdraw", args: [fresh], ...w() }));
  }

  async function doTrade() {
    if (!selected || !ov) return;
    if (!slip.ok) return fail(slip.error);
    if (!amt) return fail(mode === "buy" ? "Enter an amount." : "Enter how many shares to sell.");
    if (!amt.ok) return fail(amt.error);
    if (mode === "buy" && !buyQ) return fail("That amount is too small to buy any shares.");
    if (mode === "sell" && !sellQ) return fail("That amount is too small to sell.");
    const now = await latestChainTime();
    if (selected.phase !== PHASE.Trading || now >= selected.expiry) return fail("Trading on this market has closed.");
    const value = amt.value;
    const floor = minOut!;
    const ok = await run(
      mode,
      async () => {
        if (mode === "buy") {
          await publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: "buy", args: [selected.id, outcome, value, floor], account: address! });
          return walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: "buy", args: [selected.id, outcome, value, floor], ...w() });
        }
        await publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: "sell", args: [selected.id, outcome, value, floor], account: address! });
        return walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: "sell", args: [selected.id, outcome, value, floor], ...w() });
      },
      mode === "buy" ? () => ensureLedgerAllowance(mp, value) : undefined,
    );
    if (ok) setAmount("");
  }

  const settleAction = (label: string, fn: "resolve" | "voidMarket" | "redeem" | "claimLP") => async () => {
    if (!selected) return;
    await run(label, async () => {
      await publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: fn, args: [selected.id], account: address! });
      return walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: fn, args: [selected.id], ...w() });
    });
  };

  // ─────────────── create ───────────────
  const activeBuilders = builders.filter((b) => b.active);
  const createBuilder: BuilderRow | undefined =
    activeBuilders.find((b) => b.builderId === cBuilder) ?? activeBuilders[0];
  const cFeed = createBuilder?.milestoneFeedId;
  const { data: latest, error: latestError } = useSWR(
    ov && cFeed && D.operator ? ["perennial-latest", ov.attestation, cFeed, D.operator] : null,
    () => readLatestValue(publicClient, ov!.attestation, cFeed!, D.operator!),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const { data: cApproved } = useSWR(
    ov?.approvalView && cFeed && D.operator ? ["perennial-approved", mp, cFeed, D.operator] : null,
    async () => (await publicClient.readContract({ address: mp, abi: probeAbi, functionName: "isApprovedFeed", args: [cFeed!, D.operator!] })) as boolean,
    { revalidateOnFocus: false },
  );
  // Only from a real on-chain reading: with nothing attested the builder's count is
  // unknown, and guessing 0 would offer ">= 1", a market that may already be won.
  const cThreshold = latest ? nextMilestoneThreshold(latest.value) : undefined;
  const createBlocker: string | undefined = !ov
    ? "Loading…"
    : !ov.supportsSettlement
      ? "This deployment runs the legacy MarketsPerennial contract. New markets open once the settlement upgrade is deployed."
      : !activeBuilders.length
        ? `No active builders on ${D.label} yet. Register one from the Build tab.`
        : !D.operator
          ? `No milestone operator is configured for ${D.label}.`
          : !cFeed
            ? `${createBuilder!.name} has no milestone feed yet. The caretaker provisions one per builder; markets open on it once it exists.`
            : ov.approvalView && cApproved === false
              ? "This builder's milestone feed is not approved for new markets."
              : latestError
                ? `Could not read the latest attested count: ${humanizeError(latestError, HUMAN)}`
                : latest === null
                  ? `Waiting for the milestone agent's first reading of ${createBuilder!.name}'s count. Markets open once it is on-chain.`
                  : cThreshold === undefined
                    ? "Reading the latest attested count…"
                    : undefined;

  async function doCreate() {
    if (createBlocker || !ov || !createBuilder || !cFeed || !D.operator || cThreshold === undefined) return fail(createBlocker ?? "Not ready.");
    const liq = parseUsdcInput(cLiq, { min: ov.minLiquidity, max: ledgerBal, label: "liquidity" });
    if (!liq.ok) return fail(ledgerBal < ov.minLiquidity ? `Deposit at least ${fmt(ov.minLiquidity)} USDC first.` : liq.error);
    const days = parseDays(cDays);
    if (!days.ok) return fail(days.error);
    const builderId = BigInt(createBuilder.builderId);
    const feed = cFeed;
    const agent = D.operator;
    const threshold = cThreshold;
    await run(
      "create",
      async () => {
        const expiry = (await latestChainTime()) + BigInt(days.value * 86_400);
        const args = [builderId, feed, agent, threshold, COMPARATOR.GreaterOrEqual, expiry, liq.value] as const;
        await publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: "createMarket", args, account: address! });
        return walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: "createMarket", args, ...w() });
      },
      () => ensureLedgerAllowance(mp, liq.value),
      (r) => {
        const id = marketIdFromLogs(r.logs, mp);
        if (id) { rememberMarket(D, id); setSelectedId(id); }
        setShowCreate(false);
      },
    );
  }

  async function doClaim(e: number) {
    await run(`claim-${e}`, () => walletClient!.writeContract({ address: pool, abi: progressPoolAbi, functionName: "claim", args: [BigInt(e)], ...w() }));
  }

  // ─────────────── view model ───────────────
  const sortedMarkets = [...markets].sort((a, b) => {
    if (marketView === "new") return Number(b.createdAt - a.createdAt);
    if (marketView === "closing") {
      const ao = statusOf(a).canTrade ? 0 : 1;
      const bo = statusOf(b).canTrade ? 0 : 1;
      return ao - bo || Number(a.expiry - b.expiry);
    }
    if (marketView === "featured") {
      const aw = ov?.weights[builderById(a.builderId)?.owner.toLowerCase() ?? ""] ?? 0n;
      const bw = ov?.weights[builderById(b.builderId)?.owner.toLowerCase() ?? ""] ?? 0n;
      return Number(bw - aw) || Number(isMilestoneMarket(b)) - Number(isMilestoneMarket(a));
    }
    const ao = statusOf(a).canTrade ? 0 : 1;
    const bo = statusOf(b).canTrade ? 0 : 1;
    return ao - bo || Math.abs(50 - yesPct(a)) - Math.abs(50 - yesPct(b));
  });
  const openCount = markets.filter((m) => statusOf(m).canTrade).length;

  const sortedBuilders = [...builders].sort((a, b) => {
    if (builderView === "new") return b.builderId - a.builderId;
    if (builderView === "veteran") return a.builderId - b.builderId;
    return Number((ov?.weights[b.owner.toLowerCase()] ?? 0n) - (ov?.weights[a.owner.toLowerCase()] ?? 0n));
  });

  const selectBuilder = (b: BuilderRow) => {
    setCBuilder(b.builderId);
    setFocusId(b.builderId);
    const mine = markets.filter((m) => m.builderId === BigInt(b.builderId)).sort((x, y) => Number(y.createdAt - x.createdAt));
    if (mine[0]) setSelectedId(mine[0].id);
    setRole("bet");
  };

  const focusBuilder = focusId !== undefined ? builderById(focusId) : selBuilder;

  // The deep link selects its builder once the registry has been read.
  useEffect(() => {
    if (linkedId === undefined || !ov) return;
    const b = ov.builders.find((x) => x.builderId === linkedId);
    setLinkedId(undefined);
    if (!b) return;
    setCBuilder(b.builderId);
    setFocusId(b.builderId);
    const mine = ov.markets.filter((m) => m.builderId === BigInt(b.builderId)).sort((x, y) => Number(y.createdAt - x.createdAt));
    if (mine[0]) setSelectedId(mine[0].id);
    setRole("bet");
  }, [linkedId, ov]);

  const digest = selBuilder ? findDigest(CHAIN.id, selBuilder.owner) : undefined;
  const yp = selected ? yesPct(selected) : 50;
  // Previews: the contract's own `redeemable` / `claimableLP` views when the
  // deployment has them (v3), else the local mirror of the payout math.
  const snapshot = selected ? { ...selected, totalLpShares: selected.seeded } : undefined;
  const redeemable = selected ? pos.redeemable ?? mirrorRedeem(snapshot!, pos, feeModel) ?? 0n : 0n;
  const lpPreview = selected ? pos.claimableLP ?? mirrorClaimLP(snapshot!, pos) : 0n;
  const disclosure = selected ? agentDisclosure(selected) : undefined;

  const Chip = ({ v, set, label }: { v: string; set: (s: string) => void; label?: string }) => (
    <button type="button" onClick={() => set(v)} className="pp-chip">{label ?? `$${v}`}</button>
  );

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

  const connectPrompt = (
    <div className="pp-order-connect">
      <p>{address ? `Switch your wallet to ${D.label} to continue.` : "Connect a wallet to continue."}</p>
      <button onClick={() => (address ? switchChain(CHAIN.id) : connect())}>{address ? `switch to ${D.label}` : "connect wallet"}</button>
    </div>
  );

  return (
    <div className="perennial-panel space-y-3">
      <Suspense fallback={null}><BuilderParam onBuilder={setLinkedId} /></Suspense>
      {!PERENNIAL_WRITES_ENABLED && (
        <div className="pp-notice border border-down/35 bg-down/5 p-3 text-2xs text-down">
          Perennial transactions are paused. Live data remains available.
        </div>
      )}
      {ovError && (
        <div className="pp-notice border border-down/35 bg-down/5 p-3 text-2xs text-down">
          Couldn&apos;t read {D.label}: {humanizeError(ovError, HUMAN)} {ov ? "Showing the last good read; " : ""}retrying every 30s.
        </div>
      )}
      {ov && !ov.supportsSettlement && (
        <div className="pp-notice border border-line bg-bg-elev p-3 text-2xs text-fg-dim">
          This {D.label} deployment runs the legacy MarketsPerennial contract (no on-chain settlement state). Expired
          markets settle through the operator; resolve and void are not offered here, and new markets are disabled
          until the upgrade.
        </div>
      )}

      <div className="pp-market-status">
        <div><span>commons balance</span><strong>${stat(fmt(ov?.pendingPot ?? 0n))}</strong></div>
        <div><span>open markets</span><strong>{stat(String(openCount))}</strong></div>
        <div><span>epoch</span><strong>{stat((ov?.epoch ?? 0n).toString())}</strong></div>
        <div><span>market fee</span><strong>{ov ? feeHeadline(ov.feeModel) ?? "—" : stat("")}</strong></div>
        <div><span>network</span><strong>{D.label}</strong></div>
      </div>

      <div className="pp-terminal">
        <aside className="pp-terminal-sidebar">
          <div className="pp-mode-switch" aria-label="Perennial mode">
            <button onClick={() => setRole("bet")} aria-pressed={role === "bet"} className={role === "bet" ? "is-active" : ""}>Markets</button>
            <button onClick={() => setRole("build")} aria-pressed={role === "build"} className={role === "build" ? "is-active" : ""}>Build</button>
          </div>

          <section className="pp-discovery-section">
            <div className="pp-section-title"><span>Market explorer</span><b>{markets.length}</b></div>
            <div className="pp-filter-tabs" aria-label="Sort markets">
              {(["new", "trending", "featured", "closing"] as MarketView[]).map((view) => (
                <button key={view} onClick={() => setMarketView(view)} aria-pressed={marketView === view} className={marketView === view ? "is-active" : ""}>
                  {view === "closing" ? "closing soon" : view}
                </button>
              ))}
            </div>
            <div className="pp-market-list">
              {sortedMarkets.length ? sortedMarkets.map((m) => {
                const st = statusOf(m);
                return (
                  <button key={m.id} onClick={() => { setSelectedId(m.id); setFocusId(undefined); setRole("bet"); }} className={`pp-market-row ${m.id === selectedId ? "is-selected" : ""}`}>
                    <div className="pp-market-row-top">
                      <span>{subjectFor(m)}</span>
                      <strong>{yesPct(m)}¢</strong>
                    </div>
                    <p>{questionFor(m)}</p>
                    <div className="pp-market-row-meta">
                      <span>{st.label}</span>
                      <span>{st.canTrade ? remaining(m.expiry) : `builder #${m.builderId}`}</span>
                    </div>
                  </button>
                );
              }) : <div className="pp-empty-row">{ov ? "No markets on this deployment yet." : ovError ? "Couldn't load markets." : "Loading markets…"}</div>}
              {ov?.discovery.partial && <div className="pp-empty-row">Still indexing older blocks (scanned to #{ov.discovery.scannedTo.toString()})…</div>}
              {ov && ov.hiddenUnapproved > 0 && <div className="pp-empty-row">{ov.hiddenUnapproved} market(s) on unapproved feeds hidden.</div>}
            </div>
          </section>

          <section className="pp-discovery-section pp-builder-discovery">
            <div className="pp-section-title"><span>Builders</span><b>{builders.length}</b></div>
            <div className="pp-filter-tabs" aria-label="Sort builders">
              {(["new", "star", "veteran"] as BuilderView[]).map((view) => (
                <button key={view} onClick={() => setBuilderView(view)} aria-pressed={builderView === view} className={builderView === view ? "is-active" : ""}>{view}</button>
              ))}
            </div>
            <div className="pp-builder-list">
              {sortedBuilders.length ? sortedBuilders.map((b, index) => (
                <button key={b.builderId} onClick={() => selectBuilder(b)} className={`pp-builder-compact ${focusBuilder?.builderId === b.builderId ? "is-selected" : ""}`}>
                  <span className="pp-builder-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pp-builder-name"><b>{b.name} <VerifiedBadge verification={b.verification} link={false} /></b><small>{b.active ? b.repo : `${b.repo} · inactive`}</small></span>
                  <span className="pp-builder-weight">{stat((ov?.weights[b.owner.toLowerCase()] ?? 0n).toString())}<small>pts</small></span>
                </button>
              )) : <div className="pp-empty-row">{ov ? "No builders registered yet." : "—"}</div>}
            </div>
          </section>
        </aside>

        <section className="pp-terminal-main">
          {role === "bet" ? (
            <>
              <div className="pp-market-focus">
                <div className="pp-market-focus-head">
                  <div>
                    <div className="pp-card-label">{selected ? `${selStatus?.label} · builder #${selected.builderId}` : "Market"}</div>
                    <h2>{selected ? questionFor(selected) : ov ? "No market selected" : "Loading…"}</h2>
                    {selBuilder && <div className="flex items-center gap-2"><button className="pp-builder-link" onClick={() => setRole("build")}>{selBuilder.name} <span>↗</span></button><VerifiedBadge verification={selBuilder.verification} /></div>}
                  </div>
                  <div className="pp-market-price"><strong>{selected ? `${yp}¢` : "—"}</strong><span>YES price</span></div>
                </div>
                {selected ? <MarketOdds yes={yp} /> : <p className="mt-5 text-sm text-fg-dim">{ov ? "Pick a market, or open one below." : "Reading markets…"}</p>}
                {selected && (
                  <div className="pp-market-facts">
                    <span><b>Status</b>{selStatus?.label}</span>
                    <span><b>{selStatus?.canTrade ? "Closes" : "Expiry"}</b>{selStatus?.canTrade ? remaining(selected.expiry) : new Date(Number(selected.expiry) * 1000).toISOString().slice(0, 16).replace("T", " ")}</span>
                    <span><b>Liquidity</b>${fmt(selected.seeded)} seeded{selected.collateral !== undefined ? ` · pot $${fmt(selected.collateral)}` : ""}{selected.agentEscrow !== undefined ? ` · agent fee held $${fmt(selected.agentEscrow)}` : ""}</span>
                    <span><b>Resolution</b>bonded oracle{disclosure ? " ⚠" : ""}</span>
                  </div>
                )}
                {selected && (
                  <p className="mt-3 text-2xs text-fg-dim">
                    {selStatus?.detail}{" "}
                    {ov?.supportsSettlement ? settlementRuleText(ov.settlementWindow !== undefined ? Number(ov.settlementWindow) : undefined, feeModel) : null}
                    {feeLine && <span className="block mt-1">Fees: {feeLine}.</span>}
                    {disclosure && <span className="block mt-1 text-down">Disclosure: {disclosure}</span>}
                    {isMilestoneMarket(selected) && <MilestoneDisclosure metric={milestoneMetric(selBuilder?.source)} className="block mt-1" />}
                  </p>
                )}
              </div>

              <div className="pp-trading-grid">
                <div className="pp-action-card pp-order-ticket">
                  <div className="pp-panel-heading"><span>Order ticket</span><b>USDC</b></div>
                  {selected && <AgentBadge agent={selected.agent} rep={agentRep} className="mb-3" />}
                  {selected && <CaughtAgentBanner rep={agentRep} explorer={CHAIN.explorer.url} className="mb-3" />}
                  {needsConnect ? connectPrompt : !selected ? (
                    <button onClick={() => setShowCreate(true)} className="pp-submit-order">open a market</button>
                  ) : !selStatus?.canTrade ? (
                    <SettlementCard
                      status={selStatus!}
                      market={selected}
                      pos={pos}
                      feeModel={feeModel}
                      redeemable={redeemable}
                      lpPreview={lpPreview}
                      busy={busy}
                      pending={pending}
                      onResolve={settleAction("resolve", "resolve")}
                      onVoid={settleAction("void", "voidMarket")}
                      onRedeem={settleAction("redeem", "redeem")}
                      onClaimLP={settleAction("claimLP", "claimLP")}
                    />
                  ) : (
                    <>
                      <div className="pp-filter-tabs" aria-label="Order side">
                        {(["buy", "sell"] as const).map((m) => (
                          <button key={m} onClick={() => { setMode(m); setAmount(""); }} aria-pressed={mode === m} className={mode === m ? "is-active" : ""}>{m}</button>
                        ))}
                      </div>
                      <div className="pp-side-select mt-2">
                        {(["Yes", "No"] as const).map((choice) => (
                          <button key={choice} onClick={() => setSide(choice)} aria-pressed={side === choice} className={side === choice ? `is-active is-${choice.toLowerCase()}` : ""}>
                            <span>{mode === "buy" ? "Buy" : "Sell"} {choice}</span><b>{choice === "Yes" ? yp : 100 - yp}¢</b>
                          </button>
                        ))}
                      </div>
                      <label className="pp-amount-field"><span>{mode === "buy" ? "Pay" : "Shares"}</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /><b>{mode === "buy" ? "USDC" : side}</b></label>
                      <div className="pp-quick-row">
                        {mode === "buy"
                          ? ["1", "5", "10"].map((v) => <Chip key={v} v={v} set={setAmount} />)
                          : <Chip v={formatUsdc(held, 6)} set={setAmount} label={`max ${fmt(held)}`} />}
                      </div>
                      {amt && !amt.ok && <p className="mt-2 text-2xs text-down">{amt.error}</p>}
                      {(buyQ || sellQ) && ov && (
                        <div className="mt-2 space-y-0.5 font-mono text-[10px] text-fg-mute">
                          {buyQ && <div className="flex justify-between"><span>Shares out</span><span>{fmt(buyQ.sharesOut, 4)} {side}</span></div>}
                          {sellQ && <div className="flex justify-between"><span>You receive</span><span>${fmt(sellQ.collateralOut, 4)}</span></div>}
                          <div className="flex justify-between"><span>Avg price (incl. fee)</span><span>{cents((buyQ ?? sellQ)!.avgPrice)}</span></div>
                          <div className="flex justify-between"><span>Price impact</span><span className={(buyQ ?? sellQ)!.priceImpact > 0.05 ? "text-down" : ""}>{pct((buyQ ?? sellQ)!.priceImpact, 2)}</span></div>
                          <div className="flex justify-between"><span>Fee ({feeHeadline(feeModel)})</span><span>${fmt((buyQ ?? sellQ)!.fee, 4)}{feeParts ? ` · creator ${fmt(feeParts.creator, 4)} / agent${isV3 ? " (held)" : ""} ${fmt(feeParts.agent, 4)} / commons ${fmt(feeParts.commons, 4)}` : ""}</span></div>
                          {feeLine && <div className="text-fg-dim">{feeLine}</div>}
                          {minOut !== undefined && <div className="flex justify-between"><span>Minimum {mode === "buy" ? "shares" : "received"}</span><span>{mode === "buy" ? fmt(minOut, 4) : `$${fmt(minOut, 4)}`}</span></div>}
                        </div>
                      )}
                      <label className="mt-2 flex items-center justify-between font-mono text-[10px] text-fg-mute">
                        <span>Slippage tolerance</span>
                        <span><input value={slippage} onChange={(e) => setSlippage(e.target.value)} inputMode="decimal" className="w-12 bg-bg border border-line px-1 text-right outline-none" /> %</span>
                      </label>
                      {!slip.ok && <p className="text-2xs text-down">{slip.error}</p>}
                      <button onClick={doTrade} disabled={busy || !(buyQ || sellQ) || !slip.ok} className="pp-submit-order">
                        {pending === mode ? (mode === "buy" ? "placing order…" : "selling…") : `${mode} ${side}`}
                      </button>
                      <div className="pp-order-foot"><span>Shares Y {fmt(pos.yes)} · N {fmt(pos.no)}{pos.netCost !== undefined ? ` · net cost $${fmt(pos.netCost)}` : ""}</span><span>Chain time gates expiry</span></div>
                    </>
                  )}
                </div>

                <div className="pp-action-card pp-account-panel">
                  <div className="pp-panel-heading"><span>Trading account</span><b>{onPerennialChain ? "connected" : "read only"}</b></div>
                  <div className="pp-account-balance"><span>Available to trade</span><strong>${needsConnect ? "—" : acct ? fmt(ledgerBal) : acctError ? "error" : "—"}</strong></div>
                  {!needsConnect ? (
                    <>
                      <label className="pp-amount-field"><span>Deposit</span><input value={depAmt} onChange={(e) => setDepAmt(e.target.value)} inputMode="decimal" placeholder="0.00" /><b>USDC</b></label>
                      <div className="pp-account-actions">
                        <button onClick={doDeposit} disabled={busy || !acct}>{pending === "deposit" ? "…" : "deposit"}</button>
                        <button onClick={doWithdraw} disabled={busy || !acct}>{pending === "withdraw" ? "…" : "withdraw all"}</button>
                      </div>
                      <div className="pp-quick-row">
                        {["5", "10", "25"].map((v) => <Chip key={v} v={v} set={setDepAmt} />)}
                        <Chip v={formatUsdc(depositMax, 6)} set={setDepAmt} label={`max ${fmt(depositMax)}`} />
                      </div>
                      {CHAIN.testnet && (
                        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="pp-test-funds block text-center">get test USDC · faucet.circle.com ↗</a>
                      )}
                      {acctError && <p className="mt-2 text-2xs text-down">Couldn&apos;t read your balances: {humanizeError(acctError, HUMAN)}</p>}
                      <div className="pp-order-foot"><span>Wallet ${acct ? fmt(walletBal) : "—"}</span><span>keeps $0.10 for gas</span></div>
                    </>
                  ) : <p className="pp-read-only-copy">Market data stays live without a wallet. Connect from the order ticket when you are ready to trade.</p>}
                </div>
              </div>

              {focusBuilder && (
                <BuilderBadgeSection
                  builderId={focusBuilder.builderId}
                  owner={focusBuilder.owner}
                  name={focusBuilder.name}
                  source={focusBuilder.source}
                  snapshot={focusBuilder.badge}
                  viewer={address}
                />
              )}

              {digest && selected && (
                <BuilderProfile digest={digest} verification={selBuilder?.verification} milestone={<><span className="caption text-2xs text-fg-dim block mb-1">{questionFor(selected)}</span><MarketOdds yes={yp} /></>} />
              )}

              {!needsConnect && (
                <div className="pp-action-card pp-create-market">
                  <button onClick={() => setShowCreate((v) => !v)} className="w-full flex items-center justify-between text-[14px] text-fg-mute hover:text-fg transition-colors">
                    <span>Open a milestone market</span><span className="text-[18px] leading-none">{showCreate ? "−" : "+"}</span>
                  </button>
                  {showCreate && (
                    <div className="mt-3 space-y-2">
                      {activeBuilders.length > 0 && (
                        <div>
                          <label className="caption text-[10px] text-fg-dim">builder</label>
                          <select value={createBuilder?.builderId ?? ""} onChange={(e) => setCBuilder(Number(e.target.value))} className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60">
                            {activeBuilders.map((b) => <option key={b.builderId} value={b.builderId}>{b.name} (#{b.builderId})</option>)}
                          </select>
                        </div>
                      )}
                      <p className="text-2xs text-fg-dim">
                        YES if the builder&apos;s verified-artifact count reaches{" "}
                        <b className="text-fg">{cThreshold !== undefined ? `≥ ${cThreshold}` : "latest + 1"}</b>
                        {latest ? ` (latest attested: ${latest.value}${latest.finalized ? "" : ", not yet final"})` : latest === null ? " (nothing attested yet)" : ""}.
                        {" "}Agent: the caretaker operator{D.operator ? ` ${D.operator.slice(0, 6)}…${D.operator.slice(-4)}` : ""}.{" "}
                        {settlementRuleText(ov?.settlementWindow !== undefined ? Number(ov.settlementWindow) : undefined, feeModel)}
                      </p>
                      {createBuilder && <p><MilestoneDisclosure metric={milestoneMetric(createBuilder.source)} /></p>}
                      {ov && feeLine && (
                        <p className="text-2xs text-fg-dim">
                          {isV3
                            ? `Fees: ${feeLine}. Nothing is charged at settlement; the creator's share is yours. `
                            : `Fees: ${feeLine}. `}
                          Your liquidity is returned through Claim LP after settlement.
                        </p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-[1fr_90px_110px]">
                        <div><label className="caption text-[10px] text-fg-dim">condition</label><div className="w-full bg-bg border border-line px-3 py-2 text-[14px] text-fg-mute">artifacts ≥ {cThreshold?.toString() ?? "…"}</div></div>
                        <div><label className="caption text-[10px] text-fg-dim">days</label><input value={cDays} onChange={(e) => setCDays(e.target.value)} inputMode="numeric" className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" /></div>
                        <div><label className="caption text-[10px] text-fg-dim">liquidity (min {ov ? fmt(ov.minLiquidity) : "5"})</label><input value={cLiq} onChange={(e) => setCLiq(e.target.value)} inputMode="decimal" className="w-full bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" /></div>
                      </div>
                      {createBlocker && <p className="text-2xs text-down">{createBlocker}</p>}
                      <button onClick={doCreate} disabled={busy || Boolean(createBlocker)} className="w-full bg-accent/90 text-bg py-2 text-[14px] hover:bg-accent transition-colors disabled:opacity-50">{pending === "create" ? "…" : "create market"}</button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="pp-build-workspace">
              <div className="pp-workspace-title"><div className="pp-card-label">Builder workspace</div><h2>Ship work. Earn from verified progress.</h2></div>
              {needsConnect ? (
                <div className="pp-connect-card"><div><span>Wallet required</span><p>Connect on {D.label} to register a project or claim an epoch.</p></div><button onClick={() => (address ? switchChain(CHAIN.id) : connect())}>{address ? `switch to ${D.label}` : "connect wallet"}</button></div>
              ) : (
                <div className="pp-action-card">
                  {!acct ? (
                    <p className="text-2xs text-fg-dim">{acctError ? `Couldn't read your builder status: ${humanizeError(acctError, HUMAN)}` : "Reading your builder status…"}</p>
                  ) : !acct.registered ? (
                    <><h3>Claim your project</h3><p className="text-2xs text-fg-dim mb-3">Builders join by claim: sign a proof with this wallet, publish it in your repo or on your domain, then register. Nothing about you is public until you do.</p><Link href="/verify" className="inline-block px-4 py-2 bg-accent/90 text-bg text-[13px] hover:bg-accent transition-colors">verify your project →</Link></>
                  ) : (
                    <><div className="flex items-center justify-between mb-3"><h3>Your progress</h3><span className="text-2xs px-2 py-0.5 bg-up/10 text-up border border-up/25">registered</span></div><div className="pp-progress-total"><strong>{acct.myWeight.toString()}</strong><span>progress points · epoch {stat((ov?.epoch ?? 0n).toString())}</span></div>{acct.claims.length === 0 ? <p className="text-2xs text-fg-dim border-t border-line pt-3">Nothing to claim yet. Progress becomes claimable when the epoch closes.</p> : acct.claims.map((claim) => <div key={claim.epoch} className="pp-claim-row"><span>epoch {claim.epoch} · ${fmt(claim.amount)}</span><button onClick={() => doClaim(claim.epoch)} disabled={busy}>{pending === `claim-${claim.epoch}` ? "…" : "claim"}</button></div>)}</>
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

/** After expiry: settle (resolve / void), then redeem and claim LP. */
function SettlementCard(props: {
  status: MarketStatus;
  market: ChainMarket;
  pos: Position;
  feeModel: FeeModel | undefined;
  redeemable: bigint;
  lpPreview: bigint;
  busy: boolean;
  pending: string;
  onResolve: () => void;
  onVoid: () => void;
  onRedeem: () => void;
  onClaimLP: () => void;
}) {
  const { status: s, market: m, pos, feeModel, redeemable, lpPreview, busy, pending } = props;
  const btn = "pp-submit-order";
  const v3 = feeModel?.kind === "trade" ? feeModel : undefined;
  const redeemLine = (() => {
    if (m.phase === PHASE.Voided) {
      if (!v3) return `Your shares: YES ${formatUsdc(pos.yes)} + NO ${formatUsdc(pos.no)} × $0.50 = $${formatUsdc(redeemable)}`;
      if (pos.netCost === undefined) return `Voided — your refund is $${formatUsdc(redeemable)}`;
      const proRata = m.voidTraderPool !== undefined && m.voidNetCostTotal !== undefined && voidIsProRata(m.voidTraderPool, m.voidNetCostTotal);
      return `Voided — ${voidRefundText(pos.netCost, redeemable, proRata)}`;
    }
    return `${m.yesWon ? "YES" : "NO"} won · your winning shares pay $${formatUsdc(redeemable)} ($1.00 each)`;
  })();
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] text-fg">{s.label}</div>
      <p className="text-2xs text-fg-dim">{s.detail}</p>
      {s.canResolve && m.agentEscrow !== undefined && m.agentEscrow > 0n && (
        <div className="font-mono text-[10px] text-fg-mute">Resolving releases the agent&apos;s held ${formatUsdc(m.agentEscrow)} to it.</div>
      )}
      {s.canResolve && <button onClick={props.onResolve} disabled={busy} className={btn}>{pending === "resolve" ? "resolving…" : "resolve market"}</button>}
      {s.canVoid && v3 && pos.netCost !== undefined && pos.netCost > 0n && (
        <div className="font-mono text-[10px] text-fg-mute">
          If voided: your net cost ${formatUsdc(pos.netCost)} back (pro rata only if the pool is short)
          {m.agentEscrow !== undefined ? ` · the agent's held $${formatUsdc(m.agentEscrow)} goes to its successful challenger, else the ${v3.commonsLabel}` : ""}
        </div>
      )}
      {s.canVoid && <button onClick={props.onVoid} disabled={busy} className={btn}>{pending === "void" ? "voiding…" : v3 ? "void market (refunds net cost)" : "void market ($0.50 / share)"}</button>}
      {s.canRedeem && (
        <>
          <div className="font-mono text-[10px] text-fg-mute">{redeemLine}</div>
          <button onClick={props.onRedeem} disabled={busy || redeemable === 0n} className={btn}>{pending === "redeem" ? "redeeming…" : redeemable === 0n ? "nothing to redeem" : `redeem $${formatUsdc(redeemable)}`}</button>
        </>
      )}
      {s.canClaimLP && pos.lp > 0n && (
        <button onClick={props.onClaimLP} disabled={busy} className={btn}>{pending === "claimLP" ? "claiming…" : `claim LP ${pos.claimableLP !== undefined ? "" : "≈ "}$${formatUsdc(lpPreview)}`}</button>
      )}
      <div className="pp-order-foot"><span>Shares Y {formatUsdc(pos.yes)} · N {formatUsdc(pos.no)}{pos.netCost !== undefined ? ` · net cost $${formatUsdc(pos.netCost)}` : ""}</span><span>LP {formatUsdc(pos.lp)}</span></div>
    </div>
  );
}
