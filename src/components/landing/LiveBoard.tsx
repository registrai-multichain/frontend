"use client";

import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { INDICES_URL, LIVE_BOARD } from "@/lib/landing";

type Row = { index: number; index_24h_ago: number | null; data_until: string; spark?: [string, number][] };
type Summary = Record<string, Row | null>;

/** SVG path of the last week's hourly closes (from the summary's `spark`), scaled to the box. */
function sparkPath(spark: [string, number][] | undefined, w = 120, h = 28): string | null {
  if (!spark || spark.length < 2) return null;
  const v = spark.map((x) => x[1]);
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  return v.map((y, k) => `${k ? "L" : "M"}${((k / (v.length - 1)) * w).toFixed(1)} ${(h - 2 - ((y - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
}

// One summary request per minute for every component on the page (board + chips).
let inflight: Promise<Summary> | null = null, fetchedAt = 0;
function getSummary(): Promise<Summary> {
  if (!inflight || Date.now() - fetchedAt > 55_000) {
    fetchedAt = Date.now();
    inflight = fetch(LIVE_BOARD.summaryUrl, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    inflight.catch(() => { inflight = null; });
  }
  return inflight;
}
function useSummary(set: (s: Summary) => void, fail: (f: boolean) => void) {
  useEffect(() => {
    let alive = true;
    const load = () => getSummary().then((j) => { if (alive) { set(j); fail(false); } }).catch(() => { if (alive) fail(true); });
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [set, fail]);
}

/** Indices card: the three latest closes as chips (same summary as the hero board). */
export function LiveChips() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  useSummary(setSummary, setFailed);
  return (
    <div className="lp-chips">
      {LIVE_BOARD.indices.map((x) => {
        const row = summary?.[x.key];
        const ch = row && row.index_24h_ago ? row.index / row.index_24h_ago - 1 : null;
        return (
          <a key={x.key} className="lp-chip" href={`${INDICES_URL}${x.key === "abi" ? "" : `?index=${x.key}`}`}>
            <span>{x.name}</span>
            <b>{row ? <AnimatedNumber value={row.index} decimals={2} duration={1200} /> : failed ? "—" : "····.··"}</b>
            {ch !== null && <small className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "+" : "−"}{Math.abs(ch * 100).toFixed(2)}%</small>}
          </a>
        );
      })}
    </div>
  );
}

/** Hero card: the latest Arc block (public RPC, every 6 s while the tab is visible; a failed or rate-limited call keeps the last block) and the three index closes (builder site summary,
 * every 60 s). Nothing is hard-coded: if a fetch fails the card shows a link instead of numbers. */
export function LiveBoard() {
  const [block, setBlock] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;                   // no polling from background tabs
      try {
        const r = await fetch(LIVE_BOARD.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const j = await r.json();
        if (alive && j.result) setBlock(parseInt(j.result, 16));
      } catch { /* keep the last value */ }
    };
    tick();
    const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useSummary(setSummary, setFailed);

  const until = summary ? Object.values(summary).find((r) => r)?.data_until ?? null : null;
  const hour = until ? new Date(until).toISOString().slice(11, 16) + " UTC" : null;

  return (
    <aside className="lp-board" aria-label={LIVE_BOARD.title}>
      <div className="lp-board-head">
        <span className="lp-board-title"><i aria-hidden="true" />{LIVE_BOARD.title}</span>
        <span className="lp-board-block">
          {LIVE_BOARD.block}{" "}
          {block === null ? <b className="lp-board-skel">··········</b> : <b key={block} className="lp-board-flip">#{block.toLocaleString("en-US")}</b>}
        </span>
      </div>
      <ul className="lp-board-rows">
        {LIVE_BOARD.indices.map((x, k) => {
          const row = summary?.[x.key];
          const ch = row && row.index_24h_ago ? row.index / row.index_24h_ago - 1 : null;
          return (
            <li key={x.key} style={{ ["--i" as string]: k }}>
              <a href={`${INDICES_URL}${x.key === "abi" ? "" : `?index=${x.key}`}`}>
                <span className="lp-board-name"><b>{x.name}</b><small>{x.label}</small></span>
                <span className="lp-board-spark" aria-hidden="true">
                  {sparkPath(row?.spark) && <svg viewBox="0 0 120 28" preserveAspectRatio="none"><path className={ch === null ? "" : ch >= 0 ? "up" : "down"} d={sparkPath(row?.spark)!} pathLength={1} /></svg>}
                </span>
                <span className="lp-board-val">
                  {row ? <AnimatedNumber value={row.index} decimals={2} duration={1400} /> : <span className="lp-board-skel">{failed ? "—" : "····.··"}</span>}
                  {ch !== null && <small className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "+" : "−"}{Math.abs(ch * 100).toFixed(2)}% 24h</small>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="lp-board-foot">
        <span>{failed ? <a href={INDICES_URL}>{LIVE_BOARD.fallback} →</a> : hour ? `Last close ${hour}` : "Loading the last close…"}</span>
        <span>{LIVE_BOARD.base}</span>
      </div>
    </aside>
  );
}
