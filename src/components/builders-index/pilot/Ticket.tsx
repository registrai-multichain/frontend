"use client";

import { useState, type ReactNode } from "react";
import { InfoBubble } from "@/components/InfoBubble";
import { borrowPaid, liqPrice, RULES, type Side } from "@/lib/abi-pilot";
import { fmtRegi, fmtUsd, marketCode, type PilotAccountView } from "@/lib/abi-pilot-api";
import { leverageUnlocked, NO_CHAIN, type LockChain } from "@/lib/abi-pilot-lock";
import { borrowPerDay, fmtHour, fmtPts, fmtPx, fmtSideRate, openLabel, PILOT_COPY, PILOT_DISCLAIMER, PILOT_JUMP_NOTE, PILOT_LIQ_NOTE } from "@/lib/abi-pilot-copy";

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
  /** The signed-in wallet's REGI and lock, read from Arc by the panel (plan 2026-10-13 R6); unknown by default. */
  lock?: LockChain;
  /** The REGI lock box (RegiLock), shown under the ticket while signed in. */
  lockBox?: ReactNode;
}

/** Sign-in needs the 18+ and Terms confirmation first; the signed message repeats it (PILOT_LOGIN_NOTE). */
function SignInRow({ label, busy, admitUsd, regiSnapshot, onSignIn }: { label: string; busy?: boolean; admitUsd: number; regiSnapshot: boolean; onSignIn: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <>
      <label className="abi-pt-agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{" "}
        {PILOT_COPY.agreeBefore}<a href="/terms/" target="_blank" rel="noopener">{PILOT_COPY.agreeTerms}</a>{PILOT_COPY.agreeAnd}
        <a href="/privacy/" target="_blank" rel="noopener">{PILOT_COPY.agreePrivacy}</a>{PILOT_COPY.agreeAfter}
      </label>
      <div className="abi-pt-row">
        <button type="button" className="abi-pt-primary" onClick={onSignIn} disabled={busy || !agreed}>{busy ? PILOT_COPY.signingIn : label}</button>
        <InfoBubble label="About sign-in">{PILOT_COPY.signInTip(admitUsd, regiSnapshot)}</InfoBubble>
      </div>
    </>
  );
}

/**
 * The last known REGI state of a signed-in wallet, as a note: unknown is never shown as "no REGI". The server decides
 * at each order on a fresh read (owner decision 2026-10-12), so only a missed snapshot (it can't change) hides the form.
 */
function regiLine(view: PilotAccountView): { text: string; final: boolean } | null {
  const r = view.regi;
  if (view.address && view.price === null) return { text: PILOT_COPY.regiPriceUpdating, final: false };
  if (!r || r.ok === true) return null;
  if (r.snapshot === false) return { text: PILOT_COPY.notAtSnapshot, final: true };
  return { text: r.ok === null ? PILOT_COPY.regiUnchecked : PILOT_COPY.holdRegi(view.admitUsd), final: false };
}

/** R6: the admission amount in REGI at the 24 h median ("REGI price updating" while it is unknown), and the wallet's REGI. */
function AdmitRows({ view, regi }: { view: PilotAccountView; regi?: bigint | null }) {
  return (
    <>
      <dt>To join <InfoBubble label="About the REGI price">{PILOT_COPY.priceTip}</InfoBubble></dt>
      <dd>{view.admitRegi === null ? PILOT_COPY.regiPriceUpdating : `${fmtRegi(view.admitRegi, true)} ≈ ${fmtUsd(view.admitUsd)}`}</dd>
      {regi !== undefined && (<><dt>Your REGI</dt><dd>{regi === null ? "–" : fmtRegi(regi)}</dd></>)}
    </>
  );
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

/**
 * The trade ticket for the page's market (view.market: the index tab): Long / Short, margin, leverage (capped),
 * liquidation price with costs, fee, borrow, funding. One balance across markets; one direction and the open-position
 * limit per market.
 */
export function Ticket({ view, busy, filling, error, signInLabel, signingIn, onSignIn, onSignOut, onOrder, lock = NO_CHAIN, lockBox }: TicketProps) {
  const [side, setSide] = useState<Side>("long");
  const [lev, setLev] = useState(1);
  const [marginText, setMarginText] = useState("100");
  const m = view.mark;
  const acct = view.account;
  const regi = regiLine(view);
  const code = marketCode(view.market);

  const head = (
    <div className="abi-ph">
      <h2>{PILOT_COPY.heading} · {code}</h2>
      <InfoBubble label="About the points pilot">{PILOT_COPY.marketsRule} {PILOT_COPY.rulesTip}</InfoBubble>
      {view.address && <span className="sp"><button type="button" className="abi-pt-link" onClick={onSignOut}>{PILOT_COPY.signOut}</button></span>}
    </div>
  );
  const disclaimer = <div className="abi-pt-disc"><p>{PILOT_DISCLAIMER}</p><p>{PILOT_JUMP_NOTE}</p></div>;

  const closedLine = view.misconfigured ? PILOT_COPY.misconfigured : PILOT_COPY.closed;
  let body: React.ReactNode;
  if (!view.address) {
    body = (
      <div className="abi-pt">
        <p className="abi-pt-note">{view.open ? PILOT_COPY.holdRegi(view.admitUsd) : closedLine}</p>
        {view.open && <dl className="abi-kv abi-pt-kv"><AdmitRows view={view} /></dl>}
        {view.open && <SignInRow label={signInLabel} busy={signingIn} admitUsd={view.admitUsd} regiSnapshot={view.regiSnapshot} onSignIn={onSignIn} />}
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
        {disclaimer}
      </div>
    );
  } else if (!view.open || regi?.final) {
    body = (
      <div className="abi-pt">
        <p className="abi-pt-note">{!view.open ? closedLine : regi!.text}</p>
        <dl className="abi-kv abi-pt-kv">
          {acct && <><dt>Balance</dt><dd>{fmtPts(acct.balance)} pts</dd></>}
          <AdmitRows view={view} regi={lock.regi} />
          <FundingRows view={view} />
        </dl>
        {error && <p className="abi-pt-err" role="alert">{error}</p>}
        {disclaimer}
      </div>
    );
  } else {
    const margin = Number(marginText);
    // R3: above 1× only with enough REGI locked (read from Arc); the engine's and the pilot's caps on top
    const unlocked = leverageUnlocked(view, lock);
    const maxLev = m && unlocked ? m.maxLev : 1;
    // the pilot's cap (PILOT_MAX_LEV): no level above it is offered at all; the engine's lower cap disables levels
    const levels = RULES.levels.filter((l) => l <= (m ? m.levCap : 1));
    const levUse = levels.filter((l) => l <= Math.min(lev, maxLev)).pop() ?? 1;
    const notional = Number.isFinite(margin) ? margin * levUse : 0;
    const fee = notional * RULES.feeRate;
    const pos = m && margin > 0 ? { side, margin, notional, entry: m.mark, openedAt: 0 } : null;
    const liq = pos ? liqPrice(pos, 0) : null;
    // a day on: 24 h of borrow plus 24 h of this hour's funding for the side (+ = paid)
    const sideRate = side === "long" ? view.funding.long : view.funding.short;
    const liq24 = pos ? liqPrice(pos, borrowPaid(pos, 86400) + (sideRate ?? 0) * notional * 24) : null;
    const borrowDay = margin > 0 ? borrowPerDay(notional, margin) : 0;
    const balance = acct?.balance ?? 0;
    const here = view.positions.filter((p) => p.market === view.market);
    const full = here.length >= RULES.maxOpen;
    const held = here[0]?.side;
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
        {regi && <p className="abi-pt-note" role="status">{regi.text}</p>}
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
            {levels.map((l) => (
              <button key={l} type="button" aria-pressed={levUse === l} disabled={l > maxLev} onClick={() => setLev(l)}>{l}×</button>
            ))}
          </div>
        </div>
        {m && unlocked && maxLev < m.levCap && <p className="abi-pt-note">{PILOT_COPY.capped(maxLev, code)}</p>}
        {!unlocked && levels.length > 1 && (
          <p className="abi-pt-note" role="status">{view.lockFactory === null ? PILOT_COPY.lockNotLive : view.lockRegi === null ? PILOT_COPY.regiPriceUpdating : PILOT_COPY.lockNeeded(view.lockUsd)}</p>
        )}
        <dl className="abi-kv abi-pt-kv">
          <dt>{code} mark</dt><dd>{m ? fmtPx(m.mark) : "–"}</dd>
          <dt>Size</dt><dd>{fmtPts(notional)} pts</dd>
          <dt>Fee</dt><dd>{fmtPts(fee)} pts</dd>
          <dt>Borrow <InfoBubble label="About borrow">{PILOT_COPY.borrowTip}</InfoBubble></dt><dd>{fmtPts(borrowDay)} pts/day</dd>
          <dt>Liquidation price <InfoBubble label="About the liquidation price">{PILOT_COPY.liqTip}</InfoBubble></dt>
          <dd>{liq === null || liq24 === null ? "–" : <>{fmtPx(liq)} · {fmtPx(liq24)} in 24 h</>}</dd>
          <FundingRows view={view} />
          <dt>Balance</dt><dd>{fmtPts(balance)} pts</dd>
          <AdmitRows view={view} regi={lock.regi} />
          {acct?.equity !== null && acct?.equity !== undefined && (<><dt>Equity</dt><dd>{fmtPts(acct.equity)} pts</dd></>)}
        </dl>
        <div className="abi-pt-disc"><p>{PILOT_DISCLAIMER}</p><p>{PILOT_LIQ_NOTE}</p><p>{PILOT_JUMP_NOTE}</p></div>
        <button type="submit" className={`abi-pt-primary ${side}`} disabled={Boolean(problem) || busy}>{filling ? PILOT_COPY.filling : openLabel(side, levUse, code)}</button>
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
    <aside className="abi-panel abi-pt-panel" aria-label={`Points pilot ticket, ${code}`}>
      {head}
      {body}
      {view.address && lockBox}
    </aside>
  );
}
