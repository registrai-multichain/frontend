"use client";

import { useState } from "react";
import { InfoBubble } from "@/components/InfoBubble";
import { borrowPaid, liqPrice, RULES, type Side } from "@/lib/abi-pilot";
import type { PilotAccountView } from "@/lib/abi-pilot-api";
import { borrowPerDay, fmtHour, fmtPts, fmtPx, fmtSideRate, openLabel, PILOT_COPY, PILOT_DISCLAIMER, PILOT_LIQ_NOTE } from "@/lib/abi-pilot-copy";

export interface TicketProps {
  view: PilotAccountView;
  busy?: boolean;
  /** An order is waiting for the next mark. */
  filling?: boolean;
  error?: string;
  signInLabel: string;
  signingIn?: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOrder: (o: { side: Side; margin: number; lev: number }) => void;
}

function SignInRow({ label, busy, onSignIn }: { label: string; busy?: boolean; onSignIn: () => void }) {
  return (
    <div className="abi-pt-row">
      <button type="button" className="abi-pt-primary" onClick={onSignIn} disabled={busy}>{busy ? PILOT_COPY.signingIn : label}</button>
      <InfoBubble label="About sign-in">{PILOT_COPY.signInTip}</InfoBubble>
    </div>
  );
}

/** The REGI line for a signed-in wallet that may not trade: unknown is never shown as "no REGI". */
function regiLine(view: PilotAccountView): string | null {
  const r = view.regi;
  if (!r || r.ok === true) return null;
  if (r.ok === null) return PILOT_COPY.regiUnchecked;
  return r.snapshot === false ? PILOT_COPY.notAtSnapshot : PILOT_COPY.holdRegi;
}

/** This hour's funding per side, signed with its direction (+ pays, − receives); "–" until the hour's rates are set. */
function FundingRows({ view }: { view: PilotAccountView }) {
  const f = view.funding;
  const rate = (r: number | null) => (r === null ? "–" : fmtSideRate(r));
  return (
    <>
      <dt>Funding long <InfoBubble label="About funding">{PILOT_COPY.fundingTip}</InfoBubble></dt>
      <dd>{rate(f.long)}</dd>
      <dt>Funding short</dt>
      <dd>{rate(f.short)} · next {fmtHour(f.next)} UTC</dd>
    </>
  );
}

/** The trade ticket: Long / Short, margin, leverage (capped), liquidation price with costs, fee, borrow, funding. */
export function Ticket({ view, busy, filling, error, signInLabel, signingIn, onSignIn, onSignOut, onOrder }: TicketProps) {
  const [side, setSide] = useState<Side>("long");
  const [lev, setLev] = useState(1);
  const [marginText, setMarginText] = useState("100");
  const m = view.mark;
  const acct = view.account;
  const blocked = regiLine(view);

  const head = (
    <div className="abi-ph">
      <h2>{PILOT_COPY.heading}</h2>
      <InfoBubble label="About the points pilot">{PILOT_COPY.rulesTip}</InfoBubble>
      {view.address && <span className="sp"><button type="button" className="abi-pt-link" onClick={onSignOut}>{PILOT_COPY.signOut}</button></span>}
    </div>
  );
  const disclaimer = <div className="abi-pt-disc"><p>{PILOT_DISCLAIMER}</p></div>;

  let body: React.ReactNode;
  if (!view.address) {
    body = (
      <div className="abi-pt">
        <p className="abi-pt-note">{view.open ? PILOT_COPY.holdRegi : PILOT_COPY.closed}</p>
        {view.open && <SignInRow label={signInLabel} busy={signingIn} onSignIn={onSignIn} />}
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
        {disclaimer}
      </div>
    );
  } else if (!view.open || blocked) {
    body = (
      <div className="abi-pt">
        <p className="abi-pt-note">{!view.open ? PILOT_COPY.closed : blocked}</p>
        <dl className="abi-kv abi-pt-kv">
          {acct && <><dt>Balance</dt><dd>{fmtPts(acct.balance)} pts</dd></>}
          <FundingRows view={view} />
        </dl>
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
        {disclaimer}
      </div>
    );
  } else {
    const margin = Number(marginText);
    const maxLev = m ? m.maxLev : 1;
    const levUse = RULES.levels.filter((l) => l <= Math.min(lev, maxLev)).pop() ?? 1;
    const notional = Number.isFinite(margin) ? margin * levUse : 0;
    const fee = notional * RULES.feeRate;
    const pos = m && margin > 0 ? { side, margin, notional, entry: m.mark, openedAt: 0 } : null;
    const liq = pos ? liqPrice(pos, 0) : null;
    // a day on: 24 h of borrow plus 24 h of this hour's funding for the side (+ = paid)
    const sideRate = side === "long" ? view.funding.long : view.funding.short;
    const liq24 = pos ? liqPrice(pos, borrowPaid(pos, 86400) + (sideRate ?? 0) * notional * 24) : null;
    const borrowDay = margin > 0 ? borrowPerDay(notional, margin) : 0;
    const balance = acct?.balance ?? 0;
    const full = view.positions.length >= RULES.maxOpen;
    const held = view.positions[0]?.side;
    const problem =
      !m || !m.fresh ? PILOT_COPY.priceUpdating
        : m.paused ? PILOT_COPY.paused
          : m.basePaused ? PILOT_COPY.basePaused
            : m.milestonePaused ? PILOT_COPY.milestonePaused
            : !(margin >= RULES.minMargin) ? `Minimum margin ${RULES.minMargin} pts`
              : margin + fee > balance ? "Not enough balance"
                : full ? `Up to ${RULES.maxOpen} open positions`
                  : held && held !== side ? PILOT_COPY.closeFirst(held)
                    : null;
    const maxMargin = Math.max(0, Math.floor((balance / (1 + levUse * RULES.feeRate)) * 100) / 100);
    body = (
      <form className="abi-pt" onSubmit={(e) => { e.preventDefault(); if (!problem && !busy) onOrder({ side, margin, lev: levUse }); }}>
        <div className="abi-pt-side" role="group" aria-label="Side">
          <button type="button" className="long" aria-pressed={side === "long"} onClick={() => setSide("long")}>Long</button>
          <button type="button" className="short" aria-pressed={side === "short"} onClick={() => setSide("short")}>Short</button>
        </div>
        <label className="abi-pt-field">
          <span>Margin</span>
          <span className="abi-pt-input">
            <input type="number" inputMode="decimal" min={RULES.minMargin} step="any" value={marginText} onChange={(e) => setMarginText(e.target.value)} aria-label="Margin in points" />
            <span className="u">pts</span>
            <button type="button" className="abi-pt-link" onClick={() => setMarginText(String(maxMargin))}>Max</button>
          </span>
        </label>
        <div className="abi-pt-field">
          <span>Leverage</span>
          <div className="abi-seg" role="group" aria-label="Leverage">
            {RULES.levels.map((l) => (
              <button key={l} type="button" aria-pressed={levUse === l} disabled={l > maxLev} onClick={() => setLev(l)}>{l}×</button>
            ))}
          </div>
        </div>
        {m && maxLev < RULES.levels[RULES.levels.length - 1] && <p className="abi-pt-note">{PILOT_COPY.capped(maxLev)}</p>}
        <dl className="abi-kv abi-pt-kv">
          <dt>Mark</dt><dd>{m ? fmtPx(m.mark) : "–"}</dd>
          <dt>Size</dt><dd>{fmtPts(notional)} pts</dd>
          <dt>Fee</dt><dd>{fmtPts(fee)} pts</dd>
          <dt>Borrow <InfoBubble label="About borrow">{PILOT_COPY.borrowTip}</InfoBubble></dt><dd>{fmtPts(borrowDay)} pts/day</dd>
          <dt>Liquidation price <InfoBubble label="About the liquidation price">{PILOT_COPY.liqTip}</InfoBubble></dt>
          <dd>{liq === null || liq24 === null ? "–" : <>{fmtPx(liq)} · {fmtPx(liq24)} in 24 h</>}</dd>
          <FundingRows view={view} />
          <dt>Balance</dt><dd>{fmtPts(balance)} pts</dd>
          {acct?.equity !== null && acct?.equity !== undefined && (<><dt>Equity</dt><dd>{fmtPts(acct.equity)} pts</dd></>)}
        </dl>
        <div className="abi-pt-disc"><p>{PILOT_DISCLAIMER}</p><p>{PILOT_LIQ_NOTE}</p></div>
        <button type="submit" className={`abi-pt-primary ${side}`} disabled={Boolean(problem) || busy}>{filling ? PILOT_COPY.filling : openLabel(side, levUse)}</button>
        {problem && (
          <p className="abi-pt-note" role="status">
            {problem}
            {problem === PILOT_COPY.milestonePaused && <> <InfoBubble label="About the milestone pause">{PILOT_COPY.milestoneTip}</InfoBubble></>}
          </p>
        )}
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
      </form>
    );
  }

  return (
    <aside className="abi-panel abi-pt-panel" aria-label="Points pilot ticket">
      {head}
      {body}
    </aside>
  );
}
