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

export async function runGuardChecks(db: D1Database, migration: string): Promise<GuardResult[]> {
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
    for (const s of ddlStatements(migration)) await db.prepare(scratch(s)).run();
    const W = "0x00000000000000000000000000000000000000aa";
    await q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, 1500, 1, 0)").bind(W).run();
    const order = async (kind: string, positionId: number | null = null) =>
      (await q("INSERT INTO orders (wallet, kind, side, margin, lev, position_id, arrived_ms) VALUES (?, ?, 'long', 1000, 2, ?, 0) RETURNING id").bind(W, kind, positionId).first<{ id: number }>())!.id;
    const balance = async () => (await q("SELECT balance FROM accounts WHERE wallet = ?").bind(W).first<{ balance: number }>())!.balance;

    // open fill: debit → insert → order filled, each only after the one before changed a row
    const fill = (orderId: number, side = "long") => db.batch([
      q(SQL.openDebit).bind(1001, W, 1001, W, 5, W, side, orderId),
      q(SQL.openInsert).bind(W, side, 1000, 2, 2000, 1000, 505, 100, 1),
      q(SQL.openFilled).bind(1000, 100, orderId),
    ]);
    const o1 = await order("open"), o2 = await order("open");
    const f1 = await fill(o1);
    check("open fill: debit, insert (RETURNING id), order filled", [changes(f1), f1[1].results.length], [[1, 1, 1], 1]);
    check("open fill: the same order again changes nothing", changes(await fill(o1)), [0, 0, 0]);
    await q("UPDATE accounts SET balance = balance + 5000 WHERE wallet = ?").bind(W).run();
    const oShort = await order("open");
    check("open fill: no hedging (a short while a long is open)", changes(await fill(oShort, "short")), [0, 0, 0]);
    await q("UPDATE accounts SET balance = balance - 5000 WHERE wallet = ?").bind(W).run();
    check("open fill: a second order cannot overspend", changes(await fill(o2)), [0, 0, 0]);
    check("open fill: balance debited once", await balance(), 499);
    const pos = (await q("SELECT position_id FROM orders WHERE id = ?").bind(o1).first<{ position_id: number }>())!.position_id;
    check("open fill: the order points at its position (last_insert_rowid)", pos, (f1[1].results[0] as { id: number }).id);
    check("refuse: only a pending order", [(await q(SQL.refuse).bind("x", o1).run()).meta.changes, (await q(SQL.refuse).bind("x", o2).run()).meta.changes], [0, 1]);

    // close fill: settle → credit → order filled
    const settle = (orderId: number) => db.batch([
      q(SQL.closeSettle).bind(200, 1010, 20, 0, 0.2, 1019.8, pos, W, orderId),
      q(SQL.closeCredit).bind(1019.8, W),
      q(SQL.closeFilled).bind(1010, 200, orderId),
    ]);
    const c1 = await order("close", pos), c2 = await order("close", pos);
    check("close fill: settle, credit, order filled", changes(await settle(c1)), [1, 1, 1]);
    check("close fill: a second close order settles nothing", changes(await settle(c2)), [0, 0, 0]);
    check("close fill: credited once", await balance(), 499 + 1019.8);
    check("liquidate: an already closed position is untouched", (await q(SQL.liquidate).bind(1, 1, 1, 0, pos).run()).meta.changes, 0);

    // single-use nonce, rate window
    check("nonce: first use only", [(await q(SQL.nonceUse).bind("n1", 9).run()).meta.changes, (await q(SQL.nonceUse).bind("n1", 9).run()).meta.changes], [1, 0]);
    check("rate limit: RETURNING the count", [(await q(SQL.rateHit).bind("k", 7).first<{ n: number }>())!.n, (await q(SQL.rateHit).bind("k", 7).first<{ n: number }>())!.n], [1, 2]);

    // the mark row moves forward only, and only the winning post writes bars and funding
    const post = (ts: number, id: string) => db.batch([
      q(SQL.markUpsert).bind(1000, ts, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, 0, null, "[]", id),
      q(SQL.barUpsert).bind(60, 1001, 999, 1000, id),
      q(SQL.fundingInsert).bind(0, 0.001, id),
    ]);
    check("mark: a newer post writes the row, its bar and its funding", changes(await post(100, "a")), [1, 1, 1]);
    check("mark: a post with the same ts writes nothing", changes(await post(100, "b")), [0, 0, 0]);
    check("mark: an older post writes nothing", changes(await post(99, "c")), [0, 0, 0]);
    const merged = await db.batch([q(SQL.markUpsert).bind(1000, 101, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, 0, null, "[]", "d"), q(SQL.barUpsert).bind(60, 1000.5, 990, 1000, "d")]);
    check("bars: a re-posted minute merges (high and low only widen)", [changes(merged), await q("SELECT h, l, c FROM bars WHERE minute = 60").first()], [[1, 1], { h: 1001, l: 990, c: 1000 }]);
    check("funding: written once per hour (a later accepted post does not change it)", [changes(await post(102, "e")), await q("SELECT rate FROM funding").first()], [[1, 1, 0], { rate: 0.001 }]);
    const gap = (id: string) => db.batch([q(SQL.markUpsert).bind(1000, 103 + gapN++, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, 0, null, "[]", id), q(SQL.gapOpen).bind(120, 180, id)]);
    let gapN = 0;
    check("gaps: opened by the accepted post only, once", [changes(await gap("g1")), changes(await gap("g2"))], [[1, 1], [1, 0]]);
    const closeGap = await db.batch([q(SQL.markUpsert).bind(1000, 200, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, 0, null, "[]", "h"), q(SQL.gapClose).bind(120, "h"), q(SQL.gapClose).bind(120, "zz")]);
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
