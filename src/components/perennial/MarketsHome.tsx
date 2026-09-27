"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fundStatusNote } from "@/components/BuilderIncome";
import { durationText } from "@/lib/builder-economy";
import { humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { MARKET_TABS, isEnded, marketsForTab, topBuilder, yesPct, type MarketTab } from "@/lib/perennial-view";
import { usdText } from "@/lib/plain-words";
import { expiryDaysText, waitingAmount, wonderAnchor, wonderContracts } from "@/lib/wonder";
import { readExpiry, readWonderStatus, type WonderReader } from "@/lib/wonder-chain";
import { CreateMarket } from "./CreateMarket";
import { CreateWonderMarket } from "./CreateWonderMarket";
import { MarketCard } from "./MarketCard";
import type { PerennialData } from "./usePerennialData";
import { D, HUMAN, type PerennialTx } from "./usePerennialTx";

const W = wonderContracts(D);

export function MarketsHome({ data, tx, initialTab = "trending" }: { data: PerennialData; tx: PerennialTx; initialTab?: MarketTab }) {
  const [tab, setTab] = useState<MarketTab>(initialTab);
  const [create, setCreate] = useState<null | "builder" | "wonder">(null);
  const { ov, ovError } = data;

  const items = data.markets.map((m) => {
    const st = data.statusOf(m);
    return { m, createdAt: m.createdAt, expiry: m.expiry, yesPct: yesPct(m), canTrade: st.canTrade, wonder: data.isWonder(m), ended: isEnded(st.key) };
  });
  const shown = marketsForTab(items, tab);

  // Unclaimed projects: what is held for each team, and the escrow's expiry.
  const sources = useMemo(
    () => [...new Set(data.markets.filter(data.isWonder).map((m) => m.subject!.source!))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.markets],
  );
  const { data: wonder } = useSWR(
    W && sources.length ? ["perennial-wonder", W.escrow, sources.join("|")] : null,
    async () => {
      const c = data.publicClient as unknown as WonderReader;
      const [status, expiry] = await Promise.all([readWonderStatus(c, W!, sources), readExpiry(c, W!)]);
      return { status, expiry };
    },
    { revalidateOnFocus: false },
  );
  const waitingFor = (source: string) =>
    wonder ? waitingAmount(wonder.status[source], Math.floor(Date.now() / 1000), wonder.expiry) : null;

  // /perennial/wonder/#wonder-<source>: scroll to that project's first card once it renders.
  useEffect(() => {
    const id = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (id && ov) document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, [ov, tab]);

  const econ = ov?.economy ?? null;
  const top = topBuilder(data.builders, (id) => data.incomeOf(id));
  const fundNote = ov ? fundStatusNote(ov.fundStatus, D.label) : undefined;
  const seen = new Set<string>();

  const empty = !ov
    ? ovError ? "Couldn't load markets. Retrying every 30 seconds." : "Reading markets…"
    : tab === "unclaimed" ? "No markets about unclaimed projects yet."
    : tab === "ended" ? "No market has ended yet."
    : "No markets yet — open the first one.";

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="pa-h1 pu-h">What will builders ship?</h1>
          <p className="pa-lede">Bet on real milestones. Half of the 1% fee goes to the builder who shipped it.</p>
        </div>
        {tx.needsConnect ? (
          <button type="button" className="pa-btn pa-btn--quiet pu-btn pu-btn--quiet" onClick={tx.connectOrSwitch}>Connect to open a market</button>
        ) : (
          <button type="button" className="pa-btn pa-btn--quiet pu-btn pu-btn--quiet" onClick={() => setCreate(tab === "unclaimed" && W ? "wonder" : "builder")}>+ Open a market</button>
        )}
      </header>

      <div className="mt-5 pa-stack">
        {!PERENNIAL_WRITES_ENABLED && <p className="pa-notice" data-tone="down">Trading is paused. Prices stay live.</p>}
        {ovError && ov && <p className="pa-notice" data-tone="down">Couldn&apos;t refresh from {D.label}: {humanizeError(ovError, HUMAN)} Showing the last good read.</p>}
        {ov && !ov.supportsSettlement && <p className="pa-notice">This network runs the older markets contract: markets settle through the operator, and new markets open after its upgrade.</p>}
        {fundNote && <p className="pa-notice">{fundNote} <Link className="pa-link" href="/perennial/economy/">How builder income works</Link></p>}
      </div>

      <nav className="pa-tabs mt-6" aria-label="Filter markets">
        {MARKET_TABS.map((t) => (
          <button key={t.key} type="button" className="pa-tab" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>

      {tab === "unclaimed" && (
        <p className="pa-muted mt-4 max-w-[62ch]">
          Markets about projects that haven&apos;t joined Registrai yet. Half of each fee is held for the team until they claim the
          project; unclaimed after {expiryDaysText(wonder?.expiry ?? null)}, 90% of it goes to the season pool and 10% to the treasury.
        </p>
      )}

      {shown.length ? (
        <ul className="pa-grid mt-5">
          {shown.map(({ m }) => {
            const src = data.isWonder(m) ? m.subject!.source! : undefined;
            const anchorId = src && !seen.has(src) ? (seen.add(src), wonderAnchor(src)) : undefined;
            return <MarketCard key={m.id} data={data} m={m} waiting={src ? waitingFor(src) : undefined} anchorId={anchorId} />;
          })}
        </ul>
      ) : (
        <div className="pa-card pu-card pu-card--static mt-5 text-center">
          <p>{empty}</p>
          {ov && tab !== "ended" && !tx.needsConnect && (
            <button type="button" className="pa-btn pu-btn pu-btn--primary mt-3" onClick={() => setCreate(tab === "unclaimed" && W ? "wonder" : "builder")}>Open a market</button>
          )}
        </div>
      )}

      {ov?.discovery.partial && <p className="pa-muted pa-small mt-3">Still reading older markets…</p>}
      {ov && ov.hiddenUnapproved > 0 && <p className="pa-muted pa-small mt-1">{ov.hiddenUnapproved} market(s) on unapproved feeds are hidden.</p>}

      <section className="pa-strip mt-10" aria-label="This epoch">
        <div className="pa-card pu-card pu-card--static"><span className="pa-muted pa-small">Builder income held</span><b className="pu-h">{econ ? usdText(econ.outstanding) : "—"}</b></div>
        <div className="pa-card pu-card pu-card--static"><span className="pa-muted pa-small">Season pool</span><b className="pu-h">{econ ? usdText(econ.unallocated) : "—"}</b></div>
        <div className="pa-card pu-card pu-card--static"><span className="pa-muted pa-small">Epoch {econ ? econ.epoch.toString() : ""} ends in</span><b className="pu-h">{econ && data.chainNow ? durationText(econ.epochEndsAt - data.chainNow) : "—"}</b></div>
        <div className="pa-card pu-card pu-card--static"><span className="pa-muted pa-small">Top builder this epoch</span><b className="pu-h">{top ? top.name : "—"}</b></div>
      </section>

      {create === "builder" && <CreateMarket data={data} tx={tx} onClose={() => setCreate(null)} />}
      {create === "wonder" && <CreateWonderMarket data={data} onClose={() => setCreate(null)} />}
    </>
  );
}
