/**
 * Arc Builders Index, live engine: a line-for-line port of the reference live.js.
 * Replays the producer's hourly loop for the open hour on Arc RPC logs, so the number shown every few
 * seconds is the value the hour will close at if nothing else happens. State comes from the server's last
 * finished hour (the index file's `live` block + the seen file). Read-only RPC: eth_getBlockByNumber, eth_getLogs.
 * Pure of the DOM: the RPC transport and the sleep are injectable.
 */
import type { AbiLive } from "./builders-index";

export const EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
/** The RPC refuses getLogs ranges of 10,000 blocks or more: stay at half of that. */
export const CHUNK = 5000;
export const RPC_URL = "https://rpc.mainnet.arc.io";

export type RpcCall = (method: string, params: unknown[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type SeenFile = { hour_start: number; seen: Record<string, string> };
type Ev = { ts: number; b: number; src: string; w: string; v: number };
type Act = { payments: number; wallets: Set<string>; new_payers: number; points: number };

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
  closedHours: { t: number; index: number }[];
  baseSampled: boolean;
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
  let hourStart: number, hourBlock: number, lastBlock: number, headTs: number;
  let events: Ev[];
  let basePts: number | null;
  let P: Record<string, number>, rootsPrev: Record<string, number>;

  function load(live: AbiLive, seenJson: SeenFile) {
    L = live;
    seen = new Map();
    const pl = L.seen_prefix;
    for (const [s, str] of Object.entries(seenJson.seen)) {
      const set = new Set<string>();
      for (let i = 0; i < str.length; i += pl) set.add(str.slice(i, i + pl));
      seen.set(s, set);
    }
    topic2 = [...new Set(Object.keys(L.contracts))].sort().map((c) => "0x" + "0".repeat(24) + c.slice(2));
    hourStart = L.hour_start; hourBlock = L.hour_start_block; lastBlock = hourBlock - 1;
    events = []; basePts = null; headTs = hourStart;
    P = Object.assign({}, L.P); rootsPrev = Object.assign({}, L.roots_prev);
  }

  function accept(log: any): Ev | null { // eslint-disable-line @typescript-eslint/no-explicit-any
    const to = "0x" + log.topics[2].slice(26), from = "0x" + log.topics[1].slice(26);
    const src = L.contracts[to];
    if (!src || from === ZERO || L.contracts[from] || (L.deployers[src] || []).includes(from)) return null;
    return { ts: parseInt(log.blockTimestamp, 16), b: parseInt(log.blockNumber, 16), src, w: from, v: Number(BigInt(log.data)) / 1e18 };
  }

  async function fetchLogs(from: number, to: number): Promise<Ev[]> {
    const out: Ev[] = [];
    for (let b = from; b <= to; b += CHUNK) {
      const e = Math.min(to, b + CHUNK - 1);
      const logs = await call("eth_getLogs", [{ fromBlock: hex(b), toBlock: hex(e), address: EMITTER, topics: [TRANSFER, null, topic2] }]);
      for (const l of logs) {
        if (!l.blockTimestamp) l.blockTimestamp = hex(await blockTs(parseInt(l.blockNumber, 16)));
        const ev = accept(l);
        if (ev) out.push(ev);
      }
    }
    return out;
  }

  async function sampleBase(): Promise<number> {
    // first base_window blocks of the hour, all USDC transfers, per-sender totals
    const logs = await call("eth_getLogs", [{ fromBlock: hex(hourBlock), toBlock: hex(hourBlock + L.base_window - 1), address: EMITTER, topics: [TRANSFER] }]);
    const agg = new Map<string, number>();
    for (const l of logs) {
      const fr = "0x" + l.topics[1].slice(26), to = "0x" + l.topics[2].slice(26);
      if (fr === ZERO || to === ZERO || fr === to) continue;
      agg.set(fr, (agg.get(fr) || 0) + Number(BigInt(l.data)) / 1e18);
    }
    let pts = 0;
    for (const v of agg.values()) pts += Math.log2(1 + Math.min(Math.round(v * 1e6) / 1e6, L.cap));
    return L.base_scale * pts;
  }

  // the hourly loop of the producer for the open hour, decay pro rata (equal to the full hour at f = 1)
  function evaluate(f: number) {
    const p: Record<string, number> = {};
    for (const s in P) p[s] = P[s] * Math.pow(L.decay_h, f);
    const evs = events.filter((e) => e.ts >= hourStart && e.ts < hourStart + 3600)
      .sort((a, b) => a.ts - b.ts || (a.src < b.src ? -1 : a.src > b.src ? 1 : 0) || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0) || a.v - b.v);
    const spent = new Map<string, number>(), hourSeen = new Set<string>(), act: Record<string, Act> = {};
    for (const e of evs) {
      const k = e.src + e.w, room = Math.max(0, L.cap - (spent.get(k) || 0)), counted = Math.min(e.v, room);
      spent.set(k, (spent.get(k) || 0) + counted);
      let pts = counted > 0 ? Math.log2(1 + counted) : 0;
      const sk = e.src + e.w;
      const isNew = !hourSeen.has(sk) && !(seen.get(e.src) || new Set<string>()).has(e.w.slice(2, 2 + L.seen_prefix));
      if (isNew) pts += L.new_payer;
      hourSeen.add(sk);
      p[e.src] = (p[e.src] || 0) + pts;
      const a = act[e.src] || (act[e.src] = { payments: 0, wallets: new Set<string>(), new_payers: 0, points: 0 });
      a.payments++; a.wallets.add(e.w); if (isNew) a.new_payers++; a.points += pts;
    }
    if (basePts != null) p[L.base] = (p[L.base] || 0) + basePts;
    const prevTotal = Object.values(rootsPrev).reduce((x, y) => x + y, 0);
    const roots: Record<string, number> = {}, capped: string[] = [];
    for (const s in p) {
      const sc = s === L.base ? L.base_k : 1;
      let r = Math.sqrt(p[s]) * sc;
      const prev = rootsPrev[s] || 0;
      if (prevTotal > 0) {
        let lim = prev + L.proj_up * prevTotal;
        if (L.rel_up > 0) lim = Math.min(lim, prev > 0 ? Math.max(prev * (1 + L.rel_up), L.entry * prevTotal) : L.entry * prevTotal);
        if (r > lim) { r = lim; p[s] = (r / sc) ** 2; capped.push(s); }
      }
      roots[s] = r;
    }
    const total = Object.values(roots).reduce((x, y) => x + y, 0);
    return { index: L.K * total, roots, total, P: p, act, capped, f };
  }

  async function roll(): Promise<{ t: number; index: number }> {
    // the open hour has ended: close it locally, open the next one
    if (basePts == null) basePts = await sampleBase();
    const fin = evaluate(1);
    for (const e of events) if (e.ts < hourStart + 3600) {
      let s = seen.get(e.src);
      if (!s) seen.set(e.src, (s = new Set<string>()));
      s.add(e.w.slice(2, 2 + L.seen_prefix));
    }
    P = fin.P; rootsPrev = fin.roots;
    const closed = { t: hourStart + 3600, index: fin.index };
    hourStart += 3600;
    hourBlock = await firstBlockAtOrAfter(hourStart, hourBlock, lastBlock + 1);
    events = events.filter((e) => e.ts >= hourStart);
    basePts = null;
    return closed;
  }

  async function tick(): Promise<LiveResult> {
    const hb = await call("eth_getBlockByNumber", ["latest", false]); // number + time in one call
    const head = parseInt(hb.number, 16);
    if (head > lastBlock) {
      events.push(...(await fetchLogs(lastBlock + 1, head)));
      headTs = parseInt(hb.timestamp, 16);
      lastBlock = head;
    }
    const closedHours: { t: number; index: number }[] = [];
    while (headTs >= hourStart + 3600) closedHours.push(await roll());
    if (basePts == null && lastBlock >= hourBlock + L.base_window - 1) basePts = await sampleBase();
    const f = Math.min(1, Math.max(0, (headTs - hourStart) / 3600));
    return Object.assign(evaluate(f), { head: lastBlock, headTs, hourStart, closedHours, baseSampled: basePts != null });
  }

  return { load, tick, evaluate, get hourStart() { return hourStart; } };
}
