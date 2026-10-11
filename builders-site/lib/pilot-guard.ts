/**
 * Proves the points pilot's changes()-guarded batches behave on a D1 database as they do in the tests: run by
 * scripts/d1-guard-check.mjs against the REMOTE database after `wrangler d1 create` + migrate, before the pilot
 * opens. Everything runs on scratch copies of the tables (`_guard_*`, built from the migration with every table
 * and index name prefixed), with the exact statements of lib/pilot-sql.ts, and is dropped afterwards; the real
 * tables are never touched.
 */
import type { D1Database } from "./env";
import { scratch, SQL, TABLES } from "./pilot-sql";

export interface GuardResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** The migration's statements (comments dropped), split on ";". */
export function ddlStatements(migration: string): string[] {
  return migration
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** migrations: the files' contents in order (0001, 0002, …), or one string. */
export async function runGuardChecks(db: D1Database, migrations: string | readonly string[]): Promise<GuardResult[]> {
  const q = (sql: string) => db.prepare(scratch(sql));
  const out: GuardResult[] = [];
  const check = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    out.push({ name, ok, detail: ok ? JSON.stringify(got) : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` });
  };
  const changes = (rs: { meta: { changes: number } }[]) => rs.map((r) => r.meta.changes);
  const drop = async () => { for (const t of TABLES) await db.prepare(scratch(`DROP TABLE IF EXISTS ${t}`)).run(); };

  await drop();
  try {
    for (const m of typeof migrations === "string" ? [migrations] : migrations) for (const s of ddlStatements(m)) await db.prepare(scratch(s)).run();
    const W = "0x00000000000000000000000000000000000000aa";
    await q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, 1500, 1, 0)").bind(W).run();
    const order = async (kind: string, positionId: number | null = null) =>
      (await q("INSERT INTO orders (wallet, kind, side, margin, lev, position_id, arrived_ms) VALUES (?, ?, 'long', 1000, 2, ?, 0) RETURNING id").bind(W, kind, positionId).first<{ id: number }>())!.id;
    const balance = async () => (await q("SELECT balance FROM accounts WHERE wallet = ?").bind(W).first<{ balance: number }>())!.balance;

    // open fill: debit → insert → order filled, each only after the one before changed a row
    const pool = async (kind: string) => (await q("SELECT balance, gross FROM pools WHERE kind = ?").bind(kind).first<{ balance: number; gross: number }>())!;
    const ledgerOf = async (ref: string) => (await q("SELECT kind, amount FROM ledger WHERE ref = ? ORDER BY kind").bind(ref).all()).results;

    // open fill: debit → insert → order filled → open fee to the ledger and the pool, each only after the one before changed a row
    const fill = (orderId: number, side = "long") => db.batch([
      q(SQL.openDebit).bind(1001, W, 1001, W, 5, W, side, orderId),
      q(SQL.openInsert).bind(W, side, 1000, 2, 2000, 1000, 505, 100, 1, 100),
      q(SQL.openFilled).bind(1000, 100, orderId),
      q(SQL.openFeeLedger).bind(100, 1, orderId),
      q(SQL.openFeePool).bind(1, 1),
    ]);
    const o1 = await order("open"), o2 = await order("open");
    const f1 = await fill(o1);
    check("open fill: debit, insert (RETURNING id), order filled, fee ledger row, fee pool", [changes(f1), f1[1].results.length], [[1, 1, 1, 1, 1], 1]);
    check("open fill: the same order again changes nothing", changes(await fill(o1)), [0, 0, 0, 0, 0]);
    await q("UPDATE accounts SET balance = balance + 5000 WHERE wallet = ?").bind(W).run();
    const oShort = await order("open");
    check("open fill: no hedging (a short while a long is open)", changes(await fill(oShort, "short")), [0, 0, 0, 0, 0]);
    await q("UPDATE accounts SET balance = balance - 5000 WHERE wallet = ?").bind(W).run();
    check("open fill: a second order cannot overspend", changes(await fill(o2)), [0, 0, 0, 0, 0]);
    check("open fill: balance debited once", await balance(), 499);
    const pos = (await q("SELECT position_id FROM orders WHERE id = ?").bind(o1).first<{ position_id: number }>())!.position_id;
    check("open fill: the order points at its position (last_insert_rowid)", pos, (f1[1].results[0] as { id: number }).id);
    check("open fill: one fee row (ref open:<position>) and the pool moved once", [await ledgerOf(`open:${pos}`), await pool("fee")], [[{ kind: "fee", amount: 1 }], { balance: 1, gross: 1 }]);
    check("refuse: only a pending order", [(await q(SQL.refuse).bind("x", o1).run()).meta.changes, (await q(SQL.refuse).bind("x", o2).run()).meta.changes], [0, 1]);

    // close fill: settle (under a token, while the booking is as read) → credit → order filled → ledger rows under the token
    const settle = (orderId: number, token: string, bookedTo = 100) => db.batch([
      q(SQL.closeSettle).bind(200, 1010, 20, 0, 0.2, 1019.8, 0.003, 1010, token, -20, 0, 200, pos, W, bookedTo, orderId),
      q(SQL.closeCredit).bind(1019.8, W),
      q(SQL.closeFilled).bind(1010, 200, orderId),
      q(SQL.ledgerSettled).bind(200, "fee", 0.2, `close:${pos}`, pos, token),
      q(SQL.poolSettled).bind(0.2, 0.2, "fee", pos, token),
      q(SQL.ledgerSettled).bind(200, "house_pnl", -20, `settle:${pos}`, pos, token),
      q(SQL.poolSettled).bind(-20, -20, "house_pnl", pos, token),
    ]);
    const c1 = await order("close", pos), c2 = await order("close", pos), c0 = await order("close", pos);
    check("close fill: a booking that moved since the read settles nothing", changes(await settle(c0, "t0", 99)), [0, 0, 0, 0, 0, 0, 0]);
    check("close fill: settle, credit, order filled, ledger rows and pools under the token", changes(await settle(c1, "t1")), [1, 1, 1, 1, 1, 1, 1]);
    check("close fill: a second close order settles nothing and books nothing", changes(await settle(c2, "t2")), [0, 0, 0, 0, 0, 0, 0]);
    check("close fill: credited once, booked once", [await balance(), await pool("fee"), await pool("house_pnl")], [499 + 1019.8, { balance: 1.2, gross: 1.2 }, { balance: -20, gross: -20 }]);
    check("liquidate: an already closed position is untouched", (await q(SQL.liquidate).bind(1, 1, 1, 0, 0, 1, "t3", 0, 0, 60, pos, 200).run()).meta.changes, 0);
    check("ledger: one row per (ref, kind): a duplicate aborts its batch", await db.batch([q(SQL.ledgerSettled).bind(200, "fee", 0.2, `close:${pos}`, pos, "t1")]).then(() => "written", () => "aborted"), "aborted");

    // single-use nonce, rate window
    check("nonce: first use only", [(await q(SQL.nonceUse).bind("n1", 9).run()).meta.changes, (await q(SQL.nonceUse).bind("n1", 9).run()).meta.changes], [1, 0]);
    const hit = async (slot: number) => (await q(SQL.rateHit).bind("k", slot, 2).first<{ n: number }>())?.n ?? null;
    check("rate limit: RETURNING the count; nothing (and no write) once the limit is reached; a new window restarts", [await hit(7), await hit(7), await hit(7), await q("SELECT n FROM ratelimit WHERE k = 'k'").first(), await hit(8)], [1, 2, null, { n: 2 }, 1]);

    // the mark row moves forward only, and only the winning post writes bars, the hour's rates and the projected cut
    const post = (ts: number, id: string) => db.batch([
      q(SQL.markUpsert).bind(1000, ts, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", id),
      q(SQL.barUpsert).bind(60, 1001, 999, 1000, id),
      q(SQL.ratesInsert).bind(0, 0.0003, -0.0001, 0.5, 0.0001, 0.0002, 0.5, -1000, 1, 0.0002, 0.0001, 3000, 1000, ts, id, id),
      q(SQL.ledgerByRates).bind(0, "cut", 0.5, "hour:0", 0, id),
      q(SQL.poolByRates).bind(0.5, 0.5, "cut", 0, id),
    ]);
    check("mark: a newer post writes the row, its bar, the hour's rates and its cut", changes(await post(100, "a")), [1, 1, 1, 1, 1]);
    check("mark: a post with the same ts writes nothing", changes(await post(100, "b")), [0, 0, 0, 0, 0]);
    check("mark: an older post writes nothing", changes(await post(99, "c")), [0, 0, 0, 0, 0]);
    const merged = await db.batch([q(SQL.markUpsert).bind(1000, 101, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", "d"), q(SQL.barUpsert).bind(60, 1000.5, 990, 1000, "d")]);
    check("bars: a re-posted minute merges (high and low only widen)", [changes(merged), await q("SELECT h, l, c FROM bars WHERE minute = 60").first()], [[1, 1], { h: 1001, l: 990, c: 1000 }]);
    const same = await db.batch([q(SQL.markUpsert).bind(1000, 101.5, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", "d2"), q(SQL.barUpsert).bind(60, 1000, 995, 1000, "d2")]);
    check("bars: an unchanged (or narrower) re-sent minute writes nothing", changes(same), [1, 0]);
    const lp = (await q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, 'long', 10, 1, 10, 1000, 1, 0, 0, 0) RETURNING id").bind(W).first<{ id: number }>())!.id;
    const liq = (id: string, token: string) => q(SQL.liquidateIfPost).bind(1, 1, 1, 0, 0, 1, token, -9, 0, 60, lp, 0, id);
    const lw = await db.batch([
      q(SQL.markUpsert).bind(1000, 101.7, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", "d3"),
      liq("zz", "zz"),
      liq("d3", "d3"),
      q(SQL.ledgerSettled).bind(101, "liq_margin", 1, `liq:${lp}`, lp, "d3"),
      liq("d3", "d3b"),
      q(SQL.ledgerSettled).bind(101, "insurance_draw", -1, `draw:${lp}`, lp, "d3b"),
    ]);
    check("liquidation in the ingest batch: only for the post that won, once; its rows under its token only", changes(lw), [1, 0, 1, 1, 0, 0]);
    check("rates once per hour; the same bar re-posted is not rewritten", [changes(await post(102, "e")), await q("SELECT long, post FROM rates").first(), await pool("cut")], [[1, 0, 0, 0, 0], { long: 0.0003, post: "a" }, { balance: 0.5, gross: 0.5 }]);

    // the house's hour: only by the post whose rates insert won; a position's booking that moved aborts the whole batch
    const hp = (await q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, 'short', 100, 2, 200, 1000, 1500, 0, 0, 0) RETURNING id").bind(W).first<{ id: number }>())!.id;
    const book = (id: string, bookedTo: number) => db.batch([
      q(SQL.houseHourInsert).bind(-3600, 1000, 1001, -1000, -1, 0.4, -0.6, 0.1, -0.5, -0.5, -1, 0.4, 0.1, 0, 0, 0, id, 0, id),
      q(SQL.ledgerByHour).bind(-3600, "house_pnl", -0.6, "hour:-3600", -3600, id),
      q(SQL.poolByHour).bind(-0.6, -0.6, "house_pnl", -3600, id),
      q(SQL.bookPosition).bind(-0.5, 0, 0, hp, bookedTo, 0, id),
      q(SQL.abortUnlessChanged),
    ]);
    check("house hour: a post that did not fix the hour's rates books nothing, and its batch aborts", await book("x", 0).then(changes, () => "aborted"), "aborted");
    check("house hour: an aborted batch left nothing behind", [await q("SELECT COUNT(*) AS n FROM house_hours").first(), await ledgerOf("hour:-3600")], [{ n: 0 }, []]);
    check("house hour: a moved booking aborts the batch", await book("a", 99).then(changes, () => "aborted"), "aborted");
    check("house hour: booked once by the post that fixed the rates", await book("a", 0).then(changes, () => "aborted"), [1, 1, 1, 1, 0]);
    check("house hour: the position's booking moved", await q("SELECT booked, booked_to FROM positions WHERE id = ?").bind(hp).first(), { booked: -0.5, booked_to: 0 });

    // a gap loss: insurance covers at most its balance (never below zero), the house takes the rest; evaluated in the batch
    const gp = (await q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to, closed_at, settle) VALUES (?, 'long', 10, 30, 300, 1000, 1, 0, 0, 0, 1, 'g1') RETURNING id").bind(W).first<{ id: number }>())!.id;
    const gapLoss = (s: number, ref: string, token: string) => [
      q(SQL.gapHouseLedger).bind(5, "liq_margin", s, s, ref, gp, token),
      q(SQL.gapHousePool).bind(s, s, s, s, "liq_margin", gp, token),
      q(SQL.gapCoverLedger).bind(5, s, `draw:${ref}`, gp, token),
      q(SQL.gapCoverPool).bind(s, s, gp, token),
    ];
    const insurance = async () => (await q("SELECT SUM(balance) AS b FROM pools WHERE kind IN ('split_insurance', 'insurance_draw')").first<{ b: number }>())!.b;
    await q("UPDATE pools SET balance = 3 WHERE kind = 'split_insurance'").run();
    check("gap: a wrong token writes nothing", changes(await db.batch(gapLoss(5, "liq:g0", "nope"))), [0, 0, 0, 0]);
    check("gap: insurance covers 3 of 5, the house takes 2", [changes(await db.batch(gapLoss(5, "liq:g1", "g1"))), await ledgerOf("liq:g1"), await ledgerOf("draw:liq:g1"), await insurance()],
      [[1, 1, 1, 1], [{ kind: "liq_margin", amount: -2 }], [{ kind: "insurance_draw", amount: -3 }], 0]);
    await db.batch(gapLoss(4, "liq:g2", "g1"));
    check("gap: an empty insurance stays at zero; the house takes it all", [await ledgerOf("liq:g2"), await ledgerOf("draw:liq:g2"), await insurance()], [[{ kind: "liq_margin", amount: -4 }], [{ kind: "insurance_draw", amount: 0 }], 0]);
    await q("UPDATE pools SET balance = 0 WHERE kind IN ('split_insurance', 'insurance_draw', 'liq_margin')").run();

    // the weekly split: once per week; its rows only for the request whose insert won
    const split = (token: string) => db.batch([
      q(SQL.splitInsert).bind(604800, 700000, 10, 10, 0, 0, 0, 2, 8, 4, token),
      q(SQL.ledgerBySplit).bind(700000, "fee", -10, "split:604800", 604800, token),
      q(SQL.poolBySplit).bind(-10, 0, "fee", 604800, token),
      q(SQL.ledgerBySplit).bind(700000, "split_insurance", 2, "split:604800", 604800, token),
      q(SQL.poolBySplit).bind(2, 0, "split_insurance", 604800, token),
    ]);
    check("split: once per week, its rows only for the request whose insert landed", [changes(await split("s1")), changes(await split("s2"))], [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0]]);
    check("split: pools moved once (gross unchanged)", [await pool("fee"), await pool("split_insurance")], [{ balance: 1.2 - 10, gross: 1.2 }, { balance: 2, gross: 0 }]);
    const gap = (id: string) => db.batch([q(SQL.markUpsert).bind(1000, 103 + gapN++, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", id), q(SQL.gapOpen).bind(120, 180, id)]);
    let gapN = 0;
    check("gaps: opened by the accepted post only, once", [changes(await gap("g1")), changes(await gap("g2"))], [[1, 1], [1, 0]]);
    const closeGap = await db.batch([q(SQL.markUpsert).bind(1000, 200, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", "h"), q(SQL.gapClose).bind(120, "h"), q(SQL.gapClose).bind(120, "zz")]);
    check("gaps: closed by the accepted post", changes(closeGap), [1, 1, 0]);
    check("liquidation candidates: INDEXED BY runs", (await q(SQL.liqCandidatesLong).bind(995, 0).all()).results.length, 1);
    check("sign-out: session epoch bumped", (await q(SQL.sessionBump).bind(W).run()).meta.changes, 1);
  } catch (e) {
    out.push({ name: "run", ok: false, detail: String((e as Error)?.message ?? e) });
  } finally {
    await drop();
  }
  return out;
}
