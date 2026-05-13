"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUnits, type Hex } from "viem";
import type { Market } from "@/lib/types";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { marketsAbi, usdcAbi } from "@/lib/abi";

type Mode = "buy" | "sell";
type Status = "idle" | "approving" | "submitting" | "success" | "error";

/**
 * Trade panel for binary FPMM markets. Three modes:
 *   - buy: deposit USDC, receive YES or NO shares
 *   - sell: burn YES or NO shares, receive USDC
 *   - redeem: after resolution, winning shares pay 1 USDC each
 * Mirrors Markets.sol math exactly so the quote matches what the tx returns.
 */
export function TradePanel({ market }: { market: Market }) {
  const { address, isOnArc, walletClient, publicClient, connect, switchToArc } = useWallet();

  const [mode, setMode] = useState<Mode>("buy");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [collateral, setCollateral] = useState<string>("1");
  const [sharesIn, setSharesIn] = useState<string>("1");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const [balance, setBalance] = useState<bigint | undefined>();
  const [yesShares, setYesShares] = useState<bigint | undefined>();
  const [noShares, setNoShares] = useState<bigint | undefined>();

  const expired = market.expiry * 1000 <= Date.now();
  const resolved = market.phase === "resolved";

  // Load balances + shares.
  useEffect(() => {
    if (!address) {
      setBalance(undefined);
      setYesShares(undefined);
      setNoShares(undefined);
      return;
    }
    Promise.all([
      publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "yesBalance",
        args: [market.id, address],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "noBalance",
        args: [market.id, address],
      }) as Promise<bigint>,
    ])
      .then(([bal, ys, ns]) => {
        setBalance(bal);
        setYesShares(ys);
        setNoShares(ns);
      })
      .catch(() => undefined);
  }, [address, publicClient, market.id]);

  // Quote math, in float space — same as the contract's integer math at scale.
  const dx = Number(collateral) || 0;
  const dy = Number(sharesIn) || 0;
  const yes = market.yesReserve / 1e6;
  const no = market.noReserve / 1e6;
  const totalPool = yes + no;
  const yesPriceNow = totalPool > 0 ? no / totalPool : 0.5;
  const noPriceNow = totalPool > 0 ? yes / totalPool : 0.5;

  let buySharesOut = 0;
  let buyAvgPrice = 0;
  if (dx > 0 && totalPool > 0) {
    const yesAfter = yes + dx;
    const noAfter = no + dx;
    const k = yes * no;
    if (side === "yes") buySharesOut = yesAfter - k / noAfter;
    else buySharesOut = noAfter - k / yesAfter;
    buyAvgPrice = buySharesOut > 0 ? dx / buySharesOut : 0;
  }

  let sellCollateralOut = 0;
  let sellAvgPrice = 0;
  if (dy > 0 && totalPool > 0) {
    const yesPostSell = side === "yes" ? yes + dy : yes;
    const noPostSell = side === "no" ? no + dy : no;
    const k = yes * no;
    const a = yesPostSell;
    const b = noPostSell;
    const disc = (a + b) * (a + b) - 4 * (a * b - k);
    if (disc >= 0) {
      sellCollateralOut = Math.max(0, (a + b - Math.sqrt(disc)) / 2);
      sellAvgPrice = sellCollateralOut > 0 ? sellCollateralOut / dy : 0;
    }
  }

  const collateralWei = useMemo(() => {
    if (!Number.isFinite(dx) || dx <= 0) return 0n;
    return parseUnits(collateral, 6);
  }, [collateral, dx]);

  const sharesInWei = useMemo(() => {
    if (!Number.isFinite(dy) || dy <= 0) return 0n;
    return parseUnits(sharesIn, 6);
  }, [sharesIn, dy]);

  const userSharesOnSide = side === "yes" ? yesShares : noShares;
  const hasUserShares = (userSharesOnSide ?? 0n) > 0n;

  // ----- Actions -----

  async function refreshLive(): Promise<void> {
    if (!address) return;
    const [bal, ys, ns] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "yesBalance",
        args: [market.id, address],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "noBalance",
        args: [market.id, address],
      }) as Promise<bigint>,
    ]);
    setBalance(bal);
    setYesShares(ys);
    setNoShares(ns);
  }

  async function onBuy() {
    if (!address || !walletClient) return;
    setError(undefined);
    setTxHash(undefined);
    setStatus("idle");
    try {
      const allowance = (await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: usdcAbi,
        functionName: "allowance",
        args: [address, CONTRACTS.Markets],
      })) as bigint;
      if (allowance < collateralWei) {
        setStatus("approving");
        const h = await walletClient.writeContract({
          address: CONTRACTS.USDC,
          abi: usdcAbi,
          functionName: "approve",
          args: [CONTRACTS.Markets, collateralWei],
          chain: walletClient.chain,
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setStatus("submitting");
      const minShares = BigInt(Math.floor(buySharesOut * 1e6 * 0.99));
      const outcome = side === "yes" ? 0 : 1;
      const hash = await walletClient.writeContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "buy",
        args: [market.id, outcome, collateralWei, minShares],
        chain: walletClient.chain,
        account: address,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("buy reverted");
      setStatus("success");
      await refreshLive();
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  async function onSell() {
    if (!address || !walletClient) return;
    setError(undefined);
    setTxHash(undefined);
    setStatus("idle");
    try {
      setStatus("submitting");
      const minOut = BigInt(Math.floor(sellCollateralOut * 1e6 * 0.99));
      const outcome = side === "yes" ? 0 : 1;
      const hash = await walletClient.writeContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "sell",
        args: [market.id, outcome, sharesInWei, minOut],
        chain: walletClient.chain,
        account: address,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("sell reverted");
      setStatus("success");
      await refreshLive();
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  async function onResolve() {
    if (!address || !walletClient) return;
    setError(undefined);
    setTxHash(undefined);
    setStatus("idle");
    try {
      setStatus("submitting");
      const hash = await walletClient.writeContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "resolve",
        args: [market.id],
        chain: walletClient.chain,
        account: address,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("resolve reverted");
      setStatus("success");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  async function onRedeem() {
    if (!address || !walletClient) return;
    setError(undefined);
    setTxHash(undefined);
    setStatus("idle");
    try {
      setStatus("submitting");
      const hash = await walletClient.writeContract({
        address: CONTRACTS.Markets,
        abi: marketsAbi,
        functionName: "redeem",
        args: [market.id],
        chain: walletClient.chain,
        account: address,
      });
      setTxHash(hash);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("redeem reverted");
      setStatus("success");
      await refreshLive();
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  // ----- Render -----

  // After resolution: just show redeem panel.
  if (resolved) {
    return (
      <ResolvedPanel
        market={market}
        yesShares={yesShares}
        noShares={noShares}
        canRedeem={!!address && isOnArc}
        onConnect={connect}
        onSwitchChain={switchToArc}
        onRedeem={onRedeem}
        status={status}
        txHash={txHash}
        error={error}
        address={address}
      />
    );
  }

  // Past expiry but not yet resolved: anyone can call resolve().
  if (expired) {
    return (
      <div className="border border-line bg-bg-elev/30 p-5 sm:p-6">
        <div className="caption mb-4">resolve this market</div>
        <p className="text-fg-mute text-[13px] leading-relaxed mb-5">
          The market expired {new Date(market.expiry * 1000).toUTCString()}. Anyone can settle
          it now by reading the attestation at expiry from the oracle.
        </p>
        {!address ? (
          <button
            onClick={connect}
            className="w-full py-3 border border-accent/60 text-accent text-[12.5px] tracking-wide hover:bg-accent hover:text-bg transition-colors"
          >
            connect wallet to settle →
          </button>
        ) : !isOnArc ? (
          <button
            onClick={switchToArc}
            className="w-full py-3 border border-down/60 text-down text-[12.5px] tracking-wide hover:bg-down hover:text-bg transition-colors"
          >
            switch to Arc testnet
          </button>
        ) : (
          <button
            onClick={onResolve}
            disabled={status === "submitting"}
            className="w-full py-3 border border-accent/60 text-accent text-[12.5px] tracking-wide hover:bg-accent hover:text-bg transition-colors disabled:opacity-40"
          >
            {status === "submitting"
              ? "settling…"
              : status === "success"
                ? "✓ settled — refresh"
                : "settle market →"}
          </button>
        )}
        {error && <div className="mt-3 text-2xs text-down">{error}</div>}
      </div>
    );
  }

  return (
    <div className="border border-line bg-bg-elev/30 p-5 sm:p-6">
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-px bg-line mb-4">
        <button
          onClick={() => setMode("buy")}
          className={`bg-bg px-3 py-2 text-[11px] tracking-[0.16em] uppercase transition-colors ${
            mode === "buy" ? "text-accent" : "text-fg-dim hover:text-fg-mute"
          }`}
        >
          buy
        </button>
        <button
          onClick={() => setMode("sell")}
          className={`bg-bg px-3 py-2 text-[11px] tracking-[0.16em] uppercase transition-colors ${
            mode === "sell" ? "text-accent" : "text-fg-dim hover:text-fg-mute"
          }`}
        >
          sell
        </button>
      </div>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <SideButton
          label={`${mode === "buy" ? "buy" : "sell"} YES`}
          price={yesPriceNow}
          active={side === "yes"}
          accent="up"
          onClick={() => setSide("yes")}
        />
        <SideButton
          label={`${mode === "buy" ? "buy" : "sell"} NO`}
          price={noPriceNow}
          active={side === "no"}
          accent="down"
          onClick={() => setSide("no")}
        />
      </div>

      {mode === "buy" ? (
        <BuyForm
          collateral={collateral}
          setCollateral={setCollateral}
          balance={balance}
          sharesOut={buySharesOut}
          avgPrice={buyAvgPrice}
          priceNow={side === "yes" ? yesPriceNow : noPriceNow}
          dx={dx}
        />
      ) : (
        <SellForm
          sharesIn={sharesIn}
          setSharesIn={setSharesIn}
          userShares={userSharesOnSide}
          collateralOut={sellCollateralOut}
          avgPrice={sellAvgPrice}
          dy={dy}
        />
      )}

      {!address ? (
        <button
          onClick={connect}
          className="w-full py-4 border-2 border-accent text-accent text-[14px] font-medium tracking-wide hover:bg-accent hover:text-bg transition-colors"
        >
          connect wallet to {mode} →
        </button>
      ) : !isOnArc ? (
        <button
          onClick={switchToArc}
          className="w-full py-4 border-2 border-down text-down text-[14px] font-medium tracking-wide hover:bg-down hover:text-bg transition-colors"
        >
          switch to Arc testnet
        </button>
      ) : mode === "buy" ? (
        <button
          onClick={onBuy}
          disabled={!collateralWei || status === "approving" || status === "submitting"}
          className={`w-full py-4 border-2 text-[14px] font-medium tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            side === "yes"
              ? "border-up text-up hover:bg-up hover:text-bg"
              : "border-down text-down hover:bg-down hover:text-bg"
          }`}
        >
          {status === "approving"
            ? "approving USDC…"
            : status === "submitting"
              ? "buying…"
              : status === "success"
                ? `✓ bought ${side.toUpperCase()}`
                : `buy ${side.toUpperCase()} · ${dx > 0 ? `${dx} USDC` : "amount"} →`}
        </button>
      ) : (
        <button
          onClick={onSell}
          disabled={!sharesInWei || !hasUserShares || status === "submitting"}
          className={`w-full py-4 border-2 text-[14px] font-medium tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            side === "yes"
              ? "border-up text-up hover:bg-up hover:text-bg"
              : "border-down text-down hover:bg-down hover:text-bg"
          }`}
        >
          {!hasUserShares
            ? `no ${side.toUpperCase()} shares to sell`
            : status === "submitting"
              ? "selling…"
              : status === "success"
                ? `✓ sold ${side.toUpperCase()}`
                : `sell ${side.toUpperCase()} · ${dy > 0 ? `~${sellCollateralOut.toFixed(3)} USDC` : "amount"} →`}
        </button>
      )}

      {error && (
        <div className="mt-3 text-2xs text-down leading-relaxed">
          {error.length > 200 ? `${error.slice(0, 200)}…` : error}
        </div>
      )}

      {txHash && (
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-2xs text-fg-dim hover:text-accent"
        >
          tx: {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
        </a>
      )}

      {/* User position display */}
      {address && (yesShares !== undefined || noShares !== undefined) && (
        <div className="mt-5 pt-4 border-t border-line text-2xs text-fg-dim flex justify-between">
          <span>your YES: {((Number(yesShares ?? 0n)) / 1e6).toFixed(4)}</span>
          <span>your NO: {((Number(noShares ?? 0n)) / 1e6).toFixed(4)}</span>
        </div>
      )}

      <p className="text-2xs text-fg-dim mt-3 leading-relaxed">
        Trades land on Arc testnet. Get test USDC from the{" "}
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
    </div>
  );
}

function BuyForm({
  collateral,
  setCollateral,
  balance,
  sharesOut,
  avgPrice,
  priceNow,
  dx,
}: {
  collateral: string;
  setCollateral: (v: string) => void;
  balance: bigint | undefined;
  sharesOut: number;
  avgPrice: number;
  priceNow: number;
  dx: number;
}) {
  const slippage = avgPrice && priceNow ? (avgPrice - priceNow) / priceNow : 0;
  return (
    <>
      <label className="caption mb-2 flex items-baseline justify-between">
        <span>amount · USDC</span>
        {balance !== undefined && (
          <span className="text-fg-dim normal-case tracking-normal">
            balance: {(Number(balance) / 1e6).toFixed(2)}
          </span>
        )}
      </label>
      <div className="border border-line bg-bg flex items-baseline mb-2">
        <input
          type="number"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
          min="0"
          step="0.5"
          className="flex-1 bg-transparent px-3 py-3 text-[19px] tnum tracking-tightest outline-none focus:border-accent"
        />
        {balance !== undefined && (
          <button
            type="button"
            onClick={() => setCollateral(((Number(balance) / 1e6) * 0.95).toFixed(2))}
            className="text-[10px] text-accent border border-line hover:border-accent px-2 py-0.5 mr-2 transition-colors"
          >
            MAX
          </button>
        )}
        <span className="text-fg-dim text-[11px] px-3">USDC</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {["0.5", "1", "5", "10"].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setCollateral(v)}
            className="px-2 py-0.5 border border-line text-[10px] tnum text-fg-mute hover:border-accent hover:text-accent transition-colors"
          >
            {v}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 text-[12.5px] mb-6">
        <Row label="avg price" value={dx > 0 ? `${(avgPrice * 100).toFixed(2)}¢` : "—"} />
        <Row label="slippage" value={dx > 0 ? `${slippage >= 0 ? "+" : ""}${(slippage * 100).toFixed(2)}%` : "—"} />
        <Row label="shares" value={dx > 0 ? sharesOut.toFixed(2) : "—"} />
        <Row label="if you win" value={dx > 0 ? `+${(sharesOut - dx).toFixed(2)} USDC` : "—"} accent />
      </div>
    </>
  );
}

function SellForm({
  sharesIn,
  setSharesIn,
  userShares,
  collateralOut,
  avgPrice,
  dy,
}: {
  sharesIn: string;
  setSharesIn: (v: string) => void;
  userShares: bigint | undefined;
  collateralOut: number;
  avgPrice: number;
  dy: number;
}) {
  return (
    <>
      <label className="caption mb-2 flex items-baseline justify-between">
        <span>shares to sell</span>
        {userShares !== undefined && (
          <span className="text-fg-dim normal-case tracking-normal">
            you have: {(Number(userShares) / 1e6).toFixed(4)}
          </span>
        )}
      </label>
      <div className="border border-line bg-bg flex items-baseline mb-2">
        <input
          type="number"
          value={sharesIn}
          onChange={(e) => setSharesIn(e.target.value)}
          min="0"
          step="0.5"
          className="flex-1 bg-transparent px-3 py-3 text-[19px] tnum tracking-tightest outline-none focus:border-accent"
        />
        {userShares !== undefined && (
          <button
            type="button"
            onClick={() => setSharesIn((Number(userShares) / 1e6).toFixed(4))}
            className="text-[10px] text-accent border border-line hover:border-accent px-2 py-0.5 mr-2 transition-colors"
          >
            MAX
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 text-[12.5px] mb-6 mt-5">
        <Row label="avg price" value={dy > 0 ? `${(avgPrice * 100).toFixed(2)}¢` : "—"} />
        <Row label="USDC out" value={dy > 0 ? `${collateralOut.toFixed(4)}` : "—"} accent />
      </div>
    </>
  );
}

function ResolvedPanel({
  market,
  yesShares,
  noShares,
  canRedeem,
  onConnect,
  onSwitchChain,
  onRedeem,
  status,
  txHash,
  error,
  address,
}: {
  market: Market;
  yesShares: bigint | undefined;
  noShares: bigint | undefined;
  canRedeem: boolean;
  onConnect: () => void;
  onSwitchChain: () => void;
  onRedeem: () => void;
  status: Status;
  txHash: Hex | undefined;
  error: string | undefined;
  address: `0x${string}` | undefined;
}) {
  const yesWon = market.yesWon === true;
  const userWinning = yesWon ? yesShares : noShares;
  const userLosing = yesWon ? noShares : yesShares;

  return (
    <div className="border border-accent/40 bg-bg-elev/30 p-5 sm:p-6">
      <div className="caption mb-2 text-accent">
        ● resolved · {yesWon ? "YES won" : "NO won"}
      </div>
      <p className="font-serif italic text-fg-mute text-[14px] leading-snug mb-5">
        The attestation at expiry settled this market in favor of{" "}
        <span className={yesWon ? "text-up" : "text-down"}>
          {yesWon ? "YES" : "NO"}
        </span>
        . Holders of the winning side can redeem 1 USDC per share.
      </p>

      {address && (
        <div className="mb-5 space-y-2 text-[13px]">
          <Row
            label="your winning shares"
            value={
              userWinning !== undefined
                ? `${(Number(userWinning) / 1e6).toFixed(4)} ${yesWon ? "YES" : "NO"}`
                : "—"
            }
            accent
          />
          <Row
            label="your losing shares"
            value={
              userLosing !== undefined
                ? `${(Number(userLosing) / 1e6).toFixed(4)} (worthless)`
                : "—"
            }
          />
          <Row
            label="claim value"
            value={
              userWinning !== undefined
                ? `${(Number(userWinning) / 1e6).toFixed(4)} USDC`
                : "—"
            }
            accent
          />
        </div>
      )}

      {!address ? (
        <button
          onClick={onConnect}
          className="w-full py-3 border border-accent/60 text-accent text-[12.5px] tracking-wide hover:bg-accent hover:text-bg transition-colors"
        >
          connect to claim →
        </button>
      ) : !canRedeem ? (
        <button
          onClick={onSwitchChain}
          className="w-full py-3 border border-down/60 text-down text-[12.5px] tracking-wide hover:bg-down hover:text-bg transition-colors"
        >
          switch to Arc testnet
        </button>
      ) : (
        <button
          onClick={onRedeem}
          disabled={status === "submitting" || (userWinning ?? 0n) === 0n}
          className="w-full py-3 border-2 border-accent text-accent text-[14px] font-medium tracking-wide hover:bg-accent hover:text-bg transition-colors disabled:opacity-40"
        >
          {status === "submitting"
            ? "claiming…"
            : status === "success"
              ? "✓ claimed"
              : (userWinning ?? 0n) === 0n
                ? "no winning shares"
                : `claim ${userWinning !== undefined ? (Number(userWinning) / 1e6).toFixed(4) : ""} USDC →`}
        </button>
      )}

      {error && <div className="mt-3 text-2xs text-down">{error}</div>}
      {txHash && (
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-2xs text-fg-dim hover:text-accent"
        >
          tx: {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
        </a>
      )}
    </div>
  );
}

function SideButton({
  label,
  price,
  active,
  accent,
  onClick,
}: {
  label: string;
  price: number;
  active: boolean;
  accent: "up" | "down";
  onClick: () => void;
}) {
  const accentClass = accent === "up" ? "border-up text-up" : "border-down text-down";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-3 border ${active ? accentClass : "border-line text-fg-mute"} hover:border-line-strong transition-colors text-left`}
    >
      <div className="text-[11px] tracking-wide mb-0.5">{label}</div>
      <div className="text-[18px] tnum tracking-tightest text-fg">
        {(price * 100).toFixed(1)}¢
      </div>
    </button>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="caption text-fg-dim">{label}</span>
      <span className={`tnum ${accent ? "text-up" : "text-fg"}`}>{value}</span>
    </div>
  );
}
