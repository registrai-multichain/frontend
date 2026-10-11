import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Engine from "../../src/lib/abi-pilot";
import { handlePublicMark, INGEST_MAX_STATEMENTS } from "../lib/pilot";
import { handlePilotLogin, handlePilotNonce, ipKey } from "../lib/pilot-auth";
import { pilotLoginMessage } from "../../src/lib/abi-pilot-api";
import { ALICE, BOB, lc, ONE, ORIGIN, setup, SNAP, T0, type Json } from "./pilot-harness";

/**
 * Audit fixes, site batch (docs/superpowers/plans/2026-10-11-audit-site-fixes.md), group A: the pilot's leverage cap,
 * the REGI minimum, loud snapshot misconfiguration (PE-7), the recorder block list (F4), the pending-order cap (SS-5)
 * and the ingest's invocation-wide statement budget (review R3).
 */
const LONG = (lev: number) => ({ side: "long", margin: 1000, lev });

// the misconfiguration log (once per isolate per problem) is asserted where it matters, and kept quiet elsewhere
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe("PILOT_MAX_LEV (owner decision 2026-10-11: 10× until F1 is live and re-measured)", () => {
  test("unset: 10×. The mark reports min(engine cap, 10); an order above it is refused, 10× is accepted", async () => {
    const t = setup({ maxLev: null });
    const alice = await t.signIn();
    await t.mark(1000);
    const pub = (await (await handlePublicMark(t.req("/api/index/mark"), t.env, t.deps)).json()) as Json;
    expect(pub).toMatchObject({ maxLev: 10, levCap: 10 }); // the engine alone allows 30× at this σ
    expect((await t.account(alice)).body.mark).toMatchObject({ maxLev: 10, levCap: 10 });
    const r = await t.submit(alice, LONG(20));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("leverage above the current cap");
    expect((await t.submit(alice, LONG(30))).body.error).toBe("leverage above the current cap");
    expect((await t.submit(alice, LONG(10))).status).toBe(202);
  });

  test("a value between levels caps at the level below; the engine's lower cap still wins", async () => {
    const t = setup({ maxLev: "7" });
    await t.mark(1000);
    expect((await t.account()).body.mark).toMatchObject({ maxLev: 5, levCap: 5 });
    t.tick(1000);
    await t.mark(1000, { sigma_24h: 0.05 }); // volatility cap floor(0.10 / 0.05) = 2
    expect((await t.account()).body.mark).toMatchObject({ maxLev: 2, levCap: 5 });
  });

  test("an order queued under a higher cap is refused at the fill once the cap is lowered", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const s = await t.submit(alice, LONG(20));
    expect(s.status).toBe(202);
    t.env.PILOT_MAX_LEV = "10";
    t.tick(1000);
    await t.mark(1000);
    expect((await t.status(alice, s.body.order.id)).body.order).toMatchObject({ status: "refused", error: "leverage above the current cap" });
  });

  test("not an integer ≥ 1: misconfigured", async () => {
    for (const bad of ["abc", "0", "2.5", "-3"]) {
      const t = setup({ maxLev: bad });
      const alice = await t.signIn();
      await t.mark(1000);
      expect((await t.submit(alice, LONG(1))).body).toEqual({ error: "pilot misconfigured" });
    }
  });
});

describe("PILOT_REGI_MIN (owner decision: ≥ 1,000,000 REGI)", () => {
  test("default 1,000,000: one REGI short of it is refused with the amount in the message", async () => {
    const t = setup();
    t.balances.set(`${lc(BOB)}@latest`, ONE - 10n ** 18n);
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    expect((await t.account(bob)).body).toMatchObject({ regiMin: 1_000_000, regi: { ok: false, snapshot: true, now: false } });
    expect((await t.submit(bob, LONG(2))).body.error).toBe("Hold 1,000,000 REGI to join the points pilot.");
  });

  test("a changed minimum applies to the cached snapshot balance without another snapshot read", async () => {
    const t = setup();
    const alice = await t.signIn(); // 2,000,000 at the snapshot, 5,000,000 now
    await t.mark(1000);
    const snapReads = () => t.rpc.tags.filter((x) => x !== "latest").length;
    expect(snapReads()).toBe(1);
    t.env.PILOT_REGI_MIN = "3000000";
    const r = await t.submit(alice, LONG(2));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("This wallet didn't hold REGI at the pilot snapshot block.");
    t.env.PILOT_REGI_MIN = "2000000";
    expect((await t.submit(alice, LONG(2))).status).toBe(202);
    expect(snapReads()).toBe(1);
    expect((await t.account(alice)).body.regiMin).toBe(2_000_000);
  });

  test("not a positive whole number: misconfigured", async () => {
    for (const bad of ["0", "1e6", "lots"]) {
      const t = setup({ regiMin: bad });
      const alice = await t.signIn();
      await t.mark(1000);
      expect((await t.submit(alice, LONG(1))).body).toEqual({ error: "pilot misconfigured" });
      expect((await t.account(alice)).body).toMatchObject({ open: false, misconfigured: true, regi: null });
    }
  });
});

describe("audit PE-7: a wrong snapshot block refuses every order, says so, and logs once", () => {
  test.each([
    ["empty", ""],
    ["not a number", "0x15f0a3f"],
    ["before REGI existed", "22419070"],
    ["in the future", "99999999999"],
  ])("%s", async (_, block) => {
    const t = setup({ snapshot: block });
    const alice = await t.signIn();
    await t.mark(1000);
    const calls = t.rpc.calls;
    const r = await t.submit(alice, LONG(1));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "pilot misconfigured" });
    expect(t.rpc.calls).toBe(calls); // no REGI read
    expect((await t.account(alice)).body).toMatchObject({ open: false, misconfigured: true, regi: null });
    expect((await t.account()).body).toMatchObject({ open: false, misconfigured: true });
  });

  test("REGI's deploy block itself and a past block are fine", async () => {
    for (const block of ["22419071", String(SNAP)]) {
      const t = setup({ snapshot: block });
      t.balances.set(`${lc(ALICE)}@0x${Number(block).toString(16)}`, 2n * ONE);
      const alice = await t.signIn();
      await t.mark(1000);
      expect((await t.account(alice)).body).toMatchObject({ open: true, misconfigured: false });
      expect((await t.submit(alice, LONG(1))).status).toBe(202);
    }
  });

  test("console.error once per isolate for the same problem; a queued open is refused at the fill", async () => {
    const err = vi.mocked(console.error);
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const s = await t.submit(alice, LONG(1));
    expect(s.status).toBe(202);
    t.env.PILOT_REGI_SNAPSHOT_BLOCK = "88888888888";
    t.tick(1000);
    await t.mark(1000);
    expect((await t.status(alice, s.body.order.id)).body.order).toMatchObject({ status: "refused", error: "pilot misconfigured" });
    for (let i = 0; i < 3; i++) {
      await t.account(alice);
      await t.submit(alice, LONG(1));
    }
    const mine = err.mock.calls.filter((c) => String(c[0]).includes("88888888888"));
    expect(mine).toHaveLength(1);
    expect(String(mine[0][0])).toMatch(/^pilot misconfigured: PILOT_REGI_SNAPSHOT_BLOCK 88888888888 is in the future/);
  });

  test("PILOT_OPEN not \"1\": closed, never misconfigured", async () => {
    const t = setup({ open: false, snapshot: "" });
    const alice = await t.signIn();
    await t.mark(1000);
    expect((await t.submit(alice, LONG(1))).body).toEqual({ error: "pilot closed" });
    expect((await t.account(alice)).body).toMatchObject({ open: false, misconfigured: false });
  });
});

describe("audit F4: PILOT_BLOCKED_WALLETS (milestone recorders)", () => {
  test("opens refused with the plain message; closes still fill; a queued open is refused at the fill", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, LONG(2));
    expect(o.body.order.status).toBe("filled");
    const queued = await t.submit(alice, LONG(2));
    expect(queued.status).toBe(202);
    t.env.PILOT_BLOCKED_WALLETS = ` 0x${"9".repeat(40)} , ${ALICE.address} `; // any case, spaces
    const r = await t.submit(alice, LONG(2));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("This wallet can't trade in the pilot.");
    t.tick(1000);
    await t.mark(1000);
    expect((await t.status(alice, queued.body.order.id)).body.order).toMatchObject({ status: "refused", error: "This wallet can't trade in the pilot." });
    expect((await t.close(alice, o.body.order.positionId)).body.order.status).toBe("filled");
    const bob = await t.signIn(BOB);
    expect((await t.submit(bob, LONG(2))).status).toBe(202);
  });
});

describe("audit SS-5: at most 3 pending orders per wallet", () => {
  test("a 4th pending order is refused; once they fill, orders are accepted again", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    for (let i = 0; i < 3; i++) expect((await t.submit(alice, { side: "long", margin: 100, lev: 2 })).status).toBe(202);
    const fourth = await t.submit(alice, { side: "long", margin: 100, lev: 2 });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error).toBe("too many pending orders");
    expect((await t.submit(await t.signIn(BOB), { side: "long", margin: 100, lev: 2 })).status).toBe(202); // per wallet
    t.tick(1000);
    expect((await t.markJson(1000)).body.filled).toBe(4);
    expect((await t.submit(alice, { side: "long", margin: 100, lev: 2 })).status).toBe(202);
  });

  test("queued opens count as open in the pre-check (5 open positions at most)", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    for (let i = 0; i < 3; i++) expect((await t.open(alice, { side: "long", margin: 100, lev: 2 })).body.order.status).toBe("filled");
    for (let i = 0; i < 2; i++) expect((await t.submit(alice, { side: "long", margin: 100, lev: 2 })).status).toBe(202);
    const sixth = await t.submit(alice, { side: "long", margin: 100, lev: 2 });
    expect(sixth.status).toBe(409);
    expect(sixth.body.error).toBe("too many open positions");
  });

  test("closes count too: a 4th pending close is refused", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await t.open(alice, { side: "long", margin: 100, lev: 2 })).body.order.positionId);
    for (const id of ids.slice(0, 3)) expect((await t.submitClose(alice, id)).status).toBe(202);
    const r = await t.submitClose(alice, ids[3]);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("too many pending orders");
  });
});

describe("review R3 + audit SS-5: one ingest runs at most INGEST_MAX_STATEMENTS statements in all", () => {
  /** n open 30× longs at 1000 (inserted directly: one per wallet), liquidated by a drop to 960. */
  function crowd(t: ReturnType<typeof setup>, n: number) {
    const opened = t.nowS() - 30;
    const liq = Engine.liqPrice({ side: "long", margin: 100, notional: 3000, entry: 1000 }, 0);
    for (let i = 0; i < n; i++) {
      const w = `0x${(i + 1).toString(16).padStart(40, "0")}`;
      t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, 9899.7, 1, ?)", w, opened);
      t.db.q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, 'long', 100, 30, 3000, 1000, ?, ?, 0.3, ?)", w, liq, opened, opened);
    }
  }

  test("150 liquidations in one minute: spread over posts, each under the budget, each settled exactly once; fills wait for them", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    crowd(t, 150);
    const post = async (bars: number[][]) => {
      const r = await t.markJson(960, { bars, candle: [1000, 1000, 960, 960, 1, 1] });
      expect(r.status).toBe(200);
      return r.body;
    };
    t.tick(1000);
    let m = Math.floor(t.nowS() / 60) * 60;
    const posts: Json[] = [await post([[m - 60, 1000, 1000, 1000], [m, 1000, 960, 960]])]; // the crash minute, still open
    t.tick(60_000);
    m += 60;
    posts.push(await post([[m - 60, 1000, 960, 960], [m, 960, 960, 960]])); // stored: the in-batch sweep takes what fits
    expect(posts[1]).toMatchObject({ heldBack: true });
    expect(posts[1].liquidated).toBeGreaterThan(0);
    // an order now (its liquidation price is far below 960) waits while the safety net works through the rest
    const s = await t.submit(alice, { side: "long", margin: 1000, lev: 2 });
    expect(s.status).toBe(202);
    const left = () => t.db.q<{ n: number }>("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL AND wallet <> ?", lc(ALICE))[0].n;
    for (let i = 0; i < 8 && (left() > 0 || posts[posts.length - 1].heldBack); i++) {
      t.tick(1000);
      posts.push(await post([[m - 60, 1000, 960, 960], [m, 960, 960, 960]]));
    }
    for (const p of posts) expect(p.queries).toBeLessThanOrEqual(INGEST_MAX_STATEMENTS);
    const net = posts.slice(2);
    expect(net.some((p) => p.heldBack && p.netLiquidated > 0)).toBe(true); // the net was cut by the budget at least once
    for (const p of posts.filter((x) => x.heldBack)) expect(p.filled).toBe(0); // nothing fills while liquidations wait
    // every crowd position liquidated, each exactly once
    expect(posts.reduce((a, p) => a + p.liquidated + p.netLiquidated, 0)).toBe(150);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE reason = 'liquidation'")).toEqual([{ n: 150 }]);
    expect(t.db.q("SELECT ref, COUNT(*) AS n FROM ledger WHERE ref LIKE 'settle:%' AND kind = 'house_trueup' GROUP BY ref HAVING COUNT(*) > 1")).toEqual([]);
    expect(t.db.q("SELECT ref, COUNT(*) AS n FROM ledger WHERE ref LIKE 'borrow:%' GROUP BY ref HAVING COUNT(*) > 1")).toEqual([]);
    expect(t.db.q("SELECT COUNT(DISTINCT ref) AS n FROM ledger WHERE ref LIKE 'borrow:%'")).toEqual([{ n: 150 }]);
    expect(t.db.q("SELECT swept_minute, bars_minute FROM mark")).toEqual([{ swept_minute: m - 60, bars_minute: m - 60 }]);
    // then the deferred order fills, exactly once, at the post after the net finished
    expect(posts[posts.length - 1]).toMatchObject({ heldBack: false, filled: 1 });
    expect((await t.status(alice, s.body.order.id)).body.order).toMatchObject({ status: "filled", fillPx: 960 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE wallet = ?", lc(ALICE))).toEqual([{ n: 1 }]);
    expect(t.db.q("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'open:%'")).toEqual([{ n: 1 }]);
  });

  test("more pending orders than one ingest can fill: the rest wait for the next post and fill exactly once", async () => {
    const t = setup();
    await t.mark(1000);
    const n = 120;
    const arrived = T0 + 500;
    for (let i = 0; i < n; i++) {
      const w = `0x${(i + 1).toString(16).padStart(40, "0")}`;
      t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, 10000, 1, ?)", w, t.nowS());
      t.db.q("INSERT INTO orders (wallet, kind, side, margin, lev, arrived_ms) VALUES (?, 'open', 'long', 100, 2, ?)", w, arrived);
    }
    t.tick(1000);
    const a = await t.markJson(1000);
    expect(a.body.queries).toBeLessThanOrEqual(INGEST_MAX_STATEMENTS);
    expect(a.body.deferred).toBeGreaterThan(0);
    expect(a.body.filled + a.body.deferred).toBe(n);
    t.tick(1000);
    const b = await t.markJson(1000);
    expect(b.body.queries).toBeLessThanOrEqual(INGEST_MAX_STATEMENTS);
    expect(b.body).toMatchObject({ filled: a.body.deferred, deferred: 0, refused: 0 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM orders WHERE status = 'filled'")).toEqual([{ n }]);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions")).toEqual([{ n }]);
    expect(t.db.q("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'open:%'")).toEqual([{ n }]);
  });
});

describe("audit SS-2: sign-in and anonymous reads", () => {
  const changesSoFar = (t: ReturnType<typeof setup>) => t.db.q<{ c: number }>("SELECT total_changes() AS c")[0].c;
  const login = async (t: ReturnType<typeof setup>, ip: string, body: unknown) =>
    handlePilotLogin(new Request(`${ORIGIN}/api/pilot/auth`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip }, body: typeof body === "string" ? body : JSON.stringify(body) }), t.env, t.deps);
  async function signed(t: ReturnType<typeof setup>) {
    const { nonce } = (await (await handlePilotNonce(t.env, t.deps)).json()) as { nonce: string };
    const message = pilotLoginMessage({ address: lc(ALICE), origin: ORIGIN, nonce, issued: new Date(t.nowS() * 1000).toISOString() });
    return { message, signature: await ALICE.signMessage({ message }) };
  }

  test("a malformed request is refused before any D1 statement", async () => {
    const t = setup();
    const before = t.db.log.length;
    const good = await signed(t);
    for (const body of ["not json", {}, { message: 1, signature: "0x00" }, { message: "hello", signature: "0x" + "ab".repeat(65) }, { ...good, signature: "0xzz" },
      { message: good.message.replace(/nonce: .*/, "nonce: AAAAAAAAAAAAAAAAAAAAAAAA"), signature: good.signature }]) {
      const r = await login(t, "203.0.113.7", body);
      expect([400, 401]).toContain(r.status);
    }
    expect(t.db.log.length).toBe(before);
  });

  test("the limit (10 a minute) is per IPv4 address and per IPv6 /64; at the limit nothing is written", async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) expect((await login(t, `2001:db8:1:2::${i.toString(16)}`, await signed(t))).status).toBe(200);
    const before = changesSoFar(t), log = t.db.log.length;
    const r = await login(t, "2001:0db8:0001:0002:ffff:ffff:ffff:fffe", await signed(t)); // same /64, written another way
    expect(r.status).toBe(429);
    expect(changesSoFar(t)).toBe(before); // not even the counter
    expect(t.db.log.slice(log)).toHaveLength(1); // the one rate statement, which wrote nothing
    expect(t.db.q("SELECT n FROM ratelimit WHERE k = 'login:2001:db8:1:2::/64'")).toEqual([{ n: 10 }]);
    expect((await login(t, "2001:db8:1:3::1", await signed(t))).status).toBe(200); // the next /64
    expect((await login(t, "203.0.113.7", await signed(t))).status).toBe(200);
    t.tick(60_000);
    expect((await login(t, "2001:db8:1:2::99", await signed(t))).status).toBe(200); // a new minute
  });

  test("ipKey: IPv4 whole, IPv6 by /64 in one canonical form", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
    expect(ipKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(ipKey(null)).toBe("unknown");
    expect(ipKey("not:an:ip:::")).toBe("not:an:ip:::");
  });

  test("GET /api/pilot/account without a session writes nothing and calls no RPC, even with a weekly split due", async () => {
    const t = setup();
    await t.mark(1000);
    t.tick(8 * 86400_000); // a new week: a split is due
    const before = changesSoFar(t), calls = t.rpc.calls;
    const a = await t.account();
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ address: null, regi: null, open: true });
    expect(changesSoFar(t)).toBe(before);
    expect(t.rpc.calls).toBe(calls);
    expect(t.db.q("SELECT COUNT(*) AS n FROM splits")).toEqual([{ n: 1 }]); // only the one the first ingest ran
    const alice = await t.signIn();
    await t.account(alice); // a signed-in read runs the due split
    expect(t.db.q("SELECT COUNT(*) AS n FROM splits")).toEqual([{ n: 2 }]);
  });
});
