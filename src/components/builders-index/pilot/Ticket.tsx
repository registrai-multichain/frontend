"use client";

import { useState } from "react";
import { InfoBubble } from "@/components/InfoBubble";
import { liqPrice, RULES, type Side } from "@/lib/abi-pilot";
import type { PilotAccountView } from "@/lib/abi-pilot-api";
import { fmtHour, fmtPts, fmtPx, fmtRate, openLabel, PILOT_COPY, PILOT_DISCLAIMER, PILOT_LIQ_NOTE } from "@/lib/abi-pilot-copy";

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

function FundingRow({ view }: { view: PilotAccountView }) {
  const f = view.funding;
  return (
    <>
      <dt>Funding <InfoBubble label="About funding">{PILOT_COPY.fundingTip}</InfoBubble></dt>
      <dd>{f.current === null ? "–" : fmtRate(f.current)} · next {fmtHour(f.next)} UTC</dd>
    </>
  );
}

/** The trade ticket: Long / Short, margin, leverage (capped from ABI's volatility), liquidation price, fee, funding. */
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
          <FundingRow view={view} />
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
    const liq = m && margin > 0 ? liqPrice({ side, margin, notional, entry: m.mark }, 0) : null;
    const balance = acct?.balance ?? 0;
    const full = view.positions.length >= RULES.maxOpen;
    const problem =
      !m || !m.fresh ? PILOT_COPY.priceUpdating
        : m.paused ? PILOT_COPY.paused
          : m.basePaused ? PILOT_COPY.basePaused
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
          <FundingRow view={view} />
          <dt>Balance</dt><dd>{fmtPts(balance)} pts</dd>
          {acct?.equity !== null && acct?.equity !== undefined && (<><dt>Equity</dt><dd>{fmtPts(acct.equity)} pts</dd></>)}
        </dl>
        <div className="abi-pt-disc"><p>{PILOT_DISCLAIMER}</p><p>{PILOT_LIQ_NOTE}</p></div>
        <button type="submit" className={`abi-pt-primary ${side}`} disabled={Boolean(problem) || busy}>{filling ? PILOT_COPY.filling : openLabel(side, levUse)}</button>
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
