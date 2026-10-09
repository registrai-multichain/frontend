import type { LiveResult } from "./abi-live";
import type { AbiData, AbiEvent, AbiProject } from "./builders-index";
import { validateIndex } from "./builders-index";

/** Plain labels only (owner copy rules): explanations sit behind the "i" bubble. */
export const ABI_COPY = {
  heading: "Arc Builders Index",
  empty: "No data yet",
  failed: "Couldn't load the index. Try again.",
  base: (levelText: string, whenText: string) => `Set to ${levelText} at ${whenText}. Points from 10 Aug onward count as warm-up, so the level starts from real history.`,
  decay: "Every point loses half its value every half-life. With no new activity anywhere, the index falls.",
  weight: "A member's weight is its share of Σ√P. The square root keeps one large project from dominating. The Arc base layer carries chain-wide activity.",
  inputs: "USDC Transfer logs of the system emitter 0xffff…fffe on Arc mainnet, into contracts Tabula Radar watches. Payments from a project's own deployers or contracts do not count. Base layer: every USDC sender per hour, sampled from the first 240 blocks of each hour.",
  activity: "External USDC payments into each project's contracts, last 72 hours, hours with at least 1 point.",
} as const;

export const abiPath = "/api/index";
export const abiSeenPath = "/api/index/seen";

export type Range = "24H" | "7D" | "All";
export const RANGES: Range[] = ["24H", "7D", "All"];
const RANGE_HOURS: Record<Range, number> = { "24H": 24, "7D": 168, All: 0 };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmt = (v: number, d = 1): string => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** A ratio as a signed percent: +1.23%, −0.50% (true minus sign). */
export const pct = (x: number, d = 2): string => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(d)}%`;
export const tone = (x: number | null, eps = 0): "up" | "down" | "flat" => (x === null || Math.abs(x) <= eps ? "flat" : x > 0 ? "up" : "down");
/** "9 Oct" from an ISO time (UTC). */
export const dayLabel = (t: string): string => `${Number(t.slice(8, 10))} ${MON[Number(t.slice(5, 7)) - 1]}`;
export const hourLabel = (t: string): string => `${dayLabel(t)} ${t.slice(11, 16)} UTC`;
export const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-8)}`;

/** The last 24 or 168 hours (plus the point before them), or everything. */
export function sliceSeries(series: [string, number][], range: Range): [string, number][] {
  const h = RANGE_HOURS[range];
  return h ? series.slice(-(h + 1)) : series;
}

export type Stat = { label: string; value: string; tone?: "up" | "down" | "flat"; info?: "base" | "decay" };

export function stats(d: AbiData): Stat[] {
  const day24 = d.index_24h_ago ? d.index / d.index_24h_ago - 1 : null;
  const sinceBase = d.index / d.base.level - 1;
  return [
    { label: "Index", value: fmt(d.index, 2) },
    { label: "24h", value: day24 === null ? "–" : pct(day24), tone: tone(day24) },
    { label: "Since base", value: pct(sinceBase), tone: tone(sinceBase) },
    { label: "Base", value: `${fmt(d.base.level)} · ${dayLabel(d.base.time)}`, info: "base" },
    { label: "Members", value: `${d.projects.filter((p) => !p.base_layer).length} + base` },
    { label: "Decay", value: `−${d.params.decay_per_hour_pct.toFixed(3)}% / h`, info: "decay" },
    { label: "Arc block", value: d.head_block ? d.head_block.toLocaleString("en-US") : "–" },
  ];
}

/** Data older than 3 hours reads as delayed. */
export function freshness(d: AbiData, nowMs: number): { delayed: boolean; text: string } {
  const age = (nowMs - Date.parse(d.data_until)) / 3600e3;
  const delayed = !(age < 3);
  return { delayed, text: `${delayed ? "Delayed · data to" : "Data to"} ${hourLabel(d.data_until)}` };
}

export type MemberRow = { source: string; name: string; baseLayer: boolean; now: string; atBase: string; change: string; changeTone: "up" | "down" | "flat" | "new"; points: string; contracts: string };

export function memberRows(d: AbiData): MemberRow[] {
  return d.projects.map((p) => {
    const ch = p.share_base === null ? null : p.share - p.share_base;
    return {
      source: p.source, name: p.name, baseLayer: p.base_layer,
      now: `${p.share.toFixed(1)}%`,
      atBase: p.share_base === null ? "–" : `${p.share_base.toFixed(1)}%`,
      change: ch === null ? "new" : Math.abs(ch) < 0.05 ? "0.0" : `${ch > 0 ? "+" : "−"}${Math.abs(ch).toFixed(1)}`,
      changeTone: ch === null ? "new" : tone(ch, 0.05),
      points: fmt(p.points, 0),
      contracts: p.base_layer ? "all" : String(p.contracts),
    };
  });
}

export type ActivityRow = { open: boolean; key: string; hour: string; name: string; source: string; what: string; points: string; limited: boolean };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Events of the 72 hours up to the data's end, newest hour first. */
export function activityRows(d: AbiData): ActivityRow[] {
  const from = Date.parse(d.data_until) - 72 * 3600e3;
  const list: AbiEvent[] = d.events.filter((e) => Date.parse(e.t) > from).sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
  return list.map((e, i) => {
    const h = Number(e.t.slice(11, 13));
    const hh = `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
    const limited = e.kind === "rise_limit";
    return {
      open: e.open === true,
      key: `${e.t}|${e.source}|${e.kind}|${i}`,
      hour: `${dayLabel(e.t)} ${hh}`,
      name: e.name, source: e.source, limited,
      what: limited ? "Rise limit applied" : `${plural(e.payments, "payment")} from ${plural(e.wallets, "wallet")}${e.new_payers ? ` · ${e.new_payers} new` : ""}`,
      points: limited || !e.points ? "capped" : `+${fmt(e.points, 1)}`,
    };
  });
}

const isoSec = (sec: number): string => `${new Date(sec * 1000).toISOString().slice(0, 19)}Z`;

/**
 * The server's last closed hour plus the browser's open hour: the index, the series (closed hours the
 * browser rolled itself + the live point), the members (shares of the live roots) and the open hour's events.
 * Without a live result this is the server data unchanged.
 */
export function withLive(d: AbiData, R: LiveResult | null): AbiData {
  if (!R) return d;
  const series: [string, number][] = d.series.slice();
  for (const c of R.closedHours) series.push([isoSec(c.t), c.index]);
  series.push([isoSec(R.headTs), R.index]);
  const by = Object.fromEntries(d.projects.map((p) => [p.source, p]));
  const projects: AbiProject[] = Object.entries(R.roots)
    .filter(([, r]) => r > 0)
    .map(([s, r]) => ({
      ...(by[s] ?? { source: s, name: s.split(":").pop() ?? s, share_base: null, contracts: 0, base_layer: s === "base:arc" }),
      share: (100 * r) / R.total,
      points: R.P[s],
    }))
    .sort((a, b) => b.share - a.share);
  const hs = isoSec(R.hourStart);
  const nameOf = (s: string) => by[s]?.name ?? s;
  const open: AbiEvent[] = [
    ...Object.entries(R.act)
      .map(([s, a]): AbiEvent => ({ t: hs, source: s, name: nameOf(s), kind: "activity", payments: a.payments, wallets: a.wallets.size, new_payers: a.new_payers, points: a.points, open: true }))
      .filter((e) => e.points >= 1)
      .sort((a, b) => b.points - a.points),
    ...R.capped.map((s): AbiEvent => ({ t: hs, source: s, name: nameOf(s), kind: "rise_limit", payments: 0, wallets: 0, new_payers: 0, points: 0, open: true })),
  ];
  return { ...d, index: R.index, series, projects, events: [...open, ...d.events], head_block: R.head };
}

/** The status pill: live while the browser keeps up, else the last closed hour with a paused note. */
export function liveStatus(d: AbiData, R: LiveResult | null, failures: number, engineOn: boolean, nowMs: number): { tone: "ok" | "down" | "neutral"; text: string; paused: boolean } {
  if (R && failures === 0) return { tone: "ok", text: `Live · ${new Date(R.headTs * 1000).toISOString().slice(11, 19)} UTC`, paused: false };
  const f = freshness(d, nowMs);
  const paused = engineOn || R !== null;
  return { tone: f.delayed ? "down" : "neutral", text: `${paused ? "Live update paused · " : ""}Hour closed ${hourLabel(d.data_until)}`, paused };
}

export type Chart = {
  path: string; area: string; baseY: number | null; last: { x: number; y: number; v: number };
  yTicks: { y: number; label: string }[]; xTicks: { x: number; label: string }[];
  xs: number[]; ys: number[];
};
const PAD = { l: 8, r: 56, t: 14, b: 26 };

/** SVG geometry for a series in a W x H box; the base level is always inside the y range. */
export function chartGeometry(pts: [string, number][], range: Range, W: number, H: number, base: number): Chart | null {
  if (pts.length === 0) return null;
  const vs = [...pts.map((p) => p[1]), base];
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = Math.max(max - min, 1);
  const step = span > 80 ? 20 : span > 30 ? 10 : span > 8 ? 5 : span > 3 ? 1 : 0.5;
  const lo = Math.floor((min - span * 0.08) / step) * step;
  const hi = Math.ceil((max + span * 0.08) / step) * step;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, pts.length - 1);
  const y = (v: number) => PAD.t + ((H - PAD.t - PAD.b) * (hi - v)) / (hi - lo);
  const xs = pts.map((_, i) => x(i)), ys = pts.map((p) => y(p[1]));
  const yTicks: Chart["yTicks"] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push({ y: y(v), label: v.toLocaleString("en-US", { maximumFractionDigits: 1 }) });
  const every = range === "24H" ? 6 : 24 * Math.max(1, Math.ceil(pts.length / 24 / 6));
  const xTicks: Chart["xTicks"] = [];
  let lastX = -1e9;
  pts.forEach((p, i) => {
    if (Math.floor(Date.parse(p[0]) / 3600e3) % every !== 0) return;
    if (xs[i] - lastX < 56 || xs[i] < PAD.l + 20 || xs[i] > W - PAD.r - 20) return;
    lastX = xs[i];
    xTicks.push({ x: xs[i], label: range === "24H" ? p[0].slice(11, 16) : dayLabel(p[0]) });
  });
  const path = pts.map((_, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join("");
  const n = pts.length - 1;
  return {
    path, area: `${path}L${xs[n].toFixed(1)} ${H - PAD.b}L${xs[0].toFixed(1)} ${H - PAD.b}Z`,
    baseY: y(base), last: { x: xs[n], y: ys[n], v: pts[n][1] }, yTicks, xTicks, xs, ys,
  };
}
export const CHART_PAD = PAD;

export type AbiState = { kind: "loading" } | { kind: "empty" } | { kind: "error" } | { kind: "ready"; data: AbiData };

export function abiState(res: { status: number; body: unknown } | null): AbiState {
  if (!res) return { kind: "loading" };
  if (res.status === 404) return { kind: "empty" };
  if (res.status !== 200) return { kind: "error" };
  const v = validateIndex(res.body);
  return v.ok ? { kind: "ready", data: v.data } : { kind: "error" };
}
