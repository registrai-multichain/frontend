/**
 * Points pilot: REGI in dollars and the REGI lock (plan docs/superpowers/plans/2026-10-13-pilot-regi-usd-gate-and-lock.md
 * R1–R4). Read-only Arc RPC calls and the price store; no transactions, no keys.
 *
 * Price (R1): the site samples the REGI/USDC Uniswap v4 pool itself (PoolManager.extsload of the pool's slot0), at most
 * once per 10-minute slot, during ABI mark posts, into D1 regi_price. The price is the median of the last 24 h of
 * samples; with fewer than PRICE_MIN_SAMPLES it is unknown and both the admission and the leverage check refuse
 * ("REGI price updating"): fail closed.
 *
 * Settings: PILOT_ADMIT_USD (default 10), PILOT_LOCK_USD (default 50), PILOT_LOCK_FACTORY (empty until deployed).
 */
import {
  ARC_RPC_URL,
  PILOT_ADMIT_USD_DEFAULT,
  PILOT_LOCK_USD_DEFAULT,
  POOL_MANAGER,
  PRICE_MIN_SAMPLES,
  PRICE_SAMPLE_S,
  PRICE_WINDOW_S,
  REGI_POOL_SLOT0,
  SELECTORS,
  WITHDRAWN_TOPIC,
  median,
  regiFor,
  sqrtPriceOfSlot0,
  usdPerRegiOf,
} from "../../src/lib/abi-pilot-api";
import type { D1Database, Env } from "./env";
import { SQL } from "./pilot-sql";

// ───────────────────────────── settings ─────────────────────────────

const USD_RE = /^\d{1,7}(?:\.\d{1,2})?$/;
const usdSetting = (raw: string | undefined, dflt: number): number | null => {
  const s = (raw ?? "").trim();
  if (s === "") return dflt;
  return USD_RE.test(s) && Number(s) > 0 ? Number(s) : null;
};
/** PILOT_ADMIT_USD in dollars (unset: 10), or null when it is not a positive number with at most 2 decimals. */
export const admitUsdOf = (env: Env) => usdSetting(env.PILOT_ADMIT_USD, PILOT_ADMIT_USD_DEFAULT);
/** PILOT_LOCK_USD in dollars (unset: 50), or null when it is not a positive number with at most 2 decimals. */
export const lockUsdOf = (env: Env) => usdSetting(env.PILOT_LOCK_USD, PILOT_LOCK_USD_DEFAULT);
/** PILOT_LOCK_FACTORY lowercase; null when unset or empty (not deployed yet); undefined when it is not an address (misconfigured). */
export function lockFactoryOf(env: Env): string | null | undefined {
  const s = (env.PILOT_LOCK_FACTORY ?? "").trim();
  if (s === "") return null;
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : undefined;
}

// ───────────────────────────── RPC ─────────────────────────────

const RPC_TIMEOUT_MS = 5000;

/** One JSON-RPC call to the Arc RPC; throws unless it answers cleanly. */
export async function rpcCall(fetchFn: typeof fetch, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetchFn(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: unknown };
  if (j.error !== undefined || j.result === undefined) throw new Error("rpc: bad answer");
  return j.result;
}

/** eth_call at a block tag (default latest) returning one 32-byte word. */
async function callWord(fetchFn: typeof fetch, to: string, data: string, tag = "latest"): Promise<bigint> {
  const r = await rpcCall(fetchFn, "eth_call", [{ to, data }, tag]);
  if (typeof r !== "string" || !/^0x[0-9a-fA-F]{0,64}$/.test(r)) throw new Error("rpc: bad answer");
  return r === "0x" ? 0n : BigInt(r);
}

const addrArg = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

/** USD per REGI now, from the pool's slot0 (throws when the RPC fails or the pool has no price). */
export async function readPoolPrice(fetchFn: typeof fetch): Promise<number> {
  const word = await callWord(fetchFn, POOL_MANAGER, SELECTORS.extsload + REGI_POOL_SLOT0.slice(2));
  const p = usdPerRegiOf(sqrtPriceOfSlot0(`0x${word.toString(16)}`));
  if (p === null) throw new Error("pool has no price");
  return p;
}

/**
 * RegiLockFactory.lockedOf(wallet): raw REGI in the wallet's vault (0 when it has none), at `block` (default latest; the
 * watch pins it so a lagging RPC node errors instead of answering an old balance). Throws on an RPC failure.
 */
export const lockedOf = (factory: string, wallet: string, fetchFn: typeof fetch, block?: number) =>
  callWord(fetchFn, factory, SELECTORS.lockedOf + addrArg(wallet), block === undefined ? "latest" : `0x${block.toString(16)}`);

export async function blockNumber(fetchFn: typeof fetch): Promise<number> {
  const r = await rpcCall(fetchFn, "eth_blockNumber", []);
  if (typeof r !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(r)) throw new Error("rpc: bad answer");
  return Number(BigInt(r));
}

/** The factory's Withdrawn logs in [from, to]: each owner (lowercase) once, at its latest block in the range. Throws on an RPC failure. */
export async function withdrawnLogs(factory: string, from: number, to: number, fetchFn: typeof fetch): Promise<{ owner: string; block: number }[]> {
  const r = await rpcCall(fetchFn, "eth_getLogs", [{ address: factory, topics: [WITHDRAWN_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }]);
  if (!Array.isArray(r)) throw new Error("rpc: bad answer");
  const out = new Map<string, number>();
  for (const l of r as { topics?: unknown; blockNumber?: unknown }[]) {
    const t = Array.isArray(l?.topics) ? l.topics[1] : undefined;
    if (typeof t !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(t)) throw new Error("rpc: bad log");
    if (typeof l.blockNumber !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(l.blockNumber)) throw new Error("rpc: bad log");
    const block = Number(BigInt(l.blockNumber));
    if (block < from || block > to) throw new Error("rpc: log outside the range");
    const owner = `0x${t.slice(-40).toLowerCase()}`;
    out.set(owner, Math.max(out.get(owner) ?? block, block));
  }
  return [...out].map(([owner, block]) => ({ owner, block }));
}

// ───────────────────────────── price ─────────────────────────────

/** The 10-minute slot holding `t` (one sample per slot). */
export const priceSlot = (t: number) => Math.floor(t / PRICE_SAMPLE_S) * PRICE_SAMPLE_S;

/** The median is reused for this long per isolate and database (an account poll would otherwise scan up to 144 rows). */
export const PRICE_CACHE_S = 60;
const priceCache = new WeakMap<D1Database, { at: number; price: number | null }>();
/** Forget the cached median of `db` (tests that change regi_price under a fixed clock). */
export const clearPriceCache = (db: D1Database) => priceCache.delete(db);

/**
 * USD per REGI: the median of the samples of the last 24 h, or null with fewer than PRICE_MIN_SAMPLES (fail closed).
 * Cached ≤ PRICE_CACHE_S per isolate and database: a new sample lands once per 10 minutes, so the median is at most a
 * minute behind it.
 */
export async function regiPrice(db: D1Database, nowS: number): Promise<number | null> {
  const hit = priceCache.get(db);
  if (hit && nowS >= hit.at && nowS - hit.at < PRICE_CACHE_S) return hit.price;
  const rows = (await db.prepare(SQL.priceWindow).bind(nowS - PRICE_WINDOW_S).all<{ p: number }>()).results;
  const price = rows.length >= PRICE_MIN_SAMPLES ? median(rows.map((r) => r.p)) : null;
  priceCache.set(db, { at: nowS, price });
  return price;
}

/**
 * R1: samples the pool once for this slot (lastTs: the newest stored sample's slot, null for none). Returns whether a
 * sample was stored; an RPC failure stores nothing (the next post of the slot tries again).
 */
export async function samplePrice(db: D1Database, nowS: number, fetchFn: typeof fetch, lastTs: number | null): Promise<boolean> {
  const slot = priceSlot(nowS);
  if (lastTs !== null && lastTs >= slot) return false;
  let p: number;
  try {
    p = await readPoolPrice(fetchFn);
  } catch (e) {
    console.error(`pilot: REGI price sample failed: ${String((e as Error)?.message ?? e)}`);
    return false;
  }
  return (await db.prepare(SQL.priceInsert).bind(slot, p).run()).meta.changes === 1;
}

/** The raw REGI that `usd` dollars are at the price (null while the price is unknown). */
export const regiAt = (usd: number, price: number | null) => (price === null ? null : regiFor(usd, price));

/** A raw REGI amount as the canonical decimal string positions.lock_req holds. */
export const lockReqString = (raw: bigint) => raw.toString(10);
