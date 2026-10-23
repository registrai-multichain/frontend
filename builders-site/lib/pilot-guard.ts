/**
 * Proves the points pilot's changes()-guarded batches behave on a D1 database as they do in the tests: run by
 * scripts/d1-guard-check.mjs against the REMOTE database after `wrangler d1 create` + migrate, before the pilot
 * opens. Everything runs on scratch copies of the tables (`_guard_*`, built from the migration with every table
 * and index name prefixed), with the exact statements of lib/pilot-sql.ts, and is dropped afterwards; the real
 * tables are never touched.
 */
import type { D1Database } from "./env";
import { REBUILT, scratch, SQL, TABLES } from "./pilot-sql";

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
  // the tables, and migration 0004's rebuild copies (left behind only if a run broke off inside the migration)
  const drop = async () => { for (const t of [...TABLES, ...REBUILT.map((x) => `${x}_v4`)]) await db.prepare(scratch(`DROP TABLE IF EXISTS ${t}`)).run(); };

  await drop();
  try {
    for (const m of typeof migrations === "string" ? [migrations] : migrations) for (const s of ddlStatements(m)) await db.prepare(scratch(s)).run();
    const W = "0x00000000000000000000000000000000000000aa";
    const A = "abi", I = "aii";
    await q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, 1500, 1, 0)").bind(W).run();
    const order = async (kind: string, positionId: number | null = null, market = A) =>
      (await q("INSERT INTO orders (wallet, market, kind, side, margin, lev, position_id, arrived_ms) VALUES (?, ?, ?, 'long', 1000, 2, ?, 0) RETURNING id").bind(W, market, kind, positionId).first<{ id: number }>())!.id;
    const balance = async () => (await q("SELECT balance FROM accounts WHERE wallet = ?").bind(W).first<{ balance: number }>())!.balance;

    const pool = async (kind: string, market = A) => (await q("SELECT balance, gross FROM pools WHERE market = ? AND kind = ?").bind(market, kind).first<{ balance: number; gross: number }>())!;
    const ledgerOf = async (ref: string, market = A) => (await q("SELECT kind, amount FROM ledger WHERE market = ? AND ref = ? ORDER BY kind").bind(market, ref).all()).results;
    check("migrations: every market has its ten pools, at zero", (await q("SELECT market, COUNT(*) AS n, SUM(balance) AS b FROM pools GROUP BY market ORDER BY market").all()).results,
      [{ market: "abi", n: 10, b: 0 }, { market: "aei", n: 10, b: 0 }, { market: "aii", n: 10, b: 0 }]);

    // open fill: debit → insert → order filled → open fee to the ledger and the market's pool, each only after the one before changed a row
    const fill = (orderId: number, side = "long", market = A, cost = 1001) => db.batch([
      q(SQL.openDebit).bind(cost, W, cost, W, market, 5, W, market, side, orderId),
      q(SQL.openInsert).bind(W, market, side, 1000, 2, 2000, 1000, 505, 100, 1, 100, "5000000000000000000000000"),
      q(SQL.openFilled).bind(1000, 100, orderId),
      q(SQL.openFeeLedger).bind(100, 1, orderId),
      q(SQL.openFeePool).bind(1, 1, orderId),
    ]);
    const o1 = await order("open"), o2 = await order("open");
    const f1 = await fill(o1);
    check("open fill: debit, insert (RETURNING id), order filled, fee ledger row, fee pool", [changes(f1), f1[1].results.length], [[1, 1, 1, 1, 1], 1]);
    check("open fill: the same order again changes nothing", changes(await fill(o1)), [0, 0, 0, 0, 0]);
    await q("UPDATE accounts SET balance = balance + 5000 WHERE wallet = ?").bind(W).run();
    const oShort = await order("open");
    check("open fill: no hedging (a short while a long is open in the same market)", changes(await fill(oShort, "short")), [0, 0, 0, 0, 0]);
    // one direction per market: a short in AII while the ABI long is open
    const oAii = await order("open", null, I);
    const fAii = await fill(oAii, "short", I, 1);
    check("open fill: a short in another market (AII) while long ABI: allowed, its fee in AII's pool", [changes(fAii), await pool("fee", I), await pool("fee")], [[1, 1, 1, 1, 1], { balance: 1, gross: 1 }, { balance: 1, gross: 1 }]);
    await q("UPDATE positions SET closed_at = 1, reason = 'close' WHERE market = ?").bind(I).run();
    await q("UPDATE accounts SET balance = balance - 5000 + 1 WHERE wallet = ?").bind(W).run();
    check("open fill: a second order cannot overspend", changes(await fill(o2)), [0, 0, 0, 0, 0]);
    check("open fill: balance debited once", await balance(), 499);
    const pos = (await q("SELECT position_id FROM orders WHERE id = ?").bind(o1).first<{ position_id: number }>())!.position_id;
    check("open fill: the order points at its position (last_insert_rowid)", pos, (f1[1].results[0] as { id: number }).id);
    check("open fill: the position keeps its lock requirement (raw REGI as text, past INTEGER range)", await q("SELECT lock_req, typeof(lock_req) AS t FROM positions WHERE id = ?").bind(pos).first(), { lock_req: "5000000000000000000000000", t: "text" });
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
    check("ledger: one row per (market, ref, kind): a duplicate aborts its batch", await db.batch([q(SQL.ledgerSettled).bind(200, "fee", 0.2, `close:${pos}`, pos, "t1")]).then(() => "written", () => "aborted"), "aborted");

    // single-use nonce, rate window
    check("nonce: first use only", [(await q(SQL.nonceUse).bind("n1", 9).run()).meta.changes, (await q(SQL.nonceUse).bind("n1", 9).run()).meta.changes], [1, 0]);
    const hit = async (slot: number) => (await q(SQL.rateHit).bind("k", slot, 2).first<{ n: number }>())?.n ?? null;
    check("rate limit: RETURNING the count; nothing (and no write) once the limit is reached; a new window restarts", [await hit(7), await hit(7), await hit(7), await q("SELECT n FROM ratelimit WHERE k = 'k'").first(), await hit(8)], [1, 2, null, { n: 2 }, 1]);

    // the market's mark row moves forward only, and only its winning post writes bars, the hour's rates and the projected cut
    const markUp = (market: string, ts: number, id: string) => q(SQL.markUpsert).bind(market, 1000, ts, 0, 1, 0, 0, 0, 0.0004, 0.002, 1, null, 0, null, null, null, null, "[]", id);
    const post = (ts: number, id: string, market = A) => db.batch([
      markUp(market, ts, id),
      q(SQL.barUpsert).bind(60, 1001, 999, 1000, market, id),
      q(SQL.ratesInsert).bind(0, 0.0003, -0.0001, 0.5, 0.0001, 0.0002, 0.5, -1000, 1, 0.0002, 0.0001, 3000, 1000, ts, id, 0.00002, market, id),
      q(SQL.ledgerByRates).bind(0, "cut", 0.5, "hour:0", market, 0, id),
      q(SQL.poolByRates).bind(0.5, 0.5, "cut", market, 0, id),
    ]);
    check("mark: a newer post writes the row, its bar, the hour's rates and its cut", changes(await post(100, "a")), [1, 1, 1, 1, 1]);
    check("mark: a post with the same ts writes nothing", changes(await post(100, "b")), [0, 0, 0, 0, 0]);
    check("mark: an older post writes nothing", changes(await post(99, "c")), [0, 0, 0, 0, 0]);
    const merged = await db.batch([markUp(A, 101, "d"), q(SQL.barUpsert).bind(60, 1000.5, 990, 1000, A, "d")]);
    check("bars: a re-posted minute merges (high and low only widen)", [changes(merged), await q("SELECT h, l, c FROM bars WHERE market = ? AND minute = 60").bind(A).first()], [[1, 1], { h: 1001, l: 990, c: 1000 }]);
    const same = await db.batch([markUp(A, 101.5, "d2"), q(SQL.barUpsert).bind(60, 1000, 995, 1000, A, "d2")]);
    check("bars: an unchanged (or narrower) re-sent minute writes nothing", changes(same), [1, 0]);
    const lp = (await q("INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, ?, 'long', 10, 1, 10, 1000, 1, 0, 0, 0) RETURNING id").bind(W, A).first<{ id: number }>())!.id;
    const liq = (id: string, token: string) => q(SQL.liquidateIfPost).bind(1, 1, 1, 0, 0, 1, token, -9, 0, 60, lp, 0, id);
    const lw = await db.batch([
      markUp(A, 101.7, "d3"),
      liq("zz", "zz"),
      liq("d3", "d3"),
      q(SQL.ledgerSettled).bind(101, "liq_margin", 1, `liq:${lp}`, lp, "d3"),
      liq("d3", "d3b"),
      q(SQL.ledgerSettled).bind(101, "insurance_draw", -1, `draw:${lp}`, lp, "d3b"),
    ]);
    check("liquidation in the ingest batch: only for the post that won, once; its rows under its token only", changes(lw), [1, 0, 1, 1, 0, 0]);
    check("rates once per market hour; the same bar re-posted is not rewritten", [changes(await post(102, "e")), await q("SELECT long, premium, post FROM rates WHERE market = ?").bind(A).first(), await pool("cut")], [[1, 0, 0, 0, 0], { long: 0.0003, premium: 0.00002, post: "a" }, { balance: 0.5, gross: 0.5 }]);

    // R5: per market. AII's first post of the same hour fixes AII's rates (ABI's hour 0 is fixed already), once; ABI's
    // rows and pools are untouched; a post writes into its own market only (the market comes from its mark row)
    check("markets: AII's first post fixes AII's hour 0 (ABI's is fixed): its own mark row, bar, rates, hour:0 cut", changes(await post(100, "i1", I)), [1, 1, 1, 1, 1]);
    check("markets: a second AII post of the hour fixes nothing", changes(await post(103, "i2", I)), [1, 0, 0, 0, 0]);
    check("markets: one rates row per market for hour 0, each by its own post; the cut in each market's pool",
      [(await q("SELECT market, post FROM rates WHERE hour = 0 ORDER BY market").all()).results, await pool("cut"), await pool("cut", I)],
      [[{ market: "abi", post: "a" }, { market: "aii", post: "i1" }], { balance: 0.5, gross: 0.5 }, { balance: 0.5, gross: 0.5 }]);
    const cross = await db.batch([
      q(SQL.barUpsert).bind(120, 1, 1, 1, I, "e"),   // ABI's winning post, naming AII
      q(SQL.barUpsert).bind(120, 1, 1, 1, A, "i2"),  // AII's winning post, naming ABI
      q(SQL.ratesInsert).bind(3600, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "e", 0, I, "e"),
      q(SQL.gapOpen).bind(120, 180, I, "e"),
    ]);
    check("markets: a post writes only its own market (bars, rates, gaps)", changes(cross), [0, 0, 0, 0]);

    // a liquidation in AII (an AII post) leaves ABI's position, insurance and pools untouched
    const ap = (await q("INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, ?, 'long', 10, 30, 300, 1000, 1, 0, 0, 0) RETURNING id").bind(W, A).first<{ id: number }>())!.id;
    const ip = (await q("INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, ?, 'long', 10, 30, 300, 1000, 1, 0, 0, 0) RETURNING id").bind(W, I).first<{ id: number }>())!.id;
    await q("UPDATE pools SET balance = 3 WHERE market = ? AND kind = 'split_insurance'").bind(A).run();
    const abiPools = async () => (await q("SELECT kind, balance FROM pools WHERE market = ? ORDER BY kind").bind(A).all()).results;
    const abiBefore = await abiPools();
    const liqIn = (id: number, post: string, token: string) => q(SQL.liquidateIfPost).bind(110, 900, -100, 0, 0, 850, token, 5, 0, 170, id, 0, post);
    const s = 5; // a gap: 5 beyond the margin
    const iw = await db.batch([
      markUp(I, 110, "i3"),
      liqIn(ap, "i3", "x1"), // ABI's position, by AII's post: no
      liqIn(ip, "i3", "x2"),
      q(SQL.ledgerSettled).bind(110, "liq_margin", 0, `liq:${ip}`, ip, "x2"),
      q(SQL.gapHouseLedger).bind(110, "liq_margin", s, s, `liq:${ip}:gap`, ip, "x2"),
      q(SQL.gapHousePool).bind(s, s, s, s, "liq_margin", ip, "x2"),
      q(SQL.gapCoverLedger).bind(110, s, `draw:${ip}`, ip, "x2"),
      q(SQL.gapCoverPool).bind(s, s, ip, "x2"),
    ]);
    check("markets: an AII post liquidates the AII position only; its gap is AII's (AII's insurance is empty: AII's house takes it)",
      [changes(iw), await ledgerOf(`liq:${ip}:gap`, I), await ledgerOf(`draw:${ip}`, I)], [[1, 0, 1, 1, 1, 1, 1, 1], [{ kind: "liq_margin", amount: -5 }], [{ kind: "insurance_draw", amount: 0 }]]);
    check("markets: ABI's position, insurance (3) and pools are untouched by AII's liquidation",
      [await q("SELECT closed_at FROM positions WHERE id = ?").bind(ap).first(), await abiPools()], [{ closed_at: null }, abiBefore]);
    await q("UPDATE positions SET closed_at = 1 WHERE id IN (?, ?)").bind(ap, ip).run();
    await q("UPDATE pools SET balance = 0 WHERE market = ? AND kind = 'split_insurance'").bind(A).run();

    // the house's hour: only by the post whose rates insert won; a position's booking that moved aborts the whole batch
    const hp = (await q("INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, ?, 'short', 100, 2, 200, 1000, 1500, 0, 0, 0) RETURNING id").bind(W, A).first<{ id: number }>())!.id;
    const book = (id: string, bookedTo: number) => db.batch([
      q(SQL.houseHourInsert).bind(-3600, 1000, 1001, -1000, -1, 0.4, -0.6, 0.1, -0.5, -0.5, -1, 0.4, 0.1, 0, 0, 0, id, A, 0, id),
      q(SQL.ledgerByHour).bind(-3600, "house_pnl", -0.6, "hour:-3600", A, -3600, id),
      q(SQL.poolByHour).bind(-0.6, -0.6, "house_pnl", A, -3600, id),
      q(SQL.bookPosition).bind(-0.5, 0, 0, hp, bookedTo, 0, id),
      q(SQL.abortUnlessChanged),
    ]);
    check("house hour: a post that did not fix the hour's rates books nothing, and its batch aborts", await book("x", 0).then(changes, () => "aborted"), "aborted");
    check("house hour: an aborted batch left nothing behind", [await q("SELECT COUNT(*) AS n FROM house_hours").first(), await ledgerOf("hour:-3600")], [{ n: 0 }, []]);
    check("house hour: a moved booking aborts the batch", await book("a", 99).then(changes, () => "aborted"), "aborted");
    check("house hour: booked once by the post that fixed the rates", await book("a", 0).then(changes, () => "aborted"), [1, 1, 1, 1, 0]);
    check("house hour: the position's booking moved", await q("SELECT booked, booked_to FROM positions WHERE id = ?").bind(hp).first(), { booked: -0.5, booked_to: 0 });

    // a gap loss: insurance covers at most its balance (never below zero), the house takes the rest; evaluated in the batch
    const gp = (await q("INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to, closed_at, settle) VALUES (?, ?, 'long', 10, 30, 300, 1000, 1, 0, 0, 0, 1, 'g1') RETURNING id").bind(W, A).first<{ id: number }>())!.id;
    const gapLoss = (s: number, ref: string, token: string) => [
      q(SQL.gapHouseLedger).bind(5, "liq_margin", s, s, ref, gp, token),
      q(SQL.gapHousePool).bind(s, s, s, s, "liq_margin", gp, token),
      q(SQL.gapCoverLedger).bind(5, s, `draw:${ref}`, gp, token),
      q(SQL.gapCoverPool).bind(s, s, gp, token),
    ];
    const insurance = async (market = A) => (await q("SELECT SUM(balance) AS b FROM pools WHERE market = ? AND kind IN ('split_insurance', 'insurance_draw')").bind(market).first<{ b: number }>())!.b;
    await q("UPDATE pools SET balance = 3 WHERE market = ? AND kind = 'split_insurance'").bind(A).run();
    check("gap: a wrong token writes nothing", changes(await db.batch(gapLoss(5, "liq:g0", "nope"))), [0, 0, 0, 0]);
    check("gap: insurance covers 3 of 5, the house takes 2", [changes(await db.batch(gapLoss(5, "liq:g1", "g1"))), await ledgerOf("liq:g1"), await ledgerOf("draw:liq:g1"), await insurance()],
      [[1, 1, 1, 1], [{ kind: "liq_margin", amount: -2 }], [{ kind: "insurance_draw", amount: -3 }], 0]);
    await db.batch(gapLoss(4, "liq:g2", "g1"));
    check("gap: an empty insurance stays at zero; the house takes it all", [await ledgerOf("liq:g2"), await ledgerOf("draw:liq:g2"), await insurance()], [[{ kind: "liq_margin", amount: -4 }], [{ kind: "insurance_draw", amount: 0 }], 0]);
    await q("UPDATE pools SET balance = 0 WHERE kind IN ('split_insurance', 'insurance_draw', 'liq_margin')").run();

    // the weekly split: once per market week; its rows only for the request whose insert won
    const split = (token: string, market = A) => db.batch([
      q(SQL.splitInsert).bind(market, 604800, 700000, 10, 10, 0, 0, 0, 2, 8, 4, token),
      q(SQL.ledgerBySplit).bind(700000, "fee", -10, "split:604800", market, 604800, token),
      q(SQL.poolBySplit).bind(-10, 0, "fee", market, 604800, token),
      q(SQL.ledgerBySplit).bind(700000, "split_insurance", 2, "split:604800", market, 604800, token),
      q(SQL.poolBySplit).bind(2, 0, "split_insurance", market, 604800, token),
    ]);
    check("split: once per week, its rows only for the request whose insert landed", [changes(await split("s1")), changes(await split("s2"))], [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0]]);
    check("split: pools moved once (gross unchanged)", [await pool("fee"), await pool("split_insurance")], [{ balance: 1.2 - 10, gross: 1.2 }, { balance: 2, gross: 0 }]);
    check("split: per market: AII's split of the same week lands once, in AII's pools only",
      [changes(await split("s3", I)), changes(await split("s4", I)), await pool("fee", I), await pool("split_insurance", I), await pool("fee"), (await q("SELECT COUNT(*) AS n FROM splits").first<{ n: number }>())!.n],
      [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], { balance: 1 - 10, gross: 1 }, { balance: 2, gross: 0 }, { balance: 1.2 - 10, gross: 1.2 }, 2]);
    const gap = (id: string) => db.batch([markUp(A, 103 + gapN++, id), q(SQL.gapOpen).bind(120, 180, A, id)]);
    let gapN = 0;
    check("gaps: opened by the accepted post only, once", [changes(await gap("g1")), changes(await gap("g2"))], [[1, 1], [1, 0]]);
    const closeGap = await db.batch([markUp(A, 200, "h"), q(SQL.gapClose).bind(A, 120, "h"), q(SQL.gapClose).bind(A, 120, "zz")]);
    check("gaps: closed by the accepted post", changes(closeGap), [1, 1, 0]);
    check("liquidation candidates: INDEXED BY runs, per market", [(await q(SQL.liqCandidatesLong).bind(A, 995, 0).all()).results.length, (await q(SQL.liqCandidatesLong).bind("aei", 995, 0).all()).results.length], [1, 0]);
    check("sign-out: session epoch bumped", (await q(SQL.sessionBump).bind(W).run()).meta.changes, 1);

    // plan 2026-10-13 R4, R5: a close by withdrawal happens once, and only for positions whose lock requirement is
    // ABOVE the remaining lock (canonical decimal strings of raw REGI: longer, or as long and greater as text)
    const M5 = "5000000000000000000000000", M1 = "1000000000000000000000000", K900 = "900000000000000000000000";
    const lockPos = async (req: string) => (await q("INSERT INTO positions (wallet, market, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to, lock_req) VALUES (?, ?, 'long', 100, 2, 200, 1000, 505, 0, 0, 0, ?) RETURNING id").bind(W, A, req).first<{ id: number }>())!.id;
    const [big, small, flat] = [await lockPos(M5), await lockPos(K900), await lockPos("0")];
    const lockClose = (id: number, token: string, locked: string) => db.batch([
      q(SQL.lockClose).bind(300, 1000, 0, 0, 0.2, 99.8, 0, 1000, token, 0, 0, 300, id, W, 0, locked, locked, locked),
      q(SQL.closeCredit).bind(99.8, W),
      q(SQL.ledgerSettled).bind(300, "fee", 0.2, `close:${id}`, id, token),
      q(SQL.poolSettled).bind(0.2, 0.2, "fee", id, token),
    ]);
    const before = await balance();
    check("lock close: a requirement below the remaining lock (a shorter string) closes nothing", changes(await lockClose(small, "k1", M1)), [0, 0, 0, 0]);
    check("lock close: a requirement equal to the remaining lock closes nothing", changes(await lockClose(big, "k2", M5)), [0, 0, 0, 0]);
    check("lock close: a 1× position (lock_req '0') is never closed, even with nothing locked", changes(await lockClose(flat, "k3", "0")), [0, 0, 0, 0]);
    check("lock close: a requirement above the remaining lock (as long, greater): settled, credited, booked", changes(await lockClose(big, "k4", M1)), [1, 1, 1, 1]);
    check("lock close: the same position again settles nothing and books nothing", changes(await lockClose(big, "k5", "0")), [0, 0, 0, 0]);
    check("lock close: a requirement above an empty lock (a longer string) is closed", changes(await lockClose(small, "k6", "0")), [1, 1, 1, 1]);
    check("lock close: reason close, note 'lock withdrawn'; the 1× position stays open; credited exactly twice",
      [(await q("SELECT reason, close_note FROM positions WHERE id IN (?, ?) ORDER BY id").bind(big, small).all()).results, await q("SELECT closed_at FROM positions WHERE id = ?").bind(flat).first(), +((await balance()) - before).toFixed(6)],
      [[{ reason: "close", close_note: "lock withdrawn" }, { reason: "close", close_note: "lock withdrawn" }], { closed_at: null }, 199.6]);

    // R1: one price sample per 10-minute slot; R4: one watch per minute, and the cursor only moves forward
    check("price: one sample per slot", [(await q(SQL.priceInsert).bind(600, 1e-5).run()).meta.changes, (await q(SQL.priceInsert).bind(600, 2e-5).run()).meta.changes, await q("SELECT usd_per_regi AS p FROM regi_price WHERE ts = 600").first()], [1, 0, { p: 1e-5 }]);
    check("lock watch: claimed once per minute", [(await q(SQL.lockClaim).bind(1000, 940).run()).meta.changes, (await q(SQL.lockClaim).bind(1010, 950).run()).meta.changes, (await q(SQL.lockClaim).bind(1060, 1000).run()).meta.changes], [1, 0, 1]);
    await q(SQL.lockAdvance).bind(100).run();
    await q(SQL.lockAdvance).bind(50).run();
    check("lock watch: the cursor never moves back", await q("SELECT block FROM lock_cursor WHERE id = 1").first(), { block: 100 });

    // review S1: owners due a re-check keep their earliest and latest withdrawal; one leaves only if nothing later came in
    await q(SQL.lockDue).bind(W, 120, 120).run();
    await q(SQL.lockDue).bind(W, 110, 110).run();
    await q(SQL.lockDue).bind(W, 130, 130).run();
    check("lock due: one row per owner, earliest and latest block", await q("SELECT from_block, last_block FROM lock_due WHERE owner = ?").bind(W).first(), { from_block: 110, last_block: 130 });
    check("lock due: handled at an earlier block, the owner stays; at the latest, it leaves",
      [(await q(SQL.lockDone).bind(W, 125).run()).meta.changes, (await q(SQL.lockDone).bind(W, 130).run()).meta.changes], [0, 1]);

    // review B1: the watch refuses only pending leveraged opens whose requirement is above the remaining lock
    const lockOrder = async (req: string, status = "pending") =>
      (await q("INSERT INTO orders (wallet, market, kind, side, margin, lev, arrived_ms, status, lock_req) VALUES (?, 'abi', 'open', 'long', 100, 2, 0, ?, ?) RETURNING id").bind(W, status, req).first<{ id: number }>())!.id;
    const [hi, lo, one, done] = [await lockOrder(M5), await lockOrder(K900), await lockOrder("0"), await lockOrder(M5, "filled")];
    const refusedNow = (await q(SQL.lockRefuse).bind("lock", W, M1, M1, M1).run()).meta.changes;
    check("lock refuse: only the pending order above the remaining lock (not below it, not 1×, not a filled one)",
      [refusedNow, (await q("SELECT id, status FROM orders WHERE id IN (?, ?, ?, ?) ORDER BY id").bind(hi, lo, one, done).all()).results],
      [1, [{ id: hi, status: "refused" }, { id: lo, status: "pending" }, { id: one, status: "pending" }, { id: done, status: "filled" }]]);
  } catch (e) {
    out.push({ name: "run", ok: false, detail: String((e as Error)?.message ?? e) });
  } finally {
    await drop();
  }
  return out;
}
