/**
 * Arc Builders Index: the published data file and its validator (shared by the
 * builders-site Pages Function and the page). The producer POSTs the whole file
 * to /api/index; only the fields below are kept, anything else is dropped.
 */

import { evidenceItem } from "./facts";

export const ABI_KEY = "abi:index";
export const ABI_SEEN_KEY = "abi:seen";
export const ABI_LIMITS = {
  bytes: 256 * 1024,
  seenBytes: 1024 * 1024,
  contracts: 5_000,
  deployersPer: 50,
  seenSources: 200,
  /** under the RPC's getLogs range limit (10,000 blocks) */
  baseWindow: 5_000,
  candles: 5_000,
  tape: 1_000,
  series: 10_000,
  projects: 200,
  events: 2_000,
  params: 32,
  str: 200,
  milestones: 500,
  milestoneTitle: 120,
  evidencePer: 10,
  stablecoins: 50,
  volumeCoins: 50,
  fxDates: 10,
  fxCurrencies: 20,
} as const;

/** Milestone tiers (spec §12): the multiplier on the target member's points, and whether the target is the Arc base layer. */
export const ABI_MILESTONE_TIERS = {
  "arc-upgrade": { mult: 1.25, base: true },
  "circle-product": { mult: 1.15, base: true },
  "stablecoin-launch": { mult: 1.1, base: true },
  "project-release": { mult: 1.1, base: false },
} as const;
export type AbiMilestoneTier = keyof typeof ABI_MILESTONE_TIERS;

export type AbiProject = { source: string; name: string; share: number; share_base: number | null; points: number; contracts: number; base_layer: boolean;
  /** points this hour / last 24 closed hours, payments and USDC in the last 24 closed hours */
  pts_1h: number; pts_24h: number; pay_24h: number; usdc_24h: number };
export type AbiEvent = { t: string; source: string; name: string; kind: "activity" | "rise_limit"; payments: number; wallets: number; new_payers: number; points: number; usdc: number; open?: true };
/** What the browser needs to replay the open hour (the producer's state at the last closed hour). */
export type AbiLive = {
  hour_start: number; hour_start_block: number;
  K: number; base_k: number; base: string;
  P: Record<string, number>; roots_prev: Record<string, number>;
  decay_h: number; cap: number; new_payer: number; proj_up: number; rel_up: number; entry: number; base_scale: number; base_window: number;
  contracts: Record<string, string>; deployers: Record<string, string[]>; seen_prefix: number;
  /** registered fiat stablecoins by lowercase token address (counted from `added`, unix seconds) */
  stablecoins?: Record<string, AbiLiveCoin>;
};
export type AbiLiveCoin = { symbol: string; currency: string; decimals: number; added: number };
/** A recorded milestone: from `t` (unix seconds) the target's √P is multiplied by √mult, after the rise limit. */
export type AbiMilestone = { id: string; t: number; target: string; tier: AbiMilestoneTier; mult: number; title: string; evidence: string[] };
export type AbiStablecoin = { symbol: string; currency: string; issuer: string; address: string; decimals: number; added: number };
export type AbiVolume = { members_usd: number; members_payments: number; base_usd_est: number; base_transfers_est: number };
/** ECB fixes: date (YYYY-MM-DD) -> currency -> USD per unit */
export type AbiFx = Record<string, Record<string, number>>;
/** [iso hour open, open, high, low, close, payments, USDC, points] */
export type AbiCandle = [string, number, number, number, number, number, number, number];
/** [iso time, source, USDC, points, new payer 0|1] */
export type AbiTapeRow = [string, string, number, number, 0 | 1];
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
  roots_24h: Record<string, number>;
  candles: AbiCandle[];
  tape: AbiTapeRow[];
  milestones: AbiMilestone[];
  stablecoins: AbiStablecoin[];
  volume_24h: Record<string, AbiVolume>;
  live_fx: AbiFx;
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
const SYMBOL = /^[A-Za-z0-9.]{1,16}$/;
const CCY = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const decimals = (v: unknown): v is number => count(v) && v <= 36;
// one line of plain text: no control characters
const line = (v: unknown, max: number): v is string => str(v, max) && !/[\u0000-\u001f\u007f]/.test(v) && v.trim() === v;

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

/** live.stablecoins: lowercase token address -> { symbol, currency, decimals, added }; null when malformed. */
function validateLiveCoins(v: unknown): Record<string, AbiLiveCoin> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > ABI_LIMITS.stablecoins) return null;
  const out: Record<string, AbiLiveCoin> = {};
  for (const a of keys) {
    const c = v[a];
    if (!ADDR.test(a) || !isObj(c) || typeof c.symbol !== "string" || !SYMBOL.test(c.symbol) || typeof c.currency !== "string" || !CCY.test(c.currency) || !decimals(c.decimals) || !posInt(c.added)) return null;
    out[a] = { symbol: c.symbol, currency: c.currency, decimals: c.decimals, added: c.added };
  }
  return out;
}

/** Recorded milestones (spec §12): known tier, base tiers on a base member and member tiers off it, evidence links only. */
function validateMilestones(v: unknown): AbiMilestone[] | string {
  if (!Array.isArray(v) || v.length > ABI_LIMITS.milestones) return `milestones must be an array of at most ${ABI_LIMITS.milestones}`;
  const out: AbiMilestone[] = [];
  for (const m of v) {
    if (!isObj(m) || typeof m.id !== "string" || !MS_ID.test(m.id) || !posInt(m.t) || !str(m.target) || !line(m.title, ABI_LIMITS.milestoneTitle)) return "a milestone is malformed";
    const tier = typeof m.tier === "string" && Object.prototype.hasOwnProperty.call(ABI_MILESTONE_TIERS, m.tier) ? (m.tier as AbiMilestoneTier) : null;
    if (!tier) return "a milestone tier is unknown";
    if (ABI_MILESTONE_TIERS[tier].base !== m.target.startsWith("base:")) return `milestone ${m.id}: ${tier} targets ${ABI_MILESTONE_TIERS[tier].base ? "the Arc base layer" : "a member"}`;
    if (!num(m.mult) || m.mult <= 1 || m.mult > 2) return "a milestone multiplier must be above 1 and at most 2";
    if (!Array.isArray(m.evidence) || m.evidence.length < 1 || m.evidence.length > ABI_LIMITS.evidencePer) return `a milestone needs 1 to ${ABI_LIMITS.evidencePer} evidence items`;
    const evidence: string[] = [];
    for (const e of m.evidence) {
      const ok = evidenceItem(e);
      if (!ok) return "milestone evidence must be https URLs, 0x addresses or 0x tx hashes";
      evidence.push(ok);
    }
    out.push({ id: m.id, t: m.t, target: m.target, tier, mult: m.mult, title: m.title, evidence });
  }
  return out;
}

function validateStablecoins(v: unknown): AbiStablecoin[] | null {
  if (!Array.isArray(v) || v.length > ABI_LIMITS.stablecoins) return null;
  const out: AbiStablecoin[] = [];
  for (const c of v) {
    if (!isObj(c) || typeof c.symbol !== "string" || !SYMBOL.test(c.symbol) || typeof c.currency !== "string" || !CCY.test(c.currency)) return null;
    if (typeof c.address !== "string" || !ADDR.test(c.address) || !decimals(c.decimals) || !posInt(c.added)) return null;
    if (c.issuer !== undefined && !line(c.issuer, 80)) return null;
    out.push({ symbol: c.symbol, currency: c.currency, issuer: (c.issuer as string | undefined) ?? "", address: c.address, decimals: c.decimals, added: c.added });
  }
  return out;
}

function validateVolume(v: unknown): Record<string, AbiVolume> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > ABI_LIMITS.volumeCoins) return null;
  const out: Record<string, AbiVolume> = {};
  for (const k of keys) {
    const o = v[k];
    if (!SYMBOL.test(k) || !isObj(o)) return null;
    const vals = [o.members_usd ?? 0, o.members_payments ?? 0, o.base_usd_est ?? 0, o.base_transfers_est ?? 0];
    if (!vals.every((x) => num(x) && x >= 0)) return null;
    const [mu, mp, bu, bt] = vals as number[];
    out[k] = { members_usd: mu, members_payments: mp, base_usd_est: bu, base_transfers_est: bt };
  }
  return out;
}

/**
 * ECB fixes for the open hour's conversions: only the currencies of registered coins are kept (the producer sends the
 * whole ECB table), at most `fxDates` dates and `fxCurrencies` currencies per date. Rates are USD per unit, positive.
 */
function validateFx(v: unknown, currencies: Set<string>): AbiFx | null {
  if (!isObj(v)) return null;
  const days = Object.keys(v);
  if (days.length > ABI_LIMITS.fxDates) return null;
  const out: AbiFx = {};
  for (const d of days) {
    const row = v[d];
    if (!DAY.test(d) || !isObj(row) || Object.keys(row).length > 64) return null;
    const kept: Record<string, number> = {};
    for (const c of Object.keys(row)) {
      if (!currencies.has(c)) continue;
      const r = row[c];
      if (!num(r) || r <= 0) return null;
      kept[c] = r;
    }
    if (Object.keys(kept).length > ABI_LIMITS.fxCurrencies) return null;
    out[d] = kept;
  }
  return out;
}

/** The `live` block: null when malformed. Unknown keys are dropped. */
function validateLive(v: unknown): AbiLive | null {
  if (!isObj(v)) return null;
  if (!posInt(v.hour_start) || !count(v.hour_start_block) || !str(v.base) || !posInt(v.base_window) || v.base_window > ABI_LIMITS.baseWindow || !posInt(v.seen_prefix) || v.seen_prefix > 40) return null;
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
  let coins: Record<string, AbiLiveCoin> | null = null;
  if (v.stablecoins !== undefined) {
    coins = validateLiveCoins(v.stablecoins);
    if (!coins) return null;
  }
  return {
    ...(coins ? { stablecoins: coins } : {}),
    hour_start: v.hour_start, hour_start_block: v.hour_start_block, K: v.K as number, base_k: v.base_k as number, base: v.base, P, roots_prev: roots,
    decay_h: v.decay_h as number, cap: v.cap as number, new_payer: v.new_payer as number, proj_up: v.proj_up as number, rel_up: v.rel_up as number,
    entry: v.entry as number, base_scale: v.base_scale as number, base_window: v.base_window, contracts, deployers, seen_prefix: v.seen_prefix,
  };
}

export type AbiSeenResult = { ok: true; data: AbiSeen } | { ok: false; error: string };

/** The wallets seen before the open hour: per source, concatenated 10-hex payer-address prefixes. */
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
    const [h1, d1, pay, usd] = [p.pts_1h ?? 0, p.pts_24h ?? 0, p.pay_24h ?? 0, p.usdc_24h ?? 0];
    if (!num(h1) || !num(d1) || !count(pay) || !num(usd)) return bad("a project's pts_1h, pts_24h, pay_24h or usdc_24h is malformed");
    const extra = { pts_1h: h1, pts_24h: d1, pay_24h: pay, usdc_24h: usd };
    projects.push({ source: p.source, name: p.name, share: p.share, share_base: p.share_base ?? null, points: p.points, contracts: p.contracts, base_layer: p.base_layer, ...extra });
  }
  if (!Array.isArray(raw.events) || raw.events.length > ABI_LIMITS.events) return bad(`events must be an array of at most ${ABI_LIMITS.events}`);
  const events: AbiEvent[] = [];
  for (const e of raw.events) {
    if (!isObj(e) || !iso(e.t) || !str(e.source) || !str(e.name) || (e.kind !== "activity" && e.kind !== "rise_limit")) return bad("an event is malformed");
    if (e.kind === "rise_limit") {
      // the producer sends only { t, source, name, kind } for a rise-limit hit
      events.push({ t: e.t, source: e.source, name: e.name, kind: e.kind, payments: 0, wallets: 0, new_payers: 0, points: 0, usdc: 0 });
      continue;
    }
    if (!count(e.payments) || !count(e.wallets) || !count(e.new_payers) || !num(e.points)) return bad("event counts must be non-negative integers and points a number");
    if (e.usdc !== undefined && (!num(e.usdc) || e.usdc < 0)) return bad("event usdc must be a non-negative number");
    events.push({ t: e.t, source: e.source, name: e.name, kind: e.kind, payments: e.payments, wallets: e.wallets, new_payers: e.new_payers, points: e.points, usdc: (e.usdc as number | undefined) ?? 0 });
  }
  const candles: AbiCandle[] = [];
  if (raw.candles !== undefined) {
    if (!Array.isArray(raw.candles) || raw.candles.length > ABI_LIMITS.candles) return bad(`candles must be an array of at most ${ABI_LIMITS.candles}`);
    for (const c of raw.candles) {
      if (!Array.isArray(c) || c.length !== 8 || !iso(c[0]) || ![1, 2, 3, 4].every((i) => num(c[i]) && c[i] > 0) || !count(c[5]) || !num(c[6]) || c[6] < 0 || !num(c[7]) || c[7] < 0) return bad("candles entries must be [ISO time, open, high, low, close, payments, USDC, points]");
      candles.push(c as AbiCandle);
    }
  }
  const tape: AbiTapeRow[] = [];
  if (raw.tape !== undefined) {
    if (!Array.isArray(raw.tape) || raw.tape.length > ABI_LIMITS.tape) return bad(`tape must be an array of at most ${ABI_LIMITS.tape}`);
    for (const r of raw.tape) {
      if (!Array.isArray(r) || r.length !== 5 || !iso(r[0]) || !str(r[1]) || !num(r[2]) || r[2] < 0 || !num(r[3]) || r[3] < 0 || (r[4] !== 0 && r[4] !== 1)) return bad("tape entries must be [ISO time, source, USDC, points, 0|1]");
      tape.push(r as AbiTapeRow);
    }
  }
  let roots24: Record<string, number> = {};
  if (raw.roots_24h !== undefined) {
    const m = numberMap(raw.roots_24h, ABI_LIMITS.projects);
    if (!m) return bad("roots_24h must map sources to non-negative numbers");
    roots24 = m;
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

  let milestones: AbiMilestone[] = [];
  if (raw.milestones !== undefined) {
    const m = validateMilestones(raw.milestones);
    if (typeof m === "string") return bad(m);
    milestones = m;
  }
  let stablecoins: AbiStablecoin[] = [];
  if (raw.stablecoins !== undefined) {
    const c = validateStablecoins(raw.stablecoins);
    if (!c) return bad(`stablecoins must be at most ${ABI_LIMITS.stablecoins} of { symbol, currency, issuer, address, decimals, added }`);
    stablecoins = c;
  }
  let volume: Record<string, AbiVolume> = {};
  if (raw.volume_24h !== undefined) {
    const vv = validateVolume(raw.volume_24h);
    if (!vv) return bad(`volume_24h must map at most ${ABI_LIMITS.volumeCoins} coins to non-negative numbers`);
    volume = vv;
  }
  let liveFx: AbiFx = {};
  if (raw.live_fx !== undefined) {
    const ccys = new Set([...stablecoins.map((c) => c.currency), ...Object.values(live?.stablecoins ?? {}).map((c) => c.currency)]);
    const fx = validateFx(raw.live_fx, ccys);
    if (!fx) return bad(`live_fx must map at most ${ABI_LIMITS.fxDates} dates to at most ${ABI_LIMITS.fxCurrencies} positive rates`);
    liveFx = fx;
  }

  return {
    ok: true,
    data: {
      ...(live ? { live } : {}),
      updated: raw.updated as string, data_until: raw.data_until as string, head_time: raw.head_time as string, head_block: raw.head_block,
      index: raw.index, index_24h_ago: (raw.index_24h_ago as number | null | undefined) ?? null,
      base: { time: b.time, level: b.level, sha256: b.sha256 },
      series, projects, events, candles, tape, roots_24h: roots24, params: params as AbiData["params"],
      milestones, stablecoins, volume_24h: volume, live_fx: liveFx,
    },
  };
}
