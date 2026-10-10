/**
 * ABI points pilot API (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md; plan rulings R1–R8).
 * Points only: no deposits, no withdrawals, no transfers. D1 binding PILOT_DB (migrations/0001_pilot.sql).
 *
 *   POST /api/index/mark          producer (Bearer ABI_PUSH_TOKEN): latest mark + minute bars, one batch()
 *   GET  /api/index/mark          public: the latest mark (edge-cached 5 s)
 *   GET  /api/pilot/account       session optional: kill switch, REGI, balance, open positions, mark
 *   POST /api/pilot/order         { side, margin, lev }  session + REGI + PILOT_OPEN; 30/min per wallet
 *   POST /api/pilot/close         { id }                 session; 60/min per wallet
 *   GET  /api/pilot/positions     session: open positions
 *   GET  /api/pilot/history       session: the last 100 closed positions
 *   GET  /api/pilot/leaderboard   public: top 50 by equity at the latest mark, shortened addresses, cached 30 s
 *
 * Every balance / position write is one conditional statement or one batch() (a D1 transaction):
 *   open:  UPDATE accounts … WHERE balance >= cost AND open count < max; INSERT … WHERE changes() = 1
 *   close: UPDATE positions … WHERE id AND closed_at IS NULL;  UPDATE accounts … WHERE changes() = 1
 * so concurrent requests can neither overspend nor settle a position twice.
 *
 * Liquidation: a mark post closes, in the same batch, every open position whose liquidation price
 * the posted (merged) minute bars cross; and before any account read or write the wallet's open
 * positions are checked lazily against every stored bar since they opened (the engine's
 * liquidation()). Both settle at the liquidation price with nothing returned, guarded by
 * closed_at IS NULL.
 */
import * as Engine from "../../src/lib/abi-pilot";
import { RULES, type MinuteBar, type PilotPosition, type Side } from "../../src/lib/abi-pilot";
import {
  PILOT_LIMITS,
  shortWallet,
  type ClosedPositionView,
  type LeaderboardRow,
  type OpenPositionView,
  type PilotAccountView,
  type PilotMark,
} from "../../src/lib/abi-pilot-api";
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
  pilotWallet,
  rateOk,
  regiStatus,
  tooMany,
  type PilotDeps,
} from "./pilot-auth";

export const MARK_MAX_SKEW_S = 30;
export const MARK_BODY_BYTES = 4096;
export const BARS_KEEP_S = 7 * 24 * 3600;
/** A posted bar may be at most this old (the producer sends the open hour's last 3 minutes). */
export const BAR_MAX_AGE_S = 2 * 3600;
export const MARK_CACHE_S = 5;
export const PRUNE_EVERY = 100;

export const HOLD_REGI = "Hold REGI to join the points pilot.";
export const PRICE_UPDATING = "price updating";
export const PILOT_CLOSED = "pilot closed";

const isOpen = (env: Env) => (env.PILOT_OPEN ?? "").trim() === "1";
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
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
}

/** R4: the producer's body (live/mark.py), checked against the server clock. */
export function validateMark(raw: unknown, nowS: number): { ok: true; data: MarkPost } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("expected a JSON object");
  const b = raw as Record<string, unknown>;
  if (!finite(b.mark) || !(b.mark > 0)) return bad("mark must be a finite number > 0");
  if (!finite(b.ts) || !Number.isInteger(b.ts)) return bad("ts must be unix seconds");
  if (Math.abs(nowS - b.ts) > MARK_MAX_SKEW_S) return bad(`ts must be within ${MARK_MAX_SKEW_S} s of server time`);
  if (!finite(b.ch24) || !finite(b.ch1)) return bad("ch24 and ch1 must be finite numbers");
  if (!finite(b.head) || !Number.isInteger(b.head) || b.head < 0) return bad("head must be a block number");
  if (!finite(b.hour_start) || !Number.isInteger(b.hour_start) || b.hour_start % 3600 !== 0 || b.hour_start > b.ts) return bad("hour_start must be an hour start ≤ ts");
  if (!Array.isArray(b.candle) || b.candle.length !== 6 || !b.candle.every(finite)) return bad("candle must be [o, h, l, c, payments, usdc]");
  if (!Array.isArray(b.bars) || b.bars.length < 1 || b.bars.length > 3) return bad("bars must have 1 to 3 items");
  const bars: MarkPost["bars"] = [];
  let prev = -Infinity;
  for (const x of b.bars) {
    if (!Array.isArray(x) || x.length !== 4 || !x.every(finite)) return bad("each bar is [minute_unix, h, l, c]");
    const [m, h, l, c] = x as number[];
    if (!Number.isInteger(m) || m % 60 !== 0) return bad("bar minute must be a minute start");
    if (m > b.ts) return bad("bar minute is later than ts");
    if (m < b.ts - BAR_MAX_AGE_S) return bad("bar minute is too old");
    if (m <= prev) return bad("bars must be in ascending minute order");
    if (!(l > 0 && h > 0 && c > 0)) return bad("bar prices must be > 0");
    if (!(l <= c && c <= h)) return bad("bar must have l ≤ c ≤ h");
    prev = m;
    bars.push([m, h, l, c]);
  }
  return {
    ok: true,
    data: { mark: b.mark, ts: b.ts, head: b.head, hour_start: b.hour_start, candle: b.candle as number[], ch24: b.ch24, ch1: b.ch1, bars },
  };
}

interface MarkRow {
  mark: number;
  ts: number;
  head: number;
  hour_start: number;
  ch24: number;
  ch1: number;
  candle: string;
}

async function loadMark(db: D1Database): Promise<MarkRow | null> {
  return db.prepare("SELECT mark, ts, head, hour_start, ch24, ch1, candle FROM mark WHERE id = 1").first<MarkRow>();
}

export function markView(m: MarkRow | null, nowS: number): PilotMark | null {
  if (!m) return null;
  const cap = Engine.maxLeverage({ ch24: m.ch24, ch1: m.ch1 });
  const age = nowS - m.ts;
  return { mark: m.mark, ts: m.ts, age, ch24: m.ch24, ch1: m.ch1, maxLev: cap.max, paused: cap.paused, fresh: age <= RULES.markMaxAgeS };
}

/** Liquidates (nothing returned) every open position the stored bar of minute ?1 crosses. Mirrors Engine.liquidation + Engine.pnl. */
const SWEEP_SQL =
  "UPDATE positions SET closed_at = ?1, exit = liq, " +
  "pnl = notional * (CASE side WHEN 'long' THEN (liq / entry - 1) ELSE -(liq / entry - 1) END), returned = 0, reason = 'liquidation' " +
  "WHERE closed_at IS NULL AND opened_at <= ?1 AND (" +
  "(side = 'long' AND liq >= (SELECT l FROM bars WHERE minute = ?1)) OR (side = 'short' AND liq <= (SELECT h FROM bars WHERE minute = ?1)))";

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
  const nowS = nowSOf(deps);
  const v = validateMark(body, nowS);
  if (!v.ok) return errorJson(400, v.error);
  const d = v.data;
  const prev = await db.prepare("SELECT ts FROM mark WHERE id = 1").first<{ ts: number }>();
  if (prev && d.ts <= prev.ts) return errorJson(409, "ts is not newer than the stored mark", { stored: prev.ts });

  const post = randomHex(16);
  const stmts: D1PreparedStatement[] = [
    // monotonic even under a race: the row only moves forward, and only the winning post's bars are written
    db
      .prepare(
        "INSERT INTO mark (id, mark, ts, head, hour_start, ch24, ch1, candle, post) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (id) DO UPDATE SET mark = excluded.mark, ts = excluded.ts, head = excluded.head, hour_start = excluded.hour_start, " +
          "ch24 = excluded.ch24, ch1 = excluded.ch1, candle = excluded.candle, post = excluded.post WHERE excluded.ts > mark.ts",
      )
      .bind(d.mark, d.ts, d.head, d.hour_start, d.ch24, d.ch1, JSON.stringify(d.candle), post),
  ];
  for (const [m, h, l, c] of d.bars) {
    // Merge with what is stored (a producer restart mid-minute cannot narrow a bar); only when this post's mark won.
    stmts.push(
      db
        .prepare(
          "INSERT INTO bars (minute, h, l, c) SELECT ?, ?, ?, ? WHERE (SELECT post FROM mark WHERE id = 1) = ? " +
            "ON CONFLICT (minute) DO UPDATE SET h = max(bars.h, excluded.h), l = min(bars.l, excluded.l), c = excluded.c",
        )
        .bind(m, h, l, c, post),
    );
  }
  for (const [m] of d.bars) stmts.push(db.prepare(SWEEP_SQL).bind(m));
  const random = deps.random ?? Math.random;
  const pruned = random() < 1 / PRUNE_EVERY;
  if (pruned) {
    stmts.push(db.prepare("DELETE FROM bars WHERE minute < ?").bind(nowS - BARS_KEEP_S));
    stmts.push(db.prepare("DELETE FROM used_nonces WHERE exp < ?").bind(nowS));
    stmts.push(db.prepare("DELETE FROM rate WHERE slot < ?").bind(Math.floor(nowS / 60) - 1));
  }
  const res = await db.batch(stmts);
  if (res[0].meta.changes !== 1) return errorJson(409, "ts is not newer than the stored mark");
  const liquidated = res.slice(1 + d.bars.length, 1 + 2 * d.bars.length).reduce((n, r) => n + r.meta.changes, 0);
  return json({ ok: true, ts: d.ts, bars: d.bars.length, liquidated, pruned });
}

export async function handlePublicMark(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  return edgeCachedGet(req, deps, async () => {
    const m = markView(await loadMark(db), nowSOf(deps));
    return m ? json(m) : errorJson(404, "no data");
  }, MARK_CACHE_S);
}

// ───────────────────────────── positions ─────────────────────────────

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
  fee: number;
  returned: number | null;
  reason: "close" | "liquidation" | null;
}

const POS_COLS = "id, wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, exit, pnl, fee, returned, reason";

const toEngine = (r: PositionRow): PilotPosition => ({
  side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, liq: r.liq, openedAt: r.opened_at,
});

async function openRows(db: D1Database, wallet: string): Promise<PositionRow[]> {
  return (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NULL ORDER BY id`).bind(wallet).all<PositionRow>()).results;
}

/** The engine's liquidation() over the stored bars since the position opened (only bars crossing its price are read: indexed). */
export async function liquidationHit(db: D1Database, r: PositionRow): Promise<{ t: number; price: number } | null> {
  const sql = r.side === "long"
    ? "SELECT minute AS t, h, l, c FROM bars INDEXED BY bars_l WHERE l <= ? AND minute >= ? ORDER BY minute LIMIT 1"
    : "SELECT minute AS t, h, l, c FROM bars INDEXED BY bars_h WHERE h >= ? AND minute >= ? ORDER BY minute LIMIT 1";
  const bars = (await db.prepare(sql).bind(r.liq, r.opened_at).all<MinuteBar>()).results;
  return Engine.liquidation(toEngine(r), bars);
}

/** R5: settles the wallet's liquidated positions (idempotent). Returns how many this call settled. */
export async function lazyLiquidate(db: D1Database, wallet: string): Promise<number> {
  let n = 0;
  for (const r of await openRows(db, wallet)) {
    const hit = await liquidationHit(db, r);
    if (!hit) continue;
    const res = await db
      .prepare("UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, returned = 0, reason = 'liquidation' WHERE id = ? AND closed_at IS NULL")
      .bind(hit.t, hit.price, Engine.pnl(toEngine(r), hit.price), r.id)
      .run();
    n += res.meta.changes;
  }
  return n;
}

function openView(r: PositionRow, mark: number | null): OpenPositionView {
  return {
    id: r.id, side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, liq: r.liq, openedAt: r.opened_at, fee: r.fee,
    pnl: mark === null ? null : Engine.pnl(toEngine(r), mark),
  };
}

function closedView(r: PositionRow): ClosedPositionView {
  const returned = r.returned ?? 0;
  return {
    id: r.id, side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, liq: r.liq, openedAt: r.opened_at,
    closedAt: r.closed_at!, exit: r.exit!, pnl: r.pnl!, fee: r.fee, returned, net: returned - r.margin - r.notional * RULES.feeRate,
    reason: r.reason === "liquidation" ? "liquidation" : "close",
  };
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

export async function handleAccount(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  const base: PilotAccountView = { open: isOpen(env), address: null, regi: null, account: null, positions: [], mark: null };
  if (!wallet) return json({ ...base, mark: markView(await loadMark(db), nowS) });
  const acct = await ensureAccount(db, wallet, nowS);
  const regi = await regiStatus(db, acct, nowS, deps);
  await lazyLiquidate(db, wallet);
  const [m, rows, fresh] = await Promise.all([loadMark(db), openRows(db, wallet), getAccount(db, wallet)]);
  const mark = markView(m, nowS);
  const px = mark ? mark.mark : null;
  const balance = fresh!.balance;
  const view: PilotAccountView = {
    ...base,
    address: wallet,
    regi: regi ?? acct.regi_ok === 1,
    account: { balance, equity: px === null ? null : Engine.equity(balance, rows.map(toEngine), px), season: fresh!.season },
    positions: rows.map((r) => openView(r, px)),
    mark,
  };
  return json(view);
}

export async function handleOrder(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return errorJson(405, "method not allowed");
  if (!isOpen(env)) return errorJson(403, PILOT_CLOSED);
  const db = env.PILOT_DB;
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
  const regi = await regiStatus(db, acct, nowS, deps);
  if (regi === null) return errorJson(503, "couldn't check the REGI balance; try again");
  if (!regi) return errorJson(403, HOLD_REGI);
  await lazyLiquidate(db, wallet);
  const m = await loadMark(db);
  const mark = markView(m, nowS);
  if (!m || !mark || !mark.fresh) return errorJson(503, PRICE_UPDATING);

  const rows = await openRows(db, wallet);
  const now = (await getAccount(db, wallet))!;
  // opened_at: the next whole second, so the minute bar the order lands in counts only after the open
  const openedAt = Math.ceil(nowMs / 1000);
  const r = Engine.open({ balance: now.balance, open: rows.length }, { side, margin, lev, mark: m.mark, now: openedAt, ch24: m.ch24, ch1: m.ch1 });
  if (!r.ok) return errorJson(r.error === "insufficient balance" || r.error === "too many open positions" ? 409 : 400, r.error);
  const p = r.position, cost = p.margin + r.fee;
  const [debit, ins] = await db.batch<{ id: number }>([
    db
      .prepare(
        "UPDATE accounts SET balance = balance - ? WHERE wallet = ? AND balance >= ? " +
          "AND (SELECT COUNT(*) FROM positions WHERE wallet = ? AND closed_at IS NULL) < ?",
      )
      .bind(cost, wallet, cost, wallet, RULES.maxOpen),
    db
      .prepare(
        "INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee) " +
          "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 RETURNING id",
      )
      .bind(wallet, p.side, p.margin, p.lev, p.notional, p.entry, p.liq, p.openedAt, r.fee),
  ]);
  if (debit.meta.changes !== 1 || !ins.results[0]) {
    // lost a race: say why from the current state
    const again = await getAccount(db, wallet);
    const n = (await openRows(db, wallet)).length;
    return errorJson(409, n >= RULES.maxOpen ? "too many open positions" : again && again.balance < cost ? "insufficient balance" : "try again");
  }
  const id = ins.results[0].id;
  const after = await getAccount(db, wallet);
  return json({ ok: true, position: { ...openView({ ...p, id, wallet, opened_at: p.openedAt, closed_at: null, exit: null, pnl: null, fee: r.fee, returned: null, reason: null }, m.mark) }, balance: after!.balance });
}

export async function handleClose(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  if (!(await rateOk(db, `close:${wallet}`, PILOT_LIMITS.closesPerMin, nowS))) return tooMany();
  const b = await readBody(req);
  const id = b?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return errorJson(400, "id must be a position id");

  await lazyLiquidate(db, wallet);
  const row = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ? AND wallet = ?`).bind(id, wallet).first<PositionRow>();
  if (!row) return errorJson(404, "no such position");
  if (row.closed_at !== null) return errorJson(409, "already closed", { position: closedView(row) });
  const m = await loadMark(db);
  const mark = markView(m, nowS);
  if (!m || !mark || !mark.fresh) return errorJson(503, PRICE_UPDATING);

  const c = Engine.close(toEngine(row), m.mark);
  const closeFee = Math.max(0, c.fee);
  const [settle] = await db.batch([
    db
      .prepare("UPDATE positions SET closed_at = ?, exit = ?, pnl = ?, fee = fee + ?, returned = ?, reason = 'close' WHERE id = ? AND wallet = ? AND closed_at IS NULL")
      .bind(nowS, m.mark, c.pnl, closeFee, c.payout, id, wallet),
    db.prepare("UPDATE accounts SET balance = balance + ? WHERE wallet = ? AND changes() = 1").bind(c.payout, wallet),
  ]);
  const done = await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE id = ?`).bind(id).first<PositionRow>();
  if (settle.meta.changes !== 1) return errorJson(409, "already closed", { position: closedView(done!) });
  const after = await getAccount(db, wallet);
  return json({ ok: true, position: closedView(done!), balance: after!.balance });
}

export async function handlePositions(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  if (!wallet) return errorJson(401, "sign in first");
  await lazyLiquidate(db, wallet);
  const [m, rows] = await Promise.all([loadMark(db), openRows(db, wallet)]);
  return json({ positions: rows.map((r) => openView(r, m ? m.mark : null)), mark: markView(m, nowS) });
}

export async function handleHistory(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  const wallet = await pilotWallet(req, env, nowSOf(deps));
  if (!wallet) return errorJson(401, "sign in first");
  await lazyLiquidate(db, wallet);
  const rows = (
    await db
      .prepare(`SELECT ${POS_COLS} FROM positions WHERE wallet = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC, id DESC LIMIT ?`)
      .bind(wallet, PILOT_LIMITS.history)
      .all<PositionRow>()
  ).results;
  return json({ history: rows.map(closedView) });
}

/** Top 50 by equity at the latest mark (accounts that have opened at least one position). */
export async function leaderboard(db: D1Database): Promise<{ ts: number | null; rows: LeaderboardRow[] }> {
  const m = await loadMark(db);
  if (!m) return { ts: null, rows: [] };
  const accts = (await db.prepare("SELECT wallet, balance FROM accounts a WHERE EXISTS (SELECT 1 FROM positions p WHERE p.wallet = a.wallet)").all<{ wallet: string; balance: number }>()).results;
  const open = (await db.prepare(`SELECT ${POS_COLS} FROM positions WHERE closed_at IS NULL`).all<PositionRow>()).results;
  const by = new Map<string, PilotPosition[]>();
  for (const r of open) by.set(r.wallet, [...(by.get(r.wallet) ?? []), toEngine(r)]);
  const scored = accts
    .map((a) => ({ wallet: a.wallet, equity: Engine.equity(a.balance, by.get(a.wallet) ?? [], m.mark) }))
    .sort((x, y) => y.equity - x.equity || (x.wallet < y.wallet ? -1 : 1))
    .slice(0, PILOT_LIMITS.leaderboard);
  return { ts: m.ts, rows: scored.map((s, i) => ({ rank: i + 1, address: shortWallet(s.wallet), equity: s.equity })) };
}

export async function handleLeaderboard(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const db = env.PILOT_DB;
  if (!db) return unconfigured();
  return edgeCachedGet(req, deps, async () => json(await leaderboard(db)), PILOT_LIMITS.leaderboardCacheS);
}
