"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { InfoBubble } from "@/components/InfoBubble";
import { projectHref } from "@/lib/project-page";
import { createEngine, StaleError, type Candle, type LiveResult } from "@/lib/abi-live";
import { validateSeen, type AbiData } from "@/lib/builders-index";
import {
  barAt, candleList, chartModel, cls, coinRows, fmt, hm, hms, members, methodRows, milestoneRows, nameOf, ohlcLine, openHour, pct, quote, RANGE_BARS, RANGE_KEYS, rollOff, sgn,
  status, tapeRows, freshKeys, rowKey, rowKeys, tickerItems, ts, usdFmt, why, type Bar, type ChartModel, type RangeKey, type SortKey,
} from "@/lib/abi-terminal";
import { ABI_COPY, abiPath, abiSeenPath, abiState, baseTip, coinsTip, decayTip, type AbiState } from "@/lib/builders-index-page";
import "./terminal.css";

async function load(path = abiPath): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(path, { cache: "no-store" });
    let body: unknown = {};
    try { body = await r.json(); } catch { /* empty body */ }
    return { status: r.status, body };
  } catch {
    return { status: 0, body: {} };
  }
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="abi-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function QuoteBar({ d, bars, st }: { d: AbiData; bars: Bar[]; st: { kind: string; text: string } }) {
  const q = quote(d, bars);
  const px = q?.px ?? null;
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (px === null) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (prev.current !== null && Math.abs(px - prev.current) >= 0.005) {
      setFlash(px > prev.current ? "flash-up" : "flash-down");
      t = setTimeout(() => setFlash(""), 900);
    }
    prev.current = px;
    return () => { if (t) clearTimeout(t); };
  }, [px]);
  const Q = ({ k, v, tip }: { k: string; v: React.ReactNode; tip?: React.ReactNode }) => (
    <div className="abi-q"><span className="k">{k}{tip}</span><span className="v">{v}</span></div>
  );
  return (
    <header className="abi-quote">
      <div className="abi-sym"><h1 style={{ margin: 0 }}><b>{ABI_COPY.heading}</b></h1><small>ABI · Arc mainnet · Tabula</small></div>
      <div className="abi-px">
        <span className={`v ${flash}`} aria-label="ABI price">{q ? fmt(q.px) : "–"}</span>
        {q && <span className={`ch ${cls(q.d24)}`}>{sgn(q.chg24)} ({pct(q.d24)}) 24h</span>}
      </div>
      {q && (
        <div className="abi-qs">
          <Q k="Pace 24h" tip={<InfoBubble label="About pace">{ABI_COPY.pace}</InfoBubble>} v={q.pace === null ? "–" : <span className={q.pace >= 100 ? "up" : "down"}>{Math.round(q.pace)}%</span>} />
          <Q k="1h" v={<span className={cls(q.h1)}>{pct(q.h1)}</span>} />
          <Q k="24h high" v={fmt(q.hi)} />
          <Q k="24h low" v={fmt(q.lo)} />
          <Q k="24h payments" v={q.pay.toLocaleString("en-US")} />
          <Q k="24h USD in" v={fmt(q.usd, 0)} />
          <Q k="Since base" tip={<InfoBubble label="About the base">{baseTip(d)}</InfoBubble>} v={<span className={cls(q.sinceBase)}>{pct(q.sinceBase)}</span>} />
        </div>
      )}
      <div className={`abi-status ${st.kind}`} role="status"><span className="abi-dot" /><span>{st.text}</span></div>
    </header>
  );
}

function Ticker({ d }: { d: AbiData }) {
  const items = useMemo(() => tickerItems(d), [d.data_until]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (dup: boolean) => items.map((it) => (
    <span key={`${dup}-${it.name}`}><b>{it.name}</b>{it.share}{it.pts !== null && <> <span className={it.ptsClass}>{it.pts}</span></>}</span>
  ));
  return <div className="abi-ticker" role="group" aria-label="Members"><div className="abi-ticker-in">{row(false)}<span className="abi-dup" aria-hidden="true" style={{ display: "contents" }}>{row(true)}</span></div></div>;
}

function ChartPanel({ d, bars }: { d: AbiData; bars: Bar[] }) {
  const [range, setRange] = useState<RangeKey>("24H");
  const [kind, setKind] = useState<"c" | "l">("c");
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 470 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setSize({ w: Math.max(240, Math.floor(el.clientWidth)), h: Math.max(200, Math.floor(el.clientHeight)) });
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = RANGE_BARS[range];
  const cs = n ? bars.slice(-n) : bars;
  const m: ChartModel | null = chartModel(cs, size.w, size.h, d.base.level, d.milestones);
  const hi = hover !== null && hover < cs.length ? hover : null;
  const shown = cs[hi ?? cs.length - 1];
  const o = shown ? ohlcLine(shown) : null;
  const onKey = (e: React.KeyboardEvent) => {
    const last = cs.length - 1;
    const at = hi ?? last;
    const to = e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to !== null) { e.preventDefault(); setHover(Math.max(0, Math.min(last, to))); }
    else if (e.key === "Escape") setHover(null);
  };
  return (
    <section className="abi-panel" aria-label="Chart">
      <div className="abi-ph">
        <h2>ABI · 1H</h2>
        {o && (
          <div className="abi-ohlc" id="abi-ohlc">
            <span>{o.when}</span><span>O <b>{o.o}</b></span><span>H <b>{o.h}</b></span><span>L <b>{o.l}</b></span>
            <span>C <b className={cls(o.chg)}>{o.c}</b></span><span className={cls(o.chg)}>{sgn(o.chg)}</span><span>{o.n}</span><span>{o.usd}</span>
          </div>
        )}
        <span className="sp" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <Seg label="Range" value={range} options={RANGE_KEYS.map((k) => ({ v: k, label: k }))} onChange={(v) => { setRange(v); setHover(null); }} />
          <Seg label="Chart type" value={kind} options={[{ v: "c", label: "Candles" }, { v: "l", label: "Line" }]} onChange={setKind} />
        </span>
      </div>
      <div className="abi-chart" ref={box}>
        {m ? (
          <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="img" tabIndex={0} aria-describedby="abi-ohlc"
            aria-label="ABI hourly candles with USDC volume. Use the left and right arrow keys to read each hour."
            onKeyDown={onKey} onFocus={() => setHover((h) => h ?? cs.length - 1)} onBlur={() => setHover(null)}>
            {m.grid.map((g) => (
              <g key={g.label}>
                <line x1={m.pad.l} x2={m.W - m.pad.r} y1={g.y} y2={g.y} stroke="var(--abi-grid)" />
                <text x={m.W - m.pad.r + 8} y={g.y + 3.5}>{g.label}</text>
              </g>
            ))}
            {m.marks.map((k) => (
              <g key={k.x}>
                <line x1={k.x} x2={k.x} y1={m.pad.t} y2={m.H - m.pad.b} stroke="var(--abi-grid)" />
                <text x={k.x} y={m.H - 7} textAnchor="middle">{k.label}</text>
              </g>
            ))}
            {m.baseY !== null && (<><line x1={m.pad.l} x2={m.W - m.pad.r} y1={m.baseY} y2={m.baseY} stroke="var(--abi-faint)" strokeDasharray="4 4" /><text x={m.pad.l + 4} y={m.baseY - 5}>base {fmt(d.base.level, 0)}</text></>)}
            {m.bars.map((b, i) => (
              <rect key={`v${i}`} x={b.x - m.bw / 2} y={b.vy} width={m.bw} height={b.vh} fill={b.up ? "var(--abi-up)" : "var(--abi-down)"} opacity={b.live ? 0.55 : 0.32} />
            ))}
            <text x={m.W - m.pad.r + 8} y={m.volTop + 9}>USD/h</text>
            {kind === "c" ? m.bars.map((b, i) => {
              const col = b.up ? "var(--abi-up)" : "var(--abi-down)";
              return (
                <g key={`c${i}`}>
                  <line x1={b.x} x2={b.x} y1={b.yH} y2={b.yL} stroke={col} strokeWidth={1} />
                  <rect x={b.x - m.bw / 2} y={b.yTop} width={m.bw} height={b.body} fill={col} opacity={b.live ? 0.85 : 1} />
                </g>
              );
            }) : <path d={m.line} fill="none" stroke="var(--abi-accent)" strokeWidth={1.6} strokeLinejoin="round" />}
            {m.ms.map((k, i) => (
              <path key={`m${i}`} className="abi-ms-mark" d={`M${k.x - 5} ${k.y - 12} L${k.x + 5} ${k.y - 12} L${k.x} ${k.y - 4} Z`} fill="var(--abi-accent)"><title>{k.label}</title></path>
            ))}
            <line x1={m.pad.l} x2={m.W - m.pad.r} y1={m.last.y} y2={m.last.y} stroke={m.last.up ? "var(--abi-up)" : "var(--abi-down)"} strokeDasharray="2 3" opacity={0.7} />
            <rect x={m.W - m.pad.r + 2} y={m.last.y - 9} width={m.pad.r - 4} height={18} rx={2} fill={m.last.up ? "var(--abi-up)" : "var(--abi-down)"} />
            <text x={m.W - m.pad.r + 7} y={m.last.y + 4} style={{ fill: "var(--abi-bg)", fontWeight: 600 }}>{m.last.label}</text>
            {hi !== null && <line x1={m.bars[hi].x} x2={m.bars[hi].x} y1={m.pad.t} y2={m.H - m.pad.b} stroke="var(--abi-line2)" />}
            <rect x={m.pad.l} y={0} width={m.W - m.pad.l - m.pad.r} height={m.H} fill="transparent" style={{ touchAction: "pan-y" }}
              onPointerMove={(e) => setHover(barAt(m, e.clientX - e.currentTarget.ownerSVGElement!.getBoundingClientRect().left))}
              onPointerLeave={() => setHover(null)} />
          </svg>
        ) : <p className="abi-msg" style={{ padding: 12 }}>No points in this range.</p>}
      </div>
    </section>
  );
}

function WhyPanel({ d, R }: { d: AbiData; R: LiveResult | null }) {
  const [win, setWin] = useState<"24h" | "1h">("24h");
  const w = why(d, R, win);
  return (
    <section className="abi-panel" aria-label="Why ABI moved">
      <div className="abi-ph">
        <h2>Why ABI moved</h2><InfoBubble label="About this breakdown">{ABI_COPY.why}</InfoBubble>
        <span className="sp"><Seg label="Window" value={win} options={[{ v: "24h", label: "24h" }, { v: "1h", label: "This hour" }]} onChange={setWin} /></span>
      </div>
      <div className="abi-why">
        {w ? w.rows.map((r) => {
          const width = (50 * Math.abs(r.v)) / w.mx, col = r.v < 0 ? "var(--abi-down)" : "var(--abi-up)";
          return (
            <div key={r.l} className={`abi-wr ${r.kind ?? ""}`}>
              <span className="l">{r.l}</span>
              <span className="b"><i style={{ [r.v < 0 ? "right" : "left"]: "50%", width: `${width}%`, background: col }} /></span>
              <span className={`v ${cls(r.v)}`}>{sgn(r.v)}</span>
            </div>
          );
        }) : <p className="abi-msg">Not available for this file.</p>}
        {w && <p className="cap">{win === "24h" ? "Index points over the last 24 hours." : "Index points since the hour opened."} New payments add; older activity rolls off.</p>}
      </div>
    </section>
  );
}

function TapePanel({ d, R }: { d: AbiData; R: LiveResult | null }) {
  const [minUsd, setMin] = useState(0);
  const rows = tapeRows(d, R, minUsd);
  // rows already shown (null until the first paint, so the initial list does not flash)
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const fresh = freshKeys(rows, seen);
  const keys = rowKeys(rows);
  useEffect(() => {
    setSeen((prev) => (prev && keys.every((k) => prev.has(k)) ? prev : new Set([...(prev ?? []), ...keys])));
  }, [keys.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="abi-panel abi-tape" aria-label="Time and sales">
      <div className="abi-ph">
        <h2>Time &amp; sales</h2>
        <span className="sp"><Seg label="Minimum payment" value={minUsd} options={[{ v: 0, label: "All" }, { v: 1, label: "≥ $1" }, { v: 10, label: "≥ $10" }]} onChange={setMin} /></span>
      </div>
      <div className="abi-tape-h"><span>Time</span><span>Project</span><span className="r">USDC</span><span className="r">Pts</span></div>
      <div className="abi-tape-b">
        {rows.length === 0 && <div className="abi-tape-r"><span className="dim" style={{ gridColumn: "1/-1" }}>No payments in the last hours.</span></div>}
        {rows.map((r, i) => r.sep ? <div key={`sep${i}`} className="abi-tape-sep">Closed hours</div> : (
          <div key={`${rowKey(r)}|${i}`} className={`abi-tape-r${fresh.has(rowKey(r)) ? " fresh" : ""}`}>
            <span className="dim">{r.k > 1 ? hm(r.t) : hms(r.t)}</span>
            <span className="p">{nameOf(d, r.s)}{r.k > 1 && <span className="abi-cnt">×{r.k}</span>}{r.n && <span className="abi-nb">new</span>}</span>
            <span className="r">{usdFmt(r.v)}</span><span className="r up">+{fmt(r.p, 2)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const COLS: { k: SortKey; label: string; x?: boolean }[] = [
  { k: "name", label: "Project" }, { k: "share", label: "Weight" }, { k: "dbase", label: "Δ base", x: true }, { k: "h1", label: "Pts this hour" },
  { k: "d1", label: "Pts 24h", x: true }, { k: "pace", label: "Pace" }, { k: "pay", label: "Payments 24h", x: true }, { k: "usd", label: "USD 24h", x: true },
];

function MembersPanel({ d, R }: { d: AbiData; R: LiveResult | null }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "share", dir: -1 });
  const ms = members(d, R, sort.k, sort.dir);
  const maxS = Math.max(...ms.map((m) => m.share), 1e-9);
  const click = (k: SortKey) => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "name" ? 1 : -1 }));
  return (
    <section className="abi-panel" aria-label="Members">
      <div className="abi-ph">
        <h2>Members</h2><span className="mono dim" style={{ fontSize: 10.5 }}>{ms.filter((m) => !m.base).length} projects + Arc base layer</span>
        <span className="sp"><InfoBubble label="About weights">{ABI_COPY.weight}</InfoBubble></span>
      </div>
      <div className="abi-tbl">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k} className={`${c.x ? "abi-x" : ""}${sort.k === c.k ? " on" : ""}`} aria-sort={sort.k === c.k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => click(c.k)}>{c.label}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ms.map((m) => (
              <tr key={m.source}>
                <td className="n">{m.base ? m.name : <Link className="pa-link" href={projectHref(m.source)}>{m.name}</Link>}{m.base && <span className="abi-tag">chain-wide</span>}</td>
                <td>{m.share.toFixed(2)}%<span className={`abi-wbar${m.base ? " base" : ""}`}><i style={{ width: `${((100 * m.share) / maxS).toFixed(1)}%`, display: "block" }} /></span></td>
                <td className={`abi-x ${m.dbase === null ? "" : cls(Math.abs(m.dbase) < 0.005 ? 0 : m.dbase)}`}>{m.dbase === null ? <span className="abi-tag">new</span> : sgn(m.dbase)}</td>
                {m.base ? (<><td className="dim">–</td><td className="abi-x dim">–</td><td className="dim">–</td><td className="abi-x dim">–</td><td className="abi-x dim">–</td></>) : (<>
                  <td className={m.h1 > 0 ? "up" : "dim"}>{m.h1 > 0 ? `+${fmt(m.h1, 1)}` : "0.0"}</td>
                  <td className="abi-x">{fmt(m.d1, 1)}</td>
                  <td className={m.pace === null ? "dim" : m.pace >= 100 ? "up" : "down"}>{m.pace === null ? "–" : `${Math.round(m.pace)}%`}</td>
                  <td className="abi-x">{m.pay.toLocaleString("en-US")}</td>
                  <td className="abi-x">{fmt(m.usd, 2)}</td>
                </>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CoinsPanel({ d, R }: { d: AbiData; R: LiveResult | null }) {
  const rows = coinRows(d, R);
  return (
    <section className="abi-panel" aria-label="Stablecoins">
      <div className="abi-ph"><h2>Stablecoins · 24h</h2><InfoBubble label="About stablecoins">{coinsTip(d)}</InfoBubble></div>
      <div className="abi-tbl">
        <table>
          <thead><tr><th>Coin</th><th>Into members</th><th>Arc (est.)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sym}>
                <td className="n" title={r.issuer || undefined}>{r.sym}<span className="abi-cc">{r.ccy}</span></td>
                <td>{r.membersUsd ? <>${fmt(r.membersUsd, 0)}<span className="abi-cc">{r.membersPayments.toLocaleString("en-US")}</span></> : <span className="dim">–</span>}</td>
                <td>{r.baseUsd ? `$${fmt(r.baseUsd, 0)}` : <span className="dim">{r.from ? `from ${r.from}` : "–"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MilestonesPanel({ d }: { d: AbiData }) {
  const rows = milestoneRows(d);
  return (
    <section className="abi-panel" aria-label="Milestones">
      <div className="abi-ph"><h2>Milestones</h2><InfoBubble label="About milestones">{ABI_COPY.milestones}</InfoBubble></div>
      <div className="abi-msl">
        {rows.length === 0 ? <p className="abi-ms-empty">{ABI_COPY.noMilestones}</p> : rows.map((m) => (
          <div key={m.id} className="abi-ms">
            <span className="dim mono">{m.day}</span>
            <span className="t">{m.title}<span className="abi-cc">{m.target}</span></span>
            <span className="x">{m.mult}</span>
            <span className="ev">
              {m.evidence.map((e, i) => (
                <a key={`${e.href}|${i}`} href={e.href} target="_blank" rel="noopener noreferrer nofollow">{e.text}</a>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Countdown({ R }: { R: LiveResult | null }) {
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now() / 1000); const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);
  const oh = openHour(R);
  return <>{oh && now ? oh.left(now) : "–"}</>;
}

function SidePanel({ d, R }: { d: AbiData; R: LiveResult | null }) {
  const oh = openHour(R);
  const ro = rollOff(d);
  return (
    <section className="abi-panel" aria-label="Open hour and method">
      <div className="abi-ph"><h2>Open hour</h2><span className="sp mono dim" style={{ fontSize: 10.5 }}>{oh ? oh.span : "waiting for live data"}</span></div>
      <dl className="abi-kv">
        <dt>Open</dt><dd>{oh ? fmt(oh.o) : "–"}</dd>
        <dt>High</dt><dd>{oh ? fmt(oh.h) : "–"}</dd>
        <dt>Low</dt><dd>{oh ? fmt(oh.l) : "–"}</dd>
        <dt>Last</dt><dd>{oh ? <span className={cls(oh.c - oh.o)}>{fmt(oh.c)}</span> : "–"}</dd>
        <dt>Payments</dt><dd>{oh ? oh.n.toLocaleString("en-US") : "–"}</dd>
        <dt>USD in</dt><dd>{oh ? fmt(oh.u, 2) : "–"}</dd>
        <dt>Closes in <InfoBubble label="About the hourly close">{ABI_COPY.close}</InfoBubble></dt><dd><Countdown R={R} /></dd>
      </dl>
      <div className="abi-ph abi-sepline"><h2>Method</h2><InfoBubble label="About the inputs">{ABI_COPY.inputs}</InfoBubble></div>
      <dl className="abi-kv">
        {methodRows(d).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>))}
        <dt>Roll-off · {ro.halfLife} <InfoBubble label="About roll-off">{decayTip(d)}</InfoBubble></dt><dd>{ro.perHour}</dd>
        <dt>Snapshot</dt><dd title={d.base.sha256}>{d.base.sha256.slice(0, 8)}…{d.base.sha256.slice(-6)}</dd>
        <dt>Block</dt><dd>{(R ? R.head : d.head_block).toLocaleString("en-US")}</dd>
      </dl>
    </section>
  );
}

export function Terminal({ d, R, closedLocal, st }: { d: AbiData; R: LiveResult | null; closedLocal: Candle[]; st: { kind: string; text: string } }) {
  const bars = useMemo(() => candleList(d, closedLocal, R), [d, closedLocal, R]);
  return (
    <div className="abi-t">
      <QuoteBar d={d} bars={bars} st={st} />
      <Ticker d={d} />
      <div className="abi-row top">
        <ChartPanel d={d} bars={bars} />
        <div className="abi-side"><WhyPanel d={d} R={R} /><TapePanel d={d} R={R} /></div>
      </div>
      <div className="abi-row bot">
        <MembersPanel d={d} R={R} />
        <aside className="abi-side" aria-label="Stablecoins, milestones, open hour">
          <CoinsPanel d={d} R={R} />
          <MilestonesPanel d={d} />
          <SidePanel d={d} R={R} />
        </aside>
      </div>
      <footer className="abi-foot">
        <span>Closed by Tabula through {hm(ts(d.data_until))} UTC{R ? " · open hour computed in this browser from Arc RPC" : ""}</span>
        <span>Data only <InfoBubble label="About the data">{ABI_COPY.openHour}</InfoBubble></span>
      </footer>
    </div>
  );
}

const TICK_MS = 5000;
const POLL_MS = 60 * 1000;

export function IndexPage() {
  const [state, setState] = useState<AbiState>({ kind: "loading" });
  const [res, setRes] = useState<LiveResult | null>(null);
  const [closedLocal, setClosedLocal] = useState<Candle[]>([]);
  const [failures, setFailures] = useState(0);
  const [engineOn, setEngineOn] = useState(false);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(0);
  const engine = useRef<ReturnType<typeof createEngine> | null>(null);
  const server = useRef<AbiData | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    // the seen file is read only when the engine has to (re)start: first load or a newer closed hour
    async function start(d: AbiData) {
      engine.current = null;
      setEngineOn(false); setClosedLocal([]); setRes(null);
      if (!d.live) return;
      const sr = await load(abiSeenPath);
      const seen = sr.status === 200 ? validateSeen(sr.body) : null;
      if (!live || !seen || !seen.ok || seen.data.hour_start !== d.live.hour_start) return; // server mid-update: next poll
      const e = createEngine();
      e.load({ live: d.live, milestones: d.milestones, live_fx: d.live_fx }, seen.data);
      engine.current = e;
      setEngineOn(true);
    }
    async function poll() {
      const r = await load();
      if (!live) return;
      const s = abiState(r);
      if (s.kind !== "ready") { setState((cur) => (cur.kind === "ready" ? cur : s)); return; }
      // a newer closed hour, or a milestone recorded since: restart the engine from the server's state
      const msKey = (x: AbiData) => x.milestones.map((m) => `${m.id}@${m.t}`).join(",");
      const changed = !server.current || server.current.data_until !== s.data.data_until || msKey(server.current) !== msKey(s.data);
      server.current = s.data;
      setState(s);
      setNow(Date.now());
      if (changed || !engine.current) await start(s.data);
    }
    async function tick() {
      const e = engine.current;
      if (!e || busy.current || document.hidden) return;
      busy.current = true;
      try {
        const out = await e.tick();
        if (live && engine.current === e) {
          setClosedLocal((c) => (out.closedHours.length ? [...c, ...out.closedHours.map((h) => h.candle)] : c));
          setRes(out); setFailures(0); setStale(false);
        }
      } catch (err) {
        if (err instanceof StaleError) {
          // the server file is old: show its last closed value, no catch-up in the browser
          if (live) { engine.current = null; setEngineOn(false); setRes(null); setStale(true); }
        } else if (live) setFailures((n) => n + 1);
      }
      busy.current = false;
      if (live) setNow(Date.now());
    }
    void poll().then(tick);
    const t1 = setInterval(() => void tick(), TICK_MS);
    const t2 = setInterval(() => void poll(), POLL_MS);
    const vis = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { live = false; clearInterval(t1); clearInterval(t2); document.removeEventListener("visibilitychange", vis); };
  }, []);

  if (state.kind === "ready") return <Terminal d={state.data} R={res} closedLocal={closedLocal} st={status(state.data, res, failures, engineOn, now, stale)} />;
  return (
    <>
      <header className="mb-6"><h1 className="pa-h1">{ABI_COPY.heading}</h1></header>
      {state.kind === "loading" && <p className="pa-muted">Loading…</p>}
      {state.kind === "empty" && <div className="pa-card"><p>{ABI_COPY.empty}</p></div>}
      {state.kind === "error" && <div className="pa-card"><p>{ABI_COPY.failed}</p></div>}
    </>
  );
}
