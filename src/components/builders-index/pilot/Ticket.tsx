"use client";

import { useState } from "react";
import { InfoBubble } from "@/components/InfoBubble";
import { liqPrice, RULES, type Side } from "@/lib/abi-pilot";
import type { PilotAccountView } from "@/lib/abi-pilot-api";
import { fmtPts, fmtPx, openLabel, PILOT_COPY, PILOT_DISCLAIMERS } from "@/lib/abi-pilot-copy";

export interface TicketProps {
  view: PilotAccountView;
  busy?: boolean;
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

/** The trade ticket: Long / Short, margin, leverage (capped by the dynamic rule), liquidation price, fee. */
export function Ticket({ view, busy, error, signInLabel, signingIn, onSignIn, onSignOut, onOrder }: TicketProps) {
  const [side, setSide] = useState<Side>("long");
  const [lev, setLev] = useState(1);
  const [marginText, setMarginText] = useState("100");
  const m = view.mark;
  const acct = view.account;

  const head = (
    <div className="abi-ph">
      <h2>{PILOT_COPY.heading}</h2>
      <InfoBubble label="About the points pilot">{PILOT_COPY.rulesTip}</InfoBubble>
      {view.address && <span className="sp"><button type="button" className="abi-pt-link" onClick={onSignOut}>{PILOT_COPY.signOut}</button></span>}
    </div>
  );

  let body: React.ReactNode;
  if (!view.address) {
    body = (
      <div className="abi-pt">
        <p className="abi-pt-note">{view.open ? PILOT_COPY.holdRegi : PILOT_COPY.closed}</p>
        {view.open && <SignInRow label={signInLabel} busy={signingIn} onSignIn={onSignIn} />}
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
      </div>
    );
  } else if (!view.open || view.regi === false) {
    body = (
      <div className="abi-pt">
        <p className="abi-pt-note">{!view.open ? PILOT_COPY.closed : PILOT_COPY.holdRegi}</p>
        {acct && <dl className="abi-kv abi-pt-kv"><dt>Balance</dt><dd>{fmtPts(acct.balance)} pts</dd></dl>}
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
      </div>
    );
  } else {
    const margin = Number(marginText);
    const maxLev = m ? m.maxLev : 1;
    const levUse = Math.min(lev, maxLev);
    const notional = Number.isFinite(margin) ? margin * levUse : 0;
    const fee = notional * RULES.feeRate;
    const liq = m ? liqPrice(side, m.mark, levUse) : null;
    const balance = acct?.balance ?? 0;
    const full = view.positions.length >= RULES.maxOpen;
    const problem =
      !m || !m.fresh ? PILOT_COPY.priceUpdating
        : m.paused ? PILOT_COPY.paused
          : !(margin >= RULES.minMargin) ? `Minimum margin ${RULES.minMargin} pts`
            : margin + fee > balance ? "Not enough balance"
              : full ? `Up to ${RULES.maxOpen} open positions`
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
          <dt>Liquidation price</dt><dd>{liq === null ? "–" : fmtPx(liq)}</dd>
          <dt>Balance</dt><dd>{fmtPts(balance)} pts</dd>
          {acct?.equity !== null && acct?.equity !== undefined && (<><dt>Equity</dt><dd>{fmtPts(acct.equity)} pts</dd></>)}
        </dl>
        <div className="abi-pt-disc">{PILOT_DISCLAIMERS.map((d) => <p key={d}>{d}</p>)}</div>
        <button type="submit" className={`abi-pt-primary ${side}`} disabled={Boolean(problem) || busy}>{openLabel(side, levUse)}</button>
        {problem && <p className="abi-pt-note" role="status">{problem}</p>}
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
