/**
 * Arc Builders Index, terminal view-model: pure functions behind the page (quote bar, chart, "why ABI moved",
 * time & sales, members, open hour, method). A port of the reference app.js; every number comes from the
 * server file (`params`, `live`, `roots_24h`, `candles`, `tape`) and the browser's live result.
 */
import type { Candle, LiveResult } from "./abi-live";
import type { AbiData } from "./builders-index";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ts = (iso: string): number => Date.parse(iso) / 1000;
export const fmt = (v: number, d = 2): string => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (x: number): string => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(2)}%`;
export const sgn = (x: number, d = 2): string => `${x >= 0 ? "+" : "−"}${fmt(Math.abs(x), d)}`;
export const cls = (x: number): "up" | "down" | "" => (x > 0 ? "up" : x < 0 ? "down" : "");
export const dayLab = (t: number): string => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const hm = (t: number): string => new Date(t * 1000).toISOString().slice(11, 16);
export const hms = (t: number): string => new Date(t * 1000).toISOString().slice(11, 19);
export const usdFmt = (v: number): string => (v >= 1000 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : v.toFixed(4));
export const STALE_S = 3 * 3600;

const nameMap = (d: AbiData) => Object.fromEntries(d.projects.map((p) => [p.source, p]));
export const nameOf = (d: AbiData, s: string): string => nameMap(d)[s]?.name ?? s.split(":").pop() ?? s;

/* ---------- candles ---------- */
export type Bar = { t: number; o: number; h: number; l: number; c: number; n: number; u: number; p: number; live?: boolean };
const bar = (x: Candle | AbiData["candles"][number], live = false): Bar => ({ t: ts(x[0]), o: x[1], h: x[2], l: x[3], c: x[4], n: x[5], u: x[6], p: x[7], ...(live ? { live: true } : {}) });

/** Server candles, hours this browser closed itself, then the open hour. Without server candles: one per series point. */
export function candleList(d: AbiData, closedLocal: Candle[], R: LiveResult | null): Bar[] {
  let c: Bar[];
  if (d.candles.length) c = d.candles.map((x) => bar(x));
  else {
    let prev = d.base.level;
    c = d.series.map(([t, v]) => { const b: Bar = { t: ts(t), o: prev, h: Math.max(prev, v), l: Math.min(prev, v), c: v, n: 0, u: 0, p: 0 }; prev = v; return b; });
  }
  for (const x of closedLocal) c.push(bar(x));
  if (R) c.push(bar(R.candle, true));
  return c;
}

export const RANGE_BARS = { "24H": 24, "3D": 72, "7D": 168, All: 0 } as const;
export type RangeKey = keyof typeof RANGE_BARS;
export const RANGE_KEYS = Object.keys(RANGE_BARS) as RangeKey[];

/* ---------- quote bar ---------- */
export type Quote = { px: number; ref24: number; d24: number; chg24: number; h1: number; hi: number; lo: number; pay: number; usd: number; pace: number | null; sinceBase: number };

/** Pace = members' points in the last 24 closed hours / the points needed to hold their weight (P x one day of roll-off). */
export function paceAll(d: AbiData): number | null {
  if (!d.live) return null;
  let need = 0, did = 0;
  for (const p of d.projects) if (!p.base_layer) { need += (d.live.P[p.source] || 0) * (1 - Math.pow(d.live.decay_h, 24)); did += p.pts_24h; }
  return need > 0 ? (100 * did) / need : 0;
}

export function quote(d: AbiData, C: Bar[]): Quote | null {
  if (C.length === 0) return null;
  const last = C[C.length - 1], closed = C.filter((c) => !c.live), px = last.c;
  const roots = Object.values(d.roots_24h);
  const ref24 = d.live && roots.length ? d.live.K * roots.reduce((a, b) => a + b, 0) : closed.length > 24 ? closed[closed.length - 25].c : (closed[0] ?? last).o;
  const win = C.slice(-24);
  return {
    px, ref24, d24: px / ref24 - 1, chg24: px - ref24, h1: px / last.o - 1,
    hi: Math.max(...win.map((c) => c.h)), lo: Math.min(...win.map((c) => c.l)),
    pay: win.reduce((x, c) => x + c.n, 0), usd: win.reduce((x, c) => x + c.u, 0),
    pace: paceAll(d), sinceBase: px / d.base.level - 1,
  };
}

export function status(d: AbiData, R: LiveResult | null, failures: number, engineOn: boolean, nowMs: number, stale: boolean): { kind: "live" | "warn" | "idle"; text: string } {
  const closedAt = `${dayLab(ts(d.data_until))} ${hm(ts(d.data_until))} UTC`;
  if (R && failures === 0) return { kind: "live", text: `Live · ${hms(R.headTs)} UTC` };
  if (stale || nowMs / 1000 - ts(d.data_until) > STALE_S) return { kind: "warn", text: `Data delayed · closed ${closedAt}` };
  return { kind: "idle", text: `${engineOn || R ? "Live update paused · " : ""}closed ${hm(ts(d.data_until))} UTC` };
}

/* ---------- why ABI moved ---------- */
export type WhyRow = { l: string; v: number; kind?: "decay" | "net" };
export type Why = { rows: WhyRow[]; mx: number; net: number; decay: number };

/** decay = K·Σ r0·(f−1); contribution_s = K·(r1_s − r0_s·f); f = decay_h^(hours/2). decay + Σ contributions = K·Σr1 − K·Σr0. */
export function why(d: AbiData, R: LiveResult | null, win: "24h" | "1h"): Why | null {
  const L = d.live;
  if (!L) return null;
  const now = R ? R.roots : L.roots_prev;
  let ref: Record<string, number>, hrs: number;
  if (win === "24h") { ref = d.roots_24h; hrs = 24 + (R ? (R.hourStart - ts(d.data_until)) / 3600 + R.f : 0); }
  else { ref = R ? R.rootsPrev : L.roots_prev; hrs = R ? R.f : 0; }
  const fac = Math.pow(L.decay_h, hrs / 2); // √P decays at half the rate of P
  let decay = 0;
  const con: Record<string, number> = {};
  for (const s of new Set([...Object.keys(ref), ...Object.keys(now)])) {
    const r0 = ref[s] || 0, r1 = now[s] || 0;
    decay += L.K * r0 * (fac - 1);
    con[s] = L.K * (r1 - r0 * fac);
  }
  const net = decay + Object.values(con).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(con).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 6), rest = sorted.slice(6).reduce((a, [, v]) => a + v, 0);
  const rows: WhyRow[] = [{ l: "Older activity rolling off", v: decay, kind: "decay" }, ...top.map(([s, v]) => ({ l: nameOf(d, s), v }))];
  if (sorted.length > 6) rows.push({ l: `Others (${sorted.length - 6})`, v: rest });
  rows.push({ l: "Net", v: net, kind: "net" });
  return { rows, mx: Math.max(...rows.map((r) => Math.abs(r.v)), 1e-9), net, decay };
}

/* ---------- time & sales ---------- */
export type TapeRow = { sep: true } | { sep?: false; t: number; s: string; v: number; p: number; n: boolean; live: boolean; k: number };

export function tapeRows(d: AbiData, R: LiveResult | null, minUsd: number): TapeRow[] {
  type Raw = { sep: true } | { sep?: false; t: number; s: string; v: number; p: number; n: boolean; live: boolean };
  const rows: Raw[] = [];
  if (R) for (const e of R.tape.slice().reverse()) rows.push({ t: e.ts, s: e.src, v: e.v, p: e.pts, n: e.isNew, live: true });
  const cut = R ? R.hourStart : Infinity;
  let sep = false;
  for (const [t, s, v, p, n] of d.tape) {
    const tt = ts(t);
    if (tt >= cut) continue;
    if (R && !sep) { rows.push({ sep: true }); sep = true; }
    rows.push({ t: tt, s, v, p, n: !!n, live: false });
    if (rows.length > 160) break;
  }
  // filter by size, then group a project's payments within the same minute into one row
  const out: TapeRow[] = [];
  for (const r of rows) {
    if (r.sep) { out.push(r); continue; }
    if (r.v < minUsd) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.sep && prev.s === r.s && Math.floor(prev.t / 60) === Math.floor(r.t / 60) && prev.live === r.live) {
      prev.k++; prev.v += r.v; prev.p += r.p; prev.n = prev.n || r.n;
    } else out.push({ ...r, k: 1 });
  }
  return out.slice(0, 120);
}

/* ---------- members ---------- */
export type MemberRow = { source: string; name: string; base: boolean; share: number; dbase: number | null; pace: number | null; h1: number; d1: number; pay: number; usd: number };
export type SortKey = "name" | "share" | "dbase" | "h1" | "d1" | "pace" | "pay" | "usd";

export function members(d: AbiData, R: LiveResult | null, sortK: SortKey = "share", sortDir: 1 | -1 = -1): MemberRow[] {
  const by = nameMap(d), L = d.live;
  const srcs = R ? Object.keys(R.roots).filter((s) => R.roots[s] > 0) : d.projects.map((p) => p.source);
  const rows = srcs.map((s): MemberRow => {
    const p = by[s] ?? { source: s, name: s.split(":").pop() ?? s, share: 0, share_base: null, base_layer: s === "base:arc", pts_1h: 0, pts_24h: 0, pay_24h: 0, usdc_24h: 0 };
    const a = R?.act[s];
    const share = R ? (100 * R.roots[s]) / R.total : p.share;
    const hold = L ? (L.P[s] || 0) * (1 - Math.pow(L.decay_h, 24)) : 0;
    return {
      source: s, name: p.name, base: p.base_layer, share, dbase: p.share_base === null ? null : share - p.share_base,
      pace: !p.base_layer && hold > 0 ? (100 * p.pts_24h) / hold : null,
      h1: R ? (a ? a.points : 0) : p.pts_1h, d1: p.pts_24h + (a ? a.points : 0),
      pay: p.pay_24h + (a ? a.payments : 0), usd: p.usdc_24h + (a ? a.usdc : 0),
    };
  });
  return rows.sort((x, y) => (sortK === "name" ? sortDir * x.name.localeCompare(y.name) : sortDir * ((x[sortK] ?? -1e9) - (y[sortK] ?? -1e9))));
}

export function tickerItems(d: AbiData): { name: string; share: string; pts: string | null; ptsClass: "up" | "down" | "" }[] {
  return d.projects.map((p) => ({
    name: p.name, share: `${p.share.toFixed(1)}%`,
    pts: p.base_layer ? null : p.pts_1h ? `+${fmt(p.pts_1h, 1)} pts` : "0 pts", ptsClass: p.base_layer ? "" : cls(p.pts_1h),
  }));
}

/* ---------- open hour, method ---------- */
export function openHour(R: LiveResult | null): { span: string; o: number; h: number; l: number; c: number; n: number; u: number; left: (nowSec: number) => string } | null {
  if (!R) return null;
  const [t, o, h, l, c, n, u] = R.candle;
  return {
    span: `${hm(ts(t))}–${hm(ts(t) + 3600)} UTC`, o, h, l, c, n, u,
    left: (nowSec) => { const s = Math.max(0, R.hourStart + 3600 - nowSec); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`; },
  };
}

/** Roll-off from the file's params; the per-hour factor comes from live.decay_h when present. Nothing is a constant here. */
export function rollOff(d: AbiData): { halfLife: string; perHour: string } {
  const decayH = d.live?.decay_h ?? 1 - d.params.decay_per_hour_pct / 100;
  const pts = (1 - decayH) * 100, abi = (1 - Math.sqrt(decayH)) * 100;
  return { halfLife: `half-life ${fmtDays(d.params.half_life_days)} d`, perHour: `pts −${pts.toFixed(3)}%/h · ABI −${abi.toFixed(3)}%/h` };
}
const fmtDays = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function methodRows(d: AbiData): [string, string][] {
  const p = d.params, cap = p.cap_per_wallet_hour_usdc ?? 1000;
  return [
    ["Level", "K · Σ √P"],
    ["Payment", `log2(1 + min($, ${fmt(cap, 0)}))`],
    ["New payer", `+${fmt(p.new_payer_points ?? 1, 0)} pt`],
    ["Rise limit / h", p.rise_limit_own !== undefined && p.rise_limit_index !== undefined ? `min(${fmt(100 * p.rise_limit_own, 1)}% own √P, ${fmt(100 * p.rise_limit_index, 1)}% Σ√P)` : "–"],
    ["Base", `${fmt(d.base.level, 0)} · ${new Date(ts(d.base.time) * 1000).getUTCDate()} ${MON[new Date(ts(d.base.time) * 1000).getUTCMonth()]} ${new Date(ts(d.base.time) * 1000).getUTCFullYear()}`],
  ];
}

/* ---------- chart geometry ---------- */
export type ChartModel = {
  W: number; H: number; pad: { l: number; r: number; t: number; b: number }; slot: number; bw: number;
  grid: { y: number; label: string }[]; marks: { x: number; label: string }[]; baseY: number | null;
  bars: { x: number; yH: number; yL: number; yTop: number; body: number; up: boolean; live: boolean; vy: number; vh: number }[];
  line: string; last: { y: number; up: boolean; label: string }; volTop: number; bars_n: number;
};

export function chartModel(cs: Bar[], W: number, H: number, base = 1000): ChartModel | null {
  if (cs.length === 0) return null;
  const pad = { l: 8, r: 70, t: 12, b: 24 }, volH = Math.round((H - pad.t - pad.b) * 0.18), gap = 8;
  const pH = H - pad.t - pad.b - volH - gap;
  let lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
  const span = Math.max(hi - lo, 0.5);
  lo -= span * 0.06; hi += span * 0.06;
  const slot = (W - pad.l - pad.r) / cs.length, bw = Math.max(1, Math.min(14, slot * 0.64));
  const x = (i: number) => pad.l + slot * (i + 0.5);
  const y = (v: number) => pad.t + (pH * (hi - v)) / (hi - lo);
  const vMax = Math.max(...cs.map((c) => c.u), 1);
  const vy = (u: number) => H - pad.b - (volH * u) / vMax;
  const raw = (hi - lo) / 6, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const grid: ChartModel["grid"] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid.push({ y: y(v), label: fmt(v, dec) });
  const multiDay = cs.length > 30;
  const marks: ChartModel["marks"] = [];
  let lastX = -1e9;
  cs.forEach((c, i) => {
    const hh = new Date(c.t * 1000).getUTCHours();
    const mark = multiDay ? hh === 0 : hh % 4 === 0;
    if (!mark || x(i) - lastX < 60 || x(i) > W - pad.r - 24) return;
    lastX = x(i);
    marks.push({ x: x(i), label: multiDay ? dayLab(c.t) : `${String(hh).padStart(2, "0")}:00` });
  });
  const bars = cs.map((c, i) => {
    const yTop = y(Math.max(c.o, c.c)), yBot = y(Math.min(c.o, c.c));
    return { x: x(i), yH: y(c.h), yL: y(c.l), yTop, body: Math.max(1, yBot - yTop), up: c.c >= c.o, live: !!c.live, vy: vy(c.u), vh: H - pad.b - vy(c.u) };
  });
  const lastBar = cs[cs.length - 1];
  return {
    W, H, pad, slot, bw, grid, marks, baseY: base > lo && base < hi ? y(base) : null, bars,
    line: cs.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(c.c).toFixed(1)}`).join(""),
    last: { y: y(lastBar.c), up: lastBar.c >= lastBar.o, label: fmt(lastBar.c) }, volTop: H - pad.b - volH, bars_n: cs.length,
  };
}

/** The bar under a pointer x (px from the svg's left edge). */
export const barAt = (m: ChartModel, px: number): number => Math.max(0, Math.min(m.bars_n - 1, Math.floor((px - m.pad.l) / m.slot)));

export function ohlcLine(b: Bar): { when: string; o: string; h: string; l: string; c: string; chg: number; n: string; usd: string } {
  return { when: `${dayLab(b.t)} ${hm(b.t)}${b.live ? " · open" : ""}`, o: fmt(b.o), h: fmt(b.h), l: fmt(b.l), c: fmt(b.c), chg: b.c - b.o, n: `${b.n} payments`, usd: `${usdFmt(b.u)} USDC` };
}
