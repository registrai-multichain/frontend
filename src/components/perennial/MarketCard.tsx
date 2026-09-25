"use client";

import Link from "next/link";
import type { ChainMarket } from "@/lib/perennial-chain";
import { statusShort, timeLeft, usdText } from "@/lib/plain-words";
import { holdingLabel, potOf, yesPct } from "@/lib/perennial-view";
import type { PerennialData } from "./usePerennialData";

export function MarketCard({ data, m, waiting, anchorId }: { data: PerennialData; m: ChainMarket; waiting?: bigint | null; anchorId?: string }) {
  const st = data.statusOf(m);
  const yp = yesPct(m);
  const wonder = data.isWonder(m);
  const metric = data.metricFor(m);
  const href = `/perennial/?market=${m.id}`;
  const meta = [
    st.canTrade ? timeLeft(data.chainNow, m.expiry) : statusShort(st.key),
    `${usdText(potOf(m))} in the pot`,
    holdingLabel(data.positionOf(m)),
    waiting && waiting > 0n ? `${usdText(waiting)} waiting for the team` : null,
  ].filter(Boolean);
  return (
    <li className="pa-card pa-mcard" id={anchorId}>
      <span className="pa-pill self-start" data-tone={wonder ? "unclaimed" : undefined}>
        {wonder ? `Unclaimed · ${data.subjectFor(m)}` : `${data.subjectFor(m)}${metric ? ` · ${metric}` : ""}`}
      </span>
      <Link href={href} className="pa-mcard-q">{data.questionFor(m)}</Link>
      <p className="pa-muted pa-small">{meta.join(" · ")}</p>
      <div className="pa-bar" aria-label={`${yp}% chance of Yes`}><i style={{ width: `${yp}%` }} /></div>
      {st.canTrade ? (
        <div className="pa-yn">
          <Link href={`${href}&side=yes`} className="pa-btn pa-btn--yes"><span>Yes</span><span className="tnum">{yp}¢</span></Link>
          <Link href={`${href}&side=no`} className="pa-btn pa-btn--no"><span>No</span><span className="tnum">{100 - yp}¢</span></Link>
        </div>
      ) : (
        <Link href={href} className="pa-btn pa-btn--quiet pa-btn--block">{statusShort(st.key)} · open</Link>
      )}
    </li>
  );
}
