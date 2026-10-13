/** The points pilot test harness: an offline site (D1 double, KV, fake REGI RPC) and a mark producer. */
import { expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { pilotLoginMessage, POOL_MANAGER, PRICE_SAMPLE_S, REGI_ADDRESS, REGI_POOL_SLOT0, SELECTORS, WITHDRAWN_TOPIC } from "../../src/lib/abi-pilot-api";
import type { Env } from "../lib/env";
import { handleAccount, handleClose, handleHistory, handleOrder, handlePushMark } from "../lib/pilot";
import { handlePilotLogin, handlePilotNonce, type PilotDeps } from "../lib/pilot-auth";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

export const ORIGIN = "https://builder.registrai.cc";
export const PUSH = "p".repeat(40);
export const SESSION_SECRET = "s".repeat(40);
/** A snapshot block after REGI's deploy (22,419,071) and below every mark's head (audit PE-7). */
export const SNAP = 23_000_000;
// Anvil's dev keys: never real funds.
export const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
export const BOB = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
export const T0 = Date.parse("2026-10-10T12:00:10.000Z");
/** 1,000,000 REGI (raw). At the harness price (PRICE) this is exactly the default admission, $10. */
export const ONE = 1_000_000n * 10n ** 18n;
/**
 * The harness's REGI price, USD per REGI (100,000 REGI per USDC): the $10 admission is exactly ONE and the $50 lock
 * exactly 5 × ONE. Every setup() stores 12 samples of it (the last 2 h), and keeps at least 6 in the last 24 h whenever
 * the clock jumps (topUpPrice), unless autoPrice is false.
 */
export const PRICE = 1e-5;
/** The lock factory the harness configures (PILOT_LOCK_FACTORY) unless lockFactory is null. */
export const FACTORY = "0x00000000000000000000000000000000000fac70";
/** pool slot0 for a USD-per-REGI price: sqrtPriceX96 = √(raw REGI per raw USDC) × 2^96 (tick and fees left 0). */
export function slot0For(usdPerRegi: number): string {
  const sqrt = Math.sqrt(1e12 / usdPerRegi);
  return "0x" + ((BigInt(Math.round(sqrt * 2 ** 40)) << 56n).toString(16)).padStart(64, "0");
}
export const CALM = { sigma_24h: 0.002, sigma_1h: 0.0004 }; // engine cap 30× (the jump cap; volatility allows 50×)

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const lc = (a: { address: string }) => a.address.toLowerCase();

export interface MarkExtra {
  ts: number;
  /** Default: the hour of ts (as mark.py posts it). */
  hour_start: number;
  ch24: number;
  ch1: number;
  bars: number[][];
  candle: number[];
  sigma_24h: number | null;
  sigma_1h: number | null;
  /** live/mark.py v3: the hour's ex-milestone drift (null until the producer's close is confirmed); funding_rate = trend. */
  trend: number | null;
  funding_hour: number;
  base_pending: boolean;
  base_step_ts: number | null;
  milestone_ts: number | null;
  /** §9.15: the milestone premium (absent by default: an older producer, counted as 0; null blocks the hour's fix). */
  milestone_premium: number | null;
  /** The market (plan 2026-10-12 R4): absent by default, as today's producer posts (= abi). */
  index: string;
}

/**
 * maxLev: PILOT_MAX_LEV ("30" here, so the engine's own caps stay under test; null = unset, the 10× default).
 * blocked: PILOT_BLOCKED_WALLETS (unset by default).
 */
export function setup(o: {
  open?: boolean; db?: boolean; secret?: string; snapshot?: string | null; maxLev?: string | null; blocked?: string;
  /** PILOT_ADMIT_USD / PILOT_LOCK_USD (unset by default: $10 / $50). */
  admitUsd?: string; lockUsd?: string;
  /** PILOT_LOCK_FACTORY: FACTORY by default; null = unset (the lock not deployed). */
  lockFactory?: string | null;
  /** false: no stored price samples, and none added when the clock jumps (price tests). */
  autoPrice?: boolean;
} = {}) {
  let nowMs = T0;
  const db = new MemoryD1();
  // balances by "<wallet>@<block tag>"; "latest" = now
  const balances = new Map<string, bigint>([
    [`${lc(ALICE)}@latest`, 5n * ONE], [`${lc(ALICE)}@0x${SNAP.toString(16)}`, 2n * ONE],
    [`${lc(BOB)}@latest`, ONE], [`${lc(BOB)}@0x${SNAP.toString(16)}`, ONE],
  ]);
  /**
   * The fake Arc RPC. calls / tags: REGI balanceOf reads only (as before the lock); pool / lock / logs count the other
   * reads. down: every call fails; fail: only these methods / targets fail ("eth_call:pool", "eth_call:lock",
   * "eth_getLogs", "eth_blockNumber").
   */
  const rpc = {
    calls: 0, all: 0, pool: 0, lock: 0, logs: 0, down: false, tags: [] as string[], fail: new Set<string>(),
    /** The pool's price now (USD per REGI). */
    price: PRICE,
    /** lockedOf by wallet (lowercase); a wallet not in the map has defaultLock (5 × ONE: the $50 lock at PRICE). */
    locks: new Map<string, bigint>(), defaultLock: 5n * ONE,
    head: 30_000_000, withdrawals: [] as { block: number; owner: string }[], ranges: [] as [number, number][],
    /** The block tag of each lockedOf read ("latest", or the watch's pinned block in hex). */
    lockTags: [] as string[],
  };
  const fakeFetch = (async (url: string, init: RequestInit) => {
    rpc.all++;
    if (rpc.down) return new Response("bad gateway", { status: 502 });
    expect(url).toBe("https://rpc.mainnet.arc.io");
    const body = JSON.parse(String(init.body));
    const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });
    const word = (v: bigint) => ok("0x" + v.toString(16).padStart(64, "0"));
    if (body.method === "eth_blockNumber") {
      if (rpc.fail.has("eth_blockNumber")) return new Response("bad gateway", { status: 502 });
      return ok(`0x${rpc.head.toString(16)}`);
    }
    if (body.method === "eth_getLogs") {
      rpc.logs++;
      if (rpc.fail.has("eth_getLogs")) return new Response("bad gateway", { status: 502 });
      const q = body.params[0];
      expect(q.address).toBe(FACTORY);
      expect(q.topics).toEqual([WITHDRAWN_TOPIC]);
      const from = parseInt(q.fromBlock, 16), to = parseInt(q.toBlock, 16);
      expect(to - from + 1).toBeLessThanOrEqual(5000);
      rpc.ranges.push([from, to]);
      return ok(rpc.withdrawals.filter((w) => w.block >= from && w.block <= to).map((w) => ({
        address: FACTORY, blockNumber: `0x${w.block.toString(16)}`, data: "0x" + "0".repeat(64),
        topics: [WITHDRAWN_TOPIC, "0x" + w.owner.slice(2).padStart(64, "0"), "0x" + "0".repeat(64)],
      })));
    }
    expect(body.method).toBe("eth_call");
    const { to, data } = body.params[0];
    if (to === POOL_MANAGER) {
      rpc.pool++;
      if (rpc.fail.has("eth_call:pool")) return new Response("bad gateway", { status: 502 });
      expect(data).toBe(SELECTORS.extsload + REGI_POOL_SLOT0.slice(2));
      return ok(slot0For(rpc.price));
    }
    if (to === FACTORY) {
      rpc.lock++;
      if (rpc.fail.has("eth_call:lock")) return new Response("bad gateway", { status: 502 });
      expect(data.slice(0, 10)).toBe(SELECTORS.lockedOf);
      const w = `0x${data.slice(-40)}`;
      rpc.lockTags.push(body.params[1]);
      return word(rpc.locks.get(w) ?? rpc.defaultLock);
    }
    rpc.calls++;
    expect(to).toBe(REGI_ADDRESS);
    expect(data.slice(0, 10)).toBe("0x70a08231");
    rpc.tags.push(body.params[1]);
    const v = balances.get(`0x${data.slice(-40)}@${body.params[1]}`) ?? 0n;
    return word(v);
  }) as unknown as typeof fetch;
  /** Keeps ≥ 6 price samples in the last 24 h at PRICE (stores the 12 slots up to now that are missing). force: also with autoPrice false. */
  const topUpPrice = (force = false) => {
    if (o.autoPrice === false && !force) return;
    const now = Math.floor(nowMs / 1000), slot = Math.floor(now / PRICE_SAMPLE_S) * PRICE_SAMPLE_S;
    const n = db.q<{ n: number }>("SELECT COUNT(*) AS n FROM regi_price WHERE ts > ?", now - 86400)[0].n;
    if (n >= 6) return;
    for (let k = 0; k < 12; k++) db.q("INSERT INTO regi_price (ts, usd_per_regi) VALUES (?, ?) ON CONFLICT (ts) DO NOTHING", slot - k * PRICE_SAMPLE_S, PRICE);
  };
  topUpPrice();
  const kv = new MemoryKV(() => nowMs);
  /** A market's index file's closed hourly candles in KV ([iso hour start, o, h, l, c, …]); flat 1000 by default, every market. */
  const setCandles = (rows: [number, number, number, number][], market: "abi" | "aii" | "aei" = "abi") =>
    kv.put(`${market}:index`, JSON.stringify({ candles: rows.map(([t, h, l, c]) => [new Date(t * 1000).toISOString(), c, h, l, c, 1, 1, 1]) }));
  const h0 = Math.floor(T0 / 3_600_000) * 3600;
  for (const m of ["abi", "aii", "aei"] as const) void setCandles(Array.from({ length: 72 }, (_, i) => [h0 - 24 * 3600 + i * 3600, 1000, 1000, 1000]), m);
  const env: Env = {
    INVITES: kv,
    SITE_ORIGIN: ORIGIN,
    NONCE_SECRET: "nonce-secret-0123456789",
    PILOT_SESSION_SECRET: o.secret ?? SESSION_SECRET,
    ABI_PUSH_TOKEN: PUSH,
    PILOT_DB: o.db === false ? undefined : db,
    PILOT_OPEN: o.open === false ? undefined : "1",
    PILOT_REGI_SNAPSHOT_BLOCK: o.snapshot === null ? undefined : (o.snapshot ?? String(SNAP)),
    PILOT_MAX_LEV: o.maxLev === null ? undefined : (o.maxLev ?? "30"),
    ...(o.admitUsd !== undefined ? { PILOT_ADMIT_USD: o.admitUsd } : {}),
    ...(o.lockUsd !== undefined ? { PILOT_LOCK_USD: o.lockUsd } : {}),
    ...(o.lockFactory !== null ? { PILOT_LOCK_FACTORY: o.lockFactory ?? FACTORY } : {}),
    ...(o.blocked !== undefined ? { PILOT_BLOCKED_WALLETS: o.blocked } : {}),
  };
  let rnd = 0.5;
  const deps: PilotDeps = { now: () => nowMs, fetch: fakeFetch, random: () => rnd, cache: null };
  const nowS = () => Math.floor(nowMs / 1000);

  const req = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json", origin: ORIGIN } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function loginWith(acct: typeof ALICE, patch: { address?: string; signature?: string; message?: string } = {}) {
    topUpPrice();
    const { nonce } = (await (await handlePilotNonce(env, deps)).json()) as { nonce: string };
    const message = patch.message ?? pilotLoginMessage({ address: patch.address ?? lc(acct), origin: ORIGIN, nonce, issued: new Date(nowMs).toISOString() });
    const signature = patch.signature ?? (await acct.signMessage({ message }));
    return handlePilotLogin(req("/api/pilot/auth", "POST", { message, signature }), env, deps);
  }
  async function signIn(acct = ALICE): Promise<string> {
    const res = await loginWith(acct);
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")!.split(";")[0];
  }

  /** A producer post (live/mark.py v2 shape) at the current clock; bars default to one flat bar at the mark. */
  async function mark(px: number, x: Partial<MarkExtra> = {}) {
    topUpPrice();
    const ts = x.ts ?? nowS();
    const minute = Math.floor(ts / 60) * 60;
    // like mark.py: every bar after the acknowledged (finished) minute, so the minute before plus the open one
    const bars = x.bars ?? [[minute - 60, px, px, px], [minute, px, px, px]];
    const lo = Math.min(px, ...bars.map((b) => b[2])), hi = Math.max(px, ...bars.map((b) => b[1]));
    const body: Json = {
      mark: px, ts, head: 1000 + ts, hour_start: x.hour_start ?? Math.floor(ts / 3600) * 3600, candle: x.candle ?? [px, hi, lo, px, 3, 12.5],
      ch24: x.ch24 ?? 0.001, ch1: x.ch1 ?? 0.0001, bars,
      sigma_24h: x.sigma_24h === undefined ? CALM.sigma_24h : x.sigma_24h, sigma_1h: x.sigma_1h === undefined ? CALM.sigma_1h : x.sigma_1h,
      base_pending: x.base_pending ?? false, base_step_ts: x.base_step_ts ?? null,
    };
    if (x.milestone_ts !== undefined) body.milestone_ts = x.milestone_ts;
    if (x.milestone_premium !== undefined) body.milestone_premium = x.milestone_premium;
    if (x.index !== undefined) body.index = x.index;
    // like mark.py v3: trend every post (default 0 here), null until its hour close is confirmed; funding_rate = trend
    body.trend = x.trend === undefined ? 0 : x.trend;
    body.funding_rate = body.trend;
    body.funding_hour = x.funding_hour ?? body.hour_start;
    return handlePushMark(req("/api/index/mark", "POST", body, { authorization: `Bearer ${PUSH}` }), env, deps);
  }
  const markJson = async (px: number, x: Partial<MarkExtra> = {}) => {
    const r = await mark(px, x);
    return { status: r.status, body: (await r.json()) as Json };
  };

  const call = async (h: (r: Request, e: Env, d: PilotDeps) => Promise<Response>, r: Request) => {
    topUpPrice();
    const res = await h(r, env, deps);
    return { status: res.status, body: (await res.json()) as Json, res };
  };
  const submit = (cookie: string, body: unknown) => call(handleOrder, req("/api/pilot/order", "POST", body, { cookie }));
  const submitClose = (cookie: string, id: number) => call(handleClose, req("/api/pilot/close", "POST", { id }, { cookie }));
  const status = (cookie: string, id: number) => call(handleOrder, req(`/api/pilot/order?id=${id}`, "GET", undefined, { cookie }));
  const account = (cookie?: string, market?: string) => call(handleAccount, req(`/api/pilot/account${market ? `?market=${market}` : ""}`, "GET", undefined, cookie ? { cookie } : {}));
  const history = (cookie: string) => call(handleHistory, req("/api/pilot/history", "GET", undefined, { cookie }));
  const balanceOf = (w: string) => db.q<{ balance: number }>("SELECT balance FROM accounts WHERE wallet = ?", w.toLowerCase())[0]?.balance;

  /** Submit, then the next mark (1 s later) fills it; returns the order status read. */
  async function open(cookie: string, body: unknown, fillPx = 1000, x: Partial<MarkExtra> = {}) {
    const s = await submit(cookie, body);
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    nowMs += 1000;
    expect((await mark(fillPx, x)).status).toBe(200);
    return status(cookie, s.body.order.id);
  }
  async function close(cookie: string, id: number, fillPx = 1000, x: Partial<MarkExtra> = {}) {
    const s = await submitClose(cookie, id);
    if (s.status !== 202) return s;
    nowMs += 1000;
    expect((await mark(fillPx, x)).status).toBe(200);
    return status(cookie, s.body.order.id);
  }

  return {
    db, env, deps, rpc, balances, req, kv, setCandles, loginWith, signIn, mark, markJson, submit, submitClose, status, open, close, account, history, call, balanceOf, nowS, topUpPrice,
    tick: (ms: number) => (nowMs += ms),
    setRandom: (r: number) => (rnd = r),
  };
}

