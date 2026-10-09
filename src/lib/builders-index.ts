/**
 * Arc Builders Index: the published data file and its validator (shared by the
 * builders-site Pages Function and the page). The producer POSTs the whole file
 * to /api/index; only the fields below are kept, anything else is dropped.
 */

export const ABI_KEY = "abi:index";
export const ABI_SEEN_KEY = "abi:seen";
export const ABI_LIMITS = {
  bytes: 256 * 1024,
  seenBytes: 1024 * 1024,
  contracts: 5_000,
  deployersPer: 50,
  seenSources: 200,
  series: 10_000,
  projects: 200,
  events: 2_000,
  params: 32,
  str: 200,
} as const;

export type AbiProject = { source: string; name: string; share: number; share_base: number | null; points: number; contracts: number; base_layer: boolean };
export type AbiEvent = { t: string; source: string; name: string; kind: "activity" | "rise_limit"; payments: number; wallets: number; new_payers: number; points: number; open?: true };
/** What the browser needs to replay the open hour (the producer's state at the last closed hour). */
export type AbiLive = {
  hour_start: number; hour_start_block: number;
  K: number; base_k: number; base: string;
  P: Record<string, number>; roots_prev: Record<string, number>;
  decay_h: number; cap: number; new_payer: number; proj_up: number; rel_up: number; entry: number; base_scale: number; base_window: number;
  contracts: Record<string, string>; deployers: Record<string, string[]>; seen_prefix: number;
};
export type AbiData = {
  updated: string;
  data_until: string;
  head_time: string;
  head_block: number;
  index: number;
  index_24h_ago: number | null;
  base: { time: string; level: number; sha256: string };
  series: [string, number][];
  projects: AbiProject[];
  events: AbiEvent[];
  params: { half_life_days: number; decay_per_hour_pct: number } & Record<string, number>;
  live?: AbiLive;
};

export type AbiSeen = { hour_start: number; seen: Record<string, string> };

export type AbiResult = { ok: true; data: AbiData } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max: number = ABI_LIMITS.str): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const iso = (v: unknown): v is string => str(v, 40) && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0;
const SHA = /^[0-9a-f]{64}$/;
const KEY = /^[a-z0-9_]{1,40}$/;

const ADDR = /^0x[0-9a-f]{40}$/;
const posInt = (v: unknown): v is number => count(v) && v > 0;

function numberMap(v: unknown, max: number): Record<string, number> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > max) return null;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const x = v[k];
    if (!str(k) || !num(x) || x < 0) return null;
    out[k] = x;
  }
  return out;
}

/** The `live` block: null when malformed. Unknown keys are dropped. */
function validateLive(v: unknown): AbiLive | null {
  if (!isObj(v)) return null;
  if (!posInt(v.hour_start) || !count(v.hour_start_block) || !str(v.base) || !posInt(v.base_window) || v.base_window > 100_000 || !posInt(v.seen_prefix) || v.seen_prefix > 40) return null;
  for (const k of ["K", "base_k", "decay_h", "cap", "new_payer", "proj_up", "rel_up", "entry", "base_scale"] as const) if (!num(v[k]) || v[k] < 0) return null;
  const P = numberMap(v.P, ABI_LIMITS.projects), roots = numberMap(v.roots_prev, ABI_LIMITS.projects);
  if (!P || !roots || !isObj(v.contracts) || !isObj(v.deployers)) return null;
  const contractKeys = Object.keys(v.contracts);
  if (contractKeys.length > ABI_LIMITS.contracts) return null;
  const contracts: Record<string, string> = {};
  for (const a of contractKeys) {
    const src = v.contracts[a];
    if (!ADDR.test(a) || !str(src)) return null;
    contracts[a] = src;
  }
  const depKeys = Object.keys(v.deployers);
  if (depKeys.length > ABI_LIMITS.projects) return null;
  const deployers: Record<string, string[]> = {};
  for (const src of depKeys) {
    const list = v.deployers[src];
    if (!str(src) || !Array.isArray(list) || list.length > ABI_LIMITS.deployersPer || !list.every((a) => typeof a === "string" && ADDR.test(a))) return null;
    deployers[src] = list as string[];
  }
  return {
    hour_start: v.hour_start, hour_start_block: v.hour_start_block, K: v.K as number, base_k: v.base_k as number, base: v.base, P, roots_prev: roots,
    decay_h: v.decay_h as number, cap: v.cap as number, new_payer: v.new_payer as number, proj_up: v.proj_up as number, rel_up: v.rel_up as number,
    entry: v.entry as number, base_scale: v.base_scale as number, base_window: v.base_window, contracts, deployers, seen_prefix: v.seen_prefix,
  };
}

export type AbiSeenResult = { ok: true; data: AbiSeen } | { ok: false; error: string };

/** The wallets seen before the open hour: per source, concatenated 10-hex wallet prefixes. */
export function validateSeen(raw: unknown): AbiSeenResult {
  if (!isObj(raw)) return { ok: false, error: "expected a JSON object" };
  if (!posInt(raw.hour_start)) return { ok: false, error: "hour_start must be a positive integer" };
  if (!isObj(raw.seen)) return { ok: false, error: "seen must be an object" };
  const keys = Object.keys(raw.seen);
  if (keys.length > ABI_LIMITS.seenSources) return { ok: false, error: `seen may hold at most ${ABI_LIMITS.seenSources} sources` };
  const seen: Record<string, string> = {};
  for (const k of keys) {
    const s = raw.seen[k];
    if (!str(k) || typeof s !== "string" || !/^[0-9a-f]*$/.test(s) || s.length % 10 !== 0) return { ok: false, error: "seen values must be lowercase hex in multiples of 10 characters" };
    seen[k] = s;
  }
  return { ok: true, data: { hour_start: raw.hour_start, seen } };
}

export function validateIndex(raw: unknown): AbiResult {
  const bad = (error: string): AbiResult => ({ ok: false, error });
  if (!isObj(raw)) return bad("expected a JSON object");
  for (const k of ["updated", "data_until", "head_time"] as const) if (!iso(raw[k])) return bad(`${k} must be an ISO time`);
  if (!count(raw.head_block)) return bad("head_block must be a non-negative integer");
  if (!num(raw.index) || raw.index <= 0) return bad("index must be a positive number");
  if (raw.index_24h_ago !== null && raw.index_24h_ago !== undefined && (!num(raw.index_24h_ago) || raw.index_24h_ago <= 0)) return bad("index_24h_ago must be a positive number or null");
  const b = raw.base;
  if (!isObj(b) || !iso(b.time) || !num(b.level) || b.level <= 0 || typeof b.sha256 !== "string" || !SHA.test(b.sha256)) return bad("base must be { time, level, sha256 }");

  if (!Array.isArray(raw.series) || raw.series.length > ABI_LIMITS.series) return bad(`series must be an array of at most ${ABI_LIMITS.series}`);
  const series: [string, number][] = [];
  for (const p of raw.series) {
    if (!Array.isArray(p) || p.length !== 2 || !iso(p[0]) || !num(p[1])) return bad("series entries must be [ISO time, number]");
    series.push([p[0], p[1]]);
  }
  if (!Array.isArray(raw.projects) || raw.projects.length > ABI_LIMITS.projects) return bad(`projects must be an array of at most ${ABI_LIMITS.projects}`);
  const projects: AbiProject[] = [];
  for (const p of raw.projects) {
    if (!isObj(p) || !str(p.source) || !str(p.name) || !num(p.share) || !num(p.points) || !count(p.contracts) || typeof p.base_layer !== "boolean") return bad("a project is malformed");
    if (p.share_base !== null && p.share_base !== undefined && !num(p.share_base)) return bad("share_base must be a number or null");
    projects.push({ source: p.source, name: p.name, share: p.share, share_base: p.share_base ?? null, points: p.points, contracts: p.contracts, base_layer: p.base_layer });
  }
  if (!Array.isArray(raw.events) || raw.events.length > ABI_LIMITS.events) return bad(`events must be an array of at most ${ABI_LIMITS.events}`);
  const events: AbiEvent[] = [];
  for (const e of raw.events) {
    if (!isObj(e) || !iso(e.t) || !str(e.source) || !str(e.name) || (e.kind !== "activity" && e.kind !== "rise_limit")) return bad("an event is malformed");
    if (e.kind === "rise_limit") {
      // the producer sends only { t, source, name, kind } for a rise-limit hit
      events.push({ t: e.t, source: e.source, name: e.name, kind: e.kind, payments: 0, wallets: 0, new_payers: 0, points: 0 });
      continue;
    }
    if (!count(e.payments) || !count(e.wallets) || !count(e.new_payers) || !num(e.points)) return bad("event counts must be non-negative integers and points a number");
    events.push({ t: e.t, source: e.source, name: e.name, kind: e.kind, payments: e.payments, wallets: e.wallets, new_payers: e.new_payers, points: e.points });
  }
  if (!isObj(raw.params)) return bad("params must be an object");
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.params)) {
    if (!KEY.test(k) || !num(v)) continue; // unknown or non-numeric entries are dropped
    if (Object.keys(params).length >= ABI_LIMITS.params) return bad(`params may hold at most ${ABI_LIMITS.params} numbers`);
    params[k] = v;
  }
  if (!num(params.half_life_days) || !num(params.decay_per_hour_pct)) return bad("params needs half_life_days and decay_per_hour_pct");

  let live: AbiLive | undefined;
  if (raw.live !== undefined) {
    const l = validateLive(raw.live);
    if (!l) return bad("live is malformed");
    live = l;
  }

  return {
    ok: true,
    data: {
      ...(live ? { live } : {}),
      updated: raw.updated as string, data_until: raw.data_until as string, head_time: raw.head_time as string, head_block: raw.head_block,
      index: raw.index, index_24h_ago: (raw.index_24h_ago as number | null | undefined) ?? null,
      base: { time: b.time, level: b.level, sha256: b.sha256 },
      series, projects, events, params: params as AbiData["params"],
    },
  };
}
