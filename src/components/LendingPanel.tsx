"use client";

import { useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";
import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, addrUrl, txUrl } from "@/lib/chain";
import { usdcAbi, cirqueLendingAbi, attestedBtcOracleAbi, cirBtcAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";

type SupplyMode = "supply" | "withdraw";
type BorrowMode = "borrow" | "repay";
type Status = "idle" | "approving" | "submitting" | "success" | "error";

interface PoolStats {
  btcPrice18: bigint;
  btcUpdatedAt: bigint;
  totalPoolValue: bigint;
  totalBorrowed: bigint;
  availableUSDC: bigint;
  totalShares: bigint;
  cirBTCPaused: boolean;
  cirBTCBlacklisted: boolean;
  cirBTCSupply: bigint;
}

interface UserState {
  cirBTCBalance: bigint;
  usdcBalance: bigint;
  shares: bigint;
  positionValueUSDC: bigint;
  hasLoan: boolean;
  loanCollateral: bigint;
  loanPrincipal: bigint;
  loanHealth: bigint;
  loanInterest: bigint;
}

const fmtUSDC = (wei: bigint) => (Number(wei) / 1e6).toFixed(2);
const fmtCirBTC = (wei: bigint) => (Number(wei) / 1e8).toFixed(6);
const fmtBTCPrice = (price18: bigint) => (Number(price18) / 1e18).toFixed(2);
const fmtBps = (bps: bigint) => `${(Number(bps) / 100).toFixed(2)}%`;

export function LendingPanel() {
  const { address, publicClient, walletClient, isOnSupportedChain, connect, switchChain } =
    useWallet();

  const lending = CONTRACTS.CirqueLending;
  const oracle = CONTRACTS.AttestedBTCOracle;
  const cirbtc = CONTRACTS.cirBTC;
  const usdc = CONTRACTS.USDC;

  // Two independent widget states so the supply ↔ withdraw toggle on the
  // left doesn't blank the borrow ↔ repay toggle on the right (and vice
  // versa). Each widget owns its own mode + input.
  const [supplyMode, setSupplyMode] = useState<SupplyMode>("supply");
  const [borrowMode, setBorrowMode] = useState<BorrowMode>("borrow");
  const [supplyAmount, setSupplyAmount] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [stats, setStats] = useState<PoolStats | undefined>();
  const [user, setUser] = useState<UserState | undefined>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Refresh wall-clock every 5s for oracle freshness display.
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!lending || !oracle || !cirbtc) return;
    try {
      const [price, poolValue, borrowed, idle, total, paused, supply] =
        await Promise.all([
          publicClient.readContract({
            address: oracle, abi: attestedBtcOracleAbi, functionName: "getBTCPrice",
          }) as Promise<[bigint, bigint]>,
          publicClient.readContract({
            address: lending, abi: cirqueLendingAbi, functionName: "totalPoolValueUSDC",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: lending, abi: cirqueLendingAbi, functionName: "totalBorrowedPrincipal",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: lending, abi: cirqueLendingAbi, functionName: "availableUSDC",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: lending, abi: cirqueLendingAbi, functionName: "totalShares",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: cirbtc, abi: cirBtcAbi, functionName: "paused",
          }) as Promise<boolean>,
          publicClient.readContract({
            address: cirbtc, abi: cirBtcAbi, functionName: "totalSupply",
          }) as Promise<bigint>,
        ]);
      const blacklisted = (await publicClient.readContract({
        address: cirbtc, abi: cirBtcAbi, functionName: "isBlacklisted", args: [lending],
      })) as boolean;

      setStats({
        btcPrice18: price[0],
        btcUpdatedAt: price[1],
        totalPoolValue: poolValue,
        totalBorrowed: borrowed,
        availableUSDC: idle,
        totalShares: total,
        cirBTCPaused: paused,
        cirBTCBlacklisted: blacklisted,
        cirBTCSupply: supply,
      });

      if (address) {
        const [cirBal, usdcBal, sh, posVal, loan, health, interest] =
          await Promise.all([
            publicClient.readContract({
              address: cirbtc, abi: cirBtcAbi, functionName: "balanceOf", args: [address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: lending, abi: cirqueLendingAbi, functionName: "shares", args: [address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: lending, abi: cirqueLendingAbi, functionName: "balanceOfUSDC", args: [address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: lending, abi: cirqueLendingAbi, functionName: "loans", args: [address],
            }) as Promise<[bigint, bigint, bigint, boolean]>,
            publicClient.readContract({
              address: lending, abi: cirqueLendingAbi, functionName: "healthBps", args: [address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: lending, abi: cirqueLendingAbi, functionName: "interestOwed", args: [address],
            }) as Promise<bigint>,
          ]);
        setUser({
          cirBTCBalance: cirBal,
          usdcBalance: usdcBal,
          shares: sh,
          positionValueUSDC: posVal,
          hasLoan: loan[3],
          loanCollateral: loan[0],
          loanPrincipal: loan[1],
          loanHealth: health,
          loanInterest: interest,
        });
      } else {
        setUser(undefined);
      }
    } catch (e) {
      console.warn("LendingPanel refresh failed:", e);
    }
  }, [address, lending, oracle, cirbtc, usdc, publicClient]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const oracleAgeSec = stats ? now - Number(stats.btcUpdatedAt) : 0;
  const oracleStale = oracleAgeSec > 3600;
  const integrityOK =
    stats && !stats.cirBTCPaused && !stats.cirBTCBlacklisted && !oracleStale;
  const utilisationBps =
    stats && stats.totalPoolValue > 0n
      ? (stats.totalBorrowed * 10000n) / stats.totalPoolValue
      : 0n;

  // ───────────────────────── Actions ──────────────────────────

  async function ensureApproved(
    token: `0x${string}`,
    spender: `0x${string}`,
    needed: bigint,
  ) {
    if (!address || !walletClient) return;
    const allowance = (await publicClient.readContract({
      address: token,
      abi: usdcAbi,
      functionName: "allowance",
      args: [address, spender],
    })) as bigint;
    if (allowance >= needed) return;
    setStatus("approving");
    const hash = await walletClient.writeContract({
      address: token,
      abi: usdcAbi,
      functionName: "approve",
      args: [spender, 2n ** 256n - 1n],
      chain: walletClient.chain,
      account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function doSupply() {
    if (!walletClient || !address || !lending || !usdc) return;
    setError(undefined);
    setTxHash(undefined);
    const wei = parseUnits(supplyAmount || "0", 6);
    if (wei === 0n) {
      setError("amount required");
      return;
    }
    try {
      await ensureApproved(usdc, lending, wei);
      setStatus("submitting");
      const hash = await walletClient.writeContract({
        address: lending, abi: cirqueLendingAbi, functionName: "supplyUSDC",
        args: [wei], chain: walletClient.chain, account: walletClient.account!,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success");
      setSupplyAmount("");
      await refresh();
    } catch (e) {
      setStatus("error");
      setError(humanizeError(e));
    }
  }

  async function doWithdraw() {
    if (!walletClient || !address || !lending) return;
    setError(undefined);
    setTxHash(undefined);
    const wei = parseUnits(supplyAmount || "0", 6);
    if (wei === 0n) {
      setError("amount required");
      return;
    }
    try {
      setStatus("submitting");
      const hash = await walletClient.writeContract({
        address: lending, abi: cirqueLendingAbi, functionName: "withdrawUSDC",
        args: [wei], chain: walletClient.chain, account: walletClient.account!,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success");
      setSupplyAmount("");
      await refresh();
    } catch (e) {
      setStatus("error");
      setError(humanizeError(e));
    }
  }

  async function doBorrow() {
    if (!walletClient || !address || !lending || !cirbtc) return;
    setError(undefined);
    setTxHash(undefined);
    const collateralWei = parseUnits(collateralAmount || "0", 8);
    const borrowWei = parseUnits(borrowAmount || "0", 6);
    if (collateralWei === 0n || borrowWei === 0n) {
      setError("collateral and borrow amount required");
      return;
    }
    try {
      await ensureApproved(cirbtc, lending, collateralWei);
      setStatus("submitting");
      const hash = await walletClient.writeContract({
        address: lending, abi: cirqueLendingAbi, functionName: "borrow",
        args: [collateralWei, borrowWei],
        chain: walletClient.chain, account: walletClient.account!,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success");
      setCollateralAmount("");
      setBorrowAmount("");
      await refresh();
    } catch (e) {
      setStatus("error");
      setError(humanizeError(e));
    }
  }

  async function doRepay() {
    if (!walletClient || !address || !lending || !usdc || !user) return;
    setError(undefined);
    setTxHash(undefined);
    const owed = user.loanPrincipal + user.loanInterest;
    try {
      // Pad allowance slightly to cover interest accrued between now and tx mine.
      await ensureApproved(usdc, lending, (owed * 110n) / 100n);
      setStatus("submitting");
      const hash = await walletClient.writeContract({
        address: lending, abi: cirqueLendingAbi, functionName: "repay",
        args: [], chain: walletClient.chain, account: walletClient.account!,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success");
      await refresh();
    } catch (e) {
      setStatus("error");
      setError(humanizeError(e));
    }
  }

  // ───────────────────────── Render ──────────────────────────

  return (
    <div className="space-y-10">
      {/* ─── Pool stats banner ─── */}
      <section className="border border-line bg-bg-elev/40 p-5">
        <div className="flex items-baseline gap-3 mb-4 flex-wrap">
          <span className="caption text-accent">pool · live</span>
          <span className="text-2xs text-fg-dim">
            cirque lending · v0.5 alpha
          </span>
          <a
            href={addrUrl(lending ?? "")}
            target="_blank"
            rel="noreferrer"
            className="text-2xs text-fg-dim hover:text-accent tnum ml-auto"
          >
            contract ↗
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-6 text-[12.5px]">
          <Stat
            label="btc / usd"
            value={stats ? `$${fmtBTCPrice(stats.btcPrice18)}` : "…"}
            sub={
              stats
                ? oracleStale
                  ? `STALE · ${Math.floor(oracleAgeSec / 60)}m ago`
                  : oracleAgeSec < 60
                    ? `${oracleAgeSec}s ago`
                    : `${Math.floor(oracleAgeSec / 60)}m ago`
                : undefined
            }
            warn={oracleStale}
          />
          <Stat
            label="pool size"
            value={stats ? `$${fmtUSDC(stats.totalPoolValue)}` : "…"}
            sub={stats ? `${fmtUSDC(stats.availableUSDC)} idle` : undefined}
          />
          <Stat
            label="utilisation"
            value={stats ? `${(Number(utilisationBps) / 100).toFixed(1)}%` : "…"}
            sub={stats ? `${fmtUSDC(stats.totalBorrowed)} borrowed` : undefined}
          />
          <Stat
            label="cirbtc integrity"
            value={integrityOK ? "● healthy" : "● degraded"}
            warn={!integrityOK}
            sub={
              stats
                ? stats.cirBTCPaused
                  ? "paused"
                  : stats.cirBTCBlacklisted
                    ? "blacklisted"
                    : oracleStale
                      ? "oracle stale"
                      : "checks passing"
                : undefined
            }
          />
        </div>
      </section>

      {/* ─── Connect prompt ─── */}
      {!address && (
        <section className="border border-line bg-bg-elev/40 p-6 text-center">
          <p className="text-[13px] text-fg-mute mb-4">
            Connect a wallet to supply USDC or borrow against cirBTC.
          </p>
          <button
            onClick={connect}
            className="px-4 py-2 border border-accent/60 text-accent text-[12.5px] hover:bg-accent hover:text-bg transition-colors"
          >
            connect wallet
          </button>
        </section>
      )}

      {address && !isOnSupportedChain && (
        <section className="border border-down/40 p-6 text-center">
          <p className="text-2xs text-down mb-3">switch to Arc testnet to continue</p>
          <button
            onClick={() => switchChain()}
            className="px-3 py-1.5 border border-accent/60 text-accent text-2xs"
          >
            switch network
          </button>
        </section>
      )}

      {address && isOnSupportedChain && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-line">
          {/* ─── LEFT: supply / withdraw USDC ─── */}
          <div className="bg-bg p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="caption">supply usdc · earn yield</h2>
              <ModeToggle
                current={supplyMode}
                options={[
                  { value: "supply", label: "supply" },
                  { value: "withdraw", label: "withdraw" },
                ]}
                onChange={(v) => {
                  setSupplyMode(v);
                  setSupplyAmount("");
                  setError(undefined);
                  setTxHash(undefined);
                }}
              />
            </div>

            {supplyMode === "supply" && (
              <>
                <p className="text-2xs text-fg-dim leading-relaxed mb-4">
                  Deposit USDC into the pool, receive shares. Earns yield as
                  borrowers repay 5% APY interest. Per-user cap: 1,000 USDC.
                </p>
                <AmountInput
                  value={supplyAmount}
                  onChange={setSupplyAmount}
                  symbol="USDC"
                  balanceLabel="your balance"
                  balanceValue={user ? fmtUSDC(user.usdcBalance) : "…"}
                  setMax={() => user && setSupplyAmount(fmtUSDC(user.usdcBalance))}
                />
                <ActionButton
                  onClick={doSupply}
                  status={status}
                  disabled={!supplyAmount.trim() || status === "approving" || status === "submitting"}
                >
                  supply →
                </ActionButton>
              </>
            )}

            {supplyMode === "withdraw" && (
              <>
                <p className="text-2xs text-fg-dim leading-relaxed mb-4">
                  Burn shares for USDC at the current per-share value (principal +
                  your slice of accrued interest). Subject to pool utilisation.
                </p>
                <AmountInput
                  value={supplyAmount}
                  onChange={setSupplyAmount}
                  symbol="shares"
                  balanceLabel="your shares"
                  balanceValue={user ? fmtUSDC(user.shares) : "…"}
                  setMax={() => user && setSupplyAmount(fmtUSDC(user.shares))}
                />
                <ActionButton
                  onClick={doWithdraw}
                  status={status}
                  disabled={!supplyAmount.trim() || status === "submitting"}
                >
                  withdraw →
                </ActionButton>
              </>
            )}

            {/* Your supplier position */}
            {user && user.shares > 0n && (
              <div className="mt-6 pt-5 border-t border-line/50 text-2xs space-y-1.5">
                <div className="caption mb-2">your position</div>
                <div className="flex justify-between"><span className="text-fg-dim">shares</span><span className="tnum">{fmtUSDC(user.shares)}</span></div>
                <div className="flex justify-between"><span className="text-fg-dim">redeemable</span><span className="tnum">{fmtUSDC(user.positionValueUSDC)} USDC</span></div>
                {user.positionValueUSDC > user.shares && (
                  <div className="flex justify-between">
                    <span className="text-fg-dim">accrued yield</span>
                    <span className="tnum text-up">
                      +{fmtUSDC(user.positionValueUSDC - user.shares)} USDC
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── RIGHT: borrow / repay against cirBTC ─── */}
          <div className="bg-bg p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="caption">borrow usdc · lock cirbtc</h2>
              <ModeToggle
                current={borrowMode}
                options={[
                  { value: "borrow", label: "borrow" },
                  { value: "repay", label: "repay" },
                ]}
                onChange={(v) => {
                  setBorrowMode(v);
                  setCollateralAmount("");
                  setBorrowAmount("");
                  setError(undefined);
                  setTxHash(undefined);
                }}
              />
            </div>

            {/* No cirBTC → faucet hint */}
            {user && user.cirBTCBalance === 0n && !user.hasLoan && borrowMode === "borrow" && (
              <div className="border border-line/60 p-3 mb-4 text-2xs text-fg-mute leading-relaxed">
                you have 0 cirBTC.{" "}
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  claim from Circle&apos;s faucet ↗
                </a>
              </div>
            )}

            {borrowMode === "borrow" && (
              <>
                <p className="text-2xs text-fg-dim leading-relaxed mb-4">
                  Lock cirBTC, draw USDC at 5% APY flat. Max 50% LTV at
                  origination; liquidated above 65%. Per-user collateral cap:
                  1 cirBTC.
                </p>
                <AmountInput
                  value={collateralAmount}
                  onChange={setCollateralAmount}
                  symbol="cirBTC"
                  balanceLabel="your balance"
                  balanceValue={user ? fmtCirBTC(user.cirBTCBalance) : "…"}
                  setMax={() => user && setCollateralAmount(fmtCirBTC(user.cirBTCBalance))}
                />
                <div className="mt-3">
                  <AmountInput
                    value={borrowAmount}
                    onChange={setBorrowAmount}
                    symbol="USDC"
                    balanceLabel="max borrow"
                    balanceValue={
                      stats && collateralAmount
                        ? (
                            (Number(collateralAmount) *
                              (Number(stats.btcPrice18) / 1e18) *
                              0.5) || 0
                          ).toFixed(2)
                        : "…"
                    }
                    setMax={() => {
                      if (!stats || !collateralAmount) return;
                      const max =
                        Number(collateralAmount) * (Number(stats.btcPrice18) / 1e18) * 0.5;
                      setBorrowAmount(max.toFixed(2));
                    }}
                  />
                </div>
                <ActionButton
                  onClick={doBorrow}
                  status={status}
                  disabled={
                    !collateralAmount.trim() ||
                    !borrowAmount.trim() ||
                    status === "approving" ||
                    status === "submitting" ||
                    !!user?.hasLoan
                  }
                >
                  {user?.hasLoan ? "repay existing loan first" : "borrow →"}
                </ActionButton>
              </>
            )}

            {borrowMode === "repay" && (
              <>
                {!user?.hasLoan ? (
                  <p className="text-2xs text-fg-dim leading-relaxed">
                    you have no active loan.
                  </p>
                ) : (
                  <>
                    <p className="text-2xs text-fg-dim leading-relaxed mb-4">
                      Repay principal + accrued interest in USDC to unlock
                      your cirBTC collateral.
                    </p>
                    <div className="text-2xs space-y-1.5">
                      <div className="flex justify-between"><span className="text-fg-dim">collateral locked</span><span className="tnum">{fmtCirBTC(user.loanCollateral)} cirBTC</span></div>
                      <div className="flex justify-between"><span className="text-fg-dim">principal</span><span className="tnum">{fmtUSDC(user.loanPrincipal)} USDC</span></div>
                      <div className="flex justify-between"><span className="text-fg-dim">interest accrued</span><span className="tnum">{fmtUSDC(user.loanInterest)} USDC</span></div>
                      <div className="flex justify-between border-t border-line/50 pt-1.5 mt-2"><span>total owed</span><span className="tnum">{fmtUSDC(user.loanPrincipal + user.loanInterest)} USDC</span></div>
                      <div className="flex justify-between"><span className="text-fg-dim">health</span><span className={user.loanHealth > 5000n ? "tnum text-down" : "tnum text-up"}>{fmtBps(user.loanHealth)}</span></div>
                    </div>
                    <ActionButton
                      onClick={doRepay}
                      status={status}
                      disabled={status === "approving" || status === "submitting"}
                    >
                      repay full →
                    </ActionButton>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Tx feedback */}
      {(txHash || error) && (
        <div
          className={
            "border p-4 text-2xs " +
            (error
              ? "border-down/40 text-down"
              : "border-accent/40 text-accent")
          }
        >
          {error && <span>⚠ {error}</span>}
          {!error && txHash && (
            <span>
              ✓ transaction confirmed ·{" "}
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="hover:underline tnum"
              >
                view on ArcScan ↗
              </a>
            </span>
          )}
        </div>
      )}

      {/* Markets pivot */}
      <section className="border border-dashed border-line/60 p-6 text-[13px] text-fg-mute leading-relaxed">
        <p>
          After borrowing USDC, place a bet on one of Registrai&apos;s 12
          live prediction markets.{" "}
          <Link
            href="/markets/"
            className="text-accent hover:underline"
          >
            browse markets →
          </Link>
        </p>
        <p className="mt-3 text-2xs text-fg-dim">
          Coming in v0.5 beta: atomic borrow-and-bet in a single transaction.
          v0.6: cirBTC-denominated market settlement.
        </p>
      </section>
    </div>
  );
}

// ───────────────────────── Small UI helpers ──────────────────────────

function Stat({
  label, value, sub, warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="caption mb-1.5">{label}</div>
      <div className={"text-[15px] tnum " + (warn ? "text-down" : "text-fg")}>
        {value}
      </div>
      {sub && (
        <div className={"text-2xs mt-0.5 " + (warn ? "text-down/70" : "text-fg-dim")}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ModeToggle<T extends string>({
  current,
  options,
  onChange,
}: {
  current: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 text-2xs">
      {options.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={
              "px-2 py-1 border " +
              (active
                ? "border-accent text-accent"
                : "border-line/60 text-fg-dim hover:text-fg")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AmountInput({
  value, onChange, symbol, balanceLabel, balanceValue, setMax,
}: {
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  balanceLabel: string;
  balanceValue: string;
  setMax: () => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5 text-2xs text-fg-dim">
        <span>{balanceLabel}</span>
        <button
          onClick={setMax}
          className="hover:text-accent tnum"
        >
          {balanceValue} {symbol} · max
        </button>
      </div>
      <div className="flex items-center border border-line bg-bg">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.0"
          className="flex-1 bg-transparent px-3 py-2.5 text-[14px] tnum focus:outline-none"
        />
        <span className="px-3 text-2xs text-fg-dim border-l border-line">{symbol}</span>
      </div>
    </div>
  );
}

function ActionButton({
  onClick, status, disabled, children,
}: {
  onClick: () => void;
  status: Status;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-3 w-full px-4 py-2.5 border border-accent/60 text-accent text-[13px] hover:bg-accent hover:text-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {status === "approving"
        ? "approving…"
        : status === "submitting"
          ? "submitting…"
          : children}
    </button>
  );
}
