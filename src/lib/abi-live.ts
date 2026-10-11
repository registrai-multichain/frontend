/**
 * Arc Builders Index, live engine: a line-for-line port of the reference live.js.
 * Replays the producer's hourly loop for the open hour on Arc RPC logs, so the number shown every few
 * seconds is the value the hour will close at if nothing else happens. State comes from the server's last
 * finished hour (the index file's `live` block + the seen file). Read-only RPC: eth_getBlockByNumber, eth_getLogs.
 * Pure of the DOM: the RPC transport and the sleep are injectable.
 */
import type { AbiFx, AbiLive, AbiLiveCoin, AbiMilestone } from "./builders-index";

export const EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
/** The RPC refuses getLogs ranges of 10,000 blocks or more: stay at half of that. */
export const CHUNK = 5000;
export const RPC_URL = "https://rpc.mainnet.arc.io";
/** Above this many member contracts a topic list is too large for one request: fetch every stablecoin transfer
 * (topics [TRANSFER]) in chunks of at most WIDE_CHUNK blocks and keep members' locally ("close the gaps"). */
export const WIDE_ABOVE = 1000;
export const WIDE_CHUNK = 1000;
/** A page returning this many rows may have been cut at the RPC's result cap: split it (as an RPC error is). */
export const LOG_CAP = 9999;

/**
 * The open hour is more than this many seconds behind the chain: the server file is stale, so the browser does not
 * catch up. Audit SS-7: the first catch-up after a load also checks the time of the file's hour_start_block against
 * the head's, so a bad block number (0, or far behind the hour) can't make a visitor fetch the whole chain.
 */
export const STALE_AFTER_S = 3 * 3600;
export class StaleError extends Error {
  constructor() { super("server data is stale"); this.name = "StaleError"; }
}

export type RpcCall = (method: string, params: unknown[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type SeenFile = { hour_start: number; seen: Record<string, string> };
/** What the engine reads from the index file: the `live` block, recorded milestones and the ECB fixes. */
export type LiveInput = { live: AbiLive; milestones?: AbiMilestone[]; live_fx?: AbiFx; contracts?: LiveContracts };
/** The separate contract map (live.contracts_sha256 pins it); when absent, the inline live.contracts is used. */
export type LiveContracts = { contracts: Record<string, string>; open_senders: string[] };
type Ev = { ts: number; b: number; src: string; w: string; v: number };
type Act = { payments: number; wallets: Set<string>; new_payers: number; points: number; usdc: number };
export type TapeEntry = { ts: number; src: string; v: number; pts: number; isNew: boolean };
/** [iso hour open, open, high, low, close, payments, USDC, points] */
export type Candle = [string, number, number, number, number, number, number, number];

export type LiveResult = {
  index: number;
  roots: Record<string, number>;
  total: number;
  P: Record<string, number>;
  act: Record<string, Act>;
  capped: string[];
  f: number;
  head: number;
  headTs: number;
  hourStart: number;
  closedHours: { t: number; index: number; candle: Candle }[];
  baseSampled: boolean;
  tape: TapeEntry[];
  candle: Candle;
  rootsPrev: Record<string, number>;
};

/** JSON-RPC over fetch; 429 and 5xx back off (800 ms doubling, 5 retries), anything else throws. */
export function httpRpc(url = RPC_URL, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): RpcCall {
  let id = 0;
  return async (method, params) => {
    for (let i = 0; ; i++) {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      if ((r.status === 429 || r.status >= 500) && i < 5) { await sleep(800 * 2 ** i); continue; }
      if (!r.ok) throw new Error("RPC HTTP " + r.status);
      const j = await r.json();
      if (j.error) throw new Error("RPC " + (j.error.message || JSON.stringify(j.error)));
      return j.result;
    }
  };
}

const hex = (n: number) => "0x" + n.toString(16);
/**
 * Audit SS-7: every map keyed by a source id from the file is a null-prototype object, so ids such as "constructor"
 * or "__proto__" are plain keys (never Object.prototype members, never a prototype change).
 */
type Dict<T> = Record<string, T>;
function dict<T>(src?: Dict<T> | null): Dict<T> {
  const o = Object.create(null) as Dict<T>;
  if (src) for (const k of Object.keys(src)) o[k] = src[k];
  return o;
}

export function createEngine(opts: { call?: RpcCall; rpc?: string; sleep?: (ms: number) => Promise<void> } = {}) {
  const call: RpcCall = opts.call ?? httpRpc(opts.rpc || RPC_URL, opts.sleep);
  const blockTs = async (n: number): Promise<number> => parseInt((await call("eth_getBlockByNumber", [hex(n), false])).timestamp, 16);
  async function firstBlockAtOrAfter(ts: number, lo: number, hi: number): Promise<number> {
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await blockTs(mid)) < ts) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  let L: AbiLive;
  let seen: Map<string, Set<string>>;
  let topic2: string[];
  let C: Record<string, string> = {}; // member contracts: address -> source
  let wide = false;
  let hourStart: number, hourBlock: number, lastBlock: number, headTs: number;
  let events: Ev[];
  let basePts: number | null;
  let P: Dict<number>, rootsPrev: Dict<number>;
  let deployers: Dict<string[]> = dict();
  let anchored = false; // the first catch-up since load() checked hour_start_block's time (audit SS-7)
  let coins: Record<string, AbiLiveCoin> = {}, fx: AbiFx = {};
  let cOpen: number, cHi: number, cLo: number, pathDone: number; // the open hour's candle
  let openSenders = new Set<string>(); // §15 integrated products' contracts
  let milestones: AbiMilestone[] = [], msDone = new Set<string>(); // recorded milestones; applied after the rise limit

  // fx.py rate_for: USD per unit, latest ECB fix dated before the UTC day of ts
  function rateFor(ccy: string, ts: number): number | null {
    if (ccy === "USD") return 1;
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    let best: string | null = null;
    for (const d in fx) if (d < day && (best === null || d > best) && fx[d][ccy] != null) best = d;
    return best ? fx[best][ccy] : null;
  }
  /* An internal hop: a payment between tracked contracts. §15: an integrated product's contract (open_senders) may
   * still pay OTHER members (a routed payment counts for the project it reaches), never its own member. */
  function internal(from: string, src: string): boolean {
    const owner = C[from];
    return !!owner && (!openSenders.has(from) || owner === src);
  }
  function acceptSc(log: any): Ev | null { // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = coins[log.address.toLowerCase()];
    if (!m || log.topics.length !== 3) return null;
    const to = "0x" + log.topics[2].slice(26), from = "0x" + log.topics[1].slice(26);
    const src = C[to], ts = parseInt(log.blockTimestamp, 16);
    if (!src || ts < m.added || from === ZERO || internal(from, src) || (deployers[src] || []).includes(from)) return null;
    const rate = rateFor(m.currency, ts);
    if (rate == null) return null;
    return { ts, b: parseInt(log.blockNumber, 16), src, w: from, v: (Number(BigInt(log.data)) / 10 ** m.decimals) * rate };
  }

  function load(index: LiveInput, seenJson: SeenFile) {
    L = index.live;
    seen = new Map();
    const pl = L.seen_prefix;
    for (const [s, str] of Object.entries(seenJson.seen)) {
      const set = new Set<string>();
      for (let i = 0; i < str.length; i += pl) set.add(str.slice(i, i + pl));
      seen.set(s, set);
    }
    C = index.contracts ? index.contracts.contracts : L.contracts;
    wide = Object.keys(C).length > WIDE_ABOVE;
    topic2 = wide ? [] : [...new Set(Object.keys(C))].sort().map((c) => "0x" + "0".repeat(24) + c.slice(2));
    coins = L.stablecoins || {}; fx = index.live_fx || {};
    openSenders = new Set(index.contracts ? index.contracts.open_senders : L.open_senders || []);
    hourStart = L.hour_start; hourBlock = L.hour_start_block; lastBlock = hourBlock - 1;
    events = []; basePts = null; headTs = hourStart; anchored = false;
    P = dict(L.P); rootsPrev = dict(L.roots_prev); deployers = dict(L.deployers);
    milestones = (index.milestones || []).slice(); msDone = new Set();
    resetCandle();
  }

  function resetCandle() {
    cOpen = L.K * Object.values(rootsPrev).reduce((x, y) => x + y, 0); // = the previous hour's close
    cHi = cLo = cOpen; pathDone = 0;
  }

  function accept(log: any): Ev | null { // eslint-disable-line @typescript-eslint/no-explicit-any
    const to = "0x" + log.topics[2].slice(26), from = "0x" + log.topics[1].slice(26);
    const src = C[to];
    if (!src || from === ZERO || internal(from, src) || (deployers[src] || []).includes(from)) return null;
    return { ts: parseInt(log.blockTimestamp, 16), b: parseInt(log.blockNumber, 16), src, w: from, v: Number(BigInt(log.data)) / 1e18 };
  }

  /* One getLogs page over [b, e], split in half on an RPC error or a page at the result cap (it may be cut) until
   * a single block; a single block's error propagates (same as live.js getLogsSafe). */
  async function getLogsSafe(filter: { address: string | string[]; topics: (string | string[] | null)[] }, b: number, e: number): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const logs = await call("eth_getLogs", [{ fromBlock: hex(b), toBlock: hex(e), ...filter }]);
      if (logs.length < LOG_CAP || b === e) return logs;
    } catch (err) {
      if (b === e) throw err;
    }
    const m = Math.floor((b + e) / 2);
    return (await getLogsSafe(filter, b, m)).concat(await getLogsSafe(filter, m + 1, e));
  }
  async function getLogs(filter: { address: string | string[]; topics: (string | string[] | null)[] }, from: number, to: number): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const size = wide ? WIDE_CHUNK : CHUNK;
    for (let b = from; b <= to; b += size) out.push(...(await getLogsSafe(filter, b, Math.min(to, b + size - 1))));
    return out;
  }
  const memberTo = (l: { topics: string[] }) => l.topics.length === 3 && C["0x" + l.topics[2].slice(26)] !== undefined;

  async function fetchLogs(from: number, to: number): Promise<Ev[]> {
    const out: Ev[] = [];
    const topics = wide ? [TRANSFER] : [TRANSFER, null, topic2];
    for (const l of await getLogs({ address: EMITTER, topics }, from, to)) {
      if (wide && !memberTo(l)) continue; // not into a member: no timestamp lookup
      if (!l.blockTimestamp) l.blockTimestamp = hex(await blockTs(parseInt(l.blockNumber, 16)));
      const ev = accept(l);
      if (ev) out.push(ev);
    }
    const sc = Object.keys(coins);
    if (sc.length) { // other fiat stablecoins into members, in USD (ECB fix)
      for (const l of await getLogs({ address: sc, topics }, from, to)) {
        if (wide && !memberTo(l)) continue;
        if (!l.blockTimestamp) l.blockTimestamp = hex(await blockTs(parseInt(l.blockNumber, 16)));
        const ev = acceptSc(l);
        if (ev) out.push(ev);
      }
    }
    return out;
  }

  async function sampleBase(): Promise<number> {
    // first base_window blocks of the hour, all USDC transfers, per-sender totals
    // split on an RPC error or a full page (audit OPS-1: 20,001 dust transfers in the window broke one big request)
    const logs = await getLogsSafe({ address: EMITTER, topics: [TRANSFER] }, hourBlock, hourBlock + L.base_window - 1);
    const agg = new Map<string, number>();
    for (const l of logs) {
      const fr = "0x" + l.topics[1].slice(26), to = "0x" + l.topics[2].slice(26);
      if (fr === ZERO || to === ZERO || fr === to) continue;
      agg.set(fr, (agg.get(fr) || 0) + Number(BigInt(l.data)) / 1e18);
    }
    const sc = Object.keys(coins).filter((a) => coins[a].added <= hourStart);
    if (sc.length) { // same window, other fiat stablecoins, merged per sender after USDC
      for (const l of await call("eth_getLogs", [{ fromBlock: hex(hourBlock), toBlock: hex(hourBlock + L.base_window - 1), address: sc, topics: [TRANSFER] }])) {
        if (l.topics.length !== 3) continue;
        const m = coins[l.address.toLowerCase()];
        const fr = "0x" + l.topics[1].slice(26), to = "0x" + l.topics[2].slice(26);
        const rate = m ? rateFor(m.currency, hourStart) : null;
        if (!m || rate == null || fr === ZERO || to === ZERO || fr === to) continue;
        agg.set(fr, (agg.get(fr) || 0) + (Number(BigInt(l.data)) / 10 ** m.decimals) * rate);
      }
    }
    let pts = 0;
    for (const v of agg.values()) pts += Math.log2(1 + Math.min(Math.round(v * 1e6) / 1e6, L.cap));
    return L.base_scale * pts;
  }

  const hourEvents = () =>
    events.filter((e) => e.ts >= hourStart && e.ts < hourStart + 3600)
      .sort((a, b) => a.ts - b.ts || (a.src < b.src ? -1 : a.src > b.src ? 1 : 0) || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0) || a.v - b.v);

  // advance the candle's high and low through the open hour's payments (the value after each one), then through
  // its milestones up to `until` (each is its own path point)
  function walkPath(until: number) {
    const evs = hourEvents();
    for (; pathDone < evs.length; pathDone++) {
      const e = evs[pathDone];
      const v = evaluate((e.ts - hourStart) / 3600, e.ts, e.ts - hourStart >= 120).index;
      cHi = Math.max(cHi, v); cLo = Math.min(cLo, v);
    }
    for (const m of milestones) if (!msDone.has(m.id) && m.t >= hourStart && m.t < hourStart + 3600 && m.t <= until) {
      const v = evaluate((m.t - hourStart) / 3600, m.t, m.t - hourStart >= 120).index;
      cHi = Math.max(cHi, v); cLo = Math.min(cLo, v); msDone.add(m.id);
    }
  }
  const isoHour = (sec: number) => `${new Date(sec * 1000).toISOString().slice(0, 19)}Z`;
  const sum = (o: Record<string, Act>, k: "usdc" | "points") => Object.values(o).reduce((x, a) => x + a[k], 0);

  // the hourly loop of the producer for the open hour, decay pro rata (equal to the full hour at f = 1)
  function evaluate(f: number, upto = Infinity, withBase: boolean = basePts != null) {
    const p = dict<number>();
    for (const s in P) p[s] = P[s] * Math.pow(L.decay_h, f);
    const evs = hourEvents().filter((e) => e.ts <= upto);
    const spent = new Map<string, number>(), hourSeen = new Set<string>(), act = dict<Act>(), tape: TapeEntry[] = [];
    const npHour = dict<number>();
    const minPay = L.min_pay || 0, npMin = L.new_payer_min || 0, npMax = L.new_payer_max_h == null ? Infinity : L.new_payer_max_h;
    for (const e of evs) {
      if (e.v < minPay) continue; // audit F1: dust is ignored
      const k = e.src + e.w, room = Math.max(0, L.cap - (spent.get(k) || 0)), counted = Math.min(e.v, room);
      spent.set(k, (spent.get(k) || 0) + counted);
      let pts = counted > 0 ? Math.log2(1 + counted) : 0;
      const sk = e.src + e.w;
      let isNew = false;
      if (e.v >= npMin) { // audit F1: only a payment of new_payer_min or more makes (and marks) a new payer, at most new_payer_max_h per member-hour
        isNew = !hourSeen.has(sk) && !(seen.get(e.src) || new Set<string>()).has(e.w.slice(2, 2 + L.seen_prefix)) && (npHour[e.src] || 0) < npMax;
        if (isNew) { pts += L.new_payer; npHour[e.src] = (npHour[e.src] || 0) + 1; }
        hourSeen.add(sk);
      }
      p[e.src] = (p[e.src] || 0) + pts;
      const a = act[e.src] || (act[e.src] = { payments: 0, wallets: new Set<string>(), new_payers: 0, points: 0, usdc: 0 });
      a.payments++; a.wallets.add(e.w); if (isNew) a.new_payers++; a.points += pts; a.usdc += counted;
      tape.push({ ts: e.ts, src: e.src, v: e.v, pts, isNew });
    }
    if (withBase && basePts != null && L.base_k > 0) p[L.base] = (p[L.base] || 0) + basePts;
    const prevTotal = Object.values(rootsPrev).reduce((x, y) => x + y, 0);
    const cut = upto === Infinity ? headTs : upto, mm = dict<number>();
    for (const m of milestones) if (m.t >= hourStart && m.t < hourStart + 3600 && m.t <= cut) mm[m.target] = (mm[m.target] || 1) * m.mult;
    const roots = dict<number>(), capped: string[] = [];
    for (const s in p) {
      const sc = s === L.base ? L.base_k : 1;
      let r = Math.sqrt(p[s]) * sc;
      const prev = rootsPrev[s] || 0;
      if (prevTotal > 0) {
        let lim = prev + L.proj_up * prevTotal;
        const step = L.entry_step == null ? L.entry : L.entry_step; // audit F1: a member's entry allowance phases in
        if (L.rel_up > 0) lim = Math.min(lim, Math.max(prev * (1 + L.rel_up), Math.min(L.entry * prevTotal, prev + step * prevTotal)));
        if (r > lim) { r = lim; p[s] = (r / sc) ** 2; capped.push(s); }
      }
      // milestones: after the rise limit, exempt from it
      if (mm[s] && r > 0 && (s !== L.base || L.base_k > 0)) { r *= Math.sqrt(mm[s]); p[s] = (r / sc) ** 2; }
      roots[s] = r;
    }
    const total = Object.values(roots).reduce((x, y) => x + y, 0);
    return { index: L.K * total, roots, total, P: p, act, capped, f, tape };
  }

  async function roll(): Promise<{ t: number; index: number; candle: Candle }> {
    // the open hour has ended: close it locally, open the next one
    if (basePts == null && L.base_k > 0) basePts = await sampleBase();
    walkPath(Infinity);
    const fin = evaluate(1);
    for (const e of events) if (e.ts < hourStart + 3600 && e.v >= Math.max(L.new_payer_min || 0, L.min_pay || 0)) {
      let s = seen.get(e.src);
      if (!s) seen.set(e.src, (s = new Set<string>()));
      s.add(e.w.slice(2, 2 + L.seen_prefix));
    }
    P = fin.P; rootsPrev = fin.roots;
    const usd = sum(fin.act, "usdc"), pts = sum(fin.act, "points");
    const closed = {
      t: hourStart + 3600, index: fin.index,
      candle: [isoHour(hourStart), cOpen, Math.max(cHi, fin.index), Math.min(cLo, fin.index), fin.index, fin.tape.length, usd, pts] as Candle,
    };
    hourStart += 3600;
    hourBlock = await firstBlockAtOrAfter(hourStart, hourBlock, lastBlock + 1);
    events = events.filter((e) => e.ts >= hourStart);
    basePts = null;
    resetCandle();
    return closed;
  }

  async function tick(): Promise<LiveResult> {
    const hb = await call("eth_getBlockByNumber", ["latest", false]); // number + time in one call
    const head = parseInt(hb.number, 16), hts = parseInt(hb.timestamp, 16);
    if (hts - hourStart > STALE_AFTER_S) throw new StaleError();
    if (!anchored && head > lastBlock) {
      // audit SS-7: never catch up more than STALE_AFTER_S of chain time, whatever hour_start_block says
      if (!(hourBlock >= 1) || hts - (await blockTs(hourBlock)) > STALE_AFTER_S) throw new StaleError();
      anchored = true;
    }
    if (head > lastBlock) {
      events.push(...(await fetchLogs(lastBlock + 1, head)));
      headTs = parseInt(hb.timestamp, 16);
      lastBlock = head;
    }
    const closedHours: { t: number; index: number; candle: Candle }[] = [];
    while (headTs >= hourStart + 3600) closedHours.push(await roll());
    if (basePts == null && L.base_k > 0 && lastBlock >= hourBlock + L.base_window - 1) basePts = await sampleBase(); // no base layer (AII): skip
    const f = Math.min(1, Math.max(0, (headTs - hourStart) / 3600));
    // candle path: the value after each payment and milestone of the open hour
    walkPath(headTs);
    const now = evaluate(f);
    cHi = Math.max(cHi, now.index); cLo = Math.min(cLo, now.index);
    const candle: Candle = [isoHour(hourStart), cOpen, cHi, cLo, now.index, now.tape.length, sum(now.act, "usdc"), sum(now.act, "points")];
    return Object.assign(now, { head: lastBlock, headTs, hourStart, closedHours, baseSampled: basePts != null, candle, rootsPrev: dict(rootsPrev) });
  }

  return { load, tick, evaluate, get hourStart() { return hourStart; } };
}
