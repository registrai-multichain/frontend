"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { usdcAbi, marketsAbi, marketsV3ShareAbi, cirqueBetLendingAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";

// Markets on MarketsV3 you can hold a position in and borrow against. There is
// no cheap on-chain enumeration of markets, so the borrowable set is listed
// here (the proposer/MM bots can append as they create v3 markets).
interface V3Market {
  id: `0x${string}`;
  label: string;
  expiry: number; // unix seconds
}
const V3_MARKETS: V3Market[] = [
  {
    id: "0xaa7ccbe1e14bc627cc92a1df58d8b1ae18ce8fb179b7d08c313e24dc2de0fd5d",
    label: "BTC/USD > $75,000",
    expiry: 1785504700,
  },
];

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
}

interface MarketView {
  yesReserve: bigint;
  noReserve: bigint;
  phase: number;
  expiry: bigint;
}

interface PositionView {
  yes: bigint;
  no: bigint;
  maxBorrowYes: bigint;
  maxBorrowNo: bigint;
}

interface LoanView {
  active: boolean;
  marketId: `0x${string}`;
  betYes: boolean;
  shares: bigint;
  principal: bigint;
  interest: bigint;
  health: bigint;
}

const fmt = (wei: bigint, dp = 2) => (Number(wei) / 1e6).toFixed(dp);
const fmtBps = (bps: bigint) => `${(Number(bps) / 100).toFixed(1)}%`;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export function BetBorrowPanel() {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } =
    useWallet();

  const lending = CONTRACTS.CirqueBetLending;
  const markets = CONTRACTS.MarketsV3;
  const usdc = CONTRACTS.USDC;

  const [supplyMode, setSupplyMode] = useState<SupplyMode>("supply");
  const [supplyAmount, setSupplyAmount] = useState("");
  const [selMarket, setSelMarket] = useState<`0x${string}`>(V3_MARKETS[0]?.id ?? ZERO_ADDR);
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
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const refresh = useCallback(async () => {
    if (!lending || !markets) return;
    try {
      const [pv, borrowed, avail, ts, bad, minDepth] = (await Promise.all([
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalPoolValueUSDC" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalBorrowedPrincipal" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "availableUSDC" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalShares" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "totalBadDebtRealizedUSDC" }),
        publicClient.readContract({ address: lending, abi: cirqueBetLendingAbi, functionName: "MIN_POOL_DEPTH" }),
      ])) as bigint[];
      setStats({ totalPoolValue: pv, totalBorrowed: borrowed, available: avail, totalShares: ts, badDebt: bad, minPoolDepth: minDepth });

      // Selected market reserves/phase.
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
    } catch (e) {
      console.error("bet-borrow refresh failed", e);
    }
  }, [lending, markets, usdc, publicClient, address, selMarket]);

  useEffect(() => { void refresh(); }, [refresh]);

  const needsConnect = !address || !isOnSupportedChain;

  async function ensureApproved(spender: `0x${string}`, needed: bigint) {
    if (!walletClient || !address) return;
    const allowance = (await publicClient.readContract({
      address: usdc, abi: usdcAbi, functionName: "allowance", args: [address, spender],
    })) as bigint;
    if (allowance >= needed) return;
    setStatus("approving");
    const hash = await walletClient.writeContract({
      address: usdc, abi: usdcAbi, functionName: "approve",
      args: [spender, 2n ** 256n - 1n], chain: walletClient.chain, account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function run(fn: () => Promise<`0x${string}`>, after?: () => void) {
    if (!walletClient || !address) return;
    setError(undefined); setTxHash(undefined);
    try {
      setStatus("submitting");
      const hash = await fn();
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success");
      after?.();
      await refresh();
    } catch (e) {
      setStatus("error");
      setError(humanizeError(e));
    }
  }

  async function doSupply() {
    const wei = parseUnits(supplyAmount || "0", 6);
    if (wei === 0n) { setError("amount required"); return; }
    if (supplyMode === "supply") await ensureApproved(lending!, wei);
    await run(
      () => walletClient!.writeContract({
        address: lending!, abi: cirqueBetLendingAbi,
        functionName: supplyMode === "supply" ? "supplyUSDC" : "withdrawUSDC",
        args: [wei], chain: walletClient!.chain, account: walletClient!.account!,
      }),
      () => setSupplyAmount(""),
    );
  }

  async function doTrade() {
    const wei = parseUnits(tradeAmount || "0", 6);
    if (wei === 0n) { setError("amount required"); return; }
    await ensureApproved(markets!, wei);
    await run(
      () => walletClient!.writeContract({
        address: markets!, abi: marketsAbi, functionName: "buy",
        args: [selMarket, tradeSide === "yes" ? 0 : 1, wei, 0n],
        chain: walletClient!.chain, account: walletClient!.account!,
      }),
      () => setTradeAmount(""),
    );
  }

  async function doApproveOperator() {
    await run(() => walletClient!.writeContract({
      address: markets!, abi: marketsV3ShareAbi, functionName: "setShareOperator",
      args: [lending!, true], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  async function doBorrow() {
    if (!pos) return;
    const wei = parseUnits(borrowAmount || "0", 6);
    if (wei === 0n) { setError("amount required"); return; }
    const shares = borrowSide === "yes" ? pos.yes : pos.no;
    await run(
      () => walletClient!.writeContract({
        address: lending!, abi: cirqueBetLendingAbi, functionName: "borrowAgainstBet",
        args: [selMarket, borrowSide === "yes", shares, wei],
        chain: walletClient!.chain, account: walletClient!.account!,
      }),
      () => setBorrowAmount(""),
    );
  }

  async function doRepay() {
    await ensureApproved(lending!, (loan?.principal ?? 0n) + (loan?.interest ?? 0n) + 1_000n);
    await run(() => walletClient!.writeContract({
      address: lending!, abi: cirqueBetLendingAbi, functionName: "repayBet",
      args: [], chain: walletClient!.chain, account: walletClient!.account!,
    }));
  }

  const market = useMemo(() => V3_MARKETS.find((m) => m.id === selMarket), [selMarket]);
  const eligible = mkt && stats
    ? mkt.yesReserve >= stats.minPoolDepth && mkt.noReserve >= stats.minPoolDepth
    : false;
  const maxBorrowSel = pos ? (borrowSide === "yes" ? pos.maxBorrowYes : pos.maxBorrowNo) : 0n;
  const sharesSel = pos ? (borrowSide === "yes" ? pos.yes : pos.no) : 0n;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-line">
      {/* ── Pool: supply / withdraw ── */}
      <div className="bg-bg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-[18px]">Lending pool</h3>
          <Toggle a="supply" b="withdraw" value={supplyMode} onChange={setSupplyMode} />
        </div>
        <Stat label="pool value" value={`${stats ? fmt(stats.totalPoolValue) : "—"} USDC`} />
        <Stat label="idle (borrowable)" value={`${stats ? fmt(stats.available) : "—"} USDC`} />
        <Stat label="out on loan" value={`${stats ? fmt(stats.totalBorrowed) : "—"} USDC`} />
        {stats && stats.badDebt > 0n && (
          <Stat label="bad debt realized" value={`${fmt(stats.badDebt)} USDC`} />
        )}
        <Stat label="your pool claim" value={`${fmt(poolClaim)} USDC`} />
        <div className="mt-4">
          <input
            value={supplyAmount}
            onChange={(e) => setSupplyAmount(e.target.value)}
            inputMode="decimal" placeholder="0.00"
            className="w-full bg-bg-elev/40 border border-line/60 px-3 py-2 text-[15px] outline-none focus:border-accent/60"
          />
          <div className="caption text-2xs text-fg-dim mt-1">
            {supplyMode === "supply"
              ? `wallet: ${fmt(usdcBal)} USDC · earns interest from borrowers`
              : `your shares: ${fmt(poolShares, 0)} · claim ${fmt(poolClaim)} USDC`}
          </div>
          <ActionButton
            onClick={needsConnect ? (address ? () => switchChain() : connect) : doSupply}
            disabled={status === "approving" || status === "submitting"}
            label={needsConnect ? (address ? "Switch to Arc" : "Connect") : supplyMode === "supply" ? "Supply USDC" : "Withdraw"}
          />
        </div>
      </div>

      {/* ── Position + borrow ── */}
      <div className="bg-bg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-[18px]">Borrow against a bet</h3>
          <select
            value={selMarket}
            onChange={(e) => setSelMarket(e.target.value as `0x${string}`)}
            className="bg-bg-elev/40 border border-line/60 px-2 py-1 text-2xs outline-none"
          >
            {V3_MARKETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        {!eligible && (
          <div className="mb-3 border border-amber-500/30 bg-amber-500/5 p-2 text-2xs text-amber-300/80">
            Market too shallow to borrow against (needs ≥ {stats ? fmt(stats.minPoolDepth, 0) : "—"} USDC
            per side). Buy into it below to deepen, or pick another market.
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
            <Toggle a="yes" b="no" value={tradeSide} onChange={setTradeSide} small />
            <input
              value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)}
              inputMode="decimal" placeholder="buy amt USDC"
              className="flex-1 bg-bg-elev/40 border border-line/60 px-2 py-1 text-[13px] outline-none focus:border-accent/60"
            />
            <button
              onClick={needsConnect ? (address ? () => switchChain() : connect) : doTrade}
              disabled={status === "approving" || status === "submitting"}
              className="px-3 py-1 text-2xs border border-line hover:border-accent/60 disabled:opacity-40"
            >buy</button>
          </div>
        </div>

        {/* borrow */}
        <div className="flex items-center gap-2 mb-2">
          <Toggle a="yes" b="no" value={borrowSide} onChange={setBorrowSide} small />
          <span className="caption text-2xs text-fg-dim">
            max borrow {fmt(maxBorrowSel)} USDC {sharesSel === 0n && "· no position"}
          </span>
        </div>
        {!operatorOk && address && (
          <div className="mb-2 text-2xs text-fg-dim">
            Approve the pool to custody your shares once:{" "}
            <button onClick={doApproveOperator} className="text-accent underline">approve operator</button>
          </div>
        )}
        <input
          value={borrowAmount} onChange={(e) => setBorrowAmount(e.target.value)}
          inputMode="decimal" placeholder="0.00"
          className="w-full bg-bg-elev/40 border border-line/60 px-3 py-2 text-[15px] outline-none focus:border-accent/60"
        />
        <div className="caption text-2xs text-fg-dim mt-1">
          40% max LTV · depth-capped mark · 5% APY
        </div>
        <ActionButton
          onClick={needsConnect ? (address ? () => switchChain() : connect) : doBorrow}
          disabled={!operatorOk || sharesSel === 0n || !eligible || status === "approving" || status === "submitting"}
          label={needsConnect ? (address ? "Switch to Arc" : "Connect") : "Borrow USDC"}
        />

        {/* active loan */}
        {loan?.active && (
          <div className="mt-4 border border-accent/30 bg-accent/5 p-3">
            <div className="caption text-2xs text-accent mb-2">active loan</div>
            <Stat label="borrowed" value={`${fmt(loan.principal)} USDC`} small />
            <Stat label="interest owed" value={`${fmt(loan.interest, 4)} USDC`} small />
            <Stat label="collateral" value={`${fmt(loan.shares)} ${loan.betYes ? "YES" : "NO"}`} small />
            <Stat label="health (LTV)" value={fmtBps(loan.health)} small />
            <button
              onClick={needsConnect ? (address ? () => switchChain() : connect) : doRepay}
              disabled={status === "approving" || status === "submitting"}
              className="mt-2 w-full py-2 text-2xs border border-line hover:border-accent/60 disabled:opacity-40"
            >Repay &amp; reclaim position</button>
          </div>
        )}
      </div>

      {/* status row */}
      {(status === "success" || status === "error" || status === "approving" || status === "submitting") && (
        <div className="lg:col-span-2 bg-bg px-5 py-3 text-2xs">
          {status === "approving" && <span className="text-fg-dim">approving…</span>}
          {status === "submitting" && <span className="text-fg-dim">submitting…</span>}
          {status === "success" && (
            <span className="text-emerald-400">
              done.{" "}
              {txHash && <a className="underline" href={txUrl(txHash)} target="_blank" rel="noreferrer">view tx</a>}
            </span>
          )}
          {status === "error" && <span className="text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${small ? "py-0.5" : "py-1"} border-b border-line/30 last:border-0`}>
      <span className="caption text-2xs text-fg-dim">{label}</span>
      <span className={small ? "text-[13px]" : "text-[14px]"}>{value}</span>
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

function Toggle<T extends string>({ a, b, value, onChange, small }: { a: T; b: T; value: T; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`inline-flex border border-line/60 ${small ? "text-2xs" : "text-2xs"}`}>
      {[a, b].map((opt) => (
        <button
          key={opt} onClick={() => onChange(opt)}
          className={`px-2.5 py-1 ${value === opt ? "bg-accent/90 text-bg" : "text-fg-dim hover:text-fg"}`}
        >{opt}</button>
      ))}
    </div>
  );
}
