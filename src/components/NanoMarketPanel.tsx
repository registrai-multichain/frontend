"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex, PublicClient } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl } from "@/lib/chain";
import { nanoLedgerAbi, marketsV4Abi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import type { NanoMarket } from "@/lib/nano-markets";
import {
  OUTCOME,
  PHASE,
  bpsPct,
  formatUsdc,
  minOutWithSlippage,
  parseUsdcInput,
  priceOf,
  quoteBuy,
  quoteSell,
} from "@/lib/perennial-market";
import {
  feeSummary,
  mirrorClaimLP,
  mirrorRedeem,
  ticketFeeLabel,
  tradeFeeBps,
  voidIsProRata,
  voidRefundText,
  type FeeModel,
} from "@/lib/resolution-fee";
import {
  readFeeModel,
  readHolderSettlement,
  readMarketSettlement,
  type HolderSettlementViews,
  type MarketSettlementViews,
} from "@/lib/resolution-fee-chain";

// Trade a MarketsV4 common market that settles entirely on NanoLedger. Buying
// pulls collateral from your ledger balance (deposit on this page first). On the
// v2 contract trades carry no fee; 1% of the pot is charged once at settlement
// (30% creator · 20% agent · 50% Registrai treasury). Testnet still runs the
// legacy contract (a per-trade fee), so the fee model is probed, never assumed.

type Status = "idle" | "approving" | "submitting" | "success" | "error";
type Side = "Yes" | "No";

/** The panel's slippage tolerance on trades (1%). */
const SLIPPAGE_BPS = 100n;

type MarketState = {
  /** 0 when the id is not a market on this deployment. */
  createdAt: bigint;
  phase: number;
  yesWon: boolean;
  expiry: bigint;
  agent: Address;
  yesReserve: bigint;
  noReserve: bigint;
  lpPot: bigint;
  totalLpShares: bigint;
  chainNow: bigint;
} & MarketSettlementViews;

type HolderState = {
  yes: bigint;
  no: bigint;
  lp: bigint;
  ledgerBal: bigint;
  /** Legacy fee-pool accrual (NanoLedger.claimablePool); 0 on v2. */
  feeClaimable: bigint;
} & HolderSettlementViews;

const fmt = (w: bigint, dp = 4) => formatUsdc(w, dp);
const pct = (w: bigint) => `${(Number(w) / 1e16).toFixed(1)}%`; // 1e18 -> %
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function NanoMarketPanel({ market }: { market: NanoMarket }) {
  const { address, publicClient, walletClient, isOnSupportedChain } = useWallet();
  const nl = CONTRACTS.NanoLedger;
  const mv4 = CONTRACTS.MarketsV4nano;
  const client = publicClient as PublicClient;

  const [feeModel, setFeeModel] = useState<FeeModel>();
  const [mkt, setMkt] = useState<MarketState>();
  const [me, setMe] = useState<HolderState>();

  const [side, setSide] = useState<Side>("Yes");
  const [amt, setAmt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<Hex>();

  const refresh = useCallback(async () => {
    if (!nl || !mv4) return;
    try {
      // Probe once: v2 (RESOLUTION_FEE_BPS) or the legacy per-trade fee.
      const fm = feeModel ?? (await readFeeModel(client, mv4, "v4"));
      if (!feeModel) setFeeModel(fm);
      const [m, lpPot, totalLpShares, block] = await Promise.all([
        client.readContract({ address: mv4, abi: marketsV4Abi, functionName: "getMarket", args: [market.marketId] }) as Promise<{
          phase: number; yesWon: boolean; expiry: bigint; agent: Address; yesReserve: bigint; noReserve: bigint; createdAt: bigint;
        }>,
        client.readContract({ address: mv4, abi: marketsV4Abi, functionName: "lpPotAtResolution", args: [market.marketId] }) as Promise<bigint>,
        client.readContract({ address: mv4, abi: marketsV4Abi, functionName: "totalLpShares", args: [market.marketId] }) as Promise<bigint>,
        client.getBlock({ blockTag: "latest" }),
      ]);
      const phase = Number(m.phase);
      const v2 = fm.kind === "resolution";
      const settle = v2 ? await readMarketSettlement(client, mv4, market.marketId, phase) : {};
      setMkt({
        createdAt: m.createdAt, phase, yesWon: m.yesWon, expiry: m.expiry, agent: m.agent, yesReserve: m.yesReserve, noReserve: m.noReserve,
        lpPot, totalLpShares, chainNow: block.timestamp, ...settle,
      });
      if (address) {
        const [yes, no, lp, ledgerBal, feeClaimable, views] = await Promise.all([
          client.readContract({ address: mv4, abi: marketsV4Abi, functionName: "yesBalance", args: [market.marketId, address] }) as Promise<bigint>,
          client.readContract({ address: mv4, abi: marketsV4Abi, functionName: "noBalance", args: [market.marketId, address] }) as Promise<bigint>,
          client.readContract({ address: mv4, abi: marketsV4Abi, functionName: "lpShares", args: [market.marketId, address] }) as Promise<bigint>,
          client.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
          client.readContract({ address: nl, abi: nanoLedgerAbi, functionName: "claimablePool", args: [market.marketId, address] }) as Promise<bigint>,
          v2 ? readHolderSettlement(client, mv4, market.marketId, address, phase) : Promise.resolve({}),
        ]);
        setMe({ yes, no, lp, ledgerBal, feeClaimable, ...views });
      } else {
        setMe(undefined);
      }
    } catch (e) { console.error("nano market refresh", e); }
  }, [nl, mv4, market.marketId, client, address, feeModel]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => void refresh(), 6_000); return () => clearInterval(id); }, [refresh]);

  const busy = status === "approving" || status === "submitting";
  const v2 = feeModel?.kind === "resolution" ? feeModel : undefined;
  const phase = mkt?.phase ?? PHASE.Trading;
  const missing = mkt !== undefined && mkt.createdAt === 0n;
  const trading = !missing && phase === PHASE.Trading && (!mkt || mkt.chainNow < mkt.expiry);
  const yesPrice = mkt ? priceOf(mkt, OUTCOME.Yes) : 0n;
  const held = side === "Yes" ? me?.yes ?? 0n : me?.no ?? 0n;
  const outcome = side === "Yes" ? OUTCOME.Yes : OUTCOME.No;
  const feeBps = tradeFeeBps(feeModel);

  // Quotes mirror the contract to the unit; the slippage floor guards the rest.
  const parsed = amt.trim() ? parseUsdcInput(amt) : undefined;
  const buyQ = mkt && parsed?.ok && feeBps !== undefined ? quoteBuy(mkt, outcome, parsed.value, feeBps) : null;
  const sellQ = mkt && parsed?.ok && feeBps !== undefined && parsed.value <= held ? quoteSell(mkt, outcome, parsed.value, feeBps) : null;

  // Settlement previews: the contract's views on v2, else the local mirror.
  const redeemable = mkt && me ? me.redeemable ?? mirrorRedeem(mkt, me, feeModel) ?? 0n : 0n;
  const lpClaim = mkt && me ? me.claimableLP ?? mirrorClaimLP(mkt, me) : 0n;

  const statusLabel = !mkt
    ? "loading"
    : missing
      ? "not on this deployment"
      : phase === PHASE.Resolved
      ? (mkt.yesWon ? "resolved YES" : "resolved NO")
      : phase === PHASE.Voided
        ? v2
          ? `voided — refunds net cost minus ${bpsPct(v2.resolutionFeeBps)}; agent's ${bpsPct(v2.agentShareBps)} to its successful challenger`
          : "voided"
        : trading ? "trading" : "trading closed · awaiting settlement";

  async function ensureSpender(needed: bigint) {
    const a = (await client.readContract({ address: nl!, abi: nanoLedgerAbi, functionName: "allowance", args: [address!, mv4!] })) as bigint;
    if (a >= needed) return;
    setStatus("approving");
    // Exact amount, never an unlimited approval.
    const hash = await walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "approveSpender", args: [mv4!, needed], chain: walletClient!.chain, account: walletClient!.account! });
    await client.waitForTransactionReceipt({ hash });
  }
  async function run(fn: () => Promise<Hex>, before?: () => Promise<void>) {
    if (!walletClient || !address) return;
    setError(undefined); setTxHash(undefined);
    try {
      if (before) await before();
      setStatus("submitting");
      const hash = await fn(); setTxHash(hash);
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setStatus("success"); setAmt(""); await refresh();
    } catch (e) { setStatus("error"); setError(humanizeError(e)); }
  }
  const w = (fn: string, args: unknown[]) => walletClient!.writeContract({ address: mv4!, abi: marketsV4Abi, functionName: fn, args, chain: walletClient!.chain, account: walletClient!.account! } as never);
  const fail = (msg: string) => { setError(msg); setStatus("error"); };

  async function doBuy() {
    if (!parsed) return fail("amount required");
    if (!parsed.ok) return fail(parsed.error);
    if (parsed.value > (me?.ledgerBal ?? 0n)) return fail("deposit into the ledger first (above)");
    if (!buyQ) return fail(feeBps === undefined ? "reading the market's fee…" : "that amount is too small to buy any shares");
    const minOut = minOutWithSlippage(buyQ.sharesOut, SLIPPAGE_BPS);
    const value = parsed.value;
    await run(() => w("buy", [market.marketId, outcome, value, minOut]), () => ensureSpender(value));
  }
  async function doSell() {
    if (!parsed) return fail("amount required");
    if (!parsed.ok) return fail(parsed.error);
    if (parsed.value > held) return fail("not enough shares");
    if (!sellQ) return fail(feeBps === undefined ? "reading the market's fee…" : "that amount is too small to sell");
    const minOut = minOutWithSlippage(sellQ.collateralOut, SLIPPAGE_BPS);
    const value = parsed.value;
    await run(() => w("sell", [market.marketId, outcome, value, minOut]));
  }
  async function doClaimFee() {
    await run(() => walletClient!.writeContract({ address: nl!, abi: nanoLedgerAbi, functionName: "claim", args: [market.marketId], chain: walletClient!.chain, account: walletClient!.account! }));
  }

  if (!mv4) return null;

  const redeemLine = (() => {
    if (!me || !mkt) return undefined;
    if (phase === PHASE.Voided) {
      if (!v2) return `your shares: YES ${fmt(me.yes, 2)} + NO ${fmt(me.no, 2)} × $0.50 = $${fmt(redeemable, 2)}`;
      if (me.netCost === undefined) return `your refund: $${fmt(redeemable, 2)}`;
      const proRata = mkt.voidTraderPool !== undefined && mkt.voidNetCostTotal !== undefined && voidIsProRata(mkt.voidTraderPool, mkt.voidNetCostTotal, v2.resolutionFeeBps);
      return voidRefundText(me.netCost, redeemable, v2.resolutionFeeBps, proRata);
    }
    if (phase === PHASE.Resolved) {
      return v2
        ? `your winning shares pay $${fmt(redeemable, 2)} (after the ${bpsPct(v2.resolutionFeeBps)} resolution fee)`
        : `your winning shares pay $${fmt(redeemable, 2)}`;
    }
    return undefined;
  })();
  const feeLine = feeSummary(feeModel);

  return (
    <div className="border border-line bg-bg-elev p-5 mt-px">
      <div className="flex items-center justify-between mb-1 gap-3">
        <h3 className="font-serif text-[18px]">{market.question}</h3>
        <span className="text-2xs text-fg-dim text-right">{statusLabel}</span>
      </div>
      <p className="text-2xs text-fg-dim mb-3">{market.hint}</p>

      <div className="mb-3">
        <div className="flex items-center justify-between text-2xs mb-1">
          <span className="text-up">YES {pct(yesPrice)}</span>
          {(me?.feeClaimable ?? 0n) > 0n && <span className="text-accent">fees {fmt(me!.feeClaimable)} USDC</span>}
          <span className="text-down">NO {pct(mkt ? 10n ** 18n - yesPrice : 0n)}</span>
        </div>
        <div className="h-2 w-full bg-down/15 overflow-hidden flex">
          <div className="bg-up/80 h-full transition-all" style={{ width: `${Number(yesPrice) / 1e16}%` }} />
        </div>
      </div>

      {trading && address && isOnSupportedChain && (
        <>
          <div className="inline-flex border border-line text-2xs mb-2" role="group">
            {(["Yes", "No"] as Side[]).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}
                className={`px-3 py-1 ${side === s ? "bg-accent/90 text-bg" : "text-fg-dim hover:text-fg"}`}>{s}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder={`USDC in / ${side} shares`}
              className="flex-1 bg-bg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent/60" />
            <button onClick={doBuy} disabled={busy} className="px-4 bg-accent/90 text-bg text-[14px] hover:bg-accent transition-colors disabled:opacity-50">buy</button>
            <button onClick={doSell} disabled={busy} className="px-4 border border-line text-[14px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">sell</button>
          </div>
          {parsed?.ok && (buyQ || sellQ) && (
            <div className="caption text-2xs text-fg-dim mt-1">
              {buyQ && `buy ≈ ${fmt(buyQ.sharesOut)} ${side}`}
              {buyQ && sellQ && " · "}
              {sellQ && `sell ≈ $${fmt(sellQ.collateralOut)}`}
              {" · "}fee: {ticketFeeLabel(feeModel)} · 1% slippage floor
            </div>
          )}
          <div className="caption text-2xs text-fg-dim mt-1">
            ledger balance {fmt(me?.ledgerBal ?? 0n)} USDC · your shares: YES {fmt(me?.yes ?? 0n)} / NO {fmt(me?.no ?? 0n)}
            {me?.netCost !== undefined ? ` · net cost $${fmt(me.netCost, 2)}` : ""}
          </div>
        </>
      )}

      {missing && (
        <p className="text-2xs text-fg-dim">This market id is not on the current MarketsV4 deployment, so there is nothing to trade here yet.</p>
      )}

      {!missing && !trading && phase === PHASE.Trading && mkt && (
        <p className="text-2xs text-fg-dim">Trading has closed. The market settles on its agent&apos;s first valid attestation after expiry, or voids.</p>
      )}

      {(phase === PHASE.Resolved || phase === PHASE.Voided) && address && (
        <>
          {redeemLine && <div className="caption text-2xs text-fg-dim mb-1">{redeemLine}</div>}
          <button onClick={() => run(() => w("redeem", [market.marketId]))} disabled={busy || redeemable === 0n}
            className="w-full bg-accent/90 text-bg py-2 text-[14px] hover:bg-accent transition-colors disabled:opacity-50">
            {redeemable === 0n ? "nothing to redeem" : phase === PHASE.Voided ? `redeem refund $${fmt(redeemable, 2)}` : `redeem $${fmt(redeemable, 2)}`}
          </button>
          {(me?.lp ?? 0n) > 0n && (
            <button onClick={() => run(() => w("claimLP", [market.marketId]))} disabled={busy}
              className="mt-2 w-full border border-line py-2 text-[13px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">
              claim LP {me?.claimableLP !== undefined ? "" : "≈ "}${fmt(lpClaim, 2)}
            </button>
          )}
        </>
      )}

      {(me?.feeClaimable ?? 0n) > 0n && address && (
        <button onClick={doClaimFee} disabled={busy}
          className="mt-2 w-full border border-line py-2 text-[13px] text-fg-mute hover:text-fg hover:border-accent/60 transition-colors disabled:opacity-50">
          claim {fmt(me!.feeClaimable)} USDC fees from the ledger
        </button>
      )}

      <div className="mt-3 space-y-1 text-2xs text-fg-dim">
        {feeLine && <p>Fees: {v2 ? `no trading fee · ${feeLine}` : `${feeLine} (legacy testnet contract)`}.</p>}
        {v2 && (
          <p>
            Who settles: any bonded agent can settle a common market (with an approved independent resolver) and earns{" "}
            {bpsPct(v2.agentShareBps)} of the resolution fee. If the market voids, every trader gets their net cost back minus{" "}
            {bpsPct(v2.resolutionFeeBps)}, and the agent&apos;s {bpsPct(v2.agentShareBps)} goes to whoever successfully challenged its
            answer (otherwise to the Registrai treasury).
            {mkt ? ` This market's agent: ${shortAddr(mkt.agent)}.` : ""}
          </p>
        )}
      </div>

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
