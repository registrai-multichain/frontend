/**
 * ABI points pilot API, economy v2 (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md §8; plan R1–R8).
 * Points only: no deposits, no withdrawals, no transfers. D1 binding PILOT_DB (migrations/0001_pilot.sql).
 * All trading math is the engine's (src/lib/abi-pilot.ts, a port of pilot.js v2); this file only stores and feeds it.
 *
 *   POST /api/index/mark          producer (Bearer ABI_PUSH_TOKEN, live/mark.py) → 200 { last_minute, … }
 *   GET  /api/index/mark          public: the latest mark (edge-cached 5 s)
 *   GET  /api/pilot/account       session optional: open?, REGI, balance, positions, pending orders, mark, funding
 *   POST /api/pilot/order         { side, margin, lev } → 202 a pending order (session + REGI + open); 30/min
 *   GET  /api/pilot/order?id=     the order's status (pending / filled / refused)
 *   POST /api/pilot/close         { id } → 202 a pending close order (session only); 60/min
 *   GET  /api/pilot/positions     session: open positions
 *   GET  /api/pilot/history       session: the last 100 closed positions
 *   GET  /api/pilot/leaderboard   public: top 50 by equity at the latest mark, shortened addresses, cached 30 s
 *
 * Fills (spec §8.3): an order is stored pending and fills inside the ingest of the first mark posted after it
 * arrived, at that mark, if that comes within RULES.markMaxAgeS; otherwise it is refused "price updating".
 * Orders are refused while the hour's base sample is pending and for 60 s after it lands.
 *
 * Every balance / position write is one conditional statement or one batch() (a D1 transaction), guarded by
 * the order still being pending and the position still being open (lib/pilot-sql.ts): no overspend, no double
 * settle, no double fill.
 *
 * Liquidation (funding-aware): each mark post checks every open position against the bars it wrote; before any
 * account read or write the wallet's open positions are checked against every stored bar since they opened.
 * Both settle at the engine's liquidation price with nothing returned, guarded by closed_at IS NULL.
 */
import * as Engine from "../../src/lib/abi-pilot";
import { RULES, type FundingRate, type MinuteBar, type PilotPosition, type Side } from "../../src/lib/abi-pilot";
import {
  PILOT_LIMITS,
  shortWallet,
  type ClosedPositionView,
  type FundingView,
  type LeaderboardRow,
  type OpenPositionView,
  type OrderView,
  type PilotAccountView,
  type PilotMark,
} from "../../src/lib/abi-pilot-api";
import { ABI_KEY } from "../../src/lib/builders-index";
import { bearerGuard } from "./bot-auth";
import { readCapped } from "./builders-index";
import type { D1Database, D1PreparedStatement, Env } from "./env";
import { csrfFailure, edgeCachedGet, errorJson, json, randomHex, siteOrigin } from "./http";
import {
  ensureAccount,
  getAccount,
  nowMsOf,
  nowSOf,
  PILOT_UNCONFIGURED,
  pilotOpen,
  pilotWallet,
  rateOk,
  regiStatus,
  tooMany,
  type PilotDeps,
} from "./pilot-auth";
import { LIQ_PAGE, SQL } from "./pilot-sql";

export const MARK_MAX_SKEW_S = 30;
export const MARK_BODY_BYTES = 16384;
export const MAX_BARS = 60;
export const BARS_KEEP_S = 7 * 24 * 3600;
export const ORDERS_KEEP_MS = 7 * 24 * 3600 * 1000;
/** A posted bar may be at most this old (the producer keeps 4 h and catches up 60 bars per post). */
export const BAR_MAX_AGE_S = 6 * 3600;
export const MAX_FUNDING_RATE = 0.01;
export const MARK_CACHE_S = 5;
export const PRUNE_EVERY = 100;
/** A pending order the status read finds older than this is refused (the ingest refuses after markMaxAgeS). */
export const ORDER_EXPIRY_MS = (RULES.markMaxAgeS + 2) * 1000;

export const HOLD_REGI = "Hold REGI to join the points pilot.";
export const NOT_AT_SNAPSHOT = "This wallet didn't hold REGI at the pilot snapshot block.";
export const REGI_UNCHECKED = "Couldn't check REGI right now";
export const PRICE_UPDATING = "price updating";
export const PILOT_CLOSED = "pilot closed";
export const TRADING_PAUSED = "trading paused";
export const ALREADY_CLOSED = "already closed";
/** No hedging: one direction at a time per wallet (the engine's refusal, said plainly). */
export const HEDGE = "one direction at a time";
export const closeFirst = (held: Side) => `Close your ${held} first`;
const engineError = (error: string, held: readonly { side: Side }[]) => (error === HEDGE && held[0] ? closeFirst(held[0].side) : error);

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const int = (x: unknown): x is number => finite(x) && Number.isInteger(x);
const unconfigured = () => errorJson(503, PILOT_UNCONFIGURED);

// ───────────────────────────── mark ─────────────────────────────

export interface MarkPost {
  mark: number;
  ts: number;
  head: number;
  hour_start: number;
  candle: number[];
  ch24: number;
  ch1: number;
  bars: [number, number, number, number][];
  funding: { hour: number; rate: number } | null;
  sigma1h: number | null;
  sigma24h: number | null;
  basePending: boolean;
  baseStepTs: number | null;
}

/** R4 + spec §8.5: the producer's body (live/mark.py v2), checked against the server clock. */
export function validateMark(raw: unknown, nowS: number): { ok: true; data: MarkPost } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("expected a JSON object");
  const b = raw as Record<string, unknown>;
  if (!finite(b.mark) || !(b.mark > 0)) return bad("mark must be a finite number > 0");
  if (!int(b.ts)) return bad("ts must be unix seconds");
  const ts = b.ts, mark = b.mark;
  if (Math.abs(nowS - ts) > MARK_MAX_SKEW_S) return bad(`ts must be within ${MARK_MAX_SKEW_S} s of server time`);
  if (!finite(b.ch24) || !finite(b.ch1)) return bad("ch24 and ch1 must be finite numbers");
  if (!int(b.head) || b.head < 0) return bad("head must be a block number");
  if (!int(b.hour_start) || b.hour_start % 3600 !== 0 || b.hour_start > ts) return bad("hour_start must be an hour start ≤ ts");
  if (!Array.isArray(b.candle) || b.candle.length !== 6 || !b.candle.every(finite)) return bad("candle must be [o, h, l, c, payments, usdc]");
  const [o, ch, cl, cc] = b.candle as number[];
  if (!(o > 0 && ch > 0 && cl > 0 && cc > 0) || !(cl <= Math.min(o, cc) && Math.max(o, cc) <= ch)) return bad("candle must have l ≤ o, c ≤ h, all > 0");
  if (!(cl <= mark && mark <= ch)) return bad("mark must lie within the candle's low and high");

  if (!Array.isArray(b.bars) || b.bars.length < 1 || b.bars.length > MAX_BARS) return bad(`bars must have 1 to ${MAX_BARS} items`);
  const bars: MarkPost["bars"] = [];
  let prev = -Infinity;
  for (const x of b.bars) {
    if (!Array.isArray(x) || x.length !== 4 || !x.every(finite)) return bad("each bar is [minute_unix, h, l, c]");
    const [m, h, l, c] = x as number[];
    if (!Number.isInteger(m) || m % 60 !== 0) return bad("bar minute must be a minute start");
    if (m > ts) return bad("bar minute is later than ts");
    if (m < ts - BAR_MAX_AGE_S) return bad("bar minute is too old");
    if (m <= prev) return bad("bars must be in ascending minute order");
    if (!(l > 0 && h > 0 && c > 0)) return bad("bar prices must be > 0");
    if (!(l <= c && c <= h)) return bad("bar must have l ≤ c ≤ h");
    prev = m;
    bars.push([m, h, l, c]);
  }
  const last = bars[bars.length - 1];
  const cur = Math.floor(ts / 60) * 60;
  if (last[0] === cur) {
    if (!(last[2] <= mark && mark <= last[1])) return bad("mark must lie within the last bar's low and high");
  } else if (bars.length < MAX_BARS) return bad("the last bar must be the minute of ts (unless the post is a full catch-up batch)");

  let funding: MarkPost["funding"] = null;
  if (b.funding_rate !== undefined && b.funding_rate !== null) {
    if (!finite(b.funding_rate) || Math.abs(b.funding_rate) > MAX_FUNDING_RATE) return bad(`funding_rate must be a finite number within ±${MAX_FUNDING_RATE}`);
    const fh = b.funding_hour === undefined ? b.hour_start : b.funding_hour;
    if (!int(fh) || fh % 3600 !== 0 || fh > b.hour_start || fh < b.hour_start - 7200) return bad("funding_hour must be an hour start within 2 h before hour_start");
    funding = { hour: fh, rate: b.funding_rate };
  }
  const sigma = (k: string): number | null | undefined => {
    const v = b[k];
    if (v === undefined || v === null) return null;
    return finite(v) && v >= 0 ? v : undefined;
  };
  const sigma1h = sigma("sigma_1h"), sigma24h = sigma("sigma_24h");
  if (sigma1h === undefined || sigma24h === undefined) return bad("sigma_1h and sigma_24h must be finite numbers ≥ 0");
  if (b.base_pending !== undefined && typeof b.base_pending !== "boolean") return bad("base_pending must be a boolean");
  let baseStepTs: number | null = null;
  if (b.base_step_ts !== undefined && b.base_step_ts !== null) {
    if (!int(b.base_step_ts) || b.base_step_ts > ts + MARK_MAX_SKEW_S) return bad("base_step_ts must be unix seconds ≤ ts");
    baseStepTs = b.base_step_ts;
  }
  return {
    ok: true,
    data: {
      mark, ts, head: b.head, hour_start: b.hour_start, candle: b.candle as number[], ch24: b.ch24, ch1: b.ch1, bars,
      funding, sigma1h, sigma24h, basePending: b.base_pending === true, baseStepTs,
    },
  };
}

interface MarkRow {
  px: number;
  ts: number;
  received_ms: number;
  head: number;
  hour_start: number;
  ch24: number;
  ch1: number;
  sigma_1h: number | null;
  sigma_24h: number | null;
  funding_known: number;
  base_pending: number;
  base_step_ts: number | null;
  candle: string;
}

async function loadMark(db: D1Database): Promise<MarkRow | null> {
  return db
    .prepare("SELECT px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, base_pending, base_step_ts, candle FROM mark WHERE id = 1")
    .first<MarkRow>();
}

const riskOf = (m: { sigma_24h: number | null; sigma_1h: number | null; ch1: number }) => ({ sigma24: m.sigma_24h, sigma1h: m.sigma_1h, ch1: m.ch1 });
/** σ is usable: σ_24h > 0 and σ_1h ≥ 0. Anything else (missing, 0, negative) is unknown: orders are refused. */
export const riskKnown = (sigma24h: number | null, sigma1h: number | null) => sigma24h !== null && sigma24h > 0 && sigma1h !== null && sigma1h >= 0;
/** Orders pause while the hour's base sample is pending and for 60 s after it lands (at the mark's clock). */
export const basePaused = (m: { base_pending: number | boolean; base_step_ts: number | null; ts: number }) =>
  Boolean(m.base_pending) || (m.base_step_ts !== null && m.ts < m.base_step_ts + PILOT_LIMITS.basePauseS);

export function markView(m: MarkRow | null, nowS: number): PilotMark | null {
  if (!m) return null;
  const cap = Engine.maxLeverage(riskOf(m));
  const age = nowS - m.ts;
  // σ and the funding rate must both be known (mark.py posts null before 2 closed hours exist)
  const known = riskKnown(m.sigma_24h, m.sigma_1h) && m.funding_known === 1;
  return {
    mark: m.px, ts: m.ts, age, ch24: m.ch24, ch1: m.ch1, sigma1h: m.sigma_1h, sigma24h: m.sigma_24h,
    maxLev: known ? cap.max : 1, paused: cap.paused, basePaused: basePaused(m), fresh: known && age <= RULES.markMaxAgeS,
  };
}

/** The newest stored bar minute the producer need not send again: never the minute of `ts` (it is still open). */
async function lastMinute(db: D1Database, ts: number): Promise<number | null> {
  const r = await db.prepare("SELECT MAX(minute) AS m FROM bars").first<{ m: number | null }>();
  if (!r || r.m === null) return null;
  return Math.min(r.m, Math.floor(ts / 60) * 60 - 60);
}

export async function handlePushMark(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  const refused = bearerGuard(req, env.ABI_PUSH_TOKEN, "POST", "mark publishing");
  if (refused) return refused;
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const header = req.headers.get("content-length");
  if (header !== null && !(Number(header) <= MARK_BODY_BYTES)) return errorJson(413, `body must be at most ${MARK_BODY_BYTES} bytes`);
  const text = await readCapped(req, MARK_BODY_BYTES);
  if (text === null) return errorJson(413, `body must be at most ${MARK_BODY_BYTES} bytes`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorJson(400, "body must be JSON");
  }
  const nowMs = nowMsOf(deps), nowS = Math.floor(nowMs / 1000);
  const v = validateMark(body, nowS);
  if (!v.ok) return errorJson(400, v.error);
  const d = v.data;
  const prev = await db.prepare("SELECT ts FROM mark WHERE id = 1").first<{ ts: number }>();
  if (prev && d.ts <= prev.ts) return errorJson(409, "ts is not newer than the stored mark", { last_minute: await lastMinute(db, prev.ts) });
  const stored = await db.prepare("SELECT MAX(minute) AS m FROM bars").first<{ m: number | null }>();

  const post = randomHex(16);
  const stmts: D1PreparedStatement[] = [
    db.prepare(SQL.markUpsert).bind(d.mark, d.ts, nowMs, d.head, d.hour_start, d.ch24, d.ch1, d.sigma1h, d.sigma24h, d.funding ? 1 : 0, d.basePending ? 1 : 0, d.baseStepTs, JSON.stringify(d.candle), post),
  ];
  // spec §8.5: every minute missing between the stored bars and this post gets a gap bar, so no liquidation is skipped:
  // the open hour's from the posted candle, an earlier (closed) hour's from its index candle. An earlier hour with no
  // candle yet stays open in `gaps` (nothing fills meanwhile) until a later post can close it.
  const first = d.bars[0][0];
  const [, ch, cl, cc] = d.candle;
  const gapBars: number[][] = [];
  const opened: [number, number][] = [];
  if (stored?.m != null && first > stored.m + 60) {
    for (const [from, to] of hourSegments(stored.m + 60, first - 60)) {
      if (from >= d.hour_start) gapBars.push([from, ch, cl, Math.min(ch, Math.max(cl, cc))]);
      else opened.push([from, to]);
    }
  }
  const pendingGaps = (await db.prepare("SELECT minute_from, minute_to FROM gaps ORDER BY minute_from").all<{ minute_from: number; minute_to: number }>()).results;
  const closed: number[] = [];
  const unresolved: [number, number][] = [];
  if (opened.length || pendingGaps.length) {
    const candles = await indexCandles(env);
    for (const [from, to, known] of [...pendingGaps.map((g) => [g.minute_from, g.minute_to, true] as const), ...opened.map(([a, b]) => [a, b, false] as const)]) {
      const k = candles.get(Math.floor(from / 3600) * 3600);
      if (k) { gapBars.push([from, k.h, k.l, k.c]); if (known) closed.push(from); }
      else if (!known) unresolved.push([from, to]);
    }
  }
  for (const [m, h, l, c] of gapBars) stmts.push(db.prepare(SQL.barUpsert).bind(m, h, l, c, post));
  for (const [from, to] of unresolved) stmts.push(db.prepare(SQL.gapOpen).bind(from, to, post));
  for (const from of closed) stmts.push(db.prepare(SQL.gapClose).bind(from, post));
  for (const [m, h, l, c] of d.bars) stmts.push(db.prepare(SQL.barUpsert).bind(m, h, l, c, post));
  if (d.funding) stmts.push(db.prepare(SQL.fundingInsert).bind(d.funding.hour, d.funding.rate, post));
  const pruned = (deps.random ?? Math.random)() < 1 / PRUNE_EVERY;
  if (pruned) {
    stmts.push(db.prepare("DELETE FROM bars WHERE minute < ?").bind(nowS - BARS_KEEP_S));
    stmts.push(db.prepare("DELETE FROM used_nonces WHERE exp < ?").bind(nowS));
    stmts.push(db.prepare("DELETE FROM ratelimit WHERE slot < ?").bind(Math.floor(nowS / 60) - 1));
    stmts.push(db.prepare("DELETE FROM orders WHERE status <> 'pending' AND arrived_ms < ?").bind(nowMs - ORDERS_KEEP_MS));
    stmts.push(db.prepare("DELETE FROM gaps WHERE minute_to < ?").bind(nowS - BARS_KEEP_S)); // older than any kept bar
  }
  const res = await db.batch(stmts);
  if (res[0].meta.changes !== 1) return errorJson(409, "ts is not newer than the stored mark", { last_minute: await lastMinute(db, d.ts) });

  const liquidated = await sweep(db, Math.min(first, ...gapBars.map((g) => g[0])), d.bars[d.bars.length - 1][0]);
  const gaps = await openGaps(db);
  const fills = await fillOrders(db, env, d, gaps > 0, nowMs);
  return json({ ok: true, last_minute: await lastMinute(db, d.ts), ts: d.ts, bars: d.bars.length, gapBars: gapBars.length, gaps, liquidated, ...fills, pruned });
}

/** [from, to] split at hour starts (minute starts, inclusive). */
export function hourSegments(from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = from; a <= to; ) {
    const end = Math.min(to, Math.floor(a / 3600) * 3600 + 3540);
    out.push([a, end]);
    a = end + 60;
  }
  return out;
}

/** The closed hourly candles of the index file in KV (abi:index), by hour start: high, low, close. Empty when unreadable. */
export async function indexCandles(env: Env): Promise<Map<number, { h: number; l: number; c: number }>> {
  const out = new Map<number, { h: number; l: number; c: number }>();
  try {
    const raw = await env.INVITES.get(ABI_KEY);
    const candles = raw ? (JSON.parse(raw) as { candles?: unknown }).candles : null;
    if (!Array.isArray(candles)) return out;
    for (const x of candles) {
      if (!Array.isArray(x) || typeof x[0] !== "string") continue;
      const t = Date.parse(x[0]) / 1000, [h, l, c] = [x[2], x[3], x[4]];
      if (!Number.isInteger(t) || t % 3600 !== 0 || ![h, l, c].every(finite) || !(l > 0 && l <= h)) continue;
      out.set(t, { h, l, c: Math.min(h, Math.max(l, c)) });
    }
  } catch { /* unreadable: the gap stays open */ }
  return out;
}

const openGaps = async (db: D1Database) => (await db.prepare("SELECT COUNT(*) AS n FROM gaps").first<{ n: number }>())?.n ?? 0;

export async function handlePublicMark(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  return edgeCachedGet(req, deps, async () => {
    const m = markView(await loadMark(db), nowSOf(deps));
    return m ? json(m) : errorJson(404, "no data");
  }, MARK_CACHE_S);
}

// ───────────────────────────── positions and funding ─────────────────────────────

interface PositionRow {
  id: number;
  wallet: string;
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  liq: number;
  opened_at: number;
  closed_at: number | null;
  exit: number | null;
  pnl: number | null;
  accrued: number | null;
  fee: number;
  returned: number | null;
  reason: "close" | "liquidation" | null;
}

const POS_COLS = "id, wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, exit, pnl, accrued, fee, returned, reason";

const toEngine = (r: PositionRow): PilotPosition => ({
  side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, liq: r.liq, openedAt: r.opened_at,
});

async function openRows(db: D1Database, wallet: string): Promise<PositionRow[]> {
  return (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NULL ORDER BY id`).bind(wallet).all<PositionRow>()).results;
}

/** Funding rates whose hour overlaps [since, …), ascending (the engine's `rates`). */
export async function loadRates(db: D1Database, since: number): Promise<FundingRate[]> {
  return (await db.prepare("SELECT hour_start AS t, rate FROM funding WHERE hour_start >= ? ORDER BY hour_start").bind(since - 3600).all<FundingRate>()).results;
}

async function fundingView(db: D1Database, nowS: number): Promise<FundingView> {
  const recent = (await db.prepare("SELECT hour_start AS t, rate FROM funding ORDER BY hour_start DESC LIMIT ?").bind(PILOT_LIMITS.fundingShown).all<FundingRate>()).results;
  const hour = Math.floor(nowS / 3600) * 3600;
  return { recent, current: recent.find((r) => r.t === hour)?.rate ?? null, next: hour + 3600 };
}

const liquidateStmt = (db: D1Database, r: PositionRow, hit: { t: number; price: number }, rates: readonly FundingRate[]) => {
  const pos = toEngine(r);
  return db.prepare(SQL.liquidate).bind(hit.t, hit.price, Engine.pnl(pos, hit.price), Engine.fundingAccrued(pos, rates, hit.t + 60), r.id);
};

async function settle(db: D1Database, stmts: D1PreparedStatement[]): Promise<number> {
  if (!stmts.length) return 0;
  return (await db.batch(stmts)).reduce((n, r) => n + r.meta.changes, 0);
}

/** Ingest: every open position against the stored bars of minutes [from, to] (the ones this post wrote). */
async function sweep(db: D1Database, from: number, to: number): Promise<number> {
  const open = (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE closed_at IS NULL AND opened_at <= ?`).bind(to).all<PositionRow>()).results;
  if (!open.length) return 0;
  const rates = await loadRates(db, Math.min(...open.map((r) => r.opened_at)));
  const bars = (await db.prepare("SELECT minute AS t, h, l, c FROM bars WHERE minute >= ? AND minute <= ? ORDER BY minute").bind(from, to).all<MinuteBar>()).results;
  const stmts: D1PreparedStatement[] = [];
  for (const r of open) {
    const hit = Engine.liquidation(toEngine(r), bars, rates);
    if (hit) stmts.push(liquidateStmt(db, r, hit, rates));
  }
  return settle(db, stmts);
}

/**
 * R5: the engine's liquidation() over every stored bar since each open position of the wallet opened. Only bars
 * that could cross are read: the liquidation price at the lowest funding the position has had so far bounds every
 * bar's own (funding-aware) liquidation price, so that bound selects a superset and the engine decides exactly.
 */
export async function lazyLiquidate(db: D1Database, wallet: string, nowS: number): Promise<number> {
  const rows = await openRows(db, wallet);
  if (!rows.length) return 0;
  const rates = await loadRates(db, Math.min(...rows.map((r) => r.opened_at)));
  const end = nowS + 120;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const pos = toEngine(r);
    const pts = [r.opened_at, end, ...rates.flatMap((x) => [x.t, x.t + 3600]).filter((t) => t > r.opened_at && t < end)];
    const fmin = Math.min(0, ...pts.map((t) => Engine.fundingAccrued(pos, rates, t)));
    const bound = Engine.liqPrice(pos, fmin);
    const sql = r.side === "long" ? SQL.liqCandidatesLong : SQL.liqCandidatesShort;
    // page through every candidate (ascending): the first page with a hit decides, as over the whole list
    for (let from = r.opened_at; ;) {
      const cands = (await db.prepare(sql).bind(bound, from).all<MinuteBar>()).results;
      const hit = Engine.liquidation(pos, cands, rates);
      if (hit) { stmts.push(liquidateStmt(db, r, hit, rates)); break; }
      if (cands.length < LIQ_PAGE) break;
      from = cands[cands.length - 1].t + 60;
    }
  }
  return settle(db, stmts);
}

function openView(r: PositionRow, mark: number | null, rates: readonly FundingRate[], nowS: number): OpenPositionView {
  const pos = toEngine(r);
  const funding = Engine.fundingAccrued(pos, rates, nowS);
  return {
    id: r.id, side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, liq: Engine.liqPrice(pos, funding),
    openedAt: r.opened_at, fee: r.fee, funding, pnl: mark === null ? null : Engine.pnl(pos, mark),
  };
}

function closedView(r: PositionRow): ClosedPositionView {
  const returned = r.returned ?? 0;
  return {
    id: r.id, side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, openedAt: r.opened_at,
    closedAt: r.closed_at!, exit: r.exit!, pnl: r.pnl!, funding: r.accrued ?? 0, fee: r.fee, returned,
    net: returned - r.margin - r.notional * RULES.feeRate,
    reason: r.reason === "liquidation" ? "liquidation" : "close",
  };
}

// ───────────────────────────── orders ─────────────────────────────

interface OrderRow {
  id: number;
  wallet: string;
  kind: "open" | "close";
  side: Side | null;
  margin: number | null;
  lev: number | null;
  position_id: number | null;
  arrived_ms: number;
  status: "pending" | "filled" | "refused";
  error: string | null;
  fill_px: number | null;
  filled_at: number | null;
}
const ORDER_COLS = "id, wallet, kind, side, margin, lev, position_id, arrived_ms, status, error, fill_px, filled_at";

const orderView = (o: OrderRow): OrderView => ({
  id: o.id, kind: o.kind, status: o.status, side: o.side, margin: o.margin, lev: o.lev, positionId: o.position_id,
  arrivedMs: o.arrived_ms, fillPx: o.fill_px, error: o.error,
});

const refuseStmt = (db: D1Database, id: number, error: string) => db.prepare(SQL.refuse).bind(error, id);

/** Ingest: fill (or refuse) every order that arrived before this post, at this post's mark. */
/** nowMs: the server's ingest time (an order waits at most RULES.markMaxAgeS of it). */
async function fillOrders(db: D1Database, env: Env, d: MarkPost, gapsOpen: boolean, nowMs: number): Promise<{ filled: number; refused: number }> {
  // only orders this mark is newer than, by the mark's own chain time (the mark must postdate the order)
  const pending = (await db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE status = 'pending' AND arrived_ms < ? ORDER BY id`).bind(d.ts * 1000).all<OrderRow>()).results;
  let filled = 0, refused = 0;
  if (!pending.length) return { filled, refused };
  const paused = basePaused({ base_pending: d.basePending, base_step_ts: d.baseStepTs, ts: d.ts });
  // a catch-up batch (bars behind the mark) or an open gap: older bars may still liquidate, so nothing fills now
  const catchingUp = gapsOpen || d.bars[d.bars.length - 1][0] < Math.floor(d.ts / 60) * 60;
  const risk = { sigma24: d.sigma24h, sigma1h: d.sigma1h, ch1: d.ch1 };
  const refuse = async (o: OrderRow, error: string) => { refused += (await refuseStmt(db, o.id, error).run()).meta.changes; };

  for (const o of pending) {
    if (catchingUp || nowMs - o.arrived_ms > RULES.markMaxAgeS * 1000) { await refuse(o, PRICE_UPDATING); continue; }
    if (paused) { await refuse(o, TRADING_PAUSED); continue; }
    if (o.kind === "open") {
      if (!pilotOpen(env)) { await refuse(o, PILOT_CLOSED); continue; }
      if (!riskKnown(d.sigma24h, d.sigma1h) || !d.funding) { await refuse(o, PRICE_UPDATING); continue; }
      const acct = await getAccount(db, o.wallet);
      const held = await openRows(db, o.wallet);
      const r = Engine.open({ balance: acct?.balance ?? 0, open: held.length, side: held[0]?.side ?? null }, { side: o.side!, margin: o.margin!, lev: o.lev!, mark: d.mark, now: d.ts, risk });
      if (!r.ok) { await refuse(o, engineError(r.error, held)); continue; }
      const p = r.position, cost = p.margin + r.fee;
      const res = await db.batch([
        db.prepare(SQL.openDebit).bind(cost, o.wallet, cost, o.wallet, RULES.maxOpen, o.wallet, p.side, o.id),
        db.prepare(SQL.openInsert).bind(o.wallet, p.side, p.margin, p.lev, p.notional, p.entry, p.liq, p.openedAt, r.fee),
        db.prepare(SQL.openFilled).bind(d.mark, d.ts, o.id),
      ]);
      if (res[2].meta.changes === 1) filled++;
      else {
        const now = await openRows(db, o.wallet);
        const opp = now.find((x) => x.side !== p.side);
        await refuse(o, opp ? closeFirst(opp.side) : now.length >= RULES.maxOpen ? "too many open positions" : "insufficient balance");
      }
    } else {
      const row = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ? AND wallet = ?`).bind(o.position_id, o.wallet).first<PositionRow>();
      if (!row || row.closed_at !== null) { await refuse(o, ALREADY_CLOSED); continue; }
      const c = Engine.close(toEngine(row), d.mark, d.ts, await loadRates(db, row.opened_at));
      const res = await db.batch([
        db.prepare(SQL.closeSettle).bind(d.ts, d.mark, c.pnl, c.funding, c.fee, c.payout, row.id, o.wallet, o.id),
        db.prepare(SQL.closeCredit).bind(c.payout, o.wallet),
        db.prepare(SQL.closeFilled).bind(d.mark, d.ts, o.id),
      ]);
      if (res[2].meta.changes === 1) filled++;
      else await refuse(o, ALREADY_CLOSED);
    }
  }
  return { filled, refused };
}

// ───────────────────────────── handlers ─────────────────────────────

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await readCapped(req, 2048);
  if (text === null) return null;
  try {
    const b = JSON.parse(text);
    return typeof b === "object" && b !== null && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Ready to queue an order: a live producer (mark ≤ markMaxAgeS old, σ known, bars caught up to the mark's minute)
 * and not in the base-sample pause.
 */
async function markProblem(db: D1Database, m: MarkRow | null, nowS: number): Promise<Response | null> {
  const v = markView(m, nowS);
  if (!m || !v || !v.fresh) return errorJson(503, PRICE_UPDATING);
  const last = await db.prepare("SELECT MAX(minute) AS m FROM bars").first<{ m: number | null }>();
  if (last?.m == null || last.m < Math.floor(m.ts / 60) * 60 || (await openGaps(db)) > 0) return errorJson(503, PRICE_UPDATING);
  if (v.basePaused) return errorJson(409, TRADING_PAUSED);
  return null;
}

async function insertOrder(db: D1Database, wallet: string, kind: "open" | "close", f: { side?: Side; margin?: number; lev?: number; positionId?: number }, nowMs: number): Promise<OrderRow> {
  const r = await db
    .prepare(`INSERT INTO orders (wallet, kind, side, margin, lev, position_id, arrived_ms) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${ORDER_COLS}`)
    .bind(wallet, kind, f.side ?? null, f.margin ?? null, f.lev ?? null, f.positionId ?? null, nowMs)
    .first<OrderRow>();
  return r!;
}

export async function handleAccount(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  const funding = await fundingView(db, nowS);
  const base: PilotAccountView = { open: pilotOpen(env), address: null, regi: null, account: null, positions: [], pending: [], mark: null, funding };
  if (!wallet) return json({ ...base, mark: markView(await loadMark(db), nowS) });
  const acct = await ensureAccount(db, wallet, nowS);
  const regi = await regiStatus(db, acct, env, nowS, deps);
  await lazyLiquidate(db, wallet, nowS);
  const [m, rows, now, pending] = await Promise.all([
    loadMark(db),
    openRows(db, wallet),
    getAccount(db, wallet),
    db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE wallet = ? AND status = 'pending' ORDER BY id DESC LIMIT 10`).bind(wallet).all<OrderRow>(),
  ]);
  const rates = rows.length ? await loadRates(db, Math.min(...rows.map((r) => r.opened_at))) : [];
  const px = m ? m.px : null;
  const balance = now!.balance;
  return json({
    ...base,
    address: wallet,
    regi,
    account: { balance, equity: px === null ? null : Engine.equity(balance, rows.map(toEngine), px, nowS, rates), season: now!.season },
    positions: rows.map((r) => openView(r, px, rates, nowS)),
    pending: pending.results.map(orderView),
    mark: markView(m, nowS),
  } satisfies PilotAccountView);
}

async function orderStatus(req: Request, env: Env, db: D1Database, deps: PilotDeps): Promise<Response> {
  const nowMs = nowMsOf(deps);
  const wallet = await pilotWallet(req, env, Math.floor(nowMs / 1000));
  if (!wallet) return errorJson(401, "sign in first");
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return errorJson(400, "id must be an order id");
  const get = () => db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE id = ? AND wallet = ?`).bind(id, wallet).first<OrderRow>();
  let o = await get();
  if (!o) return errorJson(404, "no such order");
  if (o.status === "pending" && nowMs - o.arrived_ms > ORDER_EXPIRY_MS) {
    await refuseStmt(db, o.id, PRICE_UPDATING).run();
    o = (await get())!;
  }
  let position: OpenPositionView | ClosedPositionView | null = null;
  if (o.status === "filled" && o.position_id !== null) {
    const r = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ?`).bind(o.position_id).first<PositionRow>();
    if (r) position = r.closed_at === null ? openView(r, o.fill_px, await loadRates(db, r.opened_at), Math.floor(nowMs / 1000)) : closedView(r);
  }
  return json({ order: orderView(o), position });
}

export async function handleOrder(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  const method = req.method.toUpperCase();
  const db = env.PILOT_DB;
  if (method === "GET") return db ? orderStatus(req, env, db, deps) : unconfigured();
  if (method !== "POST") return errorJson(405, "method not allowed");
  if (!pilotOpen(env)) return errorJson(403, PILOT_CLOSED);
  if (!db) return unconfigured();
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const nowMs = nowMsOf(deps), nowS = Math.floor(nowMs / 1000);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  if (!(await rateOk(db, `order:${wallet}`, PILOT_LIMITS.ordersPerMin, nowS))) return tooMany();
  const b = await readBody(req);
  if (!b) return errorJson(400, "body must be a JSON object");
  const { side, margin, lev } = b;
  if (side !== "long" && side !== "short") return errorJson(400, "side must be long or short");
  if (!finite(margin) || margin > 1e12) return errorJson(400, "margin must be a number");
  if (!finite(lev)) return errorJson(400, "lev must be a number");

  const acct = await ensureAccount(db, wallet, nowS);
  const regi = await regiStatus(db, acct, env, nowS, deps);
  if (regi.ok === null) return errorJson(503, REGI_UNCHECKED);
  if (!regi.ok) return errorJson(403, regi.snapshot === false ? NOT_AT_SNAPSHOT : HOLD_REGI);
  await lazyLiquidate(db, wallet, nowS);
  const m = await loadMark(db);
  const problem = await markProblem(db, m, nowS);
  if (problem) return problem;
  // the same checks the fill makes, at the current mark: refuse now what would be refused at the fill
  const rows = await openRows(db, wallet);
  const now = (await getAccount(db, wallet))!;
  const pre = Engine.open({ balance: now.balance, open: rows.length, side: rows[0]?.side ?? null }, { side, margin, lev, mark: m!.px, now: m!.ts, risk: riskOf(m!) });
  if (!pre.ok) return errorJson(["insufficient balance", "too many open positions", HEDGE].includes(pre.error) ? 409 : 400, engineError(pre.error, rows));
  const o = await insertOrder(db, wallet, "open", { side, margin, lev }, nowMs);
  return json({ order: orderView(o) }, 202);
}

export async function handleClose(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const nowMs = nowMsOf(deps), nowS = Math.floor(nowMs / 1000);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  if (!(await rateOk(db, `close:${wallet}`, PILOT_LIMITS.closesPerMin, nowS))) return tooMany();
  const b = await readBody(req);
  const id = b?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return errorJson(400, "id must be a position id");

  await lazyLiquidate(db, wallet, nowS);
  const row = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ? AND wallet = ?`).bind(id, wallet).first<PositionRow>();
  if (!row) return errorJson(404, "no such position");
  if (row.closed_at !== null) return errorJson(409, ALREADY_CLOSED, { position: closedView(row) });
  const problem = await markProblem(db, await loadMark(db), nowS);
  if (problem) return problem;
  const o = await insertOrder(db, wallet, "close", { positionId: id }, nowMs);
  return json({ order: orderView(o) }, 202);
}

export async function handlePositions(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  await lazyLiquidate(db, wallet, nowS);
  const [m, rows] = await Promise.all([loadMark(db), openRows(db, wallet)]);
  const rates = rows.length ? await loadRates(db, Math.min(...rows.map((r) => r.opened_at))) : [];
  return json({ positions: rows.map((r) => openView(r, m ? m.px : null, rates, nowS)), mark: markView(m, nowS) });
}

export async function handleHistory(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  await lazyLiquidate(db, wallet, nowS);
  const rows = (
    await db
      .prepare(`SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC, id DESC LIMIT ?`)
      .bind(wallet, PILOT_LIMITS.history)
      .all<PositionRow>()
  ).results;
  return json({ history: rows.map(closedView) });
}

/** Top 50 by equity at the latest mark, funding included (accounts that have opened at least one position). */
export async function leaderboard(db: D1Database, nowS: number): Promise<{ ts: number | null; rows: LeaderboardRow[] }> {
  const m = await loadMark(db);
  if (!m) return { ts: null, rows: [] };
  const accts = (await db.prepare("SELECT wallet, balance FROM accounts a WHERE EXISTS (SELECT 1 FROM positions p WHERE p.wallet = a.wallet)").all<{ wallet: string; balance: number }>()).results;
  const open = (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE closed_at IS NULL`).all<PositionRow>()).results;
  const rates = open.length ? await loadRates(db, Math.min(...open.map((r) => r.opened_at))) : [];
  const by = new Map<string, PilotPosition[]>();
  for (const r of open) by.set(r.wallet, [...(by.get(r.wallet) ?? []), toEngine(r)]);
  const scored = accts
    .map((a) => ({ wallet: a.wallet, equity: Engine.equity(a.balance, by.get(a.wallet) ?? [], m.px, nowS, rates) }))
    .sort((x, y) => y.equity - x.equity || (x.wallet < y.wallet ? -1 : 1))
    .slice(0, PILOT_LIMITS.leaderboard);
  return { ts: m.ts, rows: scored.map((s, i) => ({ rank: i + 1, address: shortWallet(s.wallet), equity: s.equity })) };
}

export async function handleLeaderboard(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  return edgeCachedGet(req, deps, async () => json(await leaderboard(db, nowSOf(deps))), PILOT_LIMITS.leaderboardCacheS);
}
