"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits, parseAbiItem, type PublicClient } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { usdcAbi, marketsAbi, marketsV3ShareAbi, cirqueBetLendingAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";

// Markets on MarketsV3 you can hold a position in and borrow against. These are
// DISCOVERED on-chain from MarketCreated logs (see useV3Markets) so any market
// created on MarketsV3 — by the bots or anyone — shows up automatically. The
// entry below is a fallback for the first paint / if log discovery fails.
interface V3Market {
  id: `0x${string}`;
  label: string;
  expiry: number; // unix seconds
}
const FALLBACK_MARKETS: V3Market[] = [
  {
    id: "0xaa7ccbe1e14bc627cc92a1df58d8b1ae18ce8fb179b7d08c313e24dc2de0fd5d",
    label: "BTC/USD > $75,000",
    expiry: 1785504700,
  },
];

// Block MarketsV3 was deployed — log scan start (kept small; testnet).
const V3_DEPLOY_BLOCK = 44_990_000n;
const MARKET_CREATED = parseAbiItem(
  "event MarketCreated(bytes32 indexed marketId, address indexed creator, bytes32 indexed feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry, uint256 liquidity)",
);
const CMP = [">", "≥", "<", "≤"]; // Comparator enum order
// feedId → how to render its threshold. BTC feed is USDC18-scaled ($); the
// rest come from the live feed registry (native integer / displayDivisor).
const BTC_FEED = "0x23a85cd7cf982eb789a14a930d09d1d3ec7479b3e70679c5f46b1a190aafe64c";

function fmtThreshold(feedId: string, threshold: bigint): string {
  if (feedId.toLowerCase() === BTC_FEED) {
    return `$${(Number(threshold) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return threshold.toString();
}
function feedSymbol(feedId: string): string {
  if (feedId.toLowerCase() === BTC_FEED) return "BTC/USD";
  return `${feedId.slice(0, 6)}…`;
}

// Arc RPC caps eth_getLogs at a 10,000-block range, so scan in windows.
const LOG_WINDOW = 9_000n;

/** Discover every Trading market on MarketsV3 from its creation logs. */
async function discoverV3Markets(
  client: PublicClient,
  markets: `0x${string}`,
): Promise<V3Market[]> {
  type MktArgs = {
    marketId?: `0x${string}`; feedId?: `0x${string}`;
    threshold?: bigint; comparator?: number; expiry?: bigint;
  };
  const latest = await client.getBlockNumber();
  const args: MktArgs[] = [];
  for (let from = V3_DEPLOY_BLOCK; from <= latest; from += LOG_WINDOW + 1n) {
    const to = from + LOG_WINDOW > latest ? latest : from + LOG_WINDOW;
    const chunk = await client.getLogs({ address: markets, event: MARKET_CREATED, fromBlock: from, toBlock: to });
    for (const log of chunk) args.push(log.args as MktArgs);
  }
  const seen = new Set<string>();
  const out: V3Market[] = [];
  for (const a of args) {
    if (!a.marketId || seen.has(a.marketId)) continue;
    seen.add(a.marketId);
    // Only list markets still Trading (skip resolved/expired).
    try {
      const m = (await client.readContract({
        address: markets, abi: marketsAbi, functionName: "getMarket", args: [a.marketId],
      })) as { phase: number };
      if (m.phase !== 0) continue;
    } catch { continue; }
    const cmp = CMP[a.comparator ?? 0] ?? "?";
    out.push({
      id: a.marketId,
      label: `${feedSymbol(a.feedId ?? "")} ${cmp} ${fmtThreshold(a.feedId ?? "", a.threshold ?? 0n)}`,
      expiry: Number(a.expiry ?? 0n),
    });
  }
  return out;
}

type SupplyMode = "supply" | "withdraw";
type Side = "yes" | "no";
type Status = "idle" | "approving" | "submitting" | "success" | "error";

interface PoolStats {
  totalPoolValue: bigint;
  totalBorrowed: bigint;
  available: bigint;
  totalShares: bigint;
  badDebt: bigint;
  minPoolDepth: bigint;
  maxLtvBps: bigint;
}
interface MarketView { yesReserve: bigint; noReserve: bigint; phase: number; expiry: bigint }
interface PositionView { yes: bigint; no: bigint; maxBorrowYes: bigint; maxBorrowNo: bigint }
interface LoanView {
  active: boolean; marketId: `0x${string}`; betYes: boolean;
  shares: bigint; principal: bigint; interest: bigint; health: bigint;
}
interface ChannelState { status: Status; error?: string; tx?: `0x${string}` }
const IDLE: ChannelState = { status: "idle" };

const fmt = (wei: bigint, dp = 2) => (Number(wei) / 1e6).toFixed(dp);
// More precision for sub-1-USDC testnet amounts so they don't read as zero.
const fmtSmart = (wei: bigint) => {
  const n = Number(wei) / 1e6;
  return n > 0 && n < 1 ? n.toFixed(4) : n.toFixed(2);
};
const fmtBps = (bps: bigint) => `${(Number(bps) / 100).toFixed(1)}%`;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const busy = (c: ChannelState) => c.status === "approving" || c.status === "submitting";

export function BetBorrowPanel() {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } =
    useWallet();

  const lending = CONTRACTS.CirqueBetLending;
  const markets = CONTRACTS.MarketsV3;
  const usdc = CONTRACTS.USDC;

  const [v3Markets, setV3Markets] = useState<V3Market[]>(FALLBACK_MARKETS);
  const [supplyMode, setSupplyMode] = useState<SupplyMode>("supply");
  const [supplyAmount, setSupplyAmount] = useState("");
  const [selMarket, setSelMarket] = useState<`0x${string}`>(FALLBACK_MARKETS[0]?.id ?? ZERO_ADDR);
  const [tradeSide, setTradeSide] = useState<Side>("yes");
  const [tradeAmount, setTradeAmount] = useState("");
  const [borrowSide, setBorrowSide] = useState<Side>("yes");
  const [borrowAmount, setBorrowAmount] = useState("");

  const [stats, setStats] = useState<PoolStats>();
  const [poolShares, setPoolShares] = useState<bigint>(0n);
  const [poolClaim, setPoolClaim] = useState<bigint>(0n);
  const [usdcBal, setUsdcBal] = useState<bigint>(0n);
  const [mkt, setMkt] = useState<MarketView>();
  const [pos, setPos] = useState<PositionView>();
  const [operatorOk, setOperatorOk] = useState(false);
  const [loan, setLoan] = useState<LoanView>();
  const [loaded, setLoaded] = useState(false);

  // Two independent status channels so a supply error doesn't render under the
  // borrow widget (and vice-versa).
  const [supplyCh, setSupplyCh] = useState<ChannelState>(IDLE);
  const [actCh, setActCh] = useState<ChannelState>(IDLE);

  const refresh = useCallback(async () => {
    if (!lending || !markets) return;
    try {
      const [pv, borrowed, avail, ts, bad, minDepth, maxLtv] = (await Promise.all([
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalPoolValueUSDC" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalBorrowedPrincipal" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "availableUSDC" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalShares" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalBadDebtRealizedUSDC" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "MIN_POOL_DEPTH" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "MAX_LTV_BPS" }),
      ])) as bigint[];
      setStats({ totalPoolValue: pv, totalBorrowed: borrowed, available: avail, totalShares: ts, badDebt: bad, minPoolDepth: minDepth, maxLtvBps: maxLtv });

      const m = (await publicClient.readContract({
        address: markets, abi: marketsAbi, functionName: "getMarket", args: [selMarket],
      })) as { yesReserve: bigint; noReserve: bigint; phase: number; expiry: bigint };
      setMkt({ yesReserve: m.yesReserve, noReserve: m.noReserve, phase: m.phase, expiry: m.expiry });

      if (address) {
        const [bal, sh, claim] = (await Promise.all([
          publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "shares", args: [address] }),
          publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "balanceOfUSDC", args: [address] }),
        ])) as bigint[];
        setUsdcBal(bal); setPoolShares(sh); setPoolClaim(claim);

        const [yes, no, op] = (await Promise.all([
          publicClient.readContract({ address: markets, abi: marketsAbi, functionName: "yesBalance", args: [selMarket, address] }),
          publicClient.readContract({ address: markets, abi: marketsAbi, functionName: "noBalance", args: [selMarket, address] }),
          publicClient.readContract({ address: markets, abi: marketsV3ShareAbi, functionName: "shareOperatorApproved", args: [address, lending] }),
        ])) as [bigint, bigint, boolean];
        setOperatorOk(op);
        const [mbY, mbN] = (await Promise.all([
          yes > 0n ? publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "maxBorrow", args: [selMarket, true, yes] }) : Promise.resolve(0n),
          no > 0n ? publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "maxBorrow", args: [selMarket, false, no] }) : Promise.resolve(0n),
        ])) as bigint[];
        setPos({ yes, no, maxBorrowYes: mbY, maxBorrowNo: mbN });

        const l = (await publicClient.readContract({
          address: lending, abi: cirqueBetLendingAbi, functionName: "loans", args: [address],
        })) as [`0x${string}`, boolean, bigint, bigint, bigint, boolean, bigint];
        if (l[5]) {
          const [interest, health] = (await Promise.all([
            publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "interestOwed", args: [address] }),
            publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "healthBps", args: [address] }),
          ])) as bigint[];
          setLoan({ active: true, marketId: l[0], betYes: l[1], shares: l[2], principal: l[3], interest, health });
        } else {
          setLoan({ active: false, marketId: ZERO_ADDR, betYes: true, shares: 0n, principal: 0n, interest: 0n, health: 0n });
        }
      }
      setLoaded(true);
    } catch (e) {
      console.error("bet-borrow refresh failed", e);
    }
  }, [lending, markets, usdc, publicClient, address, selMarket]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Light poll so pool value / interest-owed don't go stale between actions.
  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, 12_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Discover every Trading market on MarketsV3 from creation logs.
  useEffect(() => {
    if (!markets) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await discoverV3Markets(publicClient, markets);
        if (cancelled || found.length === 0) return;
        setV3Markets(found);
        // Keep the selection valid if the current one isn't in the new set.
        setSelMarket((cur) => (found.some((m) => m.id === cur) ? cur : found[0]!.id));
      } catch (e) {
        console.error("v3 market discovery failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [markets, publicClient]);

  const needsConnect = !address || !isOnSupportedChain;

  async function ensureApproved(spender: `0x${string}`, needed: bigint, setCh: (c: ChannelState) => void) {
    if (!walletClient || !address) return;
    const allowance = (await publicClient.readContract({
      address: usdc, abi: usdcAbi, functionName: "allowance", args: [address, spender],
    })) as bigint;
    if (allowance >= needed) return;
    setCh({ status: "approving" });
    const hash = await walletClient.writeContract({
      address: usdc, abi: usdcAbi, functionName: "approve",
      args: [spender, 2n ** 256n - 1n], chain: walletClient.chain, account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function run(setCh: (c: ChannelState) => void, fn: () => Promise<`0x${string}`>, after?: () => void) {
    if (!walletClient || !address) return;
    try {
      setCh({ status: "submitting" });
      const hash = await fn();
      setCh({ status: "submitting", tx: hash });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setCh({ status: "success", tx: hash });
      after?.();
      await refresh();
    } catch (e) {
      setCh({ status: "error", error: humanizeError(e) });
    }
  }

  async function doSupply() {
    const wei = parseUnits(supplyAmount || "0", 6);
    if (wei === 0n) { setSupplyCh({ status: "error", error: "amount required" }); return; }
    if (supplyMode === "supply") await ensureApproved(lending!, wei, setSupplyCh);
    await run(setSupplyCh,
      () => walletClient!.writeContract({
        address: lending!, abi: cirqueBetLendingAbi,
        functionName: supplyMode === "supply" ? "supplyUSDC" : "withdrawUSDC",
        args: [wei], chain: walletClient!.chain, account: walletClient!.account!,
      }),
      () => setSupplyAmount(""));
  }

  async function doTrade() {
    const wei = parseUnits(tradeAmount || "0", 6);
    if (wei === 0n) { setActCh({ status: "error", error: "amount required" }); return; }
    await ensureApproved(markets!, wei, setActCh);
    await run(setActCh,
      () => walletClient!.writeContract({
        address: markets!, abi: marketsAbi, functionName: "buy",
        args: [selMarket, tradeSide === "yes" ? 0 : 1, wei, 0n],
        chain: walletClient!.chain, account: walletClient!.account!,
      }),
      () => setTradeAmount(""));
  }

  async function doApproveOperator() {
    await run(setActCh, () => walletClient!.writeContract({
      address: markets!, abi: marketsV3ShareAbi, functionName: "setShareOperator",
      args: [lending!, true], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  async function doBorrow() {
    if (!pos) return;
    const wei = parseUnits(borrowAmount || "0", 6);
    if (wei === 0n) { setActCh({ status: "error", error: "amount required" }); return; }
    const shares = borrowSide === "yes" ? pos.yes : pos.no;
    await run(setActCh,
      () => walletClient!.writeContract({
        address: lending!, abi: cirqueBetLendingAbi, functionName: "borrowAgainstBet",
        args: [selMarket, borrowSide === "yes", shares, wei],
        chain: walletClient!.chain, account: walletClient!.account!,
      }),
      () => setBorrowAmount(""));
  }

  async function doRepay() {
    await ensureApproved(lending!, (loan?.principal ?? 0n) + (loan?.interest ?? 0n) + 1_000n, setActCh);
    await run(setActCh, () => walletClient!.writeContract({
      address: lending!, abi: cirqueBetLendingAbi, functionName: "repayBet",
      args: [], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  const market = useMemo(() => v3Markets.find((m) => m.id === selMarket), [v3Markets, selMarket]);

  // Live odds from reserves: price(YES) = noReserve / total.
  const yesProb = mkt && mkt.yesReserve + mkt.noReserve > 0n
    ? Number(mkt.noReserve) / Number(mkt.yesReserve + mkt.noReserve)
    : undefined;

  const eligible = mkt && stats
    ? mkt.yesReserve >= stats.minPoolDepth && mkt.noReserve >= stats.minPoolDepth
    : false;
  const depthShortfall = mkt && stats && !eligible
    ? stats.minPoolDepth - (mkt.yesReserve < mkt.noReserve ? mkt.yesReserve : mkt.noReserve)
    : 0n;

  const maxBorrowSel = pos ? (borrowSide === "yes" ? pos.maxBorrowYes : pos.maxBorrowNo) : 0n;
  const sharesSel = pos ? (borrowSide === "yes" ? pos.yes : pos.no) : 0n;
  // markValue = maxBorrow / LTV. Projected LTV for the typed borrow = borrow / markValue.
  const markValueSel = stats && maxBorrowSel > 0n
    ? (maxBorrowSel * 10000n) / stats.maxLtvBps : 0n;
  const borrowWei = (() => { try { return parseUnits(borrowAmount || "0", 6); } catch { return 0n; } })();
  const projLtvBps = markValueSel > 0n ? (borrowWei * 10000n) / markValueSel : 0n;
  const overCap = stats ? projLtvBps > stats.maxLtvBps : false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-line">
      {/* ── Pool: supply / withdraw ── */}
      <div className="bg-bg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-[18px]">Lending pool</h3>
          <Toggle name="pool mode" a="supply" b="withdraw" value={supplyMode} onChange={setSupplyMode} />
        </div>
        <Stat label="pool value" value={loaded && stats ? `${fmt(stats.totalPoolValue)} USDC` : undefined} />
        <Stat label="idle (borrowable)" value={loaded && stats ? `${fmt(stats.available)} USDC` : undefined} />
        <Stat label="out on loan" value={loaded && stats ? `${fmt(stats.totalBorrowed)} USDC` : undefined} />
        {stats && stats.badDebt > 0n && <Stat label="bad debt realized" value={`${fmt(stats.badDebt)} USDC`} />}
        <Stat label="your pool claim" value={loaded ? `${fmt(poolClaim)} USDC` : undefined} />

        <div className="mt-4">
          <AmountInput
            id="supply-amt"
            ariaLabel={supplyMode === "supply" ? "USDC amount to supply" : "share amount to withdraw"}
            value={supplyAmount} onChange={setSupplyAmount}
            onMax={() => setSupplyAmount(supplyMode === "supply" ? fmt(usdcBal) : fmt(poolShares, 0))}
          />
          <div className="caption text-2xs text-fg-dim mt-1">
            {supplyMode === "supply"
              ? `wallet: ${fmt(usdcBal)} USDC · earns interest from borrowers`
              : `your shares: ${fmt(poolShares, 0)} · claim ${fmt(poolClaim)} USDC`}
          </div>
          <ActionButton
            onClick={needsConnect ? (address ? () => switchChain() : connect) : doSupply}
            disabled={busy(supplyCh)}
            label={needsConnect ? (address ? "Switch to Arc" : "Connect") : supplyMode === "supply" ? "Supply USDC" : "Withdraw"}
          />
          <StatusRow ch={supplyCh} />
        </div>
      </div>

      {/* ── Position + borrow ── */}
      <div className="bg-bg p-5">
        <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-serif text-[18px]">Borrow against a bet</h3>
          <label className="flex items-center gap-2">
            <span className="sr-only">select market</span>
            <select
              value={selMarket} onChange={(e) => setSelMarket(e.target.value as `0x${string}`)}
              className="bg-bg-elev/40 border border-line/60 px-2 py-1 text-2xs outline-none max-w-full"
            >
              {v3Markets.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>

        {/* live odds */}
        <div className="flex items-center justify-between border-b border-line/30 pb-2 mb-3 text-[13px]">
          <span className="caption text-2xs text-fg-dim">market odds</span>
          <span>
            {yesProb !== undefined
              ? <>YES <span className="text-accent">{(yesProb * 100).toFixed(0)}%</span> · NO <span className="text-fg-mute">{((1 - yesProb) * 100).toFixed(0)}%</span></>
              : "—"}
          </span>
        </div>

        {!eligible && loaded && (
          <div className="mb-3 border border-amber-500/30 bg-amber-500/5 p-2 text-2xs text-amber-300/80">
            Market too shallow to borrow against (needs ≥ {stats ? fmt(stats.minPoolDepth, 0) : "—"} USDC
            per side{depthShortfall > 0n ? ` — ~${fmt(depthShortfall, 0)} more` : ""}). Buy into it below
            to deepen, or pick another market.
          </div>
        )}

        {/* get a position */}
        <div className="border border-line/50 p-3 mb-3">
          <div className="caption text-2xs text-fg-dim mb-2">your position · {market?.label}</div>
          <div className="flex gap-4 text-[13px] mb-2">
            <span>YES <span className="text-fg-mute">{fmt(pos?.yes ?? 0n)}</span></span>
            <span>NO <span className="text-fg-mute">{fmt(pos?.no ?? 0n)}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle name="trade side" a="yes" b="no" value={tradeSide} onChange={setTradeSide} small />
            <input
              value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)}
              inputMode="decimal" placeholder="buy amt USDC" aria-label="USDC amount to buy"
              className="flex-1 min-w-0 bg-bg-elev/40 border border-line/60 px-2 py-1 text-[13px] outline-none focus:border-accent/60"
            />
            <button
              onClick={needsConnect ? (address ? () => switchChain() : connect) : doTrade}
              disabled={busy(actCh)}
              className="px-3 py-1 text-2xs border border-line hover:border-accent/60 disabled:opacity-40"
            >buy</button>
          </div>
        </div>

        {/* borrow */}
        <div className="flex items-center justify-between mb-2">
          <Toggle name="collateral side" a="yes" b="no" value={borrowSide} onChange={setBorrowSide} small />
          <span className="caption text-2xs text-fg-dim">
            {sharesSel === 0n ? "no position on this side" : `max ${fmtSmart(maxBorrowSel)} USDC`}
          </span>
        </div>
        {!operatorOk && address && (
          <div className="mb-2 border border-line/50 bg-bg-elev/20 p-2 text-2xs text-fg-dim leading-relaxed">
            One-time: approve the pool to custody (move) your MarketsV3 shares as
            collateral.{" "}
            <button onClick={needsConnect ? (() => switchChain()) : doApproveOperator} className="text-accent underline disabled:opacity-40" disabled={busy(actCh)}>
              approve operator
            </button>
          </div>
        )}
        <AmountInput
          id="borrow-amt" ariaLabel="USDC amount to borrow"
          value={borrowAmount} onChange={setBorrowAmount}
          onMax={() => setBorrowAmount(fmtSmart(maxBorrowSel))}
        />
        <div className="flex items-center justify-between caption text-2xs mt-1">
          <span className="text-fg-dim">40% max LTV · depth-capped mark · 5% APY</span>
          {borrowWei > 0n && markValueSel > 0n && (
            <span className={overCap ? "text-red-400" : "text-fg-mute"}>
              LTV {fmtBps(projLtvBps)}{overCap ? " · over cap" : ""}
            </span>
          )}
        </div>
        <ActionButton
          onClick={needsConnect ? (address ? () => switchChain() : connect) : doBorrow}
          disabled={!operatorOk || sharesSel === 0n || !eligible || overCap || busy(actCh)}
          label={needsConnect ? (address ? "Switch to Arc" : "Connect") : "Borrow USDC"}
        />

        {/* active loan */}
        {loan?.active && (
          <div className="mt-4 border border-accent/30 bg-accent/5 p-3">
            <div className="caption text-2xs text-accent mb-2">active loan</div>
            <Stat small label="borrowed" value={`${fmtSmart(loan.principal)} USDC`} />
            <Stat small label="interest owed" value={`${fmtSmart(loan.interest)} USDC`} />
            <Stat small label="collateral" value={`${fmt(loan.shares)} ${loan.betYes ? "YES" : "NO"}`} />
            <Stat small label="health (LTV)" value={fmtBps(loan.health)} />
            <button
              onClick={needsConnect ? (address ? () => switchChain() : connect) : doRepay}
              disabled={busy(actCh)}
              className="mt-2 w-full py-2 text-2xs border border-line hover:border-accent/60 disabled:opacity-40"
            >Repay &amp; reclaim position</button>
          </div>
        )}
        <StatusRow ch={actCh} />
      </div>
    </div>
  );
}

function StatusRow({ ch }: { ch: ChannelState }) {
  if (ch.status === "idle") return null;
  return (
    <div className="mt-2 text-2xs" aria-live="polite">
      {ch.status === "approving" && <span className="text-fg-dim">approving…</span>}
      {ch.status === "submitting" && <span className="text-fg-dim">submitting…</span>}
      {ch.status === "success" && (
        <span className="text-emerald-400">
          done.{" "}
          {ch.tx && <a className="underline" href={txUrl(ch.tx)} target="_blank" rel="noreferrer">view tx</a>}
        </span>
      )}
      {ch.status === "error" && <span className="text-red-400">{ch.error}</span>}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value?: string; small?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${small ? "py-0.5" : "py-1"} border-b border-line/30 last:border-0`}>
      <span className="caption text-2xs text-fg-dim">{label}</span>
      <span className={`${small ? "text-[13px]" : "text-[14px]"} ${value === undefined ? "text-fg-dim/40 animate-pulse" : ""}`}>
        {value ?? "···"}
      </span>
    </div>
  );
}

function AmountInput({ id, ariaLabel, value, onChange, onMax }: {
  id: string; ariaLabel: string; value: string; onChange: (v: string) => void; onMax: () => void;
}) {
  return (
    <div className="relative">
      <input
        id={id} aria-label={ariaLabel}
        value={value} onChange={(e) => onChange(e.target.value)}
        inputMode="decimal" placeholder="0.00"
        className="w-full bg-bg-elev/40 border border-line/60 pl-3 pr-14 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      <button
        type="button" onClick={onMax}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-accent hover:underline"
      >max</button>
    </div>
  );
}

function Toggle<T extends string>({ name, a, b, value, onChange, small }: {
  name: string; a: T; b: T; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className="inline-flex border border-line/60 text-2xs" role="group" aria-label={name}>
      {[a, b].map((opt) => (
        <button
          key={opt} type="button" aria-pressed={value === opt} onClick={() => onChange(opt)}
          className={`${small ? "px-2" : "px-2.5"} py-1 ${value === opt ? "bg-accent/90 text-bg" : "text-fg-dim hover:text-fg"}`}
        >{opt}</button>
      ))}
    </div>
  );
}

function ActionButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className="mt-3 w-full py-2.5 text-[13px] bg-accent/90 text-bg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >{label}</button>
  );
}
