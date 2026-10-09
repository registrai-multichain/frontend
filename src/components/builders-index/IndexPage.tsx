"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { InfoBubble } from "@/components/InfoBubble";
import { projectHref } from "@/lib/project-page";
import { createEngine, type LiveResult } from "@/lib/abi-live";
import { validateSeen, type AbiData } from "@/lib/builders-index";
import {
  ABI_COPY, abiPath, abiSeenPath, abiState, activityRows, chartGeometry, CHART_PAD, dayLabel, fmt, hourLabel, liveStatus, memberRows, RANGES, shortHash,
  sliceSeries, stats, withLive, type AbiState, type Range,
} from "@/lib/builders-index-page";

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

const toneColor = (t: string | undefined) => (t === "up" ? "var(--up)" : t === "down" ? "var(--down)" : undefined);

function StatStrip({ d }: { d: AbiData }) {
  const info = {
    base: ABI_COPY.base(fmt(d.base.level), `${String(d.base.time.slice(11, 16))} UTC on ${dayLabel(d.base.time)}`),
    decay: `${ABI_COPY.decay} Half-life: ${d.params.half_life_days} days.`,
  };
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))", marginBottom: 16 }}>
      {stats(d).map((s) => (
        <div key={s.label} className="pa-card" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="pa-muted pa-small">
            {s.label}{s.info && <> <InfoBubble label={`About ${s.label.toLowerCase()}`}>{info[s.info]}</InfoBubble></>}
          </span>
          <span className="pa-num" style={{ fontSize: s.label === "Index" ? 28 : 18, color: toneColor(s.tone) }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ d }: { d: AbiData }) {
  const [range, setRange] = useState<Range>("7D");
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setW(Math.max(240, Math.floor(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = w < 480 ? 240 : 320;
  const pts = sliceSeries(d.series, range);
  const g = chartGeometry(pts, range, w, H, d.base.level);
  const hp = hover !== null && hover < pts.length ? pts[hover] : g ? pts[pts.length - 1] : null;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };
  return (
    <section className="pa-card" aria-label="Index chart" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Hourly index</h2>
        <div className="pa-seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => { setRange(r); setHover(null); }}>{r}</button>
          ))}
        </div>
      </div>
      <div className="pa-muted pa-small pa-num" style={{ minHeight: 20 }}>{hp ? `${hourLabel(hp[0])} · ${fmt(hp[1], 2)}` : ""}</div>
      <div ref={box} style={{ width: "100%" }}>
        {g ? (
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Index level by hour" style={{ display: "block", maxWidth: "100%" }}>
            {g.yTicks.map((t) => (
              <g key={t.label}>
                <line x1={CHART_PAD.l} x2={w - CHART_PAD.r} y1={t.y} y2={t.y} stroke="var(--line)" strokeWidth={1} />
                <text x={w - CHART_PAD.r + 6} y={t.y + 4} fontSize={11} fill="var(--fg-mute)">{t.label}</text>
              </g>
            ))}
            {g.xTicks.map((t) => (
              <text key={t.x} x={t.x} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--fg-mute)">{t.label}</text>
            ))}
            {g.baseY !== null && <line data-testid="base-line" x1={CHART_PAD.l} x2={w - CHART_PAD.r} y1={g.baseY} y2={g.baseY} stroke="var(--fg-mute)" strokeDasharray="4 3" strokeWidth={1} />}
            <path d={g.area} fill="var(--accent)" opacity={0.1} />
            <path d={g.path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
            <circle cx={hover !== null && hover < pts.length ? g.xs[hover] : g.last.x} cy={hover !== null && hover < pts.length ? g.ys[hover] : g.last.y} r={4} fill="var(--accent)" />
            <rect x={CHART_PAD.l} y={0} width={w - CHART_PAD.l - CHART_PAD.r} height={H} fill="transparent" style={{ touchAction: "pan-y" }}
              onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        ) : <p className="pa-muted">No points in this range.</p>}
      </div>
      <div className="pa-muted pa-small" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
        <span>Solid: index, final at each hour end (UTC)</span>
        <span>Dashed: base {fmt(d.base.level, 0)}</span>
      </div>
    </section>
  );
}

function Name({ source, name, baseLayer }: { source: string; name: string; baseLayer: boolean }) {
  return baseLayer ? <>{name} <span className="pa-muted pa-small">chain-wide</span></> : <Link className="pa-link" href={projectHref(source)}>{name}</Link>;
}

function Members({ d }: { d: AbiData }) {
  const rows = memberRows(d);
  return (
    <div className="pa-table-wrap">
      <table className="pa-table">
        <thead><tr><th>Project</th><th>Now</th><th>At base</th><th>Change</th><th>Points</th><th>Contracts</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.source}>
              <td><Name source={r.source} name={r.name} baseLayer={r.baseLayer} /></td>
              <td className="pa-num">{r.now}</td>
              <td className="pa-num pa-muted">{r.atBase}</td>
              <td className="pa-num" style={{ color: toneColor(r.changeTone) }}>{r.change}</td>
              <td className="pa-num pa-muted">{r.points}</td>
              <td className="pa-num pa-muted">{r.contracts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Activity({ d }: { d: AbiData }) {
  const rows = activityRows(d);
  if (rows.length === 0) return <p className="pa-muted">No activity in the last 72 hours.</p>;
  return (
    <div className="pa-table-wrap">
      <table className="pa-table">
        <thead><tr><th>Hour (UTC)</th><th>Project</th><th>Activity</th><th>Points</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="pa-num" style={{ whiteSpace: "nowrap" }}>{r.hour}</td>
              <td>{r.name}</td>
              <td>{r.what}{r.open && <> <span className="pa-pill" data-tone="ok">open</span></>}</td>
              <td className="pa-num">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Details({ d }: { d: AbiData }) {
  const [tab, setTab] = useState<"members" | "activity">("members");
  return (
    <section className="pa-card" aria-label="Details" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="pa-tabs" role="group" aria-label="Details">
          <button type="button" className="pa-tab" aria-pressed={tab === "members"} onClick={() => setTab("members")}>Members</button>
          <button type="button" className="pa-tab" aria-pressed={tab === "activity"} onClick={() => setTab("activity")}>Activity</button>
        </div>
        {tab === "members" ? <InfoBubble label="About weights">{ABI_COPY.weight}</InfoBubble> : <InfoBubble label="About activity">{ABI_COPY.activity}</InfoBubble>}
      </div>
      {tab === "members" ? <Members d={d} /> : <Activity d={d} />}
    </section>
  );
}

function Method({ d }: { d: AbiData }) {
  const p = d.params;
  const rows: [string, string][] = [
    ["Level", "I = K · Σ √P"],
    ["Payment", `log2(1 + min($, ${fmt(p.cap_per_wallet_hour_usdc ?? 1000, 0)})) pts`],
    ["New payer", `+${fmt(p.new_payer_points ?? 1, 0)} pt`],
    ["Half-life", `${p.half_life_days} days`],
    ["Rise limit / h", p.rise_limit_own !== undefined && p.rise_limit_index !== undefined ? `min(${fmt(100 * p.rise_limit_own, 1)}% own √P, ${fmt(100 * p.rise_limit_index, 1)}% Σ√P)` : "–"],
  ];
  return (
    <section className="pa-card" aria-label="Method" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>Method <InfoBubble label="About the inputs">{ABI_COPY.inputs}</InfoBubble></h2>
      <div className="pa-table-wrap">
        <table className="pa-table">
          <tbody>
            {rows.map(([k, v]) => (<tr key={k}><th scope="row">{k}</th><td className="pa-num">{v}</td></tr>))}
            <tr><th scope="row">Base snapshot</th><td className="pa-num"><code title={d.base.sha256}>{shortHash(d.base.sha256)}</code></td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Ready({ d, status }: { d: AbiData; status: { tone: "ok" | "down" | "neutral"; text: string } }) {
  return (
    <>
      <p className="pa-muted pa-small" style={{ margin: "0 0 12px" }} aria-live="off">
        <span className="pa-pill" data-tone={status.tone === "neutral" ? undefined : status.tone}>{status.text}</span>
      </p>
      <StatStrip d={d} />
      <ChartCard d={d} />
      <Details d={d} />
      <Method d={d} />
      <p className="pa-muted pa-small">Last closed hour from the server; the open hour is computed in this browser from Arc RPC. Block {d.head_block.toLocaleString("en-US")}. Every input is public Arc chain data.</p>
    </>
  );
}

const TICK_MS = 5000;
const POLL_MS = 60 * 1000;

export function IndexPage() {
  const [state, setState] = useState<AbiState>({ kind: "loading" });
  const [res, setRes] = useState<LiveResult | null>(null);
  const [failures, setFailures] = useState(0);
  const [engineOn, setEngineOn] = useState(false);
  const [now, setNow] = useState(0);
  const engine = useRef<ReturnType<typeof createEngine> | null>(null);
  const server = useRef<AbiData | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    // the seen file is read only when the engine has to (re)start: first load or a newer closed hour
    async function start(d: AbiData) {
      engine.current = null;
      setEngineOn(false);
      if (!d.live) return;
      const sr = await load(abiSeenPath);
      const seen = sr.status === 200 ? validateSeen(sr.body) : null;
      if (!live || !seen || !seen.ok || seen.data.hour_start !== d.live.hour_start) return; // server mid-update: next poll
      const e = createEngine();
      e.load(d.live, seen.data);
      engine.current = e;
      setRes(null);
      setEngineOn(true);
    }
    async function poll() {
      const r = await load();
      if (!live) return;
      const s = abiState(r);
      if (s.kind !== "ready") { setState((cur) => (cur.kind === "ready" ? cur : s)); return; }
      const changed = !server.current || server.current.data_until !== s.data.data_until;
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
        if (live && engine.current === e) { setRes(out); setFailures(0); }
      } catch {
        if (live) setFailures((n) => n + 1);
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

  const view = state.kind === "ready" ? withLive(state.data, res) : null;
  return (
    <>
      <header className="mb-6"><h1 className="pa-h1">{ABI_COPY.heading}</h1></header>
      {state.kind === "loading" && <p className="pa-muted">Loading…</p>}
      {state.kind === "empty" && <div className="pa-card"><p>{ABI_COPY.empty}</p></div>}
      {state.kind === "error" && <div className="pa-card"><p>{ABI_COPY.failed}</p></div>}
      {state.kind === "ready" && view && <Ready d={view} status={liveStatus(state.data, res, failures, engineOn, now)} />}
    </>
  );
}
