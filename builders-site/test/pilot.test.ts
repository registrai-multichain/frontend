import { describe, expect, test } from "vitest";
import { adminLoginMessage } from "../../src/lib/builders-admin";
import * as Engine from "../../src/lib/abi-pilot";
import { pilotLoginMessage, PILOT_SESSION_COOKIE } from "../../src/lib/abi-pilot-api";
import {
  handleFunding, handleLeaderboard, handleOrder, handlePositions, handlePublicMark, handlePushMark, validateMark, HISTORY_SQL,
} from "../lib/pilot";
import { handlePilotLogin, handlePilotLogout, handlePilotNonce, makePilotSession, verifyPilotSession } from "../lib/pilot-auth";
import { MemoryCache } from "./memory-cache";
import { ALICE, BOB, lc, ONE, ORIGIN, PUSH, SESSION_SECRET, setup, SNAP, T0, type Json } from "./pilot-harness";

const LONG2 = { side: "long", margin: 1000, lev: 2 };

describe("mark ingest (R4, spec §8.5)", () => {
  test("bearer required; 503 without a 32+ char token", async () => {
    const t = setup();
    expect((await handlePushMark(t.req("/api/index/mark", "POST", {}, { authorization: "Bearer nope" }), t.env, t.deps)).status).toBe(401);
    expect((await handlePushMark(t.req("/api/index/mark", "POST", {}, { authorization: `Bearer ${PUSH}` }), { ...t.env, ABI_PUSH_TOKEN: "short" }, t.deps)).status).toBe(503);
  });

  test("mark.py v3 payload: one batch; finished minutes stored, the open minute not; the hour's rates fixed; 200 {last_minute, rows}", async () => {
    const t = setup();
    const ts = t.nowS(), m = Math.floor(ts / 60) * 60;
    const r = await t.markJson(982.25, { bars: [[m - 120, 983, 981, 982], [m - 60, 984, 980.5, 983.1], [m, 983.5, 982, 982.25]], trend: -0.0003, base_step_ts: ts - 100 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, last_minute: m - 60, ts, bars: 3, stored: 2, gapBars: 0, gaps: 0, liquidated: 0, filled: 0, refused: 0, pruned: true });
    expect(r.body.rows.written).toBeGreaterThan(0);
    expect(t.db.batches).toBe(1);
    expect(t.db.q("SELECT px, ts, ch24, ch1, sigma_1h, sigma_24h, base_pending, base_step_ts, funding_rate, bars_minute, swept_minute FROM mark")).toEqual([
      { px: 982.25, ts, ch24: 0.001, ch1: 0.0001, sigma_1h: 0.0004, sigma_24h: 0.002, base_pending: 0, base_step_ts: ts - 100, funding_rate: -0.0003, bars_minute: m - 60, swept_minute: m - 60 },
    ]);
    // an empty book: only the trend term (long pays the trend, short the reverse)
    expect(t.db.q("SELECT hour, long, short, skew, trend, L, S FROM rates")).toEqual([{ hour: Math.floor(ts / 3600) * 3600, long: -0.0003, short: 0.0003, skew: 0, trend: -0.0003, L: 0, S: 0 }]);
    expect(t.db.q("SELECT COUNT(*) AS n FROM funding")).toEqual([{ n: 0 }]); // the v2 table is no longer written
    expect(t.db.q("SELECT minute FROM bars ORDER BY minute")).toEqual([{ minute: m - 120 }, { minute: m - 60 }]);
    // the next post in the same minute: only the open minute is new; nothing but the mark row is written
    t.tick(5000);
    const again = await t.markJson(982.3, { bars: [[m, 983.5, 981, 982.3]], trend: -0.0002 });
    expect(again.body).toMatchObject({ last_minute: m - 60, stored: 0, pruned: false, fixed: false, rows: { written: 1 } });
    expect(t.db.q("SELECT trend FROM rates")).toEqual([{ trend: -0.0003 }]); // fixed once per hour: the first trend stands
    expect(t.db.q("SELECT funding_rate FROM mark")).toEqual([{ funding_rate: -0.0003 }]);
    // the minute finishes: stored once with its final high / low; re-sending it changes nothing
    t.tick(60_000);
    const done = await t.markJson(982, { bars: [[m, 983.5, 980, 982.1], [m + 60, 982, 982, 982]] });
    expect(done.body).toMatchObject({ last_minute: m, stored: 1 });
    expect(t.db.q("SELECT h, l, c FROM bars WHERE minute = ?", m)).toEqual([{ h: 983.5, l: 980, c: 982.1 }]);
    t.tick(5000);
    const resent = await t.markJson(982, { bars: [[m, 983.5, 980, 982.1], [m + 60, 982, 981.9, 982]] });
    expect(resent.body).toMatchObject({ stored: 1, rows: { written: 1 } }); // the bar statement ran, wrote nothing
  });

  test("ts: within 30 s of server time, strictly newer than the stored one (409 carries last_minute)", async () => {
    const t = setup();
    expect((await t.mark(1000, { ts: t.nowS() - 31 })).status).toBe(400);
    expect((await t.mark(1000, { ts: t.nowS() + 31 })).status).toBe(400);
    expect((await t.mark(1000, { ts: t.nowS() - 5 })).status).toBe(200);
    const dup = await t.markJson(1001, { ts: t.nowS() - 5 });
    expect(dup.status).toBe(409);
    expect("last_minute" in dup.body).toBe(true);
    expect((await t.mark(1002)).status).toBe(200);
    expect(t.db.q("SELECT px FROM mark")).toEqual([{ px: 1002 }]);
  });

  test("validation: mark in its bar and candle, bar shape, the 60-bar cap and catch-up batches, optional fields", () => {
    const now = 1_760_097_610, m = Math.floor(now / 60) * 60, hs = Math.floor(now / 3600) * 3600;
    const ok = { mark: 1000, ts: now, head: 5, hour_start: hs, candle: [1000, 1002, 998, 1000, 0, 0], ch24: 0, ch1: 0, bars: [[m, 1001, 999, 1000]], sigma_1h: 0.001, sigma_24h: 0.005 };
    expect(validateMark(ok, now).ok).toBe(true);
    const bad = (patch: Record<string, unknown>) => validateMark({ ...ok, ...patch }, now);
    const err = (patch: Record<string, unknown>) => { const v = bad(patch); return v.ok ? null : v.error; };
    expect(err({ mark: 0 })).toBeTruthy();
    expect(err({ mark: "1000" })).toBeTruthy();
    expect(err({ ch24: null })).toBeTruthy();
    expect(err({ bars: [] })).toBeTruthy();
    expect(err({ bars: [[m, 1001, 999]] })).toBeTruthy();
    expect(err({ bars: [[m, 1001, 1002, 1000]] })).toBeTruthy(); // l > c
    expect(err({ bars: [[m, 999, 998, 1000]] })).toBeTruthy(); // c > h
    expect(err({ bars: [[m + 60, 1001, 999, 1000]] })).toBeTruthy(); // later than ts
    expect(err({ bars: [[m + 1, 1001, 999, 1000]] })).toBeTruthy(); // not a minute start
    expect(err({ bars: [[m, 1001, 999, 1000], [m - 60, 1, 1, 1]] })).toBeTruthy(); // order
    expect(err({ bars: [[m, 1001, 1000.5, 1001]] })).toMatch(/last bar/); // mark outside the last bar
    expect(err({ candle: [1000, 1001, 999.5, 1000, 0, 0], mark: 999 })).toBeTruthy(); // mark outside the candle
    expect(err({ candle: [1, 2, 3] })).toBeTruthy();
    expect(err({ bars: [[m - 60, 1001, 999, 1000]] })).toMatch(/minute of ts/); // short batch must end at the open minute
    const sixty = Array.from({ length: 60 }, (_, i) => [m - 3600 + i * 60, 1001, 999, 1000]);
    expect(validateMark({ ...ok, bars: sixty }, now).ok).toBe(true); // a full catch-up batch may end earlier
    expect(err({ bars: [...sixty, [m, 1001, 999, 1000]] })).toMatch(/1 to 60/);
    expect(err({ bars: [[m - 7 * 3600, 1, 1, 1], [m, 1001, 999, 1000]] })).toMatch(/too old/);
    expect(err({ funding_rate: 0.02 })).toMatch(/funding_rate/);
    expect(err({ trend: 0.02 })).toMatch(/trend/);
    expect(err({ trend: "x" })).toMatch(/trend/);
    expect(err({ trend: 0.001, funding_hour: hs + 3600 })).toMatch(/funding_hour/);
    expect(validateMark({ ...ok, trend: 0.001, funding_rate: 0.001 }, now)).toMatchObject({ ok: true, data: { trend: { hour: hs, value: 0.001 } } });
    expect(validateMark({ ...ok, trend: null, funding_rate: null }, now)).toMatchObject({ ok: true, data: { trend: null } });
    // a v2 producer (no trend key): its funding_rate stands for the trend
    expect(validateMark({ ...ok, funding_rate: 0.001 }, now)).toMatchObject({ ok: true, data: { trend: { hour: hs, value: 0.001 } } });
    expect(err({ sigma_24h: -1 })).toMatch(/sigma/);
    expect(err({ base_pending: "yes" })).toMatch(/base_pending/);
    expect(err({ base_step_ts: now + 60 })).toMatch(/base_step_ts/);
    expect(validateMark({ ...ok, milestone_ts: now - 3600 }, now)).toMatchObject({ ok: true, data: { milestoneTs: now - 3600 } });
    expect(validateMark({ ...ok, milestone_ts: null }, now)).toMatchObject({ ok: true, data: { milestoneTs: null } });
    expect(validateMark(ok, now)).toMatchObject({ ok: true, data: { milestoneTs: null } });
    expect(err({ milestone_ts: now + 1 })).toMatch(/milestone_ts/); // after ts
    // audit PE-1: the producer always sends the latest milestone; an old one is ignored, never a refused post
    expect(validateMark({ ...ok, milestone_ts: now - 7 * 86400 - 1 }, now)).toMatchObject({ ok: true, data: { milestoneTs: null } });
    expect(validateMark({ ...ok, milestone_ts: now - 8 * 86400 }, now)).toMatchObject({ ok: true, data: { milestoneTs: null } });
    expect(err({ milestone_ts: now - 0.5 })).toMatch(/milestone_ts/);
    expect(err({ milestone_ts: "x" })).toMatch(/milestone_ts/);
    expect(validateMark({ ...ok, sigma_1h: undefined, sigma_24h: null }, now)).toMatchObject({ ok: true, data: { sigma1h: null, sigma24h: null } });
    // §9.15 milestone premium: absent = 0 (an older producer), null = not known yet, else finite within ±0.001
    expect(validateMark(ok, now)).toMatchObject({ ok: true, data: { premium: 0 } });
    expect(validateMark({ ...ok, milestone_premium: null }, now)).toMatchObject({ ok: true, data: { premium: null } });
    expect(validateMark({ ...ok, milestone_premium: 0.00007 }, now)).toMatchObject({ ok: true, data: { premium: 0.00007 } });
    expect(validateMark({ ...ok, milestone_premium: -0.001 }, now)).toMatchObject({ ok: true, data: { premium: -0.001 } });
    expect(err({ milestone_premium: 0.0011 })).toMatch(/milestone_premium/);
    expect(err({ milestone_premium: "0.0001" })).toMatch(/milestone_premium/);
    expect(err({ milestone_premium: Infinity })).toMatch(/milestone_premium/);
  });

  test("two posts racing: one wins, and only the winner's bars and rates are written", async () => {
    const t = setup();
    await t.mark(1000, { trend: null }); // the hour's rates are not fixed yet
    t.tick(70_000);
    const m = Math.floor(t.nowS() / 60) * 60;
    const before = t.db.batches;
    const [a, b] = await Promise.all([
      t.mark(1000, { bars: [[m - 60, 1001, 999, 1000], [m, 1000, 1000, 1000]], trend: 0.001 }),
      t.mark(1000, { bars: [[m - 60, 1001, 600, 1000], [m, 1000, 1000, 1000]], trend: 0.009 }),
    ]);
    expect(t.db.batches - before).toBe(2);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(t.db.q("SELECT l FROM bars WHERE minute = ?", m - 60)).toEqual([{ l: 999 }]);
    expect(t.db.q("SELECT trend FROM rates")).toEqual([{ trend: 0.001 }]);
  });

  test("any missing minute gets a gap bar: a 20-minute outage, then a restart sending only the newest bars", async () => {
    const t = setup();
    await t.mark(1000);
    const m0 = Math.floor(t.nowS() / 60) * 60;
    t.tick(5000);
    expect((await t.markJson(1000)).body.gapBars).toBe(0); // the same minute: nothing missing
    t.tick(20 * 60_000); // 12:20, same hour
    const m1 = Math.floor(t.nowS() / 60) * 60;
    // restarted producer (last_minute None): only its newest bars, here the open minute
    const r = await t.markJson(1000, { bars: [[m1, 1000, 1000, 1000]], candle: [1000, 1040, 960, 1000, 9, 9] });
    expect(r.body).toMatchObject({ gapBars: 1, gaps: 0, last_minute: m1 - 60 });
    // one gap bar for the minutes from the one open when the producer stopped (never finished) through m1 − 60,
    // at the segment's last minute so every position open during the gap is checked
    expect(t.db.q("SELECT minute, h, l, c FROM bars WHERE minute >= ? AND minute < ?", m0, m1)).toEqual([{ minute: m1 - 60, h: 1040, l: 960, c: 1000 }]);
    t.tick(1000);
    expect((await t.markJson(1000, { bars: [[m1, 1000, 1000, 1000]] })).body.gapBars).toBe(0); // covered: no second gap bar
  });

  test("a gap reaching into an earlier hour: that hour's closed index candle, the open hour's posted candle", async () => {
    const t = setup();
    const hs = Math.floor(t.nowS() / 3600) * 3600;
    t.setCandles([[hs, 1100, 900, 1000]]); // the 12:00 hour, as closed by Tabula
    t.tick(50 * 60_000); // 12:50
    await t.mark(1000);
    const m0 = Math.floor(t.nowS() / 60) * 60;
    t.tick(20 * 60_000); // 13:10
    const m1 = Math.floor(t.nowS() / 60) * 60;
    const r = await t.markJson(1000, { bars: [[m1, 1000, 1000, 1000]], candle: [1000, 1020, 990, 1000, 1, 1] });
    expect(r.body).toMatchObject({ gapBars: 2, gaps: 0 });
    expect(t.db.q("SELECT minute, h, l, c FROM bars WHERE minute >= ? AND minute < ? ORDER BY minute", m0, m1)).toEqual([
      { minute: hs + 3540, h: 1100, l: 900, c: 1000 }, // 12:50–12:59: the closed 12:00 candle
      { minute: m1 - 60, h: 1020, l: 990, c: 1000 }, // 13:00–13:09: the open hour's posted candle
    ]);
  });

  test("an earlier hour without its candle yet: nothing fills or queues until a later post can close the gap", async () => {
    const t = setup();
    const alice = await t.signIn();
    const hs = Math.floor(t.nowS() / 3600) * 3600;
    t.tick(50 * 60_000);
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 20 });
    await t.kv.delete("abi:index");
    t.tick(20 * 60_000);
    const s = await t.submit(alice, LONG2); // the mark is stale: refused at once
    expect(s.body.error).toBe("price updating");
    const r = await t.markJson(1000);
    expect(r.body).toMatchObject({ gapBars: 1, gaps: 1 });
    expect((await t.submit(alice, LONG2)).body.error).toBe("price updating");
    expect((await t.submitClose(alice, o.body.order.positionId)).body.error).toBe("price updating");
    // an order queued just before (inserted: none can be queued now) is refused at the next fill
    t.db.q("INSERT INTO orders (wallet, kind, side, margin, lev, arrived_ms) VALUES (?, 'open', 'long', 100, 1, ?)", lc(ALICE), t.nowS() * 1000);
    t.tick(2000);
    expect((await t.markJson(1000)).body).toMatchObject({ gaps: 1, refused: 1 });
    // Tabula's hour close lands: the next post closes the gap with that candle and liquidates what it crosses
    t.setCandles([[hs, 1000, 900, 950]]);
    t.tick(2000);
    expect((await t.markJson(1000)).body).toMatchObject({ gapBars: 1, gaps: 0, liquidated: 1 });
    expect(t.db.q("SELECT reason FROM positions")).toEqual([{ reason: "liquidation" }]);
    expect((await t.open(alice, LONG2)).body.order.status).toBe("filled");
  });

  test("bars, nonces, rate windows and old orders are pruned once an hour (the first post of a new hour)", async () => {
    const t = setup();
    await t.mark(1000);
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1, 1, 1)", Math.floor(t.nowS() / 60) * 60 - 8 * 86400);
    t.db.q("INSERT INTO orders (wallet, kind, arrived_ms, status) VALUES ('0x1', 'open', ?, 'refused')", T0 - 8 * 86400_000);
    t.tick(5000);
    expect((await t.markJson(1000)).body.pruned).toBe(false);
    expect(t.db.q("SELECT COUNT(*) AS n FROM orders")[0]).toEqual({ n: 1 });
    const toNextHour = (Math.floor(t.nowS() / 3600) + 1) * 3600 - t.nowS() + 5;
    t.tick(toNextHour * 1000);
    expect((await t.markJson(1000)).body.pruned).toBe(true);
    expect(t.db.q("SELECT COUNT(*) AS n FROM bars WHERE minute < ?", t.nowS() - 7 * 86400)[0]).toEqual({ n: 0 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM orders")[0]).toEqual({ n: 0 });
    t.tick(5000);
    expect((await t.markJson(1000)).body.pruned).toBe(false);
  });

  test("GET /api/index/mark: the latest mark, the cap from σ_24h and the pauses; 404 before the first post", async () => {
    const t = setup();
    expect((await handlePublicMark(t.req("/api/index/mark"), t.env, t.deps)).status).toBe(404);
    await t.mark(1000, { sigma_24h: 0.012, sigma_1h: 0.002, ch1: 0.011, base_pending: true });
    const b = (await (await handlePublicMark(t.req("/api/index/mark"), t.env, t.deps)).json()) as Json;
    expect(b).toMatchObject({ mark: 1000, maxLev: 5, paused: true, basePaused: true, fresh: true, age: 0 });
  });

  test("no PILOT_DB: 503", async () => {
    const t = setup({ db: false });
    expect((await t.mark(1000)).status).toBe(503);
    expect((await t.account()).status).toBe(503);
  });
});

describe("sign-in and session (R6)", () => {
  test("nonce + personal_sign: a 12 h HttpOnly, Secure, SameSite=Strict cookie; REGI read at the snapshot block and now", async () => {
    const t = setup();
    const res = await t.loginWith(ALICE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: lc(ALICE), regi: { ok: true, snapshot: true, now: true } });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${PILOT_SESSION_COOKIE}=0x[0-9a-f]{40}\\.0\\.\\d+\\.[A-Za-z0-9_-]+; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$`));
    expect(t.rpc.tags).toEqual([`0x${SNAP.toString(16)}`, "latest"]);
    // regi_snap: the whole REGI held at the snapshot block (2,000,000), so a changed PILOT_REGI_MIN needs no re-read
    expect(t.db.q("SELECT balance, season, regi_ok, regi_snap, regi_snap_block FROM accounts")).toEqual([{ balance: 10000, season: 1, regi_ok: 1, regi_snap: 2_000_000, regi_snap_block: SNAP }]);
  });

  test("a nonce is single use", async () => {
    const t = setup();
    const { nonce } = (await (await handlePilotNonce(t.env, t.deps)).json()) as { nonce: string };
    const message = pilotLoginMessage({ address: lc(ALICE), origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    const signature = await ALICE.signMessage({ message });
    expect((await t.loginWith(ALICE, { message, signature })).status).toBe(200);
    const again = await t.loginWith(ALICE, { message, signature });
    expect(again.status).toBe(401);
    expect(((await again.json()) as Json).error).toMatch(/already used/);
  });

  test("smart-contract wallets: a long (ERC-1271 / 6492) signature, or one that recovers to another address, is refused", async () => {
    const t = setup();
    const long = await t.loginWith(ALICE, { signature: "0x" + "ab".repeat(200) });
    expect(long.status).toBe(400);
    expect(((await long.json()) as Json).error).toBe("Smart-contract wallets aren't supported yet");
    const other = await t.loginWith(ALICE, { address: lc(BOB) }); // the smart account's owner key signs for it
    expect(other.status).toBe(401);
    expect(((await other.json()) as Json).error).toBe("Smart-contract wallets aren't supported yet");
  });

  test("an admin sign-in message, a foreign origin or a missing Origin header is refused", async () => {
    const t = setup();
    const { nonce } = (await (await handlePilotNonce(t.env, t.deps)).json()) as { nonce: string };
    const admin = adminLoginMessage({ origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    expect((await t.loginWith(ALICE, { message: admin })).status).toBe(400);
    const foreign = pilotLoginMessage({ address: lc(ALICE), origin: "https://evil.example", nonce, issued: new Date(T0).toISOString() });
    expect((await t.loginWith(ALICE, { message: foreign })).status).toBe(401);
    const msg = pilotLoginMessage({ address: lc(ALICE), origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    const noOrigin = new Request(`${ORIGIN}/api/pilot/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: msg, signature: await ALICE.signMessage({ message: msg }) }) });
    expect((await handlePilotLogin(noOrigin, t.env, t.deps)).status).toBe(403);
  });

  test("session token: tampered, expired after 12 h or under another secret is refused", async () => {
    const w = lc(ALICE), now = Math.floor(T0 / 1000);
    const tok = await makePilotSession(SESSION_SECRET, w, 3, now);
    expect(await verifyPilotSession(SESSION_SECRET, tok, now)).toEqual({ wallet: w, epoch: 3 });
    expect(await verifyPilotSession(SESSION_SECRET, tok, now + 12 * 3600)).toBeNull();
    expect(await verifyPilotSession("x".repeat(40), tok, now)).toBeNull();
    expect(await verifyPilotSession(SESSION_SECRET, tok.replace(w, lc(BOB)), now)).toBeNull();
    const [a, , exp, mac] = tok.split(".");
    expect(await verifyPilotSession(SESSION_SECRET, `${a}.4.${exp}.${mac}`, now)).toBeNull(); // the epoch is in the MAC
  });

  test("sign-out ends the session: every cookie of the wallet stops working; signing in again works", async () => {
    const t = setup();
    const laptop = await t.signIn();
    const phone = await t.signIn();
    expect((await t.account(laptop)).body.address).toBe(lc(ALICE));
    const out = await handlePilotLogout(t.req("/api/pilot/auth", "DELETE", {}, { cookie: laptop }), t.env, t.deps);
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await t.account(laptop)).body.address).toBeNull();
    expect((await t.account(phone)).body.address).toBeNull();
    const again = await t.signIn();
    expect((await t.account(again)).body.address).toBe(lc(ALICE));
  });

  test("no PILOT_SESSION_SECRET (or a short one): sign-in fails closed", async () => {
    const t = setup({ secret: "short" });
    expect((await t.loginWith(ALICE)).status).toBe(503);
  });

  test("account without a session: open flag, mark and this hour's rates only", async () => {
    const t = setup();
    await t.mark(1000, { trend: -0.0002 });
    const a = await t.account();
    expect(a.body).toMatchObject({ open: true, address: null, regi: null, account: null, positions: [], pending: [] });
    expect(a.body.mark.mark).toBe(1000);
    const hour = Math.floor(t.nowS() / 3600) * 3600;
    expect(a.body.funding).toEqual({ hour, long: -0.0002, short: 0.0002, skew: 0, next: hour + 3600 }); // joined to the mark row
    const pub = await t.call(handleFunding, t.req("/api/pilot/funding"));
    const row = { t: hour, long: -0.0002, short: 0.0002, skew: 0, trend: -0.0002, premium: 0, r: 0, cut: 0, L: 0, S: 0, houseExposure: 0 };
    expect(pub.body).toEqual({ recent: [row], current: row, next: hour + 3600 });
  });
});

describe("REGI gate (R6, spec §8.4)", () => {
  test("not holding now: 'Hold 1,000,000 REGI to join the points pilot.'", async () => {
    const t = setup();
    t.balances.set(`${lc(BOB)}@latest`, ONE - 1n);
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    expect((await t.account(bob)).body.regi).toEqual({ ok: false, snapshot: true, now: false });
    const r = await t.submit(bob, LONG2);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("Hold 1,000,000 REGI to join the points pilot.");
  });

  test("holding now but not at the snapshot block: refused; the snapshot answer is cached for good", async () => {
    const t = setup();
    t.balances.set(`${lc(BOB)}@0x${SNAP.toString(16)}`, 0n);
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    const r = await t.submit(bob, LONG2);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("This wallet didn't hold REGI at the pilot snapshot block.");
    t.balances.set(`${lc(BOB)}@0x${SNAP.toString(16)}`, ONE); // (history does not change; the cache is not re-read)
    t.tick(11 * 60_000);
    await t.account(bob);
    expect(t.rpc.tags.filter((x) => x !== "latest")).toHaveLength(1);
  });

  test("the current balance is cached 10 minutes; selling REGI blocks new orders but closes still fill", async () => {
    const t = setup();
    const alice = await t.signIn();
    expect(t.rpc.calls).toBe(2);
    await t.mark(1000);
    const o = await t.open(alice, LONG2);
    expect(o.body.order.status).toBe("filled");
    expect(t.rpc.calls).toBe(2);
    t.balances.set(`${lc(ALICE)}@latest`, 0n);
    t.tick(10 * 60_000 + 1000);
    await t.mark(1000);
    expect((await t.submit(alice, LONG2)).status).toBe(403);
    expect(t.rpc.calls).toBe(3);
    const c = await t.close(alice, o.body.order.positionId);
    expect(c.body.order.status).toBe("filled");
  });

  test("RPC down: unknown is not 'no' ('Couldn't check REGI right now'), and the RPC is left alone for 30 s", async () => {
    const t = setup();
    const alice = await t.signIn();
    t.tick(11 * 60_000);
    await t.mark(1000);
    t.rpc.down = true;
    const r = await t.submit(alice, LONG2);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("Couldn't check REGI right now");
    const calls = t.rpc.calls;
    t.tick(10_000);
    expect((await t.account(alice)).body.regi).toEqual({ ok: null, snapshot: true, now: null });
    expect(t.rpc.calls).toBe(calls); // backed off
    t.tick(21_000);
    t.rpc.down = false;
    expect((await t.account(alice)).body.regi).toEqual({ ok: true, snapshot: true, now: true });
    expect(t.rpc.calls).toBe(calls + 1);
  });

  test("no PILOT_REGI_SNAPSHOT_BLOCK with PILOT_OPEN \"1\": the pilot is misconfigured (audit PE-7)", async () => {
    const t = setup({ snapshot: null });
    const alice = await t.signIn();
    await t.mark(1000);
    expect((await t.submit(alice, LONG2)).body).toEqual({ error: "pilot misconfigured" });
    expect((await t.account(alice)).body).toMatchObject({ open: false, misconfigured: true });
    t.env.PILOT_OPEN = "0";
    expect((await t.submit(alice, LONG2)).body).toEqual({ error: "pilot closed" });
    expect((await t.account(alice)).body).toMatchObject({ open: false, misconfigured: false });
  });
});

describe("kill switch (R1)", () => {
  test("PILOT_OPEN unset: orders 403 {error:'pilot closed'}; a queued open is refused at the fill; closes still fill", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, LONG2);
    const queued = await t.submit(alice, LONG2);
    expect(queued.status).toBe(202);
    t.env.PILOT_OPEN = "0";
    expect((await t.submit(alice, LONG2)).body).toEqual({ error: "pilot closed" });
    t.tick(1000);
    await t.mark(1000);
    expect((await t.status(alice, queued.body.order.id)).body.order).toMatchObject({ status: "refused", error: "pilot closed" });
    expect((await t.account(alice)).body.open).toBe(false);
    expect((await t.close(alice, o.body.order.positionId)).body.order.status).toBe("filled");
  });
});

describe("fills at the next mark (spec §8.3)", () => {
  test("an order fills at the first mark posted after it, not at the mark it saw", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const s = await t.submit(alice, { side: "long", margin: 1000, lev: 20 });
    expect(s.status).toBe(202);
    expect(s.body.order).toMatchObject({ kind: "open", status: "pending", side: "long", margin: 1000, lev: 20 });
    expect((await t.account(alice)).body.pending).toHaveLength(1);
    t.tick(1000);
    const ing = await t.markJson(1010);
    expect(ing.body.filled).toBe(1);
    const st = await t.status(alice, s.body.order.id);
    expect(st.body.order).toMatchObject({ status: "filled", fillPx: 1010 });
    const fee = 20000 * Engine.RULES.feeRate;
    expect(st.body.position).toMatchObject({ entry: 1010, notional: 20000, liq: Engine.liqPrice({ side: "long", margin: 1000, notional: 20000, entry: 1010 }, 0) });
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(10000 - 1000 - fee, 9);
  });

  test("fills use the mark's own chain time: a mark whose ts lags the server by 3 s does not fill an order it predates", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000, { ts: t.nowS() - 3 });
    const s = await t.submit(alice, LONG2); // arrived at server time T; the stored mark says T − 3
    t.tick(1000);
    const early = await t.markJson(1005, { ts: t.nowS() - 3 }); // posted after the order, but its ts is T − 2
    expect(early.body).toMatchObject({ filled: 0, refused: 0 });
    expect((await t.status(alice, s.body.order.id)).body.order.status).toBe("pending");
    t.tick(4000);
    expect((await t.markJson(1010, { ts: t.nowS() - 3 })).body.filled).toBe(1); // ts T + 2 > T
    expect((await t.status(alice, s.body.order.id)).body.order).toMatchObject({ status: "filled", fillPx: 1010 });
  });

  test("an order the next marks never postdate is still refused after 10 s of server time", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000, { ts: t.nowS() - 3 });
    const s = await t.submit(alice, LONG2);
    t.tick(11_000);
    expect((await t.markJson(1000, { ts: t.nowS() - 12 })).body.refused).toBe(0); // older than the order: not even looked at
    t.tick(1000);
    expect((await t.markJson(1000)).body.refused).toBe(1);
    expect((await t.status(alice, s.body.order.id)).body.order.error).toBe("price updating");
  });

  test("a mark from the same instant as the order does not fill it (strictly newer only)", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000, { ts: t.nowS() - 1 });
    const s = await t.submit(alice, LONG2); // arrived exactly at T.000
    expect((await t.markJson(1001, { ts: t.nowS() })).body.filled).toBe(0); // ts = T: not after the order
    expect((await t.status(alice, s.body.order.id)).body.order.status).toBe("pending");
    t.tick(1000);
    expect((await t.markJson(1002)).body.filled).toBe(1);
  });

  test("no mark within markMaxAgeS (10 s): refused 'price updating', by the next ingest or by the status read", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const a = await t.submit(alice, LONG2);
    t.tick(11_000);
    expect((await t.markJson(1000)).body.refused).toBe(1);
    expect((await t.status(alice, a.body.order.id)).body.order).toMatchObject({ status: "refused", error: "price updating" });
    const b = await t.submit(alice, LONG2);
    t.tick(12_001);
    expect((await t.status(alice, b.body.order.id)).body.order).toMatchObject({ status: "refused", error: "price updating" });
  });

  test("no fresh producer: refused at once ('price updating'); σ unknown is the same", async () => {
    const t = setup();
    const alice = await t.signIn();
    expect((await t.submit(alice, LONG2)).body.error).toBe("price updating");
    await t.mark(1000);
    t.tick(11_000);
    expect((await t.submit(alice, LONG2)).body.error).toBe("price updating");
    for (const x of [{ sigma_24h: null }, { sigma_24h: 0 }, { sigma_1h: null }]) {
      t.tick(1000);
      await t.mark(1000, x);
      expect((await t.submit(alice, LONG2)).body.error).toBe("price updating");
      expect((await t.account(alice)).body.mark).toMatchObject({ fresh: false, maxLev: 1 });
    }
    // a new hour: no orders until a post carries the hour's trend and its rates are fixed
    t.tick(3600_000);
    await t.mark(1000, { trend: null });
    expect((await t.submit(alice, LONG2)).body.error).toBe("price updating");
    expect((await t.account(alice)).body).toMatchObject({ mark: { fresh: false, maxLev: 1 }, funding: { long: null, short: null } });
    t.tick(5000);
    await t.mark(1000, { trend: 0.0001 });
    expect((await t.account(alice)).body.mark).toMatchObject({ fresh: true, maxLev: 30 });
    expect((await t.submit(alice, LONG2)).status).toBe(202);
  });

  test("while the producer catches up after an outage (bars behind the mark) nothing is queued or filled", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    t.tick(2 * 3600_000);
    const m = Math.floor(t.nowS() / 60) * 60;
    // an order that arrived just before this post (inserted directly: none can be queued during the outage)
    t.db.q("INSERT INTO orders (wallet, kind, side, margin, lev, arrived_ms) VALUES (?, 'open', 'long', 1000, 2, ?)", lc(ALICE), T0 + 2 * 3600_000 - 1000);
    const batch = (from: number) => Array.from({ length: 60 }, (_, i) => [from + i * 60, 1000, 1000, 1000]);
    const r = await t.markJson(1000, { bars: batch(m - 7140) });
    expect(r.body).toMatchObject({ filled: 0, refused: 1, last_minute: m - 3600 });
    expect(t.db.q("SELECT error FROM orders")).toEqual([{ error: "price updating" }]);
    expect((await t.submit(alice, LONG2)).body.error).toBe("price updating"); // the mark is fresh, the bars are not
    t.tick(5000);
    await t.mark(1000, { bars: batch(m - 3540) }); // caught up: ends at the open minute
    expect((await t.open(alice, LONG2)).body.order.status).toBe("filled");
  });

  test("orders pause while the base sample is pending and for 60 s after it lands", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000, { base_pending: true });
    expect((await t.submit(alice, LONG2)).body.error).toBe("trading paused");
    t.tick(5000);
    await t.mark(1000);
    const q = await t.submit(alice, LONG2);
    t.tick(1000);
    await t.mark(1000, { base_step_ts: t.nowS() - 5 }); // the base landed: a queued order is refused at the fill
    expect((await t.status(alice, q.body.order.id)).body.order).toMatchObject({ status: "refused", error: "trading paused" });
    t.tick(30_000);
    await t.mark(1000, { base_step_ts: t.nowS() - 35 });
    expect((await t.submit(alice, LONG2)).body.error).toBe("trading paused");
    t.tick(30_000);
    await t.mark(1000, { base_step_ts: t.nowS() - 65 });
    expect((await t.open(alice, LONG2, 1000, { base_step_ts: t.nowS() - 64 })).body.order.status).toBe("filled");
  });

  test("a recorded index milestone pauses new orders (not closes) for 60 s after milestone_ts", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, LONG2);
    const queued = await t.submit(alice, LONG2);
    t.tick(1000);
    const ms = t.nowS() - 2;
    await t.mark(1000, { milestone_ts: ms }); // the milestone lands: the queued open is refused at the fill
    expect(t.db.q("SELECT milestone_ts FROM mark")).toEqual([{ milestone_ts: ms }]);
    expect((await t.status(alice, queued.body.order.id)).body.order).toMatchObject({ status: "refused", error: "Paused: index milestone" });
    const r = await t.submit(alice, LONG2);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Paused: index milestone");
    expect((await t.account(alice)).body.mark).toMatchObject({ milestonePaused: true, basePaused: false });
    // closes still fill during the pause
    expect((await t.close(alice, o.body.order.positionId, 1000, { milestone_ts: ms })).body.order.status).toBe("filled");
    t.tick(58_000);
    await t.mark(1000, { milestone_ts: ms }); // 60 s after the milestone: open again
    expect((await t.account(alice)).body.mark.milestonePaused).toBe(false);
    expect((await t.open(alice, LONG2, 1000, { milestone_ts: ms })).body.order.status).toBe("filled");
  });

  test("the engine's cap and pause use the stored σ_24h, σ_1h and ch1", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000, { ch1: 0.006 });
    expect((await t.submit(alice, LONG2)).body.error).toBe("trading paused");
    t.tick(5000);
    await t.mark(1000, { sigma_24h: 0.04, sigma_1h: 0.008 });
    expect((await t.submit(alice, { side: "long", margin: 100, lev: 3 })).body.error).toBe("leverage above the current cap");
    const ok = await t.open(alice, { side: "long", margin: 100, lev: 2 }, 1000, { sigma_24h: 0.04, sigma_1h: 0.008 });
    expect(ok.body.order.status).toBe("filled");
    // the fill re-checks: a pause at the fill mark refuses the queued order
    t.tick(5000);
    await t.mark(1000);
    const q = await t.submit(alice, LONG2);
    t.tick(1000);
    await t.mark(1000, { ch1: 0.006 });
    expect((await t.status(alice, q.body.order.id)).body.order).toMatchObject({ status: "refused", error: "trading paused" });
  });

  test("bad bodies, engine refusals and CSRF", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    expect((await t.submit(alice, { side: "up", margin: 100, lev: 1 })).status).toBe(400);
    expect((await t.submit(alice, { side: "long", margin: "100", lev: 1 })).status).toBe(400);
    expect((await t.submit(alice, { side: "long", margin: 5, lev: 1 })).body.error).toBe("margin below minimum");
    expect((await t.submit(alice, { side: "long", margin: 100, lev: 4 })).body.error).toBe("leverage not allowed");
    expect((await t.submit(alice, { side: "long", margin: 20000, lev: 1 })).body.error).toBe("insufficient balance");
    expect((await t.submit("", LONG2)).status).toBe(401);
    const noOrigin = new Request(`${ORIGIN}/api/pilot/order`, { method: "POST", headers: { "content-type": "application/json", cookie: alice }, body: JSON.stringify(LONG2) });
    expect((await handleOrder(noOrigin, t.env, t.deps)).status).toBe(403);
    const bob = await t.signIn(BOB);
    const s = await t.submit(alice, LONG2);
    expect((await t.status(bob, s.body.order.id)).status).toBe(404); // someone else's order
  });

  test("close fills at the next mark with funding and borrow (R3): margin + PnL − funding − borrow − fee; history shows it", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000, { trend: 0.0005 }); // an empty book: longs pay the trend, shorts receive it
    const o = await t.open(alice, { side: "short", margin: 1000, lev: 10 }, 1000, { trend: 0.0005 });
    const id = o.body.order.positionId as number;
    const pos = o.body.position;
    t.tick(2 * 3600_000);
    await t.mark(1000, { trend: 0.0005 }); // two hours on: fixed from a book that is all short (skew −1)
    const rates = t.db.q<{ t: number; long: number; short: number; skew: number }>("SELECT hour AS t, long, short, skew FROM rates ORDER BY hour");
    expect(rates.map((r) => r.skew)).toEqual([0, -1]);
    expect(rates[1].short).toBeCloseTo(-0.0005 + 1.5 * 0.0004, 12); // −trend + r_max · |skew|: the heavy side pays
    const p = await t.call(handlePositions, t.req("/api/pilot/positions", "GET", undefined, { cookie: alice }));
    const enginePos = { side: "short" as const, margin: 1000, lev: 10, notional: 10000, entry: 1000, liq: pos.liq, openedAt: pos.openedAt };
    const now = t.nowS();
    expect(p.body.positions[0].funding).toBeCloseTo(-Engine.fundingPaid(enginePos, rates, now), 9);
    expect(p.body.positions[0].funding).toBeGreaterThan(0); // it received the trend for most of an hour
    expect(p.body.positions[0].borrow).toBeCloseTo(Engine.borrowPaid(enginePos, now), 9);
    expect(p.body.positions[0].liq).toBeCloseTo(Engine.liqPrice(enginePos, Engine.fundingPaid(enginePos, rates, now) + Engine.borrowPaid(enginePos, now)), 9);
    const before = t.balanceOf(lc(ALICE));
    const c = await t.close(alice, id, 990);
    expect(c.body.order.status).toBe("filled");
    const fillTs = t.db.q<{ filled_at: number }>("SELECT filled_at FROM orders WHERE id = ?", c.body.order.id)[0].filled_at;
    const e = Engine.close(enginePos, 990, fillTs, rates);
    expect(c.body.position).toMatchObject({ reason: "close", exit: 990 });
    expect(c.body.position.pnl).toBeCloseTo(e.pnl, 9);
    expect(c.body.position.funding).toBeCloseTo(e.funding, 9);
    expect(c.body.position.borrow).toBeCloseTo(e.borrow, 9);
    expect(e.borrow).toBeGreaterThan(0);
    expect(c.body.position.returned).toBeCloseTo(e.payout, 9);
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(before + e.payout, 9);
    const h = await t.history(alice);
    expect(h.body.history[0].net).toBeCloseTo(e.payout - 1000 - 10000 * Engine.RULES.feeRate, 9);
    expect(h.body.history[0].fee).toBeCloseTo(10000 * Engine.RULES.feeRate + e.fee, 9);
    expect(h.body.history[0].borrow).toBeCloseTo(e.borrow, 9);
    // R4: the fees and the borrow are in the ledger
    expect(t.db.q("SELECT kind, amount FROM ledger WHERE ref IN (?, ?, ?) ORDER BY ref", `borrow:${id}`, `close:${id}`, `open:${id}`)).toEqual([
      { kind: "borrow", amount: e.borrow }, { kind: "fee", amount: e.fee }, { kind: "fee", amount: 10000 * Engine.RULES.feeRate },
    ]);
  });

  test("someone else's position cannot be closed; a closed one answers 409", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    const o = await t.open(alice, LONG2);
    expect((await t.submitClose(bob, o.body.order.positionId)).status).toBe(404);
    await t.close(alice, o.body.order.positionId);
    expect((await t.submitClose(alice, o.body.order.positionId)).status).toBe(409);
  });
});

describe("no hedging (ruling)", () => {
  test("one direction at a time: refused at the order and at the fill, open again after closing", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    const long = await t.open(alice, LONG2);
    const r = await t.submit(alice, { side: "short", margin: 100, lev: 2 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Close your long first");
    expect((await t.open(bob, { side: "short", margin: 100, lev: 2 })).body.order.status).toBe("filled"); // per wallet
    expect((await t.submit(bob, LONG2)).body.error).toBe("Close your short first");
    // both queued before either fills: the first fills, the other side is refused at the fill
    await t.close(alice, long.body.order.positionId);
    const a = await t.submit(alice, { side: "short", margin: 100, lev: 2 });
    const b = await t.submit(alice, LONG2);
    expect([a.status, b.status]).toEqual([202, 202]);
    t.tick(1000);
    expect((await t.markJson(1000)).body).toMatchObject({ filled: 1, refused: 1 });
    expect((await t.status(alice, b.body.order.id)).body.order.error).toBe("Close your short first");
    expect(t.db.q("SELECT DISTINCT side FROM positions WHERE wallet = ? AND closed_at IS NULL", lc(ALICE))).toEqual([{ side: "short" }]);
  });
});

describe("concurrency (R3)", () => {
  test("two orders that cannot both fit: one fills, the other is refused 'insufficient balance'", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    t.db.q("UPDATE accounts SET balance = 1500");
    const [a, b] = await Promise.all([t.submit(alice, LONG2), t.submit(alice, LONG2)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    t.tick(1000);
    expect((await t.markJson(1000)).body).toMatchObject({ filled: 1, refused: 1 });
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(1500 - 1000 - 2000 * Engine.RULES.feeRate, 9);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions")[0]).toEqual({ n: 1 });
    expect(t.db.q("SELECT error FROM orders WHERE status = 'refused'")).toEqual([{ error: "insufficient balance" }]);
  });

  test("two ingests racing over the same pending order: it fills once", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const s = await t.submit(alice, LONG2);
    t.tick(2000);
    const before = t.db.batches;
    const [x, y] = await Promise.all([t.markJson(1000, { ts: t.nowS() - 1 }), t.markJson(1001)]);
    expect(t.db.batches - before).toBeGreaterThanOrEqual(4); // both marks won and both tried the fill batch
    expect(x.body.filled + y.body.filled).toBe(1);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions")[0]).toEqual({ n: 1 });
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(10000 - 1000 - 2000 * Engine.RULES.feeRate, 9);
    expect((await t.status(alice, s.body.order.id)).body.order.status).toBe("filled");
  });

  test("two orders cannot exceed 5 open positions", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    for (let i = 0; i < 4; i++) expect((await t.open(alice, { side: "long", margin: 10, lev: 1 })).body.order.status).toBe("filled");
    await Promise.all([t.submit(alice, { side: "long", margin: 10, lev: 1 }), t.submit(alice, { side: "long", margin: 10, lev: 1 })]);
    t.tick(1000);
    expect((await t.markJson(1000)).body).toMatchObject({ filled: 1, refused: 1 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")[0]).toEqual({ n: 5 });
  });

  test("a double close settles once, in one ingest or in two racing ones", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, LONG2);
    const id = o.body.order.positionId as number;
    const mid = t.balanceOf(lc(ALICE));
    t.tick(1000);
    await t.mark(1010);
    await Promise.all([t.submitClose(alice, id), t.submitClose(alice, id)]);
    t.tick(2000);
    const [x, y] = await Promise.all([t.markJson(1010, { ts: t.nowS() - 1 }), t.markJson(1010)]);
    expect(x.body.filled + y.body.filled).toBe(1);
    expect(x.body.refused + y.body.refused).toBe(1);
    const row = t.db.q<{ opened_at: number; closed_at: number }>("SELECT opened_at, closed_at FROM positions")[0];
    const e = Engine.close({ side: "long", margin: 1000, notional: 2000, entry: 1000, openedAt: row.opened_at }, 1010, row.closed_at, []);
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(mid + e.payout, 9);
  });
});

/** A stored hour's rates (tests write them directly): long / short per unit per hour, r = the skew term. */
const putRates = (t: ReturnType<typeof setup>, hour: number, long: number, short: number, r = 0) =>
  t.db.q("INSERT OR REPLACE INTO rates (hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post) VALUES (?, ?, ?, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'test')", hour, long, short, r);

describe("liquidation (R3, cost-aware)", () => {
  test("lazy: a read settles a position crossed by a stored bar since it opened, at the engine's cost-moved price", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 20 });
    const p = o.body.position;
    const pos = { side: "long" as const, margin: 1000, lev: 20, notional: 20000, entry: 1000, liq: p.liq, openedAt: p.openedAt };
    const bal = t.balanceOf(lc(ALICE));
    const h0 = Math.floor(p.openedAt / 3600) * 3600;
    // longs pay 0.5%/h: after ~2 h the liquidation price has risen well above the price at open
    putRates(t, h0, 0.005, -0.005);
    putRates(t, h0 + 3600, 0.005, -0.005);
    const rates = [{ t: h0, long: 0.005, short: -0.005 }, { t: h0 + 3600, long: 0.005, short: -0.005 }];
    const tb = h0 + 2 * 3600 - 300;
    const lpAt = (t2: number) => Engine.liqPrice(pos, Engine.fundingPaid(pos, rates, t2 + 60) + Engine.borrowPaid(pos, t2 + 60));
    const lpThen = lpAt(tb);
    expect(lpThen).toBeGreaterThan(p.liq + 5);
    t.db.q("INSERT OR REPLACE INTO bars (minute, h, l, c) VALUES (?, 1000, ?, 1000)", h0 - 60, p.liq - 100); // before the open: ignored
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1000, ?, 1000)", tb - 1800, lpAt(tb - 1800) + 0.5); // just above the price then
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1000, ?, 1000)", tb, lpThen - 1); // crosses only with funding
    expect(lpThen - 1).toBeGreaterThan(p.liq);
    // written behind the ingest's back: the sweep watermark lags the stored bars, so the lazy check reads them
    t.db.q("UPDATE mark SET bars_minute = ?, swept_minute = ?", tb, Math.floor(p.openedAt / 60) * 60);
    t.tick(2 * 3600_000);
    const a = await t.account(alice);
    expect(a.body.positions).toEqual([]);
    const hit = Engine.liquidation(pos, t.db.q<Engine.MinuteBar>("SELECT minute AS t, h, l, c FROM bars ORDER BY minute"), rates)!;
    expect(hit.t).toBe(tb);
    const row = t.db.q<Json>("SELECT closed_at, exit, pnl, accrued, borrow, fill, returned, reason FROM positions")[0];
    expect(row).toEqual({
      closed_at: tb, exit: hit.price, pnl: Engine.pnl(pos, hit.price), accrued: -Engine.fundingPaid(pos, rates, tb + 60), borrow: Engine.borrowPaid(pos, tb + 60),
      fill: lpThen - 1, returned: 0, reason: "liquidation",
    });
    expect(t.balanceOf(lc(ALICE))).toBe(bal);
    await t.account(alice); // idempotent
    expect(t.balanceOf(lc(ALICE))).toBe(bal);
    expect((await t.history(alice)).body.history[0]).toMatchObject({ reason: "liquidation", returned: 0 });
  });

  test("lazy: candidates are paged past 500 (the first crossing after many near misses is found)", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 20 });
    const p = o.body.position;
    const pos = { side: "long" as const, margin: 1000, lev: 20, notional: 20000, entry: 1000, liq: p.liq, openedAt: p.openedAt };
    const h0 = Math.floor(p.openedAt / 3600) * 3600;
    const rates = Array.from({ length: 12 }, (_, i) => ({ t: h0 + i * 3600, long: 0.001, short: -0.001 })); // longs pay: liq rises
    for (const r of rates) putRates(t, r.t, r.long, r.short);
    const m0 = Math.floor(p.openedAt / 60) * 60 + 120;
    for (let i = 0; i < 620; i++) {
      const tm = m0 + i * 60;
      const lp = Engine.liqPrice(pos, Engine.fundingPaid(pos, rates, tm + 60) + Engine.borrowPaid(pos, tm + 60));
      const l = i === 610 ? lp - 0.01 : lp + 0.01; // each bar just above its own liquidation price, then one below
      t.db.q("INSERT OR REPLACE INTO bars (minute, h, l, c) VALUES (?, 1000, ?, 1000)", tm, l);
    }
    t.db.q("UPDATE mark SET bars_minute = ?, swept_minute = ?", m0 + 619 * 60, m0 - 60); // unswept bars
    t.tick(11 * 3600_000);
    const all = t.db.q<Engine.MinuteBar>("SELECT minute AS t, h, l, c FROM bars ORDER BY minute");
    const want = Engine.liquidation(pos, all, rates)!;
    expect(want.t).toBe(m0 + 610 * 60);
    expect((await t.account(alice)).body.positions).toEqual([]);
    expect(t.db.q("SELECT closed_at, exit FROM positions")).toEqual([{ closed_at: want.t, exit: want.price }]);
  });

  test("a bar in the opening minute does not count (the engine skips bars that start before the open)", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, { side: "short", margin: 1000, lev: 20 });
    const m0 = Math.floor(o.body.position.openedAt / 60) * 60;
    t.db.q("INSERT OR REPLACE INTO bars (minute, h, l, c) VALUES (?, 2000, 1000, 1000)", m0);
    expect((await t.account(alice)).body.positions).toHaveLength(1);
  });

  test("ingest: a mark post settles the positions its bars cross, with the engine's values", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 1000, lev: 20 });
    const b = await t.open(bob, { side: "short", margin: 500, lev: 20 });
    const keep = await t.open(alice, { side: "long", margin: 100, lev: 1 });
    t.tick(70_000);
    const m = Math.floor(t.nowS() / 60) * 60; // the minute after the opens
    await t.markJson(1000, { bars: [[m - 60, 1000, 1000, 1000], [m, 1060, 940, 1000]] });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")[0]).toEqual({ n: 3 }); // the open minute is not swept yet
    t.tick(60_000);
    const r = await t.markJson(1000, { bars: [[m, 1060, 940, 1000], [m + 60, 1000, 1000, 1000]] }); // m has finished
    expect(r.body.liquidated).toBe(2);
    const rows = t.db.q<Json>("SELECT id, closed_at, exit, pnl, returned, reason FROM positions ORDER BY id");
    for (const x of [a, b]) {
      const p = x.body.position;
      const pos = { side: p.side, margin: p.margin, lev: p.lev, notional: p.notional, entry: p.entry, liq: p.liq, openedAt: p.openedAt };
      const hit = Engine.liquidation(pos, [{ t: m, h: 1060, l: 940, c: 1000 }], [])!;
      expect(rows.find((y) => y.id === x.body.order.positionId)).toEqual({ id: x.body.order.positionId, closed_at: m, exit: hit.price, pnl: Engine.pnl(pos, hit.price), returned: 0, reason: "liquidation" });
    }
    expect(rows.find((y) => y.id === keep.body.order.positionId)!.closed_at).toBeNull();
  });

  test("a gap bar liquidates what the missing minutes would have", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 20 });
    t.tick(90 * 60_000);
    const r = await t.markJson(1000, { candle: [1000, 1001, 950, 1000, 1, 1] });
    expect(r.body).toMatchObject({ gapBars: 2, gaps: 0, liquidated: 1 });
    expect(t.db.q("SELECT reason FROM positions WHERE id = ?", o.body.order.positionId)).toEqual([{ reason: "liquidation" }]);
  });
});

describe("D1 usage", () => {
  test("an account poll: one query for the account + open positions, the mark row, pending orders, rates; no bars, no funding list", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    await t.open(alice, LONG2);
    await t.open(alice, { side: "long", margin: 50, lev: 1 });
    t.tick(5000);
    await t.mark(1000);
    const before = t.db.log.length;
    const a = await t.account(alice);
    expect(a.body.positions).toHaveLength(2);
    const sql = t.db.log.slice(before);
    expect(sql.filter((x) => /FROM accounts a LEFT JOIN positions p/.test(x))).toHaveLength(1);
    expect(sql.filter((x) => /FROM positions/.test(x) && !/LEFT JOIN/.test(x))).toEqual([]);
    expect(sql.filter((x) => /FROM bars/.test(x))).toEqual([]);
    expect(sql.filter((x) => /FROM funding ORDER BY hour_start DESC/.test(x))).toEqual([]);
    expect(sql.filter((x) => /^\s*(INSERT|UPDATE|DELETE)/i.test(x))).toEqual([]); // a poll writes nothing (REGI cached)
    expect(sql.length).toBeLessThanOrEqual(4);
  });

  test("history, a wallet's open positions and its pending orders read through their indexes (no sort, no scan)", () => {
    const t = setup();
    const plan = (q: string, ...p: unknown[]) => t.db.q<{ detail: string }>(`EXPLAIN QUERY PLAN ${q}`, ...p).map((r) => r.detail).join(" | ");
    const h = plan(HISTORY_SQL, "0x1", 100);
    expect(h).toMatch(/USING INDEX positions_wallet/);
    expect(h).not.toMatch(/TEMP B-TREE|SCAN positions/);
    const o = plan("SELECT * FROM accounts a LEFT JOIN positions p ON p.wallet = a.wallet AND p.closed_at IS NULL WHERE a.wallet = ? ORDER BY p.id", "0x1");
    expect(o).toMatch(/positions_wallet/);
    expect(o).not.toMatch(/SCAN p\b|SCAN positions/);
    const pend = plan("SELECT * FROM orders WHERE wallet = ? AND status = 'pending' ORDER BY id DESC LIMIT 10", "0x1");
    expect(pend).toMatch(/orders_wallet/);
    expect(pend).not.toMatch(/TEMP B-TREE/);
  });

  test("a close in a minute whose (open, not yet stored) bar crosses the liquidation price is liquidated, not closed", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 20 });
    const liq = o.body.position.liq as number;
    t.tick(60_000);
    await t.mark(1000);
    const s = await t.submitClose(alice, o.body.order.positionId);
    t.tick(1000);
    const m = Math.floor(t.nowS() / 60) * 60;
    await t.markJson(1000, { bars: [[m - 60, 1000, 1000, 1000], [m, 1000, liq - 1, 1000]] }); // the low crossed earlier this minute
    expect((await t.status(alice, s.body.order.id)).body.order).toMatchObject({ status: "refused", error: "already closed" });
    expect(t.db.q("SELECT reason, returned FROM positions")).toEqual([{ reason: "liquidation", returned: 0 }]);
  });
});

describe("rate limits (R8)", () => {
  test("orders: 30 per minute per wallet; the next minute starts over", async () => {
    const t = setup();
    const alice = await t.signIn();
    for (let i = 0; i < 30; i++) expect((await t.submit(alice, { side: "up" })).status).toBe(400);
    expect((await t.submit(alice, { side: "up" })).status).toBe(429);
    const bob = await t.signIn(BOB);
    expect((await t.submit(bob, { side: "up" })).status).toBe(400);
    t.tick(60_000);
    expect((await t.submit(alice, { side: "up" })).status).toBe(400);
  });

  test("closes: 60 per minute per wallet", async () => {
    const t = setup();
    const alice = await t.signIn();
    for (let i = 0; i < 60; i++) expect((await t.submitClose(alice, 999)).status).toBe(404);
    expect((await t.submitClose(alice, 999)).status).toBe(429);
  });
});

describe("leaderboard and history (R8)", () => {
  test("top 50 by equity (funding and borrow included) at the latest mark, shortened addresses only, cached 60 s", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    await t.open(alice, { side: "long", margin: 1000, lev: 3 });
    await t.open(bob, { side: "short", margin: 1000, lev: 3 });
    for (let i = 0; i < 60; i++) {
      const w = "0x" + i.toString(16).padStart(40, "0");
      t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, ?, 1, 0)", w, 5000 + i);
      t.db.q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, fee, returned, reason, exit, pnl) VALUES (?, 'long', 10, 1, 10, 1000, 1, 0, 1, 0, 10, 'close', 1000, 0)", w);
    }
    t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES ('0x00000000000000000000000000000000000000ff', 99999, 1, 0)");
    t.tick(5000);
    await t.mark(1100);
    const cache = new MemoryCache();
    const res = await handleLeaderboard(t.req("/api/pilot/leaderboard"), t.env, { ...t.deps, cache: cache as unknown as Cache });
    const text = await res.text();
    const body = JSON.parse(text) as Json;
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0].address).toBe(`${lc(ALICE).slice(0, 6)}…${lc(ALICE).slice(-4)}`);
    const opened = t.db.q<{ opened_at: number }>("SELECT opened_at FROM positions WHERE wallet = ?", lc(ALICE))[0].opened_at;
    const borrow = Engine.borrowPaid({ notional: 3000, margin: 1000, openedAt: opened }, t.nowS());
    expect(borrow).toBeGreaterThan(0);
    expect(body.rows[0].equity).toBeCloseTo(10000 - 3000 * Engine.RULES.feeRate + 300 - borrow, 6);
    expect(text).not.toContain(lc(ALICE));
    expect(text).not.toContain("99999");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    t.db.q("UPDATE accounts SET balance = 1e9 WHERE wallet = ?", lc(BOB));
    const again = (await (await handleLeaderboard(t.req("/api/pilot/leaderboard"), t.env, { ...t.deps, cache: cache as unknown as Cache })).json()) as Json;
    expect(again.rows[0].address).toBe(body.rows[0].address);
  });

  test("history: the last 100 closed positions, newest first", async () => {
    const t = setup();
    const alice = await t.signIn();
    for (let i = 0; i < 120; i++) {
      t.db.q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, fee, returned, reason, exit, pnl, accrued) VALUES (?, 'long', 10, 1, 10, 1000, 1, ?, ?, 0.002, 10, 'close', 1000, 0, 0)", lc(ALICE), i, 1000 + i);
    }
    const h = await t.history(alice);
    expect(h.body.history).toHaveLength(100);
    expect(h.body.history[0].closedAt).toBe(1119);
    expect(h.body.history[99].closedAt).toBe(1020);
    expect((await t.history("")).status).toBe(401);
  });
});
