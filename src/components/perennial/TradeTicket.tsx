"use client";

import { useMemo, useState } from "react";
import { AgentBadge, CaughtAgentBanner, useAgentReputation } from "@/components/AgentBadge";
import { marketsPerennialAbi } from "@/lib/abi";
import { openFunds } from "@/lib/funds-event";
import { feeHeadline, mirrorClaimLP, mirrorRedeem, payeeShort, splitTradeFee, tradeFeeBps, voidIsProRata, voidRefundText } from "@/lib/market-fees";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import type { ChainMarket } from "@/lib/perennial-chain";
import { OUTCOME, PHASE, formatUsdc, minOutWithSlippage, parseSlippagePct, parseUsdcInput, quoteBuy, quoteSell, tradeDeadline } from "@/lib/perennial-market";
import { statusSentence, usdText } from "@/lib/plain-words";
import { ticketState, yesPct } from "@/lib/perennial-view";
import { same, type PerennialData } from "./usePerennialData";
import { CHAIN, D, type PerennialTx } from "./usePerennialTx";

const shares = (v: bigint) => formatUsdc(v, 2);

export function TradeTicket({ data, tx, market: m, initialSide = "Yes" }: { data: PerennialData; tx: PerennialTx; market: ChainMarket; initialSide?: "Yes" | "No" }) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<"Yes" | "No">(initialSide);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [editSlip, setEditSlip] = useState(false);

  const st = data.statusOf(m);
  const pos = data.positionOf(m);
  const feeModel = data.ov?.feeModel;
  const ledgerBal = data.acct?.ledgerBal;
  const yp = yesPct(m);

  // The market's agent: reputation + live bond / coverage on its feed. Soft warnings only.
  const candidates = useMemo(
    () => data.markets
      .filter((x) => same(x.agent, m.agent) && same(x.feedId, m.feedId))
      .map((x) => ({ id: x.id, phase: x.phase, agent: x.agent, feed: x.feedId, collateral: x.collateral })),
    [data.markets, m.agent, m.feedId],
  );
  const rep = useAgentReputation({
    client: data.publicClient, chainId: CHAIN.id, market: D.contracts.MarketsPerennial!, flavor: "perennial",
    marketId: m.id, agent: m.agent, feed: m.feedId, candidates, fallback: { attestation: data.ov?.attestation },
  });

  // ── quote ──
  const feeBps = tradeFeeBps(feeModel);
  const slip = parseSlippagePct(slippage);
  const outcome = side === "Yes" ? OUTCOME.Yes : OUTCOME.No;
  const held = side === "Yes" ? pos.yes : pos.no;
  const amt = amount.trim()
    ? parseUsdcInput(amount, mode === "buy" ? { max: ledgerBal ?? 0n, label: "amount" } : { max: held, label: "share amount" })
    : undefined;
  const buyQ = feeBps !== undefined && mode === "buy" && amt?.ok ? quoteBuy(m, outcome, amt.value, feeBps) : null;
  const sellQ = feeBps !== undefined && mode === "sell" && amt?.ok ? quoteSell(m, outcome, amt.value, feeBps) : null;
  const q = buyQ ?? sellQ;
  const expectedOut = buyQ?.sharesOut ?? sellQ?.collateralOut;
  const minOut = expectedOut !== undefined && slip.ok ? minOutWithSlippage(expectedOut, slip.value) : undefined;
  const feeParts = q ? splitTradeFee(q.fee, feeModel) : undefined;

  // ── settlement previews: the contract's own views (v3), else the local mirror ──
  const snapshot = { ...m, totalLpShares: m.seeded };
  const redeemable = pos.redeemable ?? mirrorRedeem(snapshot, pos, feeModel) ?? 0n;
  const lpPreview = pos.claimableLP ?? mirrorClaimLP(snapshot, pos);

  const state = ticketState({
    writesEnabled: PERENNIAL_WRITES_ENABLED, address: tx.address, onChain: tx.onPerennialChain, canTrade: st.canTrade,
    ledgerBal: data.acct ? ledgerBal : undefined, canResolve: st.canResolve, canVoid: st.canVoid,
    canRedeem: st.canRedeem, redeemable, canClaimLP: st.canClaimLP, lp: pos.lp,
  });

  async function trade() {
    if (!slip.ok) return tx.fail(slip.error);
    if (!amt) return tx.fail(mode === "buy" ? "Enter an amount." : "Enter how many shares to sell.");
    if (!amt.ok) return tx.fail(amt.error);
    if (!q || minOut === undefined) return tx.fail(mode === "buy" ? "That amount is too small to buy any shares." : "That amount is too small to sell.");
    const now = await tx.latestChainTime();
    if (m.phase !== PHASE.Trading || now >= m.expiry) return tx.fail("Trading on this market has closed.");
    const value = amt.value;
    const args = [m.id, outcome, value, minOut, tradeDeadline(now)] as const;
    const mp = D.contracts.MarketsPerennial!;
    const fn = mode === "buy" ? "buy" : "sell";
    const ok = await tx.run(
      mode,
      async () => {
        await tx.publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: fn, args, account: tx.address! });
        return tx.walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: fn, args, ...tx.w() });
      },
      {
        before: mode === "buy" ? () => tx.ensureLedgerAllowance(mp, value) : undefined,
        done: buyQ
          ? `Bought about ${shares(buyQ.sharesOut)} ${side} shares for ${usdText(value)}.`
          : `Sold ${shares(value)} ${side} shares for about ${usdText(sellQ!.collateralOut)}.`,
      },
    );
    if (ok) setAmount("");
  }

  const settle = (fn: "resolve" | "voidMarket" | "redeem" | "claimLP", done: string) => () =>
    tx.run(fn, async () => {
      const mp = D.contracts.MarketsPerennial!;
      await tx.publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: fn, args: [m.id], account: tx.address! });
      return tx.walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: fn, args: [m.id], ...tx.w() });
    }, { done });

  const v3 = feeModel?.kind === "trade" ? feeModel : undefined;
  const resultLine = (() => {
    if (m.phase === PHASE.Voided) {
      if (!v3) return `The market was voided. Your shares pay $0.50 each: ${usdText(redeemable)}.`;
      if (pos.netCost === undefined) return `The market was voided. Your refund is ${usdText(redeemable)}.`;
      const proRata = m.voidTraderPool !== undefined && m.voidNetCostTotal !== undefined && voidIsProRata(m.voidTraderPool, m.voidNetCostTotal);
      return `The market was voided. ${voidRefundText(pos.netCost, redeemable, proRata)}`;
    }
    return `${m.yesWon ? "Yes" : "No"} won. Your winning shares pay ${usdText(redeemable)}.`;
  })();

  const connectBtn = (
    <button type="button" className="pa-btn pa-btn--block" onClick={tx.connectOrSwitch}>
      {tx.address ? `Switch to ${D.label}` : "Connect wallet"}
    </button>
  );

  return (
    <div className="pa-stack">
      <AgentBadge agent={m.agent} rep={rep} />
      <CaughtAgentBanner rep={rep} explorer={CHAIN.explorer.url} />

      {state === "paused" && <p className="pa-notice">Trading is paused. Prices stay live.</p>}

      {state === "connect" && (
        <>
          <p className="pa-muted">Browsing works without a wallet.</p>
          <button type="button" className="pa-btn pa-btn--block" onClick={tx.connectOrSwitch}>Connect wallet to trade</button>
        </>
      )}

      {state === "switch" && connectBtn}

      {state === "fund" && (
        <>
          <p>You have $0 to trade.</p>
          <button type="button" className="pa-btn pa-btn--block" onClick={openFunds}>Add funds</button>
        </>
      )}

      {state === "trade" && (
        <>
          <div className="pa-seg" role="group" aria-label="Buy or sell">
            {(["buy", "sell"] as const).map((x) => (
              <button key={x} type="button" aria-pressed={mode === x} onClick={() => { setMode(x); setAmount(""); }}>
                {x === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <div className="pa-yn">
            {(["Yes", "No"] as const).map((c) => (
              <button key={c} type="button" className="pa-pick" data-side={c.toLowerCase()} aria-pressed={side === c} onClick={() => setSide(c)}>
                <span>{c}</span>
                <span className="tnum">{c === "Yes" ? yp : 100 - yp}¢</span>
              </button>
            ))}
          </div>
          <label className="pa-field">
            <span>{mode === "buy" ? "Amount" : "Shares"}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label={mode === "buy" ? "Amount in USDC" : "Shares to sell"} />
            <span>{mode === "buy" ? "USDC" : side}</span>
          </label>
          <div className="pa-chips">
            {mode === "buy" ? (
              <>
                {["5", "10", "25"].map((v) => <button key={v} type="button" className="pa-chip" onClick={() => setAmount(v)}>${v}</button>)}
                <button type="button" className="pa-chip" onClick={() => setAmount(formatUsdc(ledgerBal ?? 0n, 6))}>Max</button>
              </>
            ) : (
              <button type="button" className="pa-chip" onClick={() => setAmount(formatUsdc(held, 6))}>All {shares(held)}</button>
            )}
          </div>
          {amt && !amt.ok && <p className="text-down">{amt.error}</p>}
          {q && (
            <div>
              {buyQ && <div className="pa-kv"><span>You get</span><span>≈ {shares(buyQ.sharesOut)} {side} shares</span></div>}
              {buyQ && <div className="pa-kv"><span>Pays if {side} wins</span><span>{usdText(buyQ.sharesOut)}</span></div>}
              {sellQ && <div className="pa-kv"><span>You receive</span><span>≈ {usdText(sellQ.collateralOut)}</span></div>}
              <div className="pa-kv">
                <span>Fee</span>
                <span>{usdText(q.fee)}{feeParts ? ` · ${usdText(feeParts.payee)} to the ${payeeShort(feeModel)}` : ""}</span>
              </div>
              {q.priceImpact > 0.05 && <p className="text-down pa-small">This order moves the price by {(q.priceImpact * 100).toFixed(1)}%.</p>}
            </div>
          )}
          <button type="button" className="pa-btn pa-btn--block" onClick={trade} disabled={tx.busy || !q || !slip.ok}>
            {tx.pending === mode ? (mode === "buy" ? "Buying…" : "Selling…") : `${mode === "buy" ? "Buy" : "Sell"} ${side}${amt?.ok ? ` for ${usdText(amt.value)}` : ""}`}
          </button>
          <p className="pa-muted pa-small">
            Price may move up to {slip.ok ? slippage : "1"}% before it lands ·{" "}
            {editSlip ? (
              <input className="pa-input inline-block w-16 py-0.5 text-right" value={slippage} onChange={(e) => setSlippage(e.target.value)} inputMode="decimal" aria-label="Slippage percent" />
            ) : (
              <button type="button" className="pa-link" onClick={() => setEditSlip(true)}>change</button>
            )}
            {feeModel && ` · ${feeHeadline(feeModel)} fee`}
          </p>
          {!slip.ok && <p className="text-down pa-small">{slip.error}</p>}
        </>
      )}

      {state === "settle" && (
        <>
          <p>{statusSentence(st.key, m.expiry)}</p>
          {tx.needsConnect ? connectBtn : (
            <>
              {st.canResolve && (
                <button type="button" className="pa-btn pa-btn--block" onClick={settle("resolve", "Market settled.")} disabled={tx.busy}>
                  {tx.pending === "resolve" ? "Settling…" : "Settle now (anyone can)"}
                </button>
              )}
              {st.canVoid && (
                <button type="button" className="pa-btn pa-btn--block" onClick={settle("voidMarket", "Market voided.")} disabled={tx.busy}>
                  {tx.pending === "voidMarket" ? "Voiding…" : "Void now (anyone can)"}
                </button>
              )}
            </>
          )}
        </>
      )}

      {state === "collect" && (
        <>
          <p>{resultLine}</p>
          {st.canRedeem && redeemable > 0n && (
            <button type="button" className="pa-btn pa-btn--yes pa-btn--block" onClick={settle("redeem", `Collected ${usdText(redeemable)}.`)} disabled={tx.busy}>
              {tx.pending === "redeem" ? "Collecting…" : m.phase === PHASE.Voided ? `Refund ${usdText(redeemable)}` : `Collect ${usdText(redeemable)}`}
            </button>
          )}
          {st.canClaimLP && pos.lp > 0n && (
            <button type="button" className="pa-btn pa-btn--quiet pa-btn--block" onClick={settle("claimLP", `Collected your liquidity, ${usdText(lpPreview)}.`)} disabled={tx.busy}>
              {tx.pending === "claimLP" ? "Collecting…" : `Collect your liquidity ${pos.claimableLP !== undefined ? "" : "≈ "}${usdText(lpPreview)}`}
            </button>
          )}
        </>
      )}

      {state === "closed" && <p>{statusSentence(st.key, m.expiry)}</p>}
    </div>
  );
}
