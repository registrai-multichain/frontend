/**
 * ABI points pilot API, economy v3 (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md §9, §9.13; plan
 * docs/superpowers/plans/2026-10-10-abi-pilot-v3-site.md R1–R8). Points only: no deposits, no withdrawals, no
 * transfers. D1 binding PILOT_DB (migrations/0001_pilot.sql, 0002_pilot_v3.sql). All trading math is the engine's
 * (src/lib/abi-pilot.ts, a port of pilot.js v3); this file only stores and feeds it, and keeps the points ledger.
 *
 * Three markets (plan 2026-10-12 R1–R7, spec §9.16): ABI, AII and AEI. Everything that is market state is keyed by
 * market (migration 0004): the mark row, bars, gaps, rates, house hours, pools (fee pool, insurance) and splits;
 * positions, orders and ledger rows carry their market. One balance per wallet across markets; one direction at a
 * time and RULES.maxOpen per market; the pending-order cap per wallet across markets. ?market= / "market" absent = ABI.
 *
 *   POST /api/index/mark          producer (Bearer ABI_PUSH_TOKEN, live/mark.py) → 200 { last_minute, … }; "index"
 *                                 (absent: abi) names the market, and the ingest touches that market only
 *   GET  /api/index/mark?index=   public: the market's latest mark (edge-cached 5 s)
 *   GET  /api/pilot/account?market=  session optional: open?, the REGI amounts in dollars and REGI at the 24 h median, the
 *                                 lock factory, REGI, balance, positions (every market, each at its own mark), pending
 *                                 orders, and the market's mark and funding
 *   POST /api/pilot/order         { market, side, margin, lev } → 202 a pending order (session + $ of REGI read now + open;
 *                                 above 1×, $ of REGI locked, lockedOf read now: plan 2026-10-13 R2, R3);
 *                                 30/min, at most 3 pending per wallet, leverage ≤ PILOT_MAX_LEV, not a PILOT_BLOCKED_WALLETS wallet
 *   GET  /api/pilot/order?id=     the order's status (pending / filled / refused)
 *   POST /api/pilot/close         { id } → 202 a pending close order in the position's market (session only); 60/min
 *   GET  /api/pilot/positions     session: open positions (every market)
 *   GET  /api/pilot/history       session: the last 100 closed positions (every market)
 *   GET  /api/pilot/leaderboard   public: top 50 by equity (balance + open positions at their markets' latest marks)
 *                                 among wallets holding the admission REGI now, shortened addresses, cached 60 s
 *   GET  /api/pilot/funding?market=  public: the market's last 24 hourly rates, cached 60 s
 *   GET  /api/pilot/economy?market=  public: the market's skew, funding, house, fee pool, insurance, weekly split, cached 30 s
 *
 * Fills (spec §8.3): an order is stored pending and fills inside the ingest of the first mark posted after it
 * arrived, at that mark, if that comes within RULES.markMaxAgeS; otherwise it is refused "price updating".
 * Orders are refused while the hour's base sample is pending, for 60 s after it lands, and until the hour's rates
 * are fixed.
 *
 * Hourly close (R2): the first mark post of an hour with a non-null trend, milestone premium (§9.15; an absent key
 * counts as 0) and sigma_1h fixes that hour's rates from the
 * traders' book (after the liquidation sweep), once (INSERT … ON CONFLICT DO NOTHING, under the post's token), books
 * the projected funding cut, and books the house's hours since the last booking: houseHour() − cut, plus a true-up
 * row that makes the house the exact counterparty of every position (see bookHours()).
 *
 * Ledger (R4): every write that moves points writes its ledger rows (and the pools totals) in the same batch(),
 * under a guard only the owning batch passes: changes() after the open fill, the position's settle token after a
 * close or liquidation, the rates / house_hours / splits row's post token otherwise. Over any scenario, once every
 * position is settled and every hour booked: sum(balance changes) + sum(ledger) = 0 (test/pilot-v3.test.ts).
 *
 * Weekly split (R5): per market, lazily, on the first ingest or /api/pilot read after Monday 00:00 UTC (maybeSplit()).
 *
 * REGI in dollars and the REGI lock (plan 2026-10-13 R1–R4; lib/pilot-regi.ts): ABI posts sample the REGI/USDC pool
 * once per 10 minutes; the 24 h median converts PILOT_ADMIT_USD (sign-in and every order) and PILOT_LOCK_USD (orders
 * above 1×; the requirement stays on the position as lock_req). Once a minute a post runs the withdrawal watch: the
 * lock factory's Withdrawn logs since the cursor, and every open position whose lock_req is above its owner's remaining
 * lock is closed at its market's mark (the normal close settlement, close note "lock withdrawn").
 *
 * Every balance / position write is one conditional statement or one batch() (a D1 transaction), guarded by
 * the order still being pending and the position still being open (lib/pilot-sql.ts): no overspend, no double
 * settle, no double fill.
 */
import * as Engine from "../../src/lib/abi-pilot";
import { RULES, type FundingRate, type MinuteBar, type PilotPosition, type Side } from "../../src/lib/abi-pilot";
import {
  lockUsdText,
  LOCK_CONFIRM_BLOCKS,
  LOCK_WATCH_S,
  LOG_CHUNK,
  marketOf,
  PILOT_ADMIT_USD_DEFAULT,
  PILOT_LIMITS,
  PILOT_LOCK_USD_DEFAULT,
  REGI_CACHE_S,
  REGI_PRICE_UPDATING,
  shortWallet,
  type ClosedPositionView,
  type EconomyView,
  type FundingNow,
  type FundingView,
  type LeaderboardRow,
  type OpenPositionView,
  type OrderView,
  type PilotAccountView,
  type PilotMark,
  type PilotMarket,
  type RateView,
} from "../../src/lib/abi-pilot-api";
import { ABI_INDICES } from "../../src/lib/builders-index";
import { bearerGuard } from "./bot-auth";
import { readCapped } from "./builders-index";
import type { D1Database, D1PreparedStatement, D1Result, Env } from "./env";
import { csrfFailure, edgeCachedGet, errorJson, json, randomHex, siteOrigin } from "./http";
import {
  admitMin,
  blockedWallet,
  getAccount,
  holdRegi,
  type AccountRow,
  nowMsOf,
  nowSOf,
  PILOT_UNCONFIGURED,
  pilotMaxLev,
  pilotState,
  pilotWallet,
  regiBalance,
  REGI_UNCHECKED,
  rateOk,
  sessionOf,
  regiStatus,
  snapshotBlock,
  tooMany,
  type PilotDeps,
} from "./pilot-auth";
import { admitUsdOf, blockNumber, lockedOf, lockFactoryOf, lockReqString, lockUsdOf, regiAt, regiPrice, samplePrice, withdrawnLogs } from "./pilot-regi";
import { LIQ_PAGE, SQL } from "./pilot-sql";

export const MARK_MAX_SKEW_S = 30;
export const MARK_BODY_BYTES = 16384;
export const MAX_BARS = 60;
export const BARS_KEEP_S = 7 * 24 * 3600;
export const ORDERS_KEEP_MS = 7 * 24 * 3600 * 1000;
/** A posted bar may be at most this old (the producer keeps 4 h and catches up 60 bars per post). */
export const BAR_MAX_AGE_S = 6 * 3600;
/** |trend| (and the v2 funding_rate) above this per hour is refused as a producer bug. */
export const MAX_FUNDING_RATE = 0.01;
/** |milestone_premium| above this per hour is refused as a producer bug (§9.15: a 30-day mean log step). */
export const MAX_PREMIUM = 0.001;
export const MILESTONE_MAX_AGE_S = 7 * 24 * 3600;
export const MARK_CACHE_S = 5;
/** A pending order the status read finds older than this is refused (the ingest refuses after markMaxAgeS). */
export const ORDER_EXPIRY_MS = (RULES.markMaxAgeS + 2) * 1000;
/** One hourly close books at most this many unbooked hours (the rest follow at the next hours' closes). */
export const MAX_BOOK_HOURS = 48;
/**
 * Review S2: every batch stays under this many statements. D1 (developers.cloudflare.com/d1/platform/limits) allows
 * 1000 queries per Worker invocation on Workers Paid (50 on Free), 100 bound parameters and 100 KB per statement,
 * and applies the per-query limits to each statement in a batch; it does not say whether a batch's statements count
 * one by one toward the per-invocation limit, so the cap keeps a wide margin under 1000.
 */
export const MAX_BATCH_STATEMENTS = 400;
/**
 * Review R3 + audit SS-5: one ingest invocation runs at most this many statements in all (every read and every
 * batch statement), across the safety-net liquidations, the batch (in-batch liquidations, the hourly close) and the
 * order fills. Liquidations go first; what does not fit waits for the next post (the swept watermark and the pending
 * orders stay where they are, so each settles exactly once, later).
 */
export const INGEST_MAX_STATEMENTS = 800;
/** Reads the ingest makes between the safety net and its batch (open positions, bars, overlap, rates, pools: about 5). */
const POST_NET_READS = 20;
/** The hourly close's own reads (house_hours, rates, ledger id, the attributed rows, last bars). */
const CLOSE_READS = 6;
/** The weekly split's statements at most (splitStmts: the splits row and 7 ledger pairs). */
const SPLIT_STATEMENTS = 15;
/** The safety net reads every unswept bar at once up to this many; beyond it, it pages per position. */
const NET_BARS = 1440;
/** An open fill's statements at most (account, open positions, the 5-statement batch, a re-read, a refusal). */
const OPEN_FILL_STATEMENTS = 9;
/** A close fill's at most: two tries of (position, rates, a 15-statement settlement), then a refusal. */
const CLOSE_FILL_STATEMENTS = 35;
/** Room kept for the rate fix and at least one booked hour when liquidations are capped. */
const FIX_RESERVE = 3 + 7 + 2 * 20;
/** The hourly prune's statements (bars, nonces, rate windows, orders, gaps, REGI price samples). */
const PRUNE_STATEMENTS = 6;
/** REGI price samples are kept this long (the price uses the last 24 h). */
const PRICE_KEEP_S = 7 * 86400;
export const HOUR = 3600;
export const WEEK = 7 * 86400;

export { holdRegi, REGI_UNCHECKED };
/** Only when PILOT_REGI_SNAPSHOT_BLOCK is set and the wallet didn't hold the admission amount there. */
export const NOT_AT_SNAPSHOT = "This wallet didn't hold REGI at the pilot snapshot block.";
/** R3: an order above 1× while PILOT_LOCK_FACTORY is empty (the lock is not deployed yet). */
export const LOCK_NOT_LIVE = "Leverage above 1× opens when the REGI lock is live.";
/** R3: lockedOf could not be read (fail closed). */
export const LOCK_UNCHECKED = "Couldn't check the REGI lock right now";
/** R4: the close note of a position the site closed because its wallet withdrew REGI below the position's lock requirement. */
export const LOCK_WITHDRAWN = "lock withdrawn";
export const PRICE_UPDATING = "price updating";
export const PILOT_CLOSED = "pilot closed";
/** PILOT_OPEN is "1" but a setting is wrong (audit PE-7): every order is refused. */
export const PILOT_MISCONFIGURED = "pilot misconfigured";
/** Above PILOT_MAX_LEV (the engine's own cap gives the same words). */
export const LEV_ABOVE_CAP = "leverage above the current cap";
/** PILOT_BLOCKED_WALLETS (audit F4): opens refused, closes allowed. */
export const BLOCKED_WALLET = "This wallet can't trade in the pilot.";
/** Audit SS-5: PILOT_LIMITS.pendingPerWallet orders waiting already. */
export const TOO_MANY_PENDING = "too many pending orders";
export const TRADING_PAUSED = "trading paused";
export const MILESTONE_PAUSED = "Paused: index milestone";
export const ALREADY_CLOSED = "already closed";
/** No hedging: one direction at a time per wallet (the engine's refusal, said plainly). */
export const HEDGE = "one direction at a time";
export const closeFirst = (held: Side) => `Close your ${held} first`;
/** A ?market= / "market" / "index" that is not abi, aii or aei. */
export const BAD_MARKET = "market must be abi, aii or aei";
type Market = PilotMarket;
const engineError = (error: string, held: readonly { side: Side }[]) => (error === HEDGE && held[0] ? closeFirst(held[0].side) : error);

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const int = (x: unknown): x is number => finite(x) && Number.isInteger(x);
const unconfigured = () => errorJson(503, PILOT_UNCONFIGURED);
const hourOf = (t: number) => Math.floor(t / HOUR) * HOUR;
/** Monday 00:00 UTC of the week holding `t` (1970-01-01 was a Thursday). */
export const weekStart = (t: number) => {
  const day = Math.floor(t / 86400);
  return (day - ((day + 3) % 7)) * 86400;
};

// ───────────────────────────── mark ─────────────────────────────

export interface MarkPost {
  /** R4: the post's "index" (absent: abi). Everything the ingest does is for this market only. */
  market: Market;
  mark: number;
  ts: number;
  head: number;
  hour_start: number;
  candle: number[];
  ch24: number;
  ch1: number;
  bars: [number, number, number, number][];
  /** The ex-milestone drift for `hour` (live/mark.py v3 `trend`; a v2 producer's `funding_rate`). null: not confirmed yet. */
  trend: { hour: number; value: number } | null;
  sigma1h: number | null;
  sigma24h: number | null;
  /**
   * §9.15 (audit PE-2): the milestone premium longs pay per unit per hour (live/mark.py `milestone_premium`). A
   * producer that doesn't send the key: 0. An explicit null: not known yet, so the hour's rates wait (like trend).
   */
  premium: number | null;
  basePending: boolean;
  baseStepTs: number | null;
  milestoneTs: number | null;
}

/** R4 + spec §8.5: the producer's body (live/mark.py v3), checked against the server clock. */
export function validateMark(raw: unknown, nowS: number): { ok: true; data: MarkPost } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("expected a JSON object");
  const b = raw as Record<string, unknown>;
  if (!finite(b.mark) || !(b.mark > 0)) return bad("mark must be a finite number > 0");
  if (!int(b.ts)) return bad("ts must be unix seconds");
  const ts = b.ts, mark = b.mark;
  const market = marketOf(b.index);
  if (market === null) return bad('index must be "abi", "aii" or "aei" (absent: abi)');
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

  // v3 posts `trend` (null until the producer's close is confirmed) and keeps `funding_rate` = trend for v2
  if (b.funding_rate !== undefined && b.funding_rate !== null && (!finite(b.funding_rate) || Math.abs(b.funding_rate) > MAX_FUNDING_RATE)) {
    return bad(`funding_rate must be a finite number within ±${MAX_FUNDING_RATE}`);
  }
  if (b.trend !== undefined && b.trend !== null && (!finite(b.trend) || Math.abs(b.trend) > MAX_FUNDING_RATE)) return bad(`trend must be a finite number within ±${MAX_FUNDING_RATE}`);
  const tv = b.trend !== undefined ? b.trend : b.funding_rate;
  let trend: MarkPost["trend"] = null;
  if (tv !== undefined && tv !== null) {
    const fh = b.funding_hour === undefined ? b.hour_start : b.funding_hour;
    if (!int(fh) || fh % 3600 !== 0 || fh > b.hour_start || fh < b.hour_start - 7200) return bad("funding_hour must be an hour start within 2 h before hour_start");
    trend = { hour: fh, value: tv as number };
  }
  const sigma = (k: string): number | null | undefined => {
    const v = b[k];
    if (v === undefined || v === null) return null;
    return finite(v) && v >= 0 ? v : undefined;
  };
  const sigma1h = sigma("sigma_1h"), sigma24h = sigma("sigma_24h");
  if (sigma1h === undefined || sigma24h === undefined) return bad("sigma_1h and sigma_24h must be finite numbers ≥ 0");
  let premium: number | null = 0;
  if (b.milestone_premium !== undefined) {
    if (b.milestone_premium === null) premium = null;
    else if (!finite(b.milestone_premium) || b.milestone_premium < 0 || b.milestone_premium > MAX_PREMIUM) return bad(`milestone_premium must be a finite number from 0 to ${MAX_PREMIUM}, or null`);
    else premium = b.milestone_premium;
  }
  if (b.base_pending !== undefined && typeof b.base_pending !== "boolean") return bad("base_pending must be a boolean");
  let baseStepTs: number | null = null;
  if (b.base_step_ts !== undefined && b.base_step_ts !== null) {
    if (!int(b.base_step_ts) || b.base_step_ts > ts + MARK_MAX_SKEW_S) return bad("base_step_ts must be unix seconds ≤ ts");
    baseStepTs = b.base_step_ts;
  }
  let milestoneTs: number | null = null;
  if (b.milestone_ts !== undefined && b.milestone_ts !== null) {
    if (!int(b.milestone_ts) || b.milestone_ts > ts) return bad("milestone_ts must be unix seconds at or before ts, or null");
    // the producer sends the latest milestone however old (audit PE-1): an old one is ignored, not a refusal of the
    // whole post, which froze the mark, bars, rates and liquidations 7 days after each milestone
    milestoneTs = b.milestone_ts >= ts - MILESTONE_MAX_AGE_S ? b.milestone_ts : null;
  }
  // R3: AII has no base layer, so the base-sample pause never applies there
  const base = market !== "aii";
  return {
    ok: true,
    data: {
      market, mark, ts, head: b.head, hour_start: b.hour_start, candle: b.candle as number[], ch24: b.ch24, ch1: b.ch1, bars,
      trend, sigma1h, sigma24h, premium, basePending: base && b.base_pending === true, baseStepTs: base ? baseStepTs : null, milestoneTs,
    },
  };
}

interface MarkRow {
  market: Market;
  px: number;
  ts: number;
  received_ms: number;
  head: number;
  hour_start: number;
  ch24: number;
  ch1: number;
  sigma_1h: number | null;
  sigma_24h: number | null;
  /** 1: the rates of hour_start are fixed. */
  funding_known: number;
  /** The fixed hour's trend (kept for v2 readers). */
  funding_rate: number | null;
  base_pending: number;
  base_step_ts: number | null;
  milestone_ts: number | null;
  bars_minute: number | null;
  swept_minute: number | null;
  candle: string;
}
/** loadMark(): the mark row with hour_start's rates and the last split's week (one query). */
interface MarkView extends MarkRow {
  rate_hour: number | null;
  rate_long: number | null;
  rate_short: number | null;
  rate_skew: number | null;
  last_split: number | null;
}

const MARK_COLS = "market, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, base_pending, base_step_ts, milestone_ts, bars_minute, swept_minute, candle";
const MARK_SEL = MARK_COLS.split(", ").map((c) => `m.${c}`).join(", ");

const MARK_VIEW_SQL =
  `SELECT ${MARK_SEL}, r.hour AS rate_hour, r.long AS rate_long, r.short AS rate_short, r.skew AS rate_skew, (SELECT MAX(week) FROM splits s WHERE s.market = m.market) AS last_split ` +
  "FROM mark m LEFT JOIN rates r ON r.market = m.market AND r.hour = m.hour_start";

/** One market's mark row (with its hour's rates and its last split's week). */
async function loadMark(db: D1Database, market: Market): Promise<MarkView | null> {
  return db.prepare(`${MARK_VIEW_SQL} WHERE m.market = ?`).bind(market).first<MarkView>();
}
type Marks = Map<Market, MarkView>;
/** Every market's mark row, in one query (account, positions, history, leaderboard: positions in any market). */
async function loadMarks(db: D1Database): Promise<Marks> {
  return new Map((await db.prepare(MARK_VIEW_SQL).all<MarkView>()).results.map((m) => [m.market, m] as const));
}
/** R5: each market's split if one is due (lastSplit from the mark rows' join: no extra read when none is). */
async function splitsDue(db: D1Database, marks: Marks, nowS: number): Promise<void> {
  for (const m of marks.values()) await maybeSplit(db, m.market, nowS, m.last_split);
}

const riskOf = (m: { sigma_24h: number | null; sigma_1h: number | null; ch1: number }) => ({ sigma24: m.sigma_24h, sigma1h: m.sigma_1h, ch1: m.ch1 });
/** σ is usable: σ_24h > 0 and σ_1h ≥ 0. Anything else (missing, 0, negative) is unknown: orders are refused. */
export const riskKnown = (sigma24h: number | null, sigma1h: number | null) => sigma24h !== null && sigma24h > 0 && sigma1h !== null && sigma1h >= 0;
/** Orders pause while the hour's base sample is pending and for 60 s after it lands (at the mark's clock). */
export const basePaused = (m: { base_pending: number | boolean; base_step_ts: number | null; ts: number }) =>
  Boolean(m.base_pending) || (m.base_step_ts !== null && m.ts < m.base_step_ts + PILOT_LIMITS.basePauseS);
/** New orders (not closes) pause for 60 s after a recorded index milestone (it moves the index at once). */
export const milestonePaused = (m: { milestone_ts: number | null; ts: number }) => m.milestone_ts !== null && m.ts < m.milestone_ts + PILOT_LIMITS.milestonePauseS;

/** levCap: the pilot's own cap (pilotMaxLev(env)); maxLev is the lower of it and the engine's. */
export function markView(m: MarkRow | null, nowS: number, levCap: number): PilotMark | null {
  if (!m) return null;
  const cap = Engine.maxLeverage(riskOf(m));
  const age = nowS - m.ts;
  // σ known and the hour's rates fixed (mark.py posts a null trend for ~15 s after each hour's close)
  const known = riskKnown(m.sigma_24h, m.sigma_1h) && m.funding_known === 1;
  return {
    mark: m.px, ts: m.ts, age, ch24: m.ch24, ch1: m.ch1, sigma1h: m.sigma_1h, sigma24h: m.sigma_24h,
    maxLev: known ? Math.min(cap.max, levCap) : 1, levCap, paused: cap.paused, basePaused: basePaused(m), milestonePaused: milestonePaused(m), fresh: known && age <= RULES.markMaxAgeS,
  };
}

/** This hour's rates from the mark row's join (no extra read). */
function fundingNow(m: MarkView | null, nowS: number): FundingNow {
  const hour = hourOf(nowS);
  const fixed = m !== null && m.rate_hour === hour;
  return { hour, long: fixed ? m.rate_long : null, short: fixed ? m.rate_short : null, skew: fixed ? m.rate_skew : null, next: hour + HOUR };
}

/** The newest stored minute the producer need not send again (only finished minutes are stored). */
const ackMinute = (barsMinute: number | null, ts: number) => (barsMinute === null ? null : Math.min(barsMinute, Math.floor(ts / 60) * 60 - 60));

// ───────────────────────────── metering ─────────────────────────────

/** D1 rows read / written by one request (meta.rows_read / rows_written), for the ingest response. */
export class Meter {
  read = 0;
  written = 0;
  /** Statements run (a batch counts each of its statements): the invocation budget (INGEST_MAX_STATEMENTS). */
  statements = 0;
  note(r: D1Result<unknown>) {
    this.read += Number(r.meta.rows_read ?? 0);
    this.written += Number(r.meta.rows_written ?? 0);
  }
}

/** The same database, counting every statement's rows into `meter` (first() is run as all(): same rows on D1). */
export function metered(db: D1Database, meter: Meter): D1Database {
  const inner = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => {
    const w: D1PreparedStatement = {
      bind: (...v: unknown[]) => wrap(s.bind(...v)),
      first: async <T,>() => { meter.statements++; const r = await s.all<T>(); meter.note(r); return (r.results[0] ?? null) as T | null; },
      all: async <T,>() => { meter.statements++; const r = await s.all<T>(); meter.note(r); return r; },
      run: async <T,>() => { meter.statements++; const r = await s.run<T>(); meter.note(r); return r; },
    };
    inner.set(w, s);
    return w;
  };
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: async <T,>(stmts: D1PreparedStatement[]) => {
      meter.statements += stmts.length;
      const rs = await db.batch<T>(stmts.map((x) => inner.get(x) ?? x));
      for (const r of rs) meter.note(r);
      return rs;
    },
  };
}

// ───────────────────────────── ledger ─────────────────────────────

export type LedgerKind = "fee" | "borrow" | "cut" | "house_pnl" | "house_trueup" | "liq_margin" | "insurance_draw" | "split_insurance" | "split_treasury" | "split_buyback";
export const LEDGER_KINDS: readonly LedgerKind[] = ["fee", "borrow", "cut", "house_pnl", "house_trueup", "liq_margin", "insurance_draw", "split_insurance", "split_treasury", "split_buyback"];
/** The house's book: every house kind together (house_pnl = price + funding per hour, house_trueup, liq_margin). */
export const HOUSE_KINDS: readonly LedgerKind[] = ["house_pnl", "house_trueup", "liq_margin"];
interface Entry {
  kind: LedgerKind;
  amount: number;
  ref: string;
}
const GUARDS = {
  settle: [SQL.ledgerSettled, SQL.poolSettled],
  rates: [SQL.ledgerByRates, SQL.poolByRates],
  hour: [SQL.ledgerByHour, SQL.poolByHour],
  split: [SQL.ledgerBySplit, SQL.poolBySplit],
} as const;

/**
 * Ledger rows plus their pools updates under one guard (lib/pilot-sql.ts): `g` binds the guard (an id and the owner's
 * token; for rates / hour / split the market first). The rows land in the guard row's market. Zero amounts are
 * skipped. split: the weekly split's own rows (pools.gross unchanged).
 */
function ledgerStmts(db: D1Database, guard: keyof typeof GUARDS, g: readonly unknown[], ts: number, entries: readonly Entry[], split = false): D1PreparedStatement[] {
  const [L, P] = GUARDS[guard];
  const out: D1PreparedStatement[] = [];
  for (const e of entries) {
    if (!(e.amount !== 0 && Number.isFinite(e.amount))) continue;
    out.push(db.prepare(L).bind(ts, e.kind, e.amount, e.ref, ...g), db.prepare(P).bind(e.amount, split ? 0 : e.amount, e.kind, ...g));
  }
  return out;
}

/**
 * §9.14b / owner item 6: a settled position's loss beyond zero equity (s > 0). Insurance covers what its balance
 * allows (computed inside the batch, never below zero); the rest is a house loss of `kind`, carried like any other.
 * The trader never pays more than the margin. Four statements, in this order (lib/pilot-sql.ts gap*).
 */
function gapStmts(db: D1Database, id: number, token: string, ts: number, s: number, kind: LedgerKind, ref: string): D1PreparedStatement[] {
  if (!(s > 0)) return [];
  return [
    db.prepare(SQL.gapHouseLedger).bind(ts, kind, s, s, ref, id, token),
    db.prepare(SQL.gapHousePool).bind(s, s, s, s, kind, id, token),
    db.prepare(SQL.gapCoverLedger).bind(ts, s, `draw:${id}`, id, token),
    db.prepare(SQL.gapCoverPool).bind(s, s, id, token),
  ];
}

// ───────────────────────────── positions and rates ─────────────────────────────

interface PositionRow {
  id: number;
  wallet: string;
  market: Market;
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
  borrow: number | null;
  fill: number | null;
  booked: number;
  booked_cut: number;
  booked_to: number;
  /** R3: raw REGI (canonical decimal string) the lock had to hold when it opened; '0' at 1×. */
  lock_req: string;
  /** R4: 'lock withdrawn' when the site closed it; else null. */
  close_note: string | null;
}

const POS_COLS = "id, wallet, market, side, margin, lev, notional, entry, liq, opened_at, closed_at, exit, pnl, accrued, fee, returned, reason, borrow, fill, booked, booked_cut, booked_to, lock_req, close_note";

const toEngine = (r: PositionRow): PilotPosition => ({
  side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, openedAt: r.opened_at, liq: r.liq,
});

/** A stored hour's rates as the engine reads them, plus r (the skew term) for the cut. */
export interface StoredRate extends FundingRate {
  t: number;
  long: number;
  short: number;
  r: number;
}

/** One market's rates whose hour overlaps [since, …), ascending (the engine's `rates`): read once per request. */
export async function loadRates(db: D1Database, market: Market, since: number): Promise<StoredRate[]> {
  return (await db.prepare("SELECT hour AS t, long, short, r FROM rates WHERE market = ? AND hour >= ? ORDER BY hour").bind(market, since - HOUR).all<StoredRate>()).results;
}

/** The rates every row (all in `market`) needs. */
const ratesFor = async (db: D1Database, market: Market, rows: readonly PositionRow[]) => (rows.length ? loadRates(db, market, Math.min(...rows.map((r) => r.opened_at))) : []);

/** The rates rows in any market need, by market, in ONE query (account, positions, leaderboard). */
async function ratesOf(db: D1Database, rows: readonly PositionRow[]): Promise<Map<Market, StoredRate[]>> {
  const since = new Map<Market, number>();
  for (const r of rows) since.set(r.market, Math.min(since.get(r.market) ?? Infinity, r.opened_at));
  const out = new Map<Market, StoredRate[]>([...since.keys()].map((m) => [m, []]));
  if (!since.size) return out;
  const where = [...since.keys()].map(() => "(market = ? AND hour >= ?)").join(" OR ");
  const got = await db.prepare(`SELECT market, hour AS t, long, short, r FROM rates WHERE ${where} ORDER BY hour`).bind(...[...since].flatMap(([m, t]) => [m, t - HOUR])).all<StoredRate & { market: Market }>();
  for (const x of got.results) out.get(x.market)!.push({ t: x.t, long: x.long, short: x.short, r: x.r });
  return out;
}

/** Equity: the one balance plus every open position at its own market's mark (funding and borrow included). null: a market with a position has no mark. */
function equityOf(balance: number, rows: readonly PositionRow[], marks: Marks, rates: ReadonlyMap<Market, readonly StoredRate[]>, nowS: number): number | null {
  let e = balance;
  for (const r of rows) {
    const m = marks.get(r.market);
    if (!m) return null;
    e += Engine.equity(0, [toEngine(r)], m.px, nowS, rates.get(r.market) ?? []);
  }
  return e;
}

/** The protocol's cut of a position's funding from openedAt to `to`: cut × |r| per unit per hour on the heavy side. */
export function cutPaid(pos: Pick<PilotPosition, "side" | "notional" | "openedAt">, rates: readonly StoredRate[], to: number): number {
  let c = 0;
  for (const x of rates) {
    const heavy = x.r > 0 ? "long" : x.r < 0 ? "short" : null;
    if (heavy !== pos.side) continue;
    const a = Math.max(x.t, pos.openedAt), b = Math.min(x.t + HOUR, to);
    if (b <= a) continue;
    c += RULES.fundingCut * Math.abs(x.r) * pos.notional * (b - a) / HOUR;
  }
  return c;
}

/**
 * The house's and the cut's claim on a position from its open to `to`, marked at `price`: the house is the
 * counterparty (−PnL) and receives the position's funding net of the protocol's cut. house + cut = −PnL + funding paid.
 */
export function claimAt(pos: PilotPosition, rates: readonly StoredRate[], to: number, price: number): { house: number; cut: number } {
  const cut = cutPaid(pos, rates, to);
  return { house: -Engine.pnl(pos, price) + Engine.fundingPaid(pos, rates, to) - cut, cut };
}

async function openRows(db: D1Database, wallet: string): Promise<PositionRow[]> {
  return (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NULL ORDER BY id`).bind(wallet).all<PositionRow>()).results;
}

const ACCOUNT_SEL = "a.wallet, a.balance, a.season, a.created, a.regi_ok, a.regi_checked, a.regi_snap, a.regi_snap_block, a.regi_retry_at, a.session_epoch";
const POS_SEL = POS_COLS.split(", ").filter((c) => c !== "wallet").map((c) => `p.${c}`).join(", ");

/** The account and its open positions in ONE query (rows read: 1 + open positions). null: no account. */
async function accountWithOpen(db: D1Database, wallet: string): Promise<{ acct: AccountRow; open: PositionRow[] } | null> {
  const rows = (
    await db
      .prepare(`SELECT ${ACCOUNT_SEL}, ${POS_SEL} FROM accounts a LEFT JOIN positions p ON p.wallet = a.wallet AND p.closed_at IS NULL WHERE a.wallet = ? ORDER BY p.id`)
      .bind(wallet)
      .all<AccountRow & Omit<PositionRow, "wallet">>()
  ).results;
  if (!rows.length) return null;
  const r0 = rows[0];
  const acct: AccountRow = {
    wallet: r0.wallet, balance: r0.balance, season: r0.season, created: r0.created, regi_ok: r0.regi_ok, regi_checked: r0.regi_checked,
    regi_snap: r0.regi_snap, regi_snap_block: r0.regi_snap_block, regi_retry_at: r0.regi_retry_at, session_epoch: r0.session_epoch,
  };
  const open = rows.filter((r) => r.id !== null).map((r) => ({ ...r, wallet }) as PositionRow);
  return { acct, open };
}

/**
 * R3: a liquidation's batch statements. The position settles at the engine's liquidation price (exit) with nothing
 * returned; funding and borrow to the end of the crossing bar. The house marks the exit at the bar's low (long) /
 * high (short): the equity left there goes to the house (liq_margin); a gap below zero is covered by insurance up to
 * its balance and the rest is a house loss (liq_margin, negative). post: the ingest's in-batch sweep (only if that
 * post won the mark row). At most 11 statements.
 */
function liquidationStmts(
  db: D1Database, r: PositionRow, hit: { t: number; price: number; shortfall: number }, bars: readonly MinuteBar[],
  rates: readonly StoredRate[], ts: number, token: string, post?: string,
): D1PreparedStatement[] {
  const pos = toEngine(r), end = hit.t + 60;
  const bar = bars.find((b) => b.t === hit.t)!;
  const worst = r.side === "long" ? bar.l : bar.h;
  const fp = Engine.fundingPaid(pos, rates, end), bp = Engine.borrowPaid(pos, end);
  const costs = fp + bp;
  const eq = pos.margin + Engine.pnl(pos, worst) - costs; // = −shortfall when it gapped through
  const claim = claimAt(pos, rates, end, worst);
  const binds = [hit.t, hit.price, Engine.pnl(pos, hit.price), -fp, bp, worst, token, claim.house, claim.cut, end, r.id, r.booked_to];
  return [
    post ? db.prepare(SQL.liquidateIfPost).bind(...binds, post) : db.prepare(SQL.liquidate).bind(...binds),
    ...ledgerStmts(db, "settle", [r.id, token], ts, [
      { kind: "borrow", amount: bp, ref: `borrow:${r.id}` },
      { kind: "house_trueup", amount: claim.house - r.booked, ref: `settle:${r.id}` },
      { kind: "cut", amount: claim.cut - r.booked_cut, ref: `settle:${r.id}` },
      { kind: "liq_margin", amount: Math.max(0, eq), ref: `liq:${r.id}` },
    ]),
    ...gapStmts(db, r.id, token, ts, hit.shortfall, "liq_margin", `liq:${r.id}`),
  ];
}
/** Statements per liquidation, at most (liquidationStmts). */
export const LIQ_STATEMENTS = 11;

/**
 * The safety net behind the ingest's in-batch sweep: the engine's liquidation() over one market's stored bars (rows:
 * that market's positions, m: its mark row) the sweep has not
 * covered (minute > mark.swept_minute). Every ingest sweeps the bars it stores in the same batch, so normally
 * swept_minute = bars_minute and this reads no bars at all. Only bars that could cross are read: the liquidation price
 * at the highest costs the position has had bounds every bar's own (cost-aware) one; candidates are paged.
 * room: statements this may still run (the ingest's budget); a position it can't afford is left for later.
 * → the number of positions it liquidated, and whether every position was checked.
 */
async function lazyLiquidateRows(db: D1Database, rows: readonly PositionRow[], nowS: number, m: MarkRow | null, room: () => number = () => Infinity): Promise<{ n: number; done: boolean }> {
  if (!m || m.bars_minute === null || (m.swept_minute !== null && m.swept_minute >= m.bars_minute)) return { n: 0, done: true };
  if (!rows.length) return { n: 0, done: true };
  const rates = await ratesFor(db, m.market, rows);
  const end = nowS + 120;
  let n = 0;
  for (const r of rows) {
    if (room() < 1 + LIQ_STATEMENTS) return { n, done: false };
    const pos = toEngine(r);
    const pts = [r.opened_at, end, ...rates.flatMap((x) => [x.t, x.t + HOUR]).filter((t) => t > r.opened_at && t < end)];
    const cmax = Math.max(0, ...pts.map((t) => Engine.fundingPaid(pos, rates, t) + Engine.borrowPaid(pos, t)));
    const bound = Engine.liqPrice(pos, cmax);
    const sql = r.side === "long" ? SQL.liqCandidatesLong : SQL.liqCandidatesShort;
    // page through every unswept candidate (ascending): the first page with a hit decides, as over the whole list
    for (let from = Math.max(r.opened_at, m.swept_minute === null ? -Infinity : m.swept_minute + 60); ;) {
      const cands = (await db.prepare(sql).bind(m.market, bound, from).all<MinuteBar>()).results;
      const hit = Engine.liquidation(pos, cands, rates);
      if (hit) {
        const res = await db.batch(liquidationStmts(db, r, hit, cands, rates, nowS, randomHex(8)));
        n += res[0].meta.changes;
        break;
      }
      if (cands.length < LIQ_PAGE) break;
      from = cands[cands.length - 1].t + 60;
    }
  }
  return { n, done: true };
}

/** The wallet's open positions in m's market against that market's unswept bars. known: the wallet's open rows (any market). */
export async function lazyLiquidate(db: D1Database, wallet: string, nowS: number, m: MarkRow | null, known?: readonly PositionRow[]): Promise<number> {
  if (!m || m.bars_minute === null || (m.swept_minute !== null && m.swept_minute >= m.bars_minute)) return 0;
  const rows = (known ?? (await openRows(db, wallet))).filter((r) => r.market === m.market);
  return (await lazyLiquidateRows(db, rows, nowS, m)).n;
}

/** lazyLiquidate in every market the wallet holds a position in. */
async function lazyLiquidateAll(db: D1Database, wallet: string, nowS: number, marks: Marks, known?: readonly PositionRow[]): Promise<number> {
  const rows = known ?? (await openRows(db, wallet));
  let n = 0;
  for (const market of new Set(rows.map((r) => r.market))) n += await lazyLiquidate(db, wallet, nowS, marks.get(market) ?? null, rows);
  return n;
}

/**
 * The ingest's safety net over every open position (review R3): the bars not swept yet are read once (normally a
 * few minutes of them) and each position is checked in memory, so a position that does not cross costs no statement;
 * each crossing is settled in its own batch while `room` allows. A very long unswept stretch (over NET_BARS bars)
 * falls back to the paged per-position read. done = false: positions were left for the next post (the caller then
 * holds the swept watermark, fills nothing and fixes no rates in this post).
 */
async function sweepUnswept(db: D1Database, rows: readonly PositionRow[], nowS: number, m: MarkRow, room: () => number): Promise<{ n: number; done: boolean }> {
  if (!rows.length) return { n: 0, done: true };
  const from = m.swept_minute === null ? 0 : m.swept_minute + 60;
  const bars = (await db.prepare("SELECT minute AS t, h, l, c FROM bars WHERE market = ? AND minute >= ? ORDER BY minute LIMIT ?").bind(m.market, from, NET_BARS + 1).all<MinuteBar>()).results;
  if (bars.length > NET_BARS) return lazyLiquidateRows(db, rows, nowS, m, room);
  if (!bars.length) return { n: 0, done: true };
  const rates = await ratesFor(db, m.market, rows);
  let n = 0;
  for (const r of rows) {
    const hit = Engine.liquidation(toEngine(r), bars, rates);
    if (!hit) continue;
    if (room() < LIQ_STATEMENTS) return { n, done: false };
    const res = await db.batch(liquidationStmts(db, r, hit, bars, rates, nowS, randomHex(8)));
    n += res[0].meta.changes;
  }
  return { n, done: true };
}

function openView(r: PositionRow, mark: number | null, rates: readonly StoredRate[], nowS: number): OpenPositionView {
  const pos = toEngine(r);
  const fp = Engine.fundingPaid(pos, rates, nowS), bp = Engine.borrowPaid(pos, nowS);
  return {
    id: r.id, market: r.market, side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, liq: Engine.liqPrice(pos, fp + bp),
    openedAt: r.opened_at, fee: r.fee, funding: -fp, borrow: bp, mark, pnl: mark === null ? null : Engine.pnl(pos, mark), lockReq: r.lock_req ?? "0",
  };
}

function closedView(r: PositionRow): ClosedPositionView {
  const returned = r.returned ?? 0;
  return {
    id: r.id, market: r.market, side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, openedAt: r.opened_at,
    closedAt: r.closed_at!, exit: r.exit!, pnl: r.pnl!, funding: r.accrued ?? 0, borrow: r.borrow ?? 0, fee: r.fee, returned,
    net: returned - r.margin - r.notional * RULES.feeRate,
    reason: r.reason === "liquidation" ? "liquidation" : r.close_note === LOCK_WITHDRAWN ? LOCK_WITHDRAWN : "close",
  };
}

// ───────────────────────────── ingest ─────────────────────────────

interface PrevRow extends MarkRow {
  has_pending: number;
  has_gaps: number;
  has_rates: number;
  last_split: number | null;
  booked_hour: number | null;
  /** R1: the newest REGI price sample's slot (null: none yet). */
  price_ts: number | null;
  /** R4: the withdrawal watch's cursor block and when it last ran. */
  lock_block: number | null;
  lock_checked: number | null;
}

/**
 * Producer ingest, for the post's market only (R4: its mark row, bars, gaps, rates, house hours, positions, orders,
 * pools and split; another market's state is never read or written). D1 budget: the mark row is written every post; a bar only when its minute has finished (the
 * open minute is in every post, cumulative) and only when it changed; the liquidation sweep runs inside the same
 * batch, over the bars it writes (so about once a minute, reading the open positions then); once an hour the rates
 * are fixed and the house's hour is booked (R2), in the same batch; prune once an hour.
 */
export async function handlePushMark(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  const refused = bearerGuard(req, env.ABI_PUSH_TOKEN, "POST", "mark publishing");
  if (refused) return refused;
  if (!env.PILOT_DB) return unconfigured();
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
  const M = d.market;
  const meter = new Meter();
  const db = metered(env.PILOT_DB, meter);
  const rows = () => ({ read: meter.read, written: meter.written });

  // the market's mark row plus probes in one read (a row even before the first post): pending orders, open gaps, this
  // hour's rates, the last split, the last booked hour
  const probe = await db
    .prepare(
      `SELECT ${MARK_SEL}, EXISTS (SELECT 1 FROM orders WHERE market = ? AND status = 'pending') AS has_pending, EXISTS (SELECT 1 FROM gaps WHERE market = ?) AS has_gaps, ` +
        "EXISTS (SELECT 1 FROM rates WHERE market = ? AND hour = ?) AS has_rates, (SELECT MAX(week) FROM splits WHERE market = ?) AS last_split, " +
        "(SELECT MAX(hour) FROM house_hours WHERE market = ?) AS booked_hour, (SELECT MAX(ts) FROM regi_price) AS price_ts, " +
        "(SELECT block FROM lock_cursor WHERE id = 1) AS lock_block, (SELECT checked FROM lock_cursor WHERE id = 1) AS lock_checked FROM (SELECT 1) AS one LEFT JOIN mark m ON m.market = ?",
    )
    .bind(M, M, M, d.hour_start, M, M, M)
    .first<PrevRow>();
  const prev = probe && probe.ts !== null ? probe : null;
  if (prev && d.ts <= prev.ts) return errorJson(409, "ts is not newer than the stored mark", { last_minute: ackMinute(prev.bars_minute, prev.ts), rows: rows() });
  // review S1: hours only move forward (a stale or replayed post must not fix an hour already booked)
  if (prev && d.hour_start < prev.hour_start) return errorJson(409, "hour_start is older than the stored mark's", { last_minute: ackMinute(prev.bars_minute, prev.ts), rows: rows() });
  const cur = Math.floor(d.ts / 60) * 60;
  const finished = d.bars.filter((b) => b[0] < cur);
  const openBar = d.bars.find((b) => b[0] === cur) ?? null;
  const stored = prev?.bars_minute ?? null;
  const post = randomHex(16);

  // spec §8.5: every minute missing between the stored bars and this post gets a gap bar, so no liquidation is skipped:
  // the open hour's from the posted candle, an earlier (closed) hour's from its index candle. An earlier hour with no
  // candle yet stays open in `gaps` (nothing fills meanwhile) until a later post can close it. One bar stands for a
  // whole hour segment and sits at its LAST minute, so every position open at any time in the segment is checked
  // (the engine skips bars that start before a position opened).
  const first = d.bars[0][0];
  const [, ch, cl, cc] = d.candle;
  const gapBars: number[][] = [];
  const opened: [number, number][] = [];
  const gapFound = stored !== null && first > stored + 60;
  if (gapFound) {
    for (const [from, to] of hourSegments(stored + 60, first - 60)) {
      if (from >= d.hour_start) gapBars.push([to, ch, cl, Math.min(ch, Math.max(cl, cc))]);
      else opened.push([from, to]);
    }
  }
  const pendingGaps = !prev || prev.has_gaps
    ? (await db.prepare("SELECT minute_from, minute_to FROM gaps WHERE market = ? ORDER BY minute_from").bind(M).all<{ minute_from: number; minute_to: number }>()).results
    : [];
  const closedGaps: number[] = [];
  const unresolved: [number, number][] = [];
  let candles: Map<number, IndexCandle> | null = null;
  if (opened.length || pendingGaps.length) {
    candles = await indexCandles(env, M);
    for (const [from, to, known] of [...pendingGaps.map((g) => [g.minute_from, g.minute_to, true] as const), ...opened.map(([a, b]) => [a, b, false] as const)]) {
      const k = candles.get(hourOf(from));
      if (k) { gapBars.push([to, k.h, k.l, k.c]); if (known) closedGaps.push(from); }
      else if (!known) unresolved.push([from, to]);
    }
  }
  const gapsLeft = pendingGaps.length - closedGaps.length + unresolved.length;

  // the bars this post stores (finished minutes + gap bars), merged with what is stored (high and low only widen)
  const toStore = [...gapBars, ...finished].sort((a, b) => a[0] - b[0]);
  const existing = new Map<number, MinuteBar>();
  for (let i = 0; i < toStore.length; i += 90) {
    const ms = toStore.slice(i, i + 90).map((b) => b[0]);
    const got = (await db.prepare(`SELECT minute AS t, h, l, c FROM bars WHERE market = ? AND minute IN (${ms.map(() => "?").join(", ")})`).bind(M, ...ms).all<MinuteBar>()).results;
    for (const b of got) existing.set(b.t, b);
  }
  const merged: MinuteBar[] = toStore.map(([t, h, l, c]) => {
    const e = existing.get(t);
    return e ? { t, h: Math.max(e.h, h), l: Math.min(e.l, l), c } : { t, h, l, c };
  });
  // the newest minute accounted for: a gap counts as covered through first - 60 (a gap bar, or a row in `gaps`)
  const covered = [stored, gapFound ? first - 60 : null, merged.length ? merged[merged.length - 1].t : null].filter((x): x is number => x !== null);
  const barsMinute = covered.length ? Math.max(...covered) : null;

  // R2: this post fixes the hour's rates when it carries the trend and σ_1h of the hour its own clock is in, nobody
  // fixed them yet, and the hour is not booked (review S1: never an earlier hour, never retroactively)
  const H = d.hour_start, bookedHour = probe?.booked_hour ?? null;

  // R2 step 1, and the safety net: bars stored but never swept are checked first, over every open position. Review
  // R3: it takes at most what leaves room for the batch; if positions are left, this post sweeps, fixes and fills
  // nothing (the next post goes on from the same watermark)
  let netDone = true, netLiquidated = 0;
  if (prev && prev.bars_minute !== null && (prev.swept_minute === null || prev.swept_minute < prev.bars_minute)) {
    // what the rest of this post needs at least: its reads, the mark / bar / gap / prune / split statements, and a
    // rate fix with its close's reads
    const rest = POST_NET_READS + 1 + merged.length + unresolved.length + closedGaps.length + SPLIT_STATEMENTS + PRUNE_STATEMENTS + FIX_RESERVE + CLOSE_READS;
    const net = await sweepUnswept(db, await allOpen(db, M), nowS, prev, () => INGEST_MAX_STATEMENTS - rest - meter.statements);
    netDone = net.done;
    netLiquidated = net.n;
  }
  const fixing = netDone && d.trend !== null && d.premium !== null && d.trend.hour === H && H === hourOf(d.ts) && d.sigma1h !== null && !probe?.has_rates && (bookedHour === null || H > bookedHour);
  const hourFixed = Boolean(probe?.has_rates) || fixing;

  // the bars the sweep checks: this post's, and after a fix (§9.14c) every stored bar since the hour started, now
  // with the hour's rates (a crossing found there is stamped at its own bar)
  let sweepBars = merged;
  if (fixing) {
    const since = (await db.prepare("SELECT minute AS t, h, l, c FROM bars WHERE market = ? AND minute >= ? ORDER BY minute").bind(M, H).all<MinuteBar>()).results;
    const byT = new Map(since.map((b) => [b.t, b] as const));
    for (const b of merged) byT.set(b.t, b);
    sweepBars = [...byT.values()].sort((a, b) => a.t - b.t);
  }
  let open: PositionRow[] = [];
  let rates: StoredRate[] = [];
  let sweepRates: StoredRate[] = [];
  let fix: { fr: Engine.FundingRates; L: number; S: number; overlap: PositionRow[]; first: number } | null = null;
  if (netDone && (sweepBars.length || fixing)) {
    open = await allOpen(db, M);
    let overlap: PositionRow[] = [];
    const first = bookedHour === null ? H - HOUR : bookedHour + HOUR;
    if (fixing) {
      // every position that overlapped the hours being booked or the closing hour, closed ones included
      overlap = (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE market = ? AND opened_at < ? AND (closed_at IS NULL OR closed_at >= ?) ORDER BY id`).bind(M, H, Math.min(first, H - HOUR) - 60).all<PositionRow>()).results;
    }
    const all = overlap.length ? overlap : open;
    if (all.length) rates = await ratesFor(db, M, all);
    sweepRates = rates;
    if (fixing) {
      // §9.14a: the book that fixes hour H is time-weighted over hour H − 1 (a crossing before H in this post's bars
      // ends its position's weight there)
      const before = sweepBars.filter((b) => b.t < H);
      const endAt = new Map<number, number>();
      for (const r of open) {
        const hit = before.length ? Engine.liquidation(toEngine(r), before, rates) : null;
        if (hit) endAt.set(r.id, hit.t);
      }
      const { L, S } = Engine.bookTW(overlap.map((r) => ({ side: r.side, notional: r.notional, openedAt: r.opened_at, closedAt: r.closed_at ?? endAt.get(r.id) ?? null })), H - HOUR, H);
      const fr = Engine.fundingRates({ L, S, trend: d.trend!.value, sigma1h: d.sigma1h, premium: d.premium });
      sweepRates = [...rates.filter((x) => x.t !== H), { t: H, long: fr.long, short: fr.short, r: fr.r }].sort((a, b) => a.t - b.t);
      fix = { fr, L, S, overlap, first };
    }
  }
  // in-batch liquidation sweep: every open position against the sweep bars (first crossing)
  const lastBar = sweepBars.length ? sweepBars[sweepBars.length - 1].t : -Infinity;
  const hits: { r: PositionRow; hit: { t: number; price: number; shortfall: number } }[] = [];
  for (const r of open) {
    if (r.opened_at > lastBar) continue;
    const hit = Engine.liquidation(toEngine(r), sweepBars, sweepRates);
    if (hit) hits.push({ r, hit });
  }

  const pruned = !prev || d.hour_start > prev.hour_start;
  const split = await splitStmts(db, M, nowS, probe?.last_split ?? null, post);
  // review S2: the batch stays under MAX_BATCH_STATEMENTS, and (review R3) under what is left of the invocation's
  // INGEST_MAX_STATEMENTS after the reads so far and the hourly close's own. Liquidations beyond the cap wait (the
  // swept watermark is held back, so the next post's safety net picks them up); the hourly booking takes what is left.
  const batchCap = Math.min(MAX_BATCH_STATEMENTS, INGEST_MAX_STATEMENTS - meter.statements - (fixing ? CLOSE_READS : 0));
  const base = 1 + merged.length + unresolved.length + closedGaps.length + split.length + (pruned ? PRUNE_STATEMENTS : 0);
  const liqCap = Math.max(1, Math.floor((batchCap - base - (fixing ? FIX_RESERVE : 0)) / LIQ_STATEMENTS));
  const taken = hits.slice(0, liqCap);
  const heldBack = !netDone || taken.length < hits.length;
  const liqStmts: D1PreparedStatement[] = [];
  const liqFirst: number[] = []; // index (in liqStmts) of each liquidation's settle statement
  for (const { r, hit } of taken) {
    liqFirst.push(liqStmts.length);
    liqStmts.push(...liquidationStmts(db, r, hit, sweepBars, sweepRates, d.ts, post, post));
  }
  const swept = heldBack ? (fixing ? Math.min(prev?.swept_minute ?? H - 60, H - 60) : (prev?.swept_minute ?? null)) : barsMinute;

  const stmts: D1PreparedStatement[] = [
    db.prepare(SQL.markUpsert).bind(
      M, d.mark, d.ts, nowMs, d.head, d.hour_start, d.ch24, d.ch1, d.sigma1h, d.sigma24h, hourFixed ? 1 : 0,
      hourFixed ? (fixing ? d.trend!.value : prev && prev.hour_start === d.hour_start ? prev.funding_rate : null) : null,
      d.basePending ? 1 : 0, d.baseStepTs, d.milestoneTs, barsMinute, swept, JSON.stringify(d.candle), post,
    ),
  ];
  for (const b of merged) stmts.push(db.prepare(SQL.barUpsert).bind(b.t, b.h, b.l, b.c, M, post));
  for (const [from, to] of unresolved) stmts.push(db.prepare(SQL.gapOpen).bind(from, to, M, post));
  for (const from of closedGaps) stmts.push(db.prepare(SQL.gapClose).bind(M, from, post));
  const liqAt = stmts.length;
  stmts.push(...liqStmts);
  if (fix) {
    const takenIds = new Set(taken.map((x) => x.r.id));
    const ends = new Map(taken.map((x) => [x.r.id, x.hit.t + 60] as const));
    const live = open.filter((r) => !takenIds.has(r.id));
    const budget = batchCap - base - liqStmts.length;
    stmts.push(...(await hourlyClose(db, env, d, fix, live, ends, rates, bookedHour, post, nowS, budget)));
  }
  stmts.push(...split);
  // prune once an hour: on the market's first post of a new hour (its bars, gaps and orders; nonces and rate windows
  // are the site's, pruned by whichever market posts)
  if (pruned) {
    stmts.push(db.prepare("DELETE FROM bars WHERE market = ? AND minute < ?").bind(M, nowS - BARS_KEEP_S));
    stmts.push(db.prepare("DELETE FROM used_nonces WHERE exp < ?").bind(nowS));
    stmts.push(db.prepare("DELETE FROM ratelimit WHERE slot < ?").bind(Math.floor(nowS / 60) - 1));
    stmts.push(db.prepare("DELETE FROM orders WHERE market = ? AND status <> 'pending' AND arrived_ms < ?").bind(M, nowMs - ORDERS_KEEP_MS));
    stmts.push(db.prepare("DELETE FROM gaps WHERE market = ? AND minute_to < ?").bind(M, nowS - BARS_KEEP_S)); // older than any kept bar
    stmts.push(db.prepare("DELETE FROM regi_price WHERE ts < ?").bind(nowS - PRICE_KEEP_S)); // R1: only the last 24 h count
  }
  let res: D1Result[];
  try {
    res = await db.batch(stmts);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // the deliberate abort (SQL.abortUnlessChanged): a position moved between this post's reads and its batch, or a
    // racing post fixed the hour; nothing was written, the producer re-sends from last_minute
    if (isDeliberateAbort(msg)) return errorJson(409, "changed meanwhile, post again", { last_minute: ackMinute(stored, d.ts), rows: rows() });
    console.error(`pilot ingest (${M}): batch failed (${fix ? "hourly close" : "mark"}, ${stmts.length} statements, ${hits.length} liquidations): ${msg}`);
    return errorJson(500, "ingest failed", { rows: rows() });
  }
  if (res[0].meta.changes !== 1) return errorJson(409, "ts is not newer than the stored mark", { last_minute: ackMinute(stored, d.ts), rows: rows() });
  const liquidated = liqFirst.reduce((n, i) => n + res[liqAt + i].meta.changes, 0);

  // review R3: while liquidations are held back nothing fills (a close must not settle a position an earlier bar
  // liquidates); the orders wait for the next post, within RULES.markMaxAgeS of their arrival
  const fills = (!prev || prev.has_pending) && !heldBack
    ? await fillOrders(db, env, d, gapsLeft > 0, hourFixed, nowMs, openBar, () => INGEST_MAX_STATEMENTS - meter.statements, deps.fetch ?? fetch)
    : { filled: 0, refused: 0, deferred: 0 };
  // R1 + R4: the REGI price sample (ABI posts, once per 10 min) and the withdrawal watch (any post, once a minute), in
  // what is left of the invocation's statement budget
  const chores = await regiChores(db, env, d, nowS, deps, probe, heldBack, () => INGEST_MAX_STATEMENTS - meter.statements);
  return json({
    ok: true, index: M, last_minute: ackMinute(barsMinute, d.ts), ts: d.ts, bars: d.bars.length, stored: merged.length, gapBars: gapBars.length,
    gaps: gapsLeft, liquidated, netLiquidated, ...fills, heldBack, pruned, fixed: fixing, ...chores, statements: stmts.length, queries: meter.statements, rows: rows(),
  });
}

/** The NOT NULL failure SQL.abortUnlessChanged raises on purpose (D1 and SQLite word it the same). */
export const isDeliberateAbort = (msg: string) => /NOT NULL constraint failed: \w*ledger\.ts\b/.test(msg);

/** [from, to] split at hour starts (minute starts, inclusive). */
export function hourSegments(from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = from; a <= to; ) {
    const end = Math.min(to, hourOf(a) + 3540);
    out.push([a, end]);
    a = end + 60;
  }
  return out;
}

export interface IndexCandle {
  o: number;
  h: number;
  l: number;
  c: number;
}

/** R7: the closed hourly candles of the market's own index file in KV (abi:index, aii:index, aei:index), by hour start. Empty when unreadable. */
export async function indexCandles(env: Env, market: Market): Promise<Map<number, IndexCandle>> {
  const out = new Map<number, IndexCandle>();
  try {
    const raw = await env.INVITES.get(ABI_INDICES[market].key);
    const candles = raw ? (JSON.parse(raw) as { candles?: unknown }).candles : null;
    if (!Array.isArray(candles)) return out;
    for (const x of candles) {
      if (!Array.isArray(x) || typeof x[0] !== "string") continue;
      const t = Date.parse(x[0]) / 1000, [o, h, l, c] = [x[1], x[2], x[3], x[4]];
      if (!Number.isInteger(t) || t % 3600 !== 0 || ![h, l, c].every(finite) || !(l > 0 && l <= h)) continue;
      const cc = Math.min(h, Math.max(l, c));
      out.set(t, { o: finite(o) && o > 0 ? o : cc, h, l, c: cc });
    }
  } catch { /* unreadable: the gap stays open */ }
  return out;
}

const openGaps = async (db: D1Database, market: Market) => (await db.prepare("SELECT COUNT(*) AS n FROM gaps WHERE market = ?").bind(market).first<{ n: number }>())?.n ?? 0;
/** One market's open positions (index positions_market). */
const allOpen = async (db: D1Database, market: Market) => (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE market = ? AND closed_at IS NULL ORDER BY id`).bind(market).all<PositionRow>()).results;

// ───────────────────────────── hourly close (R2) ─────────────────────────────

interface HourRates {
  hour: number;
  long: number;
  short: number;
  r: number;
  cut: number;
  trend: number;
  sigma_1h: number;
  L: number;
  S: number;
  premium: number | null;
}
interface BookedRow {
  hour: number;
  close: number;
  cum: number;
  cum_price: number;
  cum_funding: number;
  cum_trueup: number;
  cum_liq: number;
  upto_id: number;
}

/** When a settled position stopped accruing: a close's time, a liquidation's bar end. null: open. */
const endOf = (r: PositionRow) => (r.closed_at === null ? null : r.reason === "liquidation" ? r.closed_at + 60 : r.closed_at);

/**
 * R2, steps 2–5, as statements for the ingest batch that fixes hour H = d.hour_start. fix: the rates from the
 * time-weighted book of hour H − 1 (§9.14a) and every position that overlapped the hours to book; live: the open
 * positions the sweep left; ends: the bar ends of this batch's liquidations; rates: stored rates (H not included);
 * budget: statements this may add (review S2).
 * - the rates row, INSERT … ON CONFLICT DO NOTHING under this post, and the projected cut of hour H (ledger `cut`,
 *   ref hour:H), only if that insert won;
 * - each unbooked hour h < H (oldest first, as many as the budget allows, at most MAX_BOOK_HOURS): a house_hours
 *   row and its ledger rows:
 *   - `house_pnl` ref hour:h = price + funding. Price: houseHour() on the hour's stored book and candle. Funding
 *     (§9.14a): what the positions actually paid in the hour, light-side receipts included, minus the cut.
 *   - `house_trueup` ref hour:h:adj and `cut` ref hour:h:adj: the true-up to the exact counterparty result.
 *
 * The true-up: each open position carries the house's and the cut's claim on it already in the ledger (booked,
 * booked_cut, booked_to). At the end of each booked hour its claim is marked at the hour's close and the difference
 * is booked; at settlement the rest is booked (house_trueup ref settle:<id>). The claims telescope, so the house is
 * the exact counterparty of every position whatever the hourly figures, and positions left out of one booking (the
 * batch budget) lose nothing.
 */
async function hourlyClose(
  db: D1Database, env: Env, d: MarkPost, fix: { fr: Engine.FundingRates; L: number; S: number; overlap: readonly PositionRow[]; first: number },
  live: readonly PositionRow[], ends: ReadonlyMap<number, number>, rates: readonly StoredRate[], bookedHour: number | null, post: string, nowS: number, budget: number,
): Promise<D1PreparedStatement[]> {
  const H = d.hour_start, M = d.market, trend = d.trend!.value, sigma1h = d.sigma1h!, { fr, L, S } = fix;
  const out: D1PreparedStatement[] = [
    db.prepare(SQL.ratesInsert).bind(H, fr.long, fr.short, fr.skew, fr.r, fr.rMax, fr.cut, fr.houseExposure, fr.houseFunding, trend, sigma1h, L, S, nowS, post, d.premium ?? 0, M, post),
    ...ledgerStmts(db, "rates", [M, H, post], H, [{ kind: "cut", amount: fr.cut, ref: `hour:${H}` }]),
  ];
  // the budget (review S2): 7 statements per hour (house_hours + 3 ledger pairs), 2 per booked position (update +
  // abort check). Catch-up hours take at most half of it; the open positions with the oldest bookings take the rest
  // (with more open positions than fit, they rotate: the claims telescope, so a late booking loses nothing).
  const room = budget - out.length;
  const first = fix.first;
  const due = Math.max(0, (H - HOUR - first) / HOUR + 1);
  if (!due || room < 7) return out;
  const hoursN = Math.min(due, MAX_BOOK_HOURS, Math.max(1, Math.floor(room / 2 / 7)));
  const posN = Math.max(0, Math.min(live.length, Math.floor((room - 7 * hoursN) / 2)));
  const last = first + (hoursN - 1) * HOUR;
  const hours: number[] = [];
  for (let h = first; h <= last; h += HOUR) hours.push(h);

  const [prevRow, hourRates, maxIdRow, idx] = await Promise.all([
    db.prepare("SELECT hour, close, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id FROM house_hours WHERE market = ? ORDER BY hour DESC LIMIT 1").bind(M).first<BookedRow>(),
    db.prepare("SELECT hour, long, short, r, cut, trend, sigma_1h, L, S, premium FROM rates WHERE market = ? AND hour >= ? AND hour <= ?").bind(M, first, last).all<HourRates>(),
    db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM ledger").first<{ id: number }>(),
    indexCandles(env, M),
  ]);
  const byHour = new Map(hourRates.results.map((x) => [x.hour, x]));
  // review N4: the market house's settlement rows not yet in any booked hour, by ledger id (each counted exactly once;
  // the id watermark is the whole ledger's, the rows are this market's)
  const fromId = prevRow?.upto_id ?? 0, uptoId = maxIdRow?.id ?? 0;
  const attributed = (
    await db
      .prepare("SELECT ts, kind, amount FROM ledger WHERE id > ? AND id <= ? AND market = ? AND kind IN ('house_trueup', 'liq_margin') AND ref NOT LIKE 'hour:%' AND ref NOT LIKE 'split:%'")
      .bind(fromId, uptoId, M)
      .all<{ ts: number; kind: string; amount: number }>()
  ).results;
  const trueupAt = new Map<number, number>(), liqAt = new Map<number, number>();
  const add = (m: Map<number, number>, h: number, x: number) => m.set(h, (m.get(h) ?? 0) + x);
  for (const a of attributed) add(a.kind === "liq_margin" ? liqAt : trueupAt, Math.min(last, Math.max(first, hourOf(a.ts))), a.amount);

  // each hour's open and close: the index file's candle (the same source as the gap bars), else the hour's last bar
  const lastBar = new Map<number, number>();
  if (hours.some((h) => !idx.has(h))) {
    const got = await db
      .prepare("SELECT b.minute AS t, b.c AS c FROM bars b JOIN (SELECT MAX(minute) AS m FROM bars WHERE market = ? AND minute >= ? AND minute < ? GROUP BY minute / 3600) x ON b.market = ? AND b.minute = x.m")
      .bind(M, first, last + HOUR, M)
      .all<{ t: number; c: number }>();
    for (const b of got.results) lastBar.set(hourOf(b.t), b.c);
  }
  const candle = new Map<number, { o: number; c: number }>();
  let prevClose: number | null = prevRow?.close ?? null;
  for (const h of hours) {
    const k = idx.get(h);
    const c = k ? k.c : lastBar.get(h) ?? prevClose ?? d.mark;
    candle.set(h, { o: k ? k.o : prevClose ?? c, c });
    prevClose = c;
  }

  // §9.14a: the house's funding line per hour, from what every overlapping position actually paid (net of the cut)
  const fundingAt = new Map<number, number>();
  for (const r of fix.overlap) {
    const pos = toEngine(r), end = ends.get(r.id) ?? endOf(r);
    for (const h of hours) {
      const rh = byHour.get(h);
      if (!rh || r.opened_at >= h + HOUR || (end !== null && end <= h)) continue;
      const one = [{ t: h, long: rh.long, short: rh.short, r: rh.r }];
      const to = end === null ? h + HOUR : Math.min(end, h + HOUR);
      add(fundingAt, h, Engine.fundingPaid(pos, one, to) - cutPaid(pos, one, to));
    }
  }

  // the claims of the open positions with the oldest bookings, at the end of each hour, against what is booked
  const dHouse = new Map<number, number>(), dCut = new Map<number, number>();
  const moves: D1PreparedStatement[] = [];
  const chosen = [...live].sort((a, b) => a.booked_to - b.booked_to || a.id - b.id).slice(0, posN);
  for (const r of chosen) {
    const pos = toEngine(r);
    let booked = r.booked, bookedCut = r.booked_cut, to = r.booked_to;
    for (const h of hours) {
      const T = h + HOUR;
      if (r.opened_at >= T || to >= T) continue;
      const cl = claimAt(pos, rates, T, candle.get(h)!.c);
      add(dHouse, h, cl.house - booked);
      add(dCut, h, cl.cut - bookedCut);
      booked = cl.house;
      bookedCut = cl.cut;
      to = T;
    }
    if (to !== r.booked_to) moves.push(db.prepare(SQL.bookPosition).bind(booked, bookedCut, to, r.id, r.booked_to, H, post), db.prepare(SQL.abortUnlessChanged));
  }

  const cum = { all: prevRow?.cum ?? 0, price: prevRow?.cum_price ?? 0, funding: prevRow?.cum_funding ?? 0, trueup: prevRow?.cum_trueup ?? 0, liq: prevRow?.cum_liq ?? 0 };
  for (const h of hours) {
    const { o, c } = candle.get(h)!;
    const rh = byHour.get(h);
    let exposure = 0, price = 0;
    if (rh) {
      const hh = Engine.houseHour({ L: rh.L, S: rh.S, open: o, close: c, trend: rh.trend, sigma1h: rh.sigma_1h, premium: rh.premium ?? 0 });
      exposure = hh.exposure;
      price = hh.pricePnl;
    }
    const funding = fundingAt.get(h) ?? 0;
    const pnl = price + funding;
    const delta = dHouse.get(h) ?? 0;
    const adj = delta - pnl, cutAdj = (dCut.get(h) ?? 0) - (rh?.cut ?? 0);
    const tAttr = trueupAt.get(h) ?? 0, lAttr = liqAt.get(h) ?? 0;
    const total = delta + tAttr + lAttr;
    cum.all += total;
    cum.price += price;
    cum.funding += funding;
    cum.trueup += adj + tAttr;
    cum.liq += lAttr;
    out.push(
      db.prepare(SQL.houseHourInsert).bind(h, o, c, exposure, price, funding, pnl, adj, total, cum.all, cum.price, cum.funding, cum.trueup, cum.liq, uptoId, nowS, post, M, H, post),
      ...ledgerStmts(db, "hour", [M, h, post], h, [
        { kind: "house_pnl", amount: pnl, ref: `hour:${h}` },
        { kind: "house_trueup", amount: adj, ref: `hour:${h}:adj` },
        { kind: "cut", amount: cutAdj, ref: `hour:${h}:adj` },
      ]),
    );
  }
  out.push(...moves);
  return out;
}

// ───────────────────────────── weekly split (R5) ─────────────────────────────

type Pools = Record<LedgerKind, { balance: number; gross: number }> & {
  /** The house's claim on the positions still open (their booked mark-to-market and accruals): unrealized. */
  openBooked: number;
};

/** One market's pools and its open positions' booked claims in ONE statement (a consistent snapshot). */
async function readPools(db: D1Database, market: Market): Promise<Pools> {
  const rows = (
    await db
      .prepare("SELECT p.kind, p.balance, p.gross, (SELECT COALESCE(SUM(booked), 0) FROM positions WHERE market = ? AND closed_at IS NULL) AS open_booked FROM pools p WHERE p.market = ?")
      .bind(market, market)
      .all<{ kind: LedgerKind; balance: number; gross: number; open_booked: number }>()
  ).results;
  const out = { ...Object.fromEntries(LEDGER_KINDS.map((k) => [k, { balance: 0, gross: 0 }])), openBooked: 0 } as unknown as Pools;
  out.openBooked = rows[0]?.open_booked ?? 0;
  for (const r of rows) out[r.kind] = { balance: r.balance, gross: r.gross };
  return out;
}

/** The house's book: every house kind's balance (realized, unrealized and carried, net of what splits moved out). */
const houseBook = (p: Pools) => HOUSE_KINDS.reduce((a, k) => a + p[k].balance, 0);
/**
 * §9.14b: the house's realized result not yet split. The book minus the claim on the positions still open: what
 * settled (closes and liquidations, with the funding and borrow settled on them), net of what earlier splits moved
 * out. Negative = a carried loss.
 */
export const houseRealized = (p: Pools) => houseBook(p) - p.openBooked;

/**
 * The fee pool since the last split (R5, §9.14b): fee + borrow + cut + max(0, the house's realized unsplit result). A
 * negative realized result is carried (spec §9.5); the house's mark-to-market on open positions stays in its book;
 * a pool ≤ 0 moves nothing.
 */
export function splitOf(p: Pools) {
  const fee = p.fee.balance, borrow = p.borrow.balance, cut = p.cut.balance;
  const house = Math.max(0, houseRealized(p));
  const pool = fee + borrow + cut + house;
  if (!(pool > 0)) return { pool: 0, fee: 0, borrow: 0, cut: 0, house: 0, insurance: 0, treasury: 0, buyback: 0 };
  const s = Engine.splitFees(pool);
  return { pool, fee, borrow, cut, house, ...s };
}

/** The week a split is due for (Monday 00:00 UTC of the week that ended), or null when the last one covers it. */
export function splitDue(nowS: number, lastSplit: number | null): number | null {
  const week = weekStart(nowS) - WEEK;
  return lastSplit !== null && lastSplit >= week ? null : week;
}

/**
 * The weekly split's statements (none unless due): the splits row (once per week), then, only if it won, rows that
 * move each source's unsplit balance out (ref split:<week>) and into insurance, the treasury and its buyback
 * earmark (split_treasury holds the part not earmarked). Points only (spec §9.12). After a split, the fee, borrow
 * and cut balances are exactly what is unsplit per source; the house's realized share leaves its book as a
 * `house_pnl` row, so the house kinds are read together (houseBook / houseRealized), never one by one.
 */
async function splitStmts(db: D1Database, market: Market, nowS: number, lastSplit: number | null, token: string): Promise<D1PreparedStatement[]> {
  const week = splitDue(nowS, lastSplit);
  if (week === null) return [];
  const s = splitOf(await readPools(db, market));
  const ref = `split:${week}`;
  return [
    db.prepare(SQL.splitInsert).bind(market, week, nowS, s.pool, s.fee, s.borrow, s.cut, s.house, s.insurance, s.treasury, s.buyback, token),
    ...ledgerStmts(db, "split", [market, week, token], nowS, [
      { kind: "fee", amount: -s.fee, ref },
      { kind: "borrow", amount: -s.borrow, ref },
      { kind: "cut", amount: -s.cut, ref },
      { kind: "house_pnl", amount: -s.house, ref },
      { kind: "split_insurance", amount: s.insurance, ref },
      { kind: "split_treasury", amount: s.treasury - s.buyback, ref },
      { kind: "split_buyback", amount: s.buyback, ref },
    ], true),
  ];
}

/** R5: run the market's split if one is due (any /api/pilot read; lastSplit from the mark row's join when at hand). */
export async function maybeSplit(db: D1Database, market: Market, nowS: number, lastSplit?: number | null): Promise<boolean> {
  const known = lastSplit !== undefined ? lastSplit : ((await db.prepare("SELECT MAX(week) AS w FROM splits WHERE market = ?").bind(market).first<{ w: number | null }>())?.w ?? null);
  if (splitDue(nowS, known) === null) return false;
  const stmts = await splitStmts(db, market, nowS, known, randomHex(8));
  const res = await db.batch(stmts);
  return res[0].meta.changes === 1;
}

// ───────────────────────────── public reads ─────────────────────────────

/** The request's market from its query (`param`, absent = abi), or null when it names none of the three. */
const queryMarket = (req: Request, param = "market") => marketOf(new URL(req.url).searchParams.get(param));

export async function handlePublicMark(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const market = queryMarket(req, "index");
  if (!market) return errorJson(400, BAD_MARKET);
  return edgeCachedGet(req, deps, async () => {
    const m = markView(await loadMark(db, market), nowSOf(deps), pilotMaxLev(env));
    return m ? json(m) : errorJson(404, "no data");
  }, MARK_CACHE_S, market);
}

const RATE_SEL = "hour AS t, long, short, skew, trend, COALESCE(premium, 0) AS premium, r, cut, L, S, house_exposure AS houseExposure";
const recentRates = async (db: D1Database, market: Market) =>
  (await db.prepare(`SELECT ${RATE_SEL} FROM rates WHERE market = ? ORDER BY hour DESC LIMIT ?`).bind(market, PILOT_LIMITS.fundingShown).all<RateView>()).results;

/** GET /api/pilot/funding?market=: the market's last 24 hourly rates (R7), public, edge-cached 60 s. */
export async function handleFunding(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const market = queryMarket(req);
  if (!market) return errorJson(400, BAD_MARKET);
  return edgeCachedGet(req, deps, async () => {
    const nowS = nowSOf(deps);
    await maybeSplit(db, market, nowS);
    const recent = await recentRates(db, market);
    const hour = hourOf(nowS);
    return json({ market, recent, current: recent.find((r) => r.t === hour) ?? null, next: hour + HOUR } satisfies FundingView);
  }, PILOT_LIMITS.fundingCacheS, market);
}

interface CumRow {
  cum_price: number;
  cum_funding: number;
  cum_trueup: number;
  cum_liq: number;
}
const CUM_COLS = "cum_price, cum_funding, cum_trueup, cum_liq";
const ZERO_CUM: CumRow = { cum_price: 0, cum_funding: 0, cum_trueup: 0, cum_liq: 0 };
/** The market house's running sums through the booked hours that end at or before t (zeros before the first). */
const cumThrough = async (db: D1Database, market: Market, t: number) =>
  (await db.prepare(`SELECT ${CUM_COLS} FROM house_hours WHERE market = ? AND hour <= ? ORDER BY hour DESC LIMIT 1`).bind(market, t - HOUR).first<CumRow>()) ?? ZERO_CUM;

/**
 * R7: the economy in points (about 40 rows read). The house's P&L by line, over 24 h, this week and all time:
 * price and funding (the booked hours' houseHour price and the funding actually paid, net of the cut), true-up (to
 * the exact counterparty result: the hourly :adj rows and every settlement's residual) and liquidations (equity
 * left, less gaps insurance could not cover). Windows are the all-time figures minus the running sums at the window's
 * start; settlement rows are attributed to booked hours by ledger id, so none is counted twice (review N4).
 */
export async function economy(db: D1Database, market: Market, nowS: number): Promise<EconomyView> {
  const H = hourOf(nowS), W = weekStart(nowS);
  const [recent, pools, latest, c24, cWeek, last] = await Promise.all([
    recentRates(db, market),
    readPools(db, market),
    db.prepare(`SELECT ${CUM_COLS} FROM house_hours WHERE market = ? ORDER BY hour DESC LIMIT 1`).bind(market).first<CumRow>(),
    cumThrough(db, market, H - 24 * HOUR),
    cumThrough(db, market, W),
    db.prepare("SELECT week, ts, pool, insurance, treasury, buyback FROM splits WHERE market = ? ORDER BY week DESC LIMIT 1").bind(market).first<NonNullable<EconomyView["lastSplit"]>>(),
  ]);
  const current = recent.find((r) => r.t === H) ?? null;
  const all = {
    price: latest?.cum_price ?? 0,
    funding: latest?.cum_funding ?? 0,
    trueup: pools.house_trueup.gross,
    liquidations: pools.liq_margin.gross,
  };
  const win = (a: number, k: keyof CumRow) => ({ h24: a - c24[k], week: a - cWeek[k], all: a });
  const price = win(all.price, "cum_price"), funding = win(all.funding, "cum_funding"), trueup = win(all.trueup, "cum_trueup"), liquidations = win(all.liquidations, "cum_liq");
  const sum = (k: "h24" | "week" | "all") => price[k] + funding[k] + trueup[k] + liquidations[k];
  const s = splitOf(pools);
  return {
    market,
    ts: nowS,
    rates: { current, recent },
    borrowApr: RULES.borrowApr,
    house: {
      exposure: current ? current.houseExposure : null,
      realized: houseRealized(pools),
      unrealized: pools.openBooked,
      price, funding, trueup, liquidations,
      total: { h24: sum("h24"), week: sum("week"), all: sum("all") },
    },
    pool: { fee: pools.fee.balance, borrow: pools.borrow.balance, cut: pools.cut.balance, house: s.house, total: s.pool },
    insurance: pools.split_insurance.balance + pools.insurance_draw.balance,
    treasury: pools.split_treasury.balance + pools.split_buyback.balance,
    buyback: pools.split_buyback.balance,
    week: { start: W, pool: s.pool, insurance: s.insurance, treasury: s.treasury, buyback: s.buyback },
    lastSplit: last ?? null,
  };
}

/** GET /api/pilot/economy?market=: the market's economy, public, edge-cached 30 s (R7). Runs its due weekly split first. */
export async function handleEconomy(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const market = queryMarket(req);
  if (!market) return errorJson(400, BAD_MARKET);
  return edgeCachedGet(req, deps, async () => {
    const nowS = nowSOf(deps);
    await maybeSplit(db, market, nowS);
    return json(await economy(db, market, nowS));
  }, PILOT_LIMITS.economyCacheS, market);
}

// ───────────────────────────── orders ─────────────────────────────

interface OrderRow {
  id: number;
  wallet: string;
  market: Market;
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
  /** R3: the lock requirement checked when the order was placed (raw REGI, decimal string; '0' at 1×). */
  lock_req: string;
}
const ORDER_COLS = "id, wallet, market, kind, side, margin, lev, position_id, arrived_ms, status, error, fill_px, filled_at, lock_req";

const orderView = (o: OrderRow): OrderView => ({
  id: o.id, market: o.market, kind: o.kind, status: o.status, side: o.side, margin: o.margin, lev: o.lev, positionId: o.position_id,
  arrivedMs: o.arrived_ms, fillPx: o.fill_px, error: o.error,
});

const refuseStmt = (db: D1Database, id: number, error: string) => db.prepare(SQL.refuse).bind(error, id);

/**
 * The close settlement at `at` (R3): the settle binds up to booked_to, the settle token, and the statements after the
 * settle (the ledger rows under the token and any negative equity covered by insurance up to its balance, the rest a
 * house loss). margin + PnL − funding − borrow − exit fee goes back to the balance (never below 0); the fee and the
 * borrow go to the fee pool; the house's and the cut's remaining claim are booked.
 */
function settlement(db: D1Database, row: PositionRow, at: { mark: number; ts: number }, rates: readonly StoredRate[]) {
  const pos = toEngine(row), token = randomHex(8);
  const c = Engine.close(pos, at.mark, at.ts, rates);
  const claim = claimAt(pos, rates, at.ts, at.mark);
  const eq = pos.margin + c.pnl + c.funding - c.borrow - c.fee;
  return {
    binds: [at.ts, at.mark, c.pnl, c.funding, c.fee, c.payout, c.borrow, at.mark, token, claim.house, claim.cut, at.ts],
    payout: c.payout,
    after: [
      ...ledgerStmts(db, "settle", [row.id, token], at.ts, [
        { kind: "fee", amount: c.fee, ref: `close:${row.id}` },
        { kind: "borrow", amount: c.borrow, ref: `borrow:${row.id}` },
        { kind: "house_trueup", amount: claim.house - row.booked, ref: `settle:${row.id}` },
        { kind: "cut", amount: claim.cut - row.booked_cut, ref: `settle:${row.id}` },
      ]),
      // a deficit (equity below the exit fee): insurance covers what it can, the rest is a carried house loss
      ...gapStmts(db, row.id, token, at.ts, -eq, "house_trueup", `gap:${row.id}`),
    ],
  };
}

/** A close fill's statements: the settlement, only while the order is pending and the position's booking is as read. */
export function closeStmts(db: D1Database, row: PositionRow, o: Pick<OrderRow, "id" | "wallet">, d: Pick<MarkPost, "mark" | "ts">, rates: readonly StoredRate[]): D1PreparedStatement[] {
  const st = settlement(db, row, d, rates);
  return [
    db.prepare(SQL.closeSettle).bind(...st.binds, row.id, o.wallet, row.booked_to, o.id),
    db.prepare(SQL.closeCredit).bind(st.payout, o.wallet),
    db.prepare(SQL.closeFilled).bind(d.mark, d.ts, o.id),
    ...st.after,
  ];
}

/**
 * R4: the site's close of a position whose wallet withdrew REGI below its lock requirement: the same settlement at
 * the market's mark, with no order, only while the position is open, its booking is as read and its lock_req is
 * above `locked` (the remaining lock read from the factory). Never a liquidation.
 */
export function lockCloseStmts(db: D1Database, row: PositionRow, at: { mark: number; ts: number }, rates: readonly StoredRate[], locked: bigint): D1PreparedStatement[] {
  const st = settlement(db, row, at, rates);
  const l = lockReqString(locked);
  return [
    db.prepare(SQL.lockClose).bind(...st.binds, row.id, row.wallet, row.booked_to, l, l, l),
    db.prepare(SQL.closeCredit).bind(st.payout, row.wallet),
    ...st.after,
  ];
}

/**
 * Ingest: fill (or refuse) every order of the post's market this mark postdates (its chain ts after the order's
 * arrival), at this mark.
 * nowMs: the server's ingest time (an order waits at most RULES.markMaxAgeS of it). openBar: this post's open minute
 * (not stored until it finishes): a close is checked against it first, so a crossing in this minute liquidates.
 * hourFixed: this hour's rates are fixed: opens and closes wait for them (§9.14c), liquidations do not.
 */
async function fillOrders(
  db: D1Database, env: Env, d: MarkPost, gapsOpen: boolean, hourFixed: boolean, nowMs: number, openBar: MarkPost["bars"][number] | null, room: () => number,
  f: typeof fetch = fetch,
): Promise<{ filled: number; refused: number; deferred: number }> {
  if (room() < 1) return { filled: 0, refused: 0, deferred: 0 };
  const M = d.market;
  const pending = (await db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE market = ? AND status = 'pending' AND arrived_ms < ? ORDER BY id`).bind(M, d.ts * 1000).all<OrderRow>()).results;
  let filled = 0, refused = 0, deferred = 0;
  if (!pending.length) return { filled, refused, deferred };
  const state = pilotState(env, d.head), levCap = pilotMaxLev(env);
  const paused = basePaused({ base_pending: d.basePending, base_step_ts: d.baseStepTs, ts: d.ts });
  // a catch-up batch (bars behind the mark) or an open gap: older bars may still liquidate, so nothing fills now
  const catchingUp = gapsOpen || d.bars[d.bars.length - 1][0] < Math.floor(d.ts / 60) * 60;
  const risk = { sigma24: d.sigma24h, sigma1h: d.sigma1h, ch1: d.ch1 };
  const refuse = async (o: OrderRow, error: string) => { refused += (await refuseStmt(db, o.id, error).run()).meta.changes; };

  for (let i = 0; i < pending.length; i++) {
    const o = pending[i];
    // review R3: the invocation's budget; the rest stays pending for the next post
    if (room() < (o.kind === "open" ? OPEN_FILL_STATEMENTS : CLOSE_FILL_STATEMENTS)) { deferred = pending.length - i; break; }
    if (catchingUp || nowMs - o.arrived_ms > RULES.markMaxAgeS * 1000) { await refuse(o, PRICE_UPDATING); continue; }
    if (paused) { await refuse(o, TRADING_PAUSED); continue; }
    if (o.kind === "open") {
      if (state !== "open") { await refuse(o, state === "closed" ? PILOT_CLOSED : PILOT_MISCONFIGURED); continue; }
      if (blockedWallet(env, o.wallet)) { await refuse(o, BLOCKED_WALLET); continue; }
      if (o.lev! > levCap) { await refuse(o, LEV_ABOVE_CAP); continue; }
      if (milestonePaused({ milestone_ts: d.milestoneTs, ts: d.ts })) { await refuse(o, MILESTONE_PAUSED); continue; }
      if (!riskKnown(d.sigma24h, d.sigma1h) || !hourFixed) { await refuse(o, PRICE_UPDATING); continue; }
      // review B1: a leveraged open re-reads the lock at its fill, so a withdrawal between the order and the fill can't
      // leave a leveraged position without it (the order's lock_req is the requirement checked at submission; an RPC
      // failure refuses: fail closed)
      if (o.lev! > 1) {
        const factory = lockFactoryOf(env);
        if (!factory) { await refuse(o, LOCK_NOT_LIVE); continue; }
        let locked: bigint | null = null;
        try { locked = await lockedOf(factory, o.wallet, f); } catch { /* refused below */ }
        if (locked === null) { await refuse(o, LOCK_UNCHECKED); continue; }
        if (o.lock_req === "0" || locked < BigInt(o.lock_req)) { await refuse(o, lockUsdText(lockUsdOf(env) ?? PILOT_LOCK_USD_DEFAULT)); continue; }
      }
      const acct = await getAccount(db, o.wallet);
      // R2: one balance across markets; one direction and RULES.maxOpen per market
      const held = (await openRows(db, o.wallet)).filter((x) => x.market === M);
      const r = Engine.open({ balance: acct?.balance ?? 0, open: held.length, side: held[0]?.side ?? null }, { side: o.side!, margin: o.margin!, lev: o.lev!, mark: d.mark, now: d.ts, risk });
      if (!r.ok) { await refuse(o, engineError(r.error, held)); continue; }
      const p = r.position, cost = p.margin + r.fee;
      const res = await db.batch([
        db.prepare(SQL.openDebit).bind(cost, o.wallet, cost, o.wallet, M, RULES.maxOpen, o.wallet, M, p.side, o.id),
        db.prepare(SQL.openInsert).bind(o.wallet, M, p.side, p.margin, p.lev, p.notional, p.entry, p.liq, p.openedAt, r.fee, p.openedAt, p.lev > 1 ? o.lock_req : "0"),
        db.prepare(SQL.openFilled).bind(d.mark, d.ts, o.id),
        db.prepare(SQL.openFeeLedger).bind(d.ts, r.fee, o.id),
        db.prepare(SQL.openFeePool).bind(r.fee, r.fee, o.id),
      ]);
      if (res[2].meta.changes === 1) filled++;
      else {
        const now = (await openRows(db, o.wallet)).filter((x) => x.market === M);
        const opp = now.find((x) => x.side !== p.side);
        await refuse(o, opp ? closeFirst(opp.side) : now.length >= RULES.maxOpen ? "too many open positions" : "insufficient balance");
      }
    } else {
      if (!hourFixed) { await refuse(o, PRICE_UPDATING); continue; } // §9.14c: nothing settles at unknown rates
      // two tries: the position's booking may move between the read and the batch (a racing ingest)
      for (let attempt = 0; ; attempt++) {
        const row = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ? AND wallet = ? AND market = ?`).bind(o.position_id, o.wallet, M).first<PositionRow>();
        if (!row || row.closed_at !== null) { await refuse(o, ALREADY_CLOSED); break; }
        const rates = await loadRates(db, M, row.opened_at);
        const bar = openBar ? [{ t: openBar[0], h: openBar[1], l: openBar[2], c: openBar[3] }] : [];
        const hit = bar.length ? Engine.liquidation(toEngine(row), bar, rates) : null;
        const res = await db.batch(hit ? liquidationStmts(db, row, hit, bar, rates, d.ts, randomHex(8)) : closeStmts(db, row, o, d, rates));
        if (hit && res[0].meta.changes === 1) { await refuse(o, ALREADY_CLOSED); break; } // liquidated in this minute
        if (!hit && res[2].meta.changes === 1) { filled++; break; }
        // nothing settled: the position moved meanwhile (review N1: say so only if it really is closed now)
        if (attempt === 0 && res[0].meta.changes === 0) continue;
        await refuse(o, PRICE_UPDATING);
        break;
      }
    }
  }
  return { filled, refused, deferred };
}

// ───────────────────────────── REGI price and the lock watch (plan 2026-10-13 R1, R4) ─────────────────────────────

/** Statements one lock close may take at most: the mark and gap reads, the safety-net check, a re-read, rates, a 14-statement settlement. */
const LOCK_CLOSE_STATEMENTS = 40;
/** Log chunks (of LOG_CHUNK blocks) one watch reads at most; the rest follow the next minute. */
const LOCK_MAX_CHUNKS = 4;
/** Owners due a re-check that one run looks at, at most (the earliest withdrawals first); the rest follow. */
const LOCK_DUE_PER_RUN = 50;

export interface LockWatchResult {
  /** The cursor after this run: every Withdrawn log up to it is read and its owner recorded in lock_due. */
  cursor: number | null;
  /** The block this run's lockedOf reads were pinned to (the cursor), or null when no log was ever read. */
  pinned: number | null;
  /** Due owners re-checked; positions closed; pending leveraged orders refused. */
  owners: number;
  closed: number;
  refused: number;
  /** Owners still due after this run (a market not settleable now, an RPC failure, the statement budget). */
  due: number;
  /** Caught up to the head − LOCK_CONFIRM_BLOCKS with nobody left due. */
  done: boolean;
}

/**
 * R4, after the ingest's fills: the REGI price sample (R1: ABI posts only, once per 10-minute slot) and, at most once
 * a minute (any market's post), the withdrawal watch. Never while this post holds liquidations back. Failures are
 * logged and change nothing (the next post tries again).
 */
async function regiChores(
  db: D1Database, env: Env, d: MarkPost, nowS: number, deps: PilotDeps, probe: PrevRow | null, heldBack: boolean, room: () => number,
): Promise<{ priceSampled: boolean; lockWatch: LockWatchResult | null }> {
  const f = deps.fetch ?? fetch;
  let priceSampled = false, lock: LockWatchResult | null = null;
  try {
    if (d.market === "abi" && room() >= 1) priceSampled = await samplePrice(db, nowS, f, probe?.price_ts ?? null);
    const factory = lockFactoryOf(env);
    if (factory && !heldBack && (probe?.lock_checked ?? 0) <= nowS - LOCK_WATCH_S && room() >= 1 + LOCK_CLOSE_STATEMENTS) {
      const claimed = (await db.prepare(SQL.lockClaim).bind(nowS, nowS - LOCK_WATCH_S).run()).meta.changes === 1;
      if (claimed) lock = await lockWatch(db, factory, nowS, f, probe?.lock_block ?? null, room, lockUsdText(lockUsdOf(env) ?? PILOT_LOCK_USD_DEFAULT));
    }
  } catch (e) {
    console.error(`pilot ingest (${d.market}): REGI chores failed: ${String((e as Error)?.message ?? e)}`);
  }
  return { priceSampled, lockWatch: lock };
}

/**
 * R4 (with review 2026-10-13 B1, S1, S2): the withdrawal watch.
 * 1. The factory's Withdrawn logs from the block after `cursor` (a new watch starts one chunk back) up to
 *    head − LOCK_CONFIRM_BLOCKS, so a load-balanced RPC node a few blocks behind still has them, in chunks of at most
 *    LOG_CHUNK blocks. Each chunk's owners go into lock_due and the cursor moves past it in the same batch: logs are
 *    read once, and a market that can't settle now never holds the cursor.
 * 2. Every owner due a re-check (lock_due), with lockedOf read at the cursor block (pinned: a node that lacks the block
 *    errors rather than answering an old balance): its pending leveraged opens whose requirement is above the remaining
 *    lock are refused first (so none fills after the check), then its open positions whose lock_req is above it are
 *    closed at their market's mark. The owner leaves lock_due once nothing is left to do; otherwise it is looked at
 *    again next run. Closes and refusals are guarded, so two watches at once settle each position at most once.
 * refusal: the pending orders' refusal text ("Lock at least $50 of REGI to trade with leverage.").
 */
export async function lockWatch(
  db: D1Database, factory: string, nowS: number, f: typeof fetch, cursor: number | null, room: () => number, refusal = lockUsdText(PILOT_LOCK_USD_DEFAULT),
): Promise<LockWatchResult> {
  const out: LockWatchResult = { cursor, pinned: null, owners: 0, closed: 0, refused: 0, due: 0, done: false };
  let safe: number | null = null;
  try {
    safe = (await blockNumber(f)) - LOCK_CONFIRM_BLOCKS;
  } catch (e) {
    console.warn("lock watch: no head block", String(e)); // only the owners already due, at the cursor
  }
  let from = safe === null ? Infinity : cursor === null ? Math.max(0, safe - LOG_CHUNK + 1) : cursor + 1;
  for (let i = 0; safe !== null && i < LOCK_MAX_CHUNKS && from <= safe; i++) {
    const to = Math.min(safe, from + LOG_CHUNK - 1);
    let logs: { owner: string; block: number }[];
    try {
      logs = await withdrawnLogs(factory, from, to, f);
    } catch (e) {
      console.warn("lock watch: Withdrawn logs unreadable", from, to, String(e));
      break;
    }
    if (room() < logs.length + 1) {
      console.warn("lock watch: no statement room for the cursor", room(), logs.length);
      break;
    }
    if (logs.length) await db.batch([...logs.map((l) => db.prepare(SQL.lockDue).bind(l.owner, l.block, l.block)), db.prepare(SQL.lockAdvance).bind(to)]);
    else await db.prepare(SQL.lockAdvance).bind(to).run();
    out.cursor = to;
    from = to + 1;
  }
  const caughtUp = safe !== null && from > safe;
  if (out.cursor === null || room() < 2) return out;
  const pinned = out.pinned = out.cursor;
  // random order: owners held back by a market that can't settle now can't starve the rest of the list (review R2)
  const due = (await db.prepare("SELECT owner FROM lock_due ORDER BY random() LIMIT ?").bind(LOCK_DUE_PER_RUN).all<{ owner: string }>()).results;
  for (const { owner } of due) {
    if (room() < 3) break;
    let r: { closed: number; refused: number; done: boolean };
    try {
      r = await settleOwner(db, factory, owner, pinned, nowS, f, room, refusal);
    } catch (e) {
      // one owner's failure (a batch that threw) leaves that owner due; the others go on
      console.error(`pilot lock watch: ${owner} failed: ${String((e as Error)?.message ?? e)}`);
      r = { closed: 0, refused: 0, done: false };
    }
    out.owners++;
    out.closed += r.closed;
    out.refused += r.refused;
    if (r.done) await db.prepare(SQL.lockDone).bind(owner, pinned).run();
  }
  out.due = (await db.prepare("SELECT COUNT(*) AS n FROM lock_due").first<{ n: number }>())?.n ?? 0;
  out.done = caughtUp && out.due === 0;
  return out;
}

/**
 * One owner due a re-check, at `block`: lockedOf read there; the owner's pending leveraged opens above it refused
 * (review B1: an order placed before the withdrawal must not fill after it); then every open position whose lock_req
 * is above it closed at its market's mark (the normal close settlement, close note "lock withdrawn"; never a
 * liquidation). A position the market's unswept bars liquidate is left to that. A price move alone never closes
 * anything: lock_req is fixed at open. done = false: something waits for the next run (a market whose mark is not
 * settleable now; the other markets go on), an RPC failure, the statement budget.
 */
async function settleOwner(
  db: D1Database, factory: string, owner: string, block: number, nowS: number, f: typeof fetch, room: () => number, refusal: string,
): Promise<{ closed: number; refused: number; done: boolean }> {
  let locked: bigint;
  try {
    locked = await lockedOf(factory, owner, f, block);
  } catch {
    return { closed: 0, refused: 0, done: false };
  }
  const l = lockReqString(locked);
  const refused = (await db.prepare(SQL.lockRefuse).bind(refusal, owner, l, l, l).run()).meta.changes;
  const rows = (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NULL AND lock_req <> '0' ORDER BY id`).bind(owner).all<PositionRow>()).results;
  let closed = 0, done = true;
  for (const r of rows) {
    if (!(BigInt(r.lock_req) > locked)) continue;
    if (room() < LOCK_CLOSE_STATEMENTS) return { closed, refused, done: false };
    const m = await loadMark(db, r.market);
    // the same readiness a close order needs: a live mark, the hour's rates fixed, bars caught up, no gap, no base pause
    if (!m || (await markProblem(db, m, nowS)) !== null) { done = false; continue; }
    if ((await lazyLiquidate(db, owner, nowS, m, [r])) > 0) continue;
    const row = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ?`).bind(r.id).first<PositionRow>();
    if (!row || row.closed_at !== null) continue;
    const res = await db.batch(lockCloseStmts(db, row, { mark: m.px, ts: m.ts }, await loadRates(db, row.market, row.opened_at), locked));
    if (res[0].meta.changes === 1) closed++;
    else {
      // nothing settled: closed meanwhile (another watch), or its booking moved (an hourly close): again next run
      const now = await db.prepare("SELECT closed_at FROM positions WHERE id = ?").bind(r.id).first<{ closed_at: number | null }>();
      if (now && now.closed_at === null) done = false;
    }
  }
  return { closed, refused, done };
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
 * Ready to queue an order: a live producer (mark ≤ markMaxAgeS old, σ known, the hour's rates fixed, bars stored up
 * to the minute before the mark's, no open gap) and not in the base-sample pause.
 */
async function markProblem(db: D1Database, m: MarkRow | null, nowS: number): Promise<Response | null> {
  const v = markView(m, nowS, RULES.levels[RULES.levels.length - 1]);
  if (!m || !v || !v.fresh) return errorJson(503, PRICE_UPDATING);
  if (m.bars_minute === null || m.bars_minute < Math.floor(m.ts / 60) * 60 - 60 || (await openGaps(db, m.market)) > 0) return errorJson(503, PRICE_UPDATING);
  if (v.basePaused) return errorJson(409, TRADING_PAUSED);
  return null;
}

async function insertOrder(db: D1Database, wallet: string, market: Market, kind: "open" | "close", f: { side?: Side; margin?: number; lev?: number; positionId?: number; lockReq?: string }, nowMs: number): Promise<OrderRow> {
  const r = await db
    .prepare(`INSERT INTO orders (wallet, market, kind, side, margin, lev, position_id, arrived_ms, lock_req) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${ORDER_COLS}`)
    .bind(wallet, market, kind, f.side ?? null, f.margin ?? null, f.lev ?? null, f.positionId ?? null, nowMs, f.lockReq ?? "0")
    .first<OrderRow>();
  return r!;
}

/** The signed-in wallet's account and open positions (one query; the session epoch is checked from the same row). */
async function signedIn(req: Request, env: Env, db: D1Database, nowS: number): Promise<{ wallet: string; acct: AccountRow; open: PositionRow[] } | null> {
  const s = await sessionOf(req, env, nowS);
  if (!s) return null;
  const got = await accountWithOpen(db, s.wallet);
  if (!got || got.acct.session_epoch !== s.epoch) return null;
  return { wallet: s.wallet, ...got };
}

/** Open positions in any market, each at its own market's mark and rates. */
const openViews = (rows: readonly PositionRow[], marks: Marks, rates: ReadonlyMap<Market, readonly StoredRate[]>, nowS: number) =>
  rows.map((r) => openView(r, marks.get(r.market)?.px ?? null, rates.get(r.market) ?? [], nowS));

/**
 * GET /api/pilot/account?market=, polled every 15 s while the page is visible. D1 per poll: the account + open
 * positions in every market (one query), every market's mark row (one query, with each hour's rates and last split
 * week), the wallet's pending orders (index on wallet, status), the rates the open positions need (one query); no bars
 * (see lazyLiquidate), no rates list (GET /api/pilot/funding, edge-cached). The mark and funding are the page
 * market's (R6); positions are valued each at its own market's mark.
 */
export async function handleAccount(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const market = queryMarket(req);
  if (!market) return errorJson(400, BAD_MARKET);
  const nowS = nowSOf(deps);
  const [me, marks] = await Promise.all([signedIn(req, env, db, nowS), loadMarks(db)]);
  const m = marks.get(market) ?? null;
  // audit SS-2: a visitor without a session reads only (no split, no account row, no REGI call)
  if (me) await splitsDue(db, marks, nowS);
  const state = pilotState(env, m ? m.head : null);
  // R2, R3, R6: the dollar amounts, the 24 h median price and what they are in REGI now (null while the price is unknown)
  const price = await regiPrice(db, nowS);
  const admitUsd = admitUsdOf(env) ?? PILOT_ADMIT_USD_DEFAULT, lockUsd = lockUsdOf(env) ?? PILOT_LOCK_USD_DEFAULT;
  const admit = regiAt(admitUsd, price), lockNeed = regiAt(lockUsd, price);
  const base: PilotAccountView = {
    market, open: state === "open", misconfigured: state === "misconfigured", admitUsd, lockUsd, price,
    admitRegi: admit === null ? null : lockReqString(admit), lockRegi: lockNeed === null ? null : lockReqString(lockNeed), lockFactory: lockFactoryOf(env) ?? null,
    regiSnapshot: snapshotBlock(env) !== null,
    address: null, regi: null, account: null, positions: [], pending: [], mark: markView(m, nowS, pilotMaxLev(env)), funding: fundingNow(m, nowS),
  };
  if (!me) return json(base);
  // the last known REGI state (cached ≤ 10 min); an order re-reads it. misconfigured: no REGI read (a future block only
  // fails, a pre-REGI one reads 0 for everyone)
  const regi = state === "misconfigured" ? null : await regiStatus(db, me.acct, env, nowS, deps, { min: admit });
  let open = me.open, balance = me.acct.balance;
  if ((await lazyLiquidateAll(db, me.wallet, nowS, marks, open)) > 0) {
    const again = (await accountWithOpen(db, me.wallet))!;
    open = again.open;
    balance = again.acct.balance;
  }
  const [rates, pending] = await Promise.all([
    ratesOf(db, open),
    db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE wallet = ? AND status = 'pending' ORDER BY id DESC LIMIT 10`).bind(me.wallet).all<OrderRow>(),
  ]);
  return json({
    ...base,
    address: me.wallet,
    regi,
    account: { balance, equity: equityOf(balance, open, marks, rates, nowS), season: me.acct.season },
    positions: openViews(open, marks, rates, nowS),
    pending: pending.results.map(orderView),
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
    if (r) position = r.closed_at === null ? openView(r, o.fill_px, await loadRates(db, r.market, r.opened_at), Math.floor(nowMs / 1000)) : closedView(r);
  }
  return json({ order: orderView(o), position });
}

/**
 * The wallet's orders still waiting for a mark (not yet expired), in every market (R2: the pending cap is per wallet
 * across markets), and its queued opens in `market` (index orders_wallet).
 */
async function pendingOf(db: D1Database, wallet: string, market: Market | null, nowMs: number): Promise<{ all: number; opens: number }> {
  const rows = (await db.prepare("SELECT kind, market FROM orders WHERE wallet = ? AND status = 'pending' AND arrived_ms > ?").bind(wallet, nowMs - ORDER_EXPIRY_MS).all<{ kind: string; market: Market }>()).results;
  return { all: rows.length, opens: rows.filter((r) => r.kind === "open" && r.market === market).length };
}

export async function handleOrder(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  const method = req.method.toUpperCase();
  const db = env.PILOT_DB;
  if (method === "GET") return db ? orderStatus(req, env, db, deps) : unconfigured();
  if (method !== "POST") return errorJson(405, "method not allowed");
  if (pilotState(env, null) === "closed") return errorJson(403, PILOT_CLOSED);
  if (!db) return unconfigured();
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const nowMs = nowMsOf(deps), nowS = Math.floor(nowMs / 1000);
  const me = await signedIn(req, env, db, nowS);
  if (!me) return errorJson(401, "sign in first");
  const wallet = me.wallet;
  if (!(await rateOk(db, `order:${wallet}`, PILOT_LIMITS.ordersPerMin, nowS))) return tooMany();
  const b = await readBody(req);
  if (!b) return errorJson(400, "body must be a JSON object");
  const { side, margin, lev } = b;
  const market = marketOf(b.market);
  if (!market) return errorJson(400, BAD_MARKET);
  if (side !== "long" && side !== "short") return errorJson(400, "side must be long or short");
  if (!finite(margin) || margin > 1e12) return errorJson(400, "margin must be a number");
  if (!finite(lev)) return errorJson(400, "lev must be a number");

  // R3: every check is on the order's market (its mark, σ, pauses); the balance is the wallet's one balance
  const m = await loadMark(db, market);
  // audit PE-7: a wrong snapshot block (or minimum, or cap) refuses every order, before any REGI read
  if (pilotState(env, m ? m.head : null) !== "open") return errorJson(503, PILOT_MISCONFIGURED);
  if (blockedWallet(env, wallet)) return errorJson(403, BLOCKED_WALLET);
  if (lev > pilotMaxLev(env)) return errorJson(400, LEV_ABOVE_CAP);
  const pending = await pendingOf(db, wallet, market, nowMs);
  if (pending.all >= PILOT_LIMITS.pendingPerWallet) return errorJson(409, TOO_MANY_PENDING);
  // R2 (owner decisions 2026-10-13): PILOT_ADMIT_USD of REGI at the 24 h median price, on the balance read fresh from
  // the RPC (no cache); an unknown price or an RPC failure refuses the order (fail closed)
  const price = await regiPrice(db, nowS);
  if (price === null) return errorJson(503, REGI_PRICE_UPDATING);
  const regi = await regiStatus(db, me.acct, env, nowS, deps, { forceNow: true, min: regiAt(admitUsdOf(env) ?? PILOT_ADMIT_USD_DEFAULT, price) });
  if (regi.ok === null) return errorJson(503, REGI_UNCHECKED);
  if (!regi.ok) return errorJson(403, regi.snapshot === false ? NOT_AT_SNAPSHOT : holdRegi(env));
  // R3: above 1×, PILOT_LOCK_USD of REGI locked in the wallet's vault, lockedOf read fresh (fail closed). The
  // requirement is stored with the order and kept by the position (lock_req): withdrawing below it closes the position
  let lockReq = "0";
  if (lev > 1) {
    const factory = lockFactoryOf(env);
    if (!factory) return errorJson(403, LOCK_NOT_LIVE);
    const usd = lockUsdOf(env) ?? PILOT_LOCK_USD_DEFAULT;
    const need = regiAt(usd, price)!;
    let locked: bigint;
    try {
      locked = await lockedOf(factory, wallet, deps.fetch ?? fetch);
    } catch {
      return errorJson(503, LOCK_UNCHECKED);
    }
    if (locked < need) return errorJson(403, lockUsdText(usd));
    lockReq = lockReqString(need);
  }
  let { open: all, acct } = me;
  if ((await lazyLiquidate(db, wallet, nowS, m, all)) > 0) ({ open: all, acct } = (await accountWithOpen(db, wallet))!);
  const problem = await markProblem(db, m, nowS);
  if (problem) return problem;
  if (milestonePaused(m!)) return errorJson(409, MILESTONE_PAUSED); // new orders only: closes go on
  // the same checks the fill makes, at the market's current mark: refuse now what would be refused at the fill (queued
  // opens in this market count as open: audit SS-5; one direction and RULES.maxOpen per market: R2)
  const rows = all.filter((r) => r.market === market);
  const pre = Engine.open({ balance: acct.balance, open: rows.length + pending.opens, side: rows[0]?.side ?? null }, { side, margin, lev, mark: m!.px, now: m!.ts, risk: riskOf(m!) });
  if (!pre.ok) return errorJson(["insufficient balance", "too many open positions", HEDGE].includes(pre.error) ? 409 : 400, engineError(pre.error, rows));
  const o = await insertOrder(db, wallet, market, "open", { side, margin, lev, lockReq }, nowMs);
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
  if ((await pendingOf(db, wallet, null, nowMs)).all >= PILOT_LIMITS.pendingPerWallet) return errorJson(409, TOO_MANY_PENDING);

  // the close is an order in the position's market: that market's mark, bars and liquidation sweep decide
  const get = () => db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ? AND wallet = ?`).bind(id, wallet).first<PositionRow>();
  let row = await get();
  if (!row) return errorJson(404, "no such position");
  const m = await loadMark(db, row.market);
  if (row.closed_at === null && (await lazyLiquidate(db, wallet, nowS, m)) > 0) row = (await get())!;
  if (row.closed_at !== null) return errorJson(409, ALREADY_CLOSED, { position: closedView(row) });
  const problem = await markProblem(db, m, nowS);
  if (problem) return problem;
  const o = await insertOrder(db, wallet, row.market, "close", { positionId: id }, nowMs);
  return json({ order: orderView(o) }, 202);
}

export async function handlePositions(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const market = queryMarket(req);
  if (!market) return errorJson(400, BAD_MARKET);
  const nowS = nowSOf(deps);
  const [me, marks] = await Promise.all([signedIn(req, env, db, nowS), loadMarks(db)]);
  if (!me) return errorJson(401, "sign in first");
  await splitsDue(db, marks, nowS);
  let open = me.open;
  if ((await lazyLiquidateAll(db, me.wallet, nowS, marks, open)) > 0) open = (await accountWithOpen(db, me.wallet))!.open;
  const rates = await ratesOf(db, open);
  const m = marks.get(market) ?? null;
  return json({ market, positions: openViews(open, marks, rates, nowS), mark: markView(m, nowS, pilotMaxLev(env)), funding: fundingNow(m, nowS) });
}

/** The caller's last 100 closed positions: index positions_wallet (wallet, closed_at, id), read backwards, no sort. */
export const HISTORY_SQL = `SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC, id DESC LIMIT ?`;

export async function handleHistory(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  const marks = await loadMarks(db);
  await splitsDue(db, marks, nowS);
  await lazyLiquidateAll(db, wallet, nowS, marks);
  const rows = (await db.prepare(HISTORY_SQL).bind(wallet, PILOT_LIMITS.history).all<PositionRow>()).results;
  return json({ history: rows.map(closedView) });
}

/** A leaderboard build's RPC wave checks at least this many stale wallets (fewer, slower waves otherwise). */
const LEADERBOARD_WAVE_MIN = 10;

interface Ranked {
  wallet: string;
  equity: number;
  regi_ok: number;
  regi_checked: number;
}

/**
 * The first `want` of `ranked` (in its order) that hold the admission amount (PILOT_ADMIT_USD at today's median) now (owner decision 2026-10-12: one REGI stash
 * rotated between wallets shows up once). A check ≤ REGI_CACHE_S old is reused; older ones are re-read from the RPC in
 * parallel waves, each about as large as the free places (at most PILOT_LIMITS.leaderboardRegiChecks calls per build),
 * and their regi_ok / regi_checked written back. A wallet whose read fails, or that would need a read past the cap,
 * is left out (fail closed). The snapshot block is not consulted (a wallet without it could never have opened).
 */
export async function regiHolders(db: D1Database, env: Env, nowS: number, deps: PilotDeps, ranked: readonly Ranked[], want: number): Promise<Ranked[]> {
  const f = deps.fetch ?? fetch;
  // R2: the admission amount at today's median; while the price is unknown only checks ≤ REGI_CACHE_S old count
  const min = await admitMin(db, env, nowS);
  let budget = PILOT_LIMITS.leaderboardRegiChecks;
  const out: Ranked[] = [];
  const fresh: { wallet: string; ok: boolean }[] = [];
  let i = 0;
  while (out.length < want && i < ranked.length) {
    // the next wave, in rank order: enough wallets to fill the free places if every one passes
    const target = Math.max(want - out.length, LEADERBOARD_WAVE_MIN);
    const wave: { row: Ranked; read: boolean }[] = [];
    let maybe = 0, reads = 0;
    while (i < ranked.length && maybe < target) {
      const row = ranked[i++];
      if (row.regi_checked > 0 && nowS - row.regi_checked <= REGI_CACHE_S) {
        if (row.regi_ok === 1) { wave.push({ row, read: false }); maybe++; }
      } else if (min !== null && reads < budget) {
        wave.push({ row, read: true });
        reads++;
        maybe++;
      } // stale and over the cap: left out of this build
    }
    budget -= reads;
    const held = await Promise.all(wave.map(async ({ row, read }) => {
      if (!read) return true;
      try {
        const ok = (await regiBalance(row.wallet, f)) >= min!;
        fresh.push({ wallet: row.wallet, ok });
        return ok;
      } catch {
        return false; // RPC failure: left out (fail closed)
      }
    }));
    wave.forEach(({ row }, k) => { if (held[k]) out.push(row); });
  }
  if (fresh.length) {
    await db.batch(fresh.map((x) => db.prepare("UPDATE accounts SET regi_ok = ?, regi_checked = ? WHERE wallet = ?").bind(x.ok ? 1 : 0, nowS, x.wallet)));
  }
  return out.slice(0, want);
}

/**
 * Top 50 by equity (R6: one board; the one balance plus every open position at its own market's latest mark, funding
 * and borrow included; accounts that have opened at least one position), among the wallets that hold the REGI
 * minimum now (regiHolders). ts: the newest market mark.
 */
export async function leaderboard(db: D1Database, env: Env, nowS: number, deps: PilotDeps = {}): Promise<{ ts: number | null; rows: LeaderboardRow[] }> {
  const marks = await loadMarks(db);
  if (!marks.size) return { ts: null, rows: [] };
  await splitsDue(db, marks, nowS);
  const accts = (
    await db
      .prepare("SELECT wallet, balance, regi_ok, regi_checked FROM accounts a WHERE EXISTS (SELECT 1 FROM positions p WHERE p.wallet = a.wallet)")
      .all<{ wallet: string; balance: number; regi_ok: number; regi_checked: number }>()
  ).results;
  const open = (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE closed_at IS NULL ORDER BY id`).all<PositionRow>()).results;
  const rates = await ratesOf(db, open);
  const by = new Map<string, PositionRow[]>();
  for (const r of open) by.set(r.wallet, [...(by.get(r.wallet) ?? []), r]);
  const ranked = accts
    // a position whose market has no mark yet can't exist (it opened at one); count its margin if it ever does
    .map((a) => ({ wallet: a.wallet, equity: equityOf(a.balance, by.get(a.wallet) ?? [], marks, rates, nowS) ?? a.balance + (by.get(a.wallet) ?? []).reduce((x, r) => x + r.margin, 0), regi_ok: a.regi_ok, regi_checked: a.regi_checked }))
    .sort((x, y) => y.equity - x.equity || (x.wallet < y.wallet ? -1 : 1));
  const top = await regiHolders(db, env, nowS, deps, ranked, PILOT_LIMITS.leaderboard);
  return { ts: Math.max(...[...marks.values()].map((m) => m.ts)), rows: top.map((s, i) => ({ rank: i + 1, address: shortWallet(s.wallet), equity: s.equity })) };
}

/** Public, edge-cached 60 s: the D1 query runs about once a minute per edge location. */
export async function handleLeaderboard(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  return edgeCachedGet(req, deps, async () => json(await leaderboard(db, env, nowSOf(deps), deps)), PILOT_LIMITS.leaderboardCacheS);
}
