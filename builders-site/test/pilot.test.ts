import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { adminLoginMessage } from "../../src/lib/builders-admin";
import * as Engine from "../../src/lib/abi-pilot";
import { pilotLoginMessage, PILOT_SESSION_COOKIE, REGI_ADDRESS } from "../../src/lib/abi-pilot-api";
import type { Env } from "../lib/env";
import {
  handleAccount, handleClose, handleHistory, handleLeaderboard, handleOrder, handlePositions, handlePublicMark, handlePushMark, validateMark,
} from "../lib/pilot";
import { handlePilotLogin, handlePilotLogout, handlePilotNonce, makePilotSession, verifyPilotSession, type PilotDeps } from "../lib/pilot-auth";
import { MemoryCache } from "./memory-cache";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const PUSH = "p".repeat(40);
const SESSION_SECRET = "s".repeat(40);
// Anvil's dev keys: never real funds.
const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const BOB = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const T0 = Date.parse("2026-10-10T12:00:10.000Z");
const ONE = 10n ** 18n;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup(o: { open?: boolean; db?: boolean; secret?: string } = {}) {
  let nowMs = T0;
  const db = new MemoryD1();
  const balances = new Map<string, bigint>([[ALICE.address.toLowerCase(), 5n * ONE], [BOB.address.toLowerCase(), ONE]]);
  const rpc = { calls: 0, down: false };
  const fakeFetch = (async (url: string, init: RequestInit) => {
    rpc.calls++;
    if (rpc.down) return new Response("bad gateway", { status: 502 });
    expect(url).toBe("https://rpc.mainnet.arc.io");
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("eth_call");
    expect(body.params[0].to).toBe(REGI_ADDRESS);
    expect(body.params[0].data.slice(0, 10)).toBe("0x70a08231");
    const who = "0x" + body.params[0].data.slice(-40);
    const v = balances.get(who) ?? 0n;
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + v.toString(16).padStart(64, "0") });
  }) as unknown as typeof fetch;
  const env: Env = {
    INVITES: new MemoryKV(() => nowMs),
    SITE_ORIGIN: ORIGIN,
    NONCE_SECRET: "nonce-secret-0123456789",
    PILOT_SESSION_SECRET: o.secret ?? SESSION_SECRET,
    ABI_PUSH_TOKEN: PUSH,
    PILOT_DB: o.db === false ? undefined : db,
    PILOT_OPEN: o.open === false ? undefined : "1",
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

  async function signIn(acct = ALICE): Promise<string> {
    const { nonce } = (await (await handlePilotNonce(env, deps)).json()) as { nonce: string };
    const message = pilotLoginMessage({ origin: ORIGIN, nonce, issued: new Date(nowMs).toISOString() });
    const signature = await acct.signMessage({ message });
    const res = await handlePilotLogin(req("/api/pilot/auth", "POST", { message, signature }), env, deps);
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    return sc.split(";")[0];
  }

  /** A producer post at the current clock: bars default to one flat bar at the mark. */
  async function mark(px: number, extra: Partial<{ ts: number; ch24: number; ch1: number; bars: number[][] }> = {}) {
    const ts = extra.ts ?? nowS();
    const minute = Math.floor(ts / 60) * 60;
    const body = {
      mark: px, ts, head: 1000 + ts, hour_start: Math.floor(ts / 3600) * 3600, candle: [px, px, px, px, 3, 12.5],
      ch24: extra.ch24 ?? 0.01, ch1: extra.ch1 ?? 0.001, bars: extra.bars ?? [[minute, px, px, px]],
    };
    return handlePushMark(req("/api/index/mark", "POST", body, { authorization: `Bearer ${PUSH}` }), env, deps);
  }

  const call = async (h: (r: Request, e: Env, d: PilotDeps) => Promise<Response>, r: Request) => {
    const res = await h(r, env, deps);
    return { status: res.status, body: (await res.json()) as Json, res };
  };
  const order = (cookie: string, body: unknown) => call(handleOrder, req("/api/pilot/order", "POST", body, { cookie }));
  const close = (cookie: string, id: number) => call(handleClose, req("/api/pilot/close", "POST", { id }, { cookie }));
  const account = (cookie?: string) => call(handleAccount, req("/api/pilot/account", "GET", undefined, cookie ? { cookie } : {}));
  const history = (cookie: string) => call(handleHistory, req("/api/pilot/history", "GET", undefined, { cookie }));
  const balanceOf = (w: string) => db.q<{ balance: number }>("SELECT balance FROM accounts WHERE wallet = ?", w.toLowerCase())[0]?.balance;

  return {
    db, env, deps, rpc, balances, req, signIn, mark, order, close, account, history, call, balanceOf, nowS,
    tick: (ms: number) => (nowMs += ms),
    setRandom: (r: number) => (rnd = r),
  };
}

const LONG2 = { side: "long", margin: 1000, lev: 2 };

describe("mark ingest (R4)", () => {
  test("bearer required; 503 without a 32+ char token", async () => {
    const t = setup();
    const r1 = await handlePushMark(t.req("/api/index/mark", "POST", {}, { authorization: "Bearer nope" }), t.env, t.deps);
    expect(r1.status).toBe(401);
    const r2 = await handlePushMark(t.req("/api/index/mark", "POST", {}, { authorization: `Bearer ${PUSH}` }), { ...t.env, ABI_PUSH_TOKEN: "short" }, t.deps);
    expect(r2.status).toBe(503);
  });

  test("the producer's payload (live/mark.py) is accepted and stored in one batch", async () => {
    const t = setup();
    const ts = t.nowS(), m = Math.floor(ts / 60) * 60;
    const res = await t.mark(982.25, { bars: [[m - 120, 983, 981, 982], [m - 60, 984, 980.5, 983.1], [m, 983.5, 982, 982.25]] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ts, bars: 3, liquidated: 0 });
    expect(t.db.batches).toBe(1);
    expect(t.db.q("SELECT mark, ts, ch24, ch1, candle FROM mark")).toEqual([{ mark: 982.25, ts, ch24: 0.01, ch1: 0.001, candle: "[982.25,982.25,982.25,982.25,3,12.5]" }]);
    expect(t.db.q("SELECT minute, h, l, c FROM bars ORDER BY minute").length).toBe(3);
  });

  test("ts: within 30 s of server time, strictly newer than the stored one", async () => {
    const t = setup();
    expect((await t.mark(1000, { ts: t.nowS() - 31 })).status).toBe(400);
    expect((await t.mark(1000, { ts: t.nowS() + 31 })).status).toBe(400);
    expect((await t.mark(1000, { ts: t.nowS() - 5 })).status).toBe(200);
    expect((await t.mark(1001, { ts: t.nowS() - 5 })).status).toBe(409);
    expect((await t.mark(1001, { ts: t.nowS() - 6 })).status).toBe(409);
    expect((await t.mark(1002)).status).toBe(200);
    expect(t.db.q("SELECT mark FROM mark")).toEqual([{ mark: 1002 }]);
  });

  test("validation: mark, ch24/ch1, bars shape and sanity", () => {
    const now = 1_760_097_610, m = Math.floor(now / 60) * 60;
    const ok = { mark: 1000, ts: now, head: 5, hour_start: Math.floor(now / 3600) * 3600, candle: [1, 2, 0.5, 1, 0, 0], ch24: 0, ch1: 0, bars: [[m, 1001, 999, 1000]] };
    expect(validateMark(ok, now).ok).toBe(true);
    const bad = (patch: Record<string, unknown>) => validateMark({ ...ok, ...patch }, now);
    expect(bad({ mark: 0 }).ok).toBe(false);
    expect(bad({ mark: -1 }).ok).toBe(false);
    expect(bad({ mark: "1000" }).ok).toBe(false);
    expect(bad({ ch24: null }).ok).toBe(false);
    expect(bad({ ch1: "x" }).ok).toBe(false);
    expect(bad({ bars: [] }).ok).toBe(false);
    expect(bad({ bars: [[m - 180, 1, 1, 1], [m - 120, 1, 1, 1], [m - 60, 1, 1, 1], [m, 1, 1, 1]] }).ok).toBe(false);
    expect(bad({ bars: [[m, 1001, 999]] }).ok).toBe(false);
    expect(bad({ bars: [[m, 1001, 1002, 1000]] }).ok).toBe(false); // l > c
    expect(bad({ bars: [[m, 999, 998, 1000]] }).ok).toBe(false); // c > h
    expect(bad({ bars: [[m, 1001, 0, 0]] }).ok).toBe(false); // not > 0
    expect(bad({ bars: [[m + 60, 1001, 999, 1000]] }).ok).toBe(false); // later than ts
    expect(bad({ bars: [[m + 1, 1001, 999, 1000]] }).ok).toBe(false); // not a minute start
    expect(bad({ bars: [[m, 1, 1, 1], [m - 60, 1, 1, 1]] }).ok).toBe(false); // order
    expect(bad({ candle: [1, 2, 3] }).ok).toBe(false);
    expect(validateMark([], now).ok).toBe(false);
  });

  test("two posts with the same ts racing: one wins, and only the winner's bars are written (no liquidation from the loser)", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.order(alice, { side: "long", margin: 1000, lev: 3 });
    t.tick(70_000);
    const m = Math.floor(t.nowS() / 60) * 60;
    const before = t.db.batches;
    const [a, b] = await Promise.all([t.mark(1000, { bars: [[m, 1001, 999, 1000]] }), t.mark(1000, { bars: [[m, 1001, 600, 1000]] })]);
    expect(t.db.batches - before).toBe(2); // both passed the ts pre-check and raced to the write
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(t.db.q("SELECT l FROM bars WHERE minute = ?", m)).toEqual([{ l: 999 }]);
    expect(t.db.q("SELECT closed_at FROM positions WHERE id = ?", o.body.position.id)).toEqual([{ closed_at: null }]);
  });

  test("a bar re-posted later in its minute is merged (high and low only widen)", async () => {
    const t = setup();
    const m = Math.floor(t.nowS() / 60) * 60;
    await t.mark(1000, { bars: [[m, 1002, 998, 1000]] });
    t.tick(5000);
    await t.mark(1001, { bars: [[m, 1001, 999, 1001]] });
    expect(t.db.q("SELECT h, l, c FROM bars WHERE minute = ?", m)).toEqual([{ h: 1002, l: 998, c: 1001 }]);
  });

  test("bars older than 7 days are pruned in ~1 of 100 posts", async () => {
    const t = setup();
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1, 1, 1)", Math.floor(t.nowS() / 60) * 60 - 8 * 86400);
    await t.mark(1000);
    expect(t.db.q("SELECT COUNT(*) AS n FROM bars")[0]).toEqual({ n: 2 });
    t.setRandom(0.001);
    t.tick(5000);
    const r = await t.mark(1000);
    expect(((await r.json()) as Json).pruned).toBe(true);
    expect(t.db.q("SELECT COUNT(*) AS n FROM bars")[0]).toEqual({ n: 1 });
  });

  test("GET /api/index/mark: the latest mark with the leverage cap; 404 before the first post", async () => {
    const t = setup();
    expect((await handlePublicMark(t.req("/api/index/mark"), t.env, t.deps)).status).toBe(404);
    await t.mark(1000, { ch24: 0.12, ch1: 0.05 });
    const b = (await (await handlePublicMark(t.req("/api/index/mark"), t.env, t.deps)).json()) as Json;
    expect(b).toMatchObject({ mark: 1000, maxLev: 2, paused: true, fresh: true, age: 0 });
  });

  test("no PILOT_DB: 503", async () => {
    const t = setup({ db: false });
    expect((await t.mark(1000)).status).toBe(503);
    expect((await t.account()).status).toBe(503);
  });
});

describe("sign-in and session (R6)", () => {
  test("nonce + personal_sign sets an HttpOnly, Secure, SameSite=Strict 12 h cookie; REGI read at sign-in", async () => {
    const t = setup();
    const { nonce } = (await (await handlePilotNonce(t.env, t.deps)).json()) as { nonce: string };
    const message = pilotLoginMessage({ origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    const res = await handlePilotLogin(t.req("/api/pilot/auth", "POST", { message, signature: await ALICE.signMessage({ message }) }), t.env, t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: ALICE.address.toLowerCase(), regi: true });
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(new RegExp(`^${PILOT_SESSION_COOKIE}=0x[0-9a-f]{40}\\.\\d+\\.[A-Za-z0-9_-]+; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$`));
    expect(t.rpc.calls).toBe(1);
    expect(t.db.q("SELECT balance, season, regi_ok FROM accounts")).toEqual([{ balance: 10000, season: 1, regi_ok: 1 }]);
    // the nonce is single use
    const again = await handlePilotLogin(t.req("/api/pilot/auth", "POST", { message, signature: await ALICE.signMessage({ message }) }), t.env, t.deps);
    expect(again.status).toBe(401);
    expect(((await again.json()) as Json).error).toMatch(/already used/);
  });

  test("an admin sign-in message, a foreign origin or a missing Origin header is refused", async () => {
    const t = setup();
    const { nonce } = (await (await handlePilotNonce(t.env, t.deps)).json()) as { nonce: string };
    const admin = adminLoginMessage({ origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    expect((await handlePilotLogin(t.req("/api/pilot/auth", "POST", { message: admin, signature: await ALICE.signMessage({ message: admin }) }), t.env, t.deps)).status).toBe(400);
    const foreign = pilotLoginMessage({ origin: "https://evil.example", nonce, issued: new Date(T0).toISOString() });
    expect((await handlePilotLogin(t.req("/api/pilot/auth", "POST", { message: foreign, signature: await ALICE.signMessage({ message: foreign }) }), t.env, t.deps)).status).toBe(401);
    const msg = pilotLoginMessage({ origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    const noOrigin = new Request(`${ORIGIN}/api/pilot/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: msg, signature: await ALICE.signMessage({ message: msg }) }) });
    expect((await handlePilotLogin(noOrigin, t.env, t.deps)).status).toBe(403);
  });

  test("session token: tampered, expired after 12 h, or under another secret is refused; sign-out clears the cookie", async () => {
    const w = ALICE.address.toLowerCase();
    const now = Math.floor(T0 / 1000);
    const tok = await makePilotSession(SESSION_SECRET, w, now);
    expect(await verifyPilotSession(SESSION_SECRET, tok, now)).toBe(w);
    expect(await verifyPilotSession(SESSION_SECRET, tok, now + 12 * 3600)).toBeNull();
    expect(await verifyPilotSession("x".repeat(40), tok, now)).toBeNull();
    const other = BOB.address.toLowerCase();
    expect(await verifyPilotSession(SESSION_SECRET, tok.replace(w, other), now)).toBeNull();
    const [a, exp, mac] = tok.split(".");
    expect(await verifyPilotSession(SESSION_SECRET, `${a}.${Number(exp) + 1}.${mac}`, now)).toBeNull();
    const t = setup();
    const out = await handlePilotLogout(t.req("/api/pilot/auth", "DELETE", {}), t.env);
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("no PILOT_SESSION_SECRET (or a short one): sign-in fails closed", async () => {
    const t = setup({ secret: "short" });
    const { nonce } = (await (await handlePilotNonce(t.env, t.deps)).json()) as { nonce: string };
    const message = pilotLoginMessage({ origin: ORIGIN, nonce, issued: new Date(T0).toISOString() });
    expect((await handlePilotLogin(t.req("/api/pilot/auth", "POST", { message, signature: await ALICE.signMessage({ message }) }), t.env, t.deps)).status).toBe(503);
  });

  test("account without a session: kill switch and mark only", async () => {
    const t = setup();
    await t.mark(1000);
    const a = await t.account();
    expect(a.body).toMatchObject({ open: true, address: null, regi: null, account: null, positions: [] });
    expect(a.body.mark.mark).toBe(1000);
  });
});

describe("REGI gate (R6)", () => {
  test("non-holders can sign in but cannot open; the message says to hold REGI", async () => {
    const t = setup();
    t.balances.set(BOB.address.toLowerCase(), ONE - 1n);
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    expect((await t.account(bob)).body.regi).toBe(false);
    const r = await t.order(bob, LONG2);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("Hold REGI to join the points pilot.");
  });

  test("cached for 10 minutes, re-read after; selling REGI blocks new orders but closes still work", async () => {
    const t = setup();
    const alice = await t.signIn();
    expect(t.rpc.calls).toBe(1);
    await t.mark(1000);
    const o = await t.order(alice, LONG2);
    expect(o.status).toBe(200);
    expect(t.rpc.calls).toBe(1); // cached from sign-in
    t.balances.set(ALICE.address.toLowerCase(), 0n);
    t.tick(10 * 60_000 + 1000);
    await t.mark(1000);
    const o2 = await t.order(alice, LONG2);
    expect(t.rpc.calls).toBe(2);
    expect(o2.status).toBe(403);
    const c = await t.close(alice, o.body.position.id);
    expect(c.status).toBe(200);
  });

  test("RPC down with a stale cache: orders fail closed", async () => {
    const t = setup();
    const alice = await t.signIn();
    t.tick(11 * 60_000);
    await t.mark(1000);
    t.rpc.down = true;
    const r = await t.order(alice, LONG2);
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/REGI/);
  });
});

describe("kill switch (R1)", () => {
  test("PILOT_OPEN unset: orders 403 {error:'pilot closed'}; reads, closes and the mark ingest work", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.order(alice, LONG2);
    expect(o.status).toBe(200);
    t.env.PILOT_OPEN = undefined;
    const refused = await t.order(alice, LONG2);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "pilot closed" });
    t.env.PILOT_OPEN = "0";
    expect((await t.order(alice, LONG2)).body).toEqual({ error: "pilot closed" });
    t.tick(5000);
    expect((await t.mark(1010)).status).toBe(200);
    const a = await t.account(alice);
    expect(a.body.open).toBe(false);
    expect(a.body.positions).toHaveLength(1);
    expect((await t.close(alice, o.body.position.id)).status).toBe(200);
  });
});

describe("orders and closes", () => {
  test("open: margin + 0.06% fee debited; position at the mark with the engine's liquidation price", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(982.2);
    const r = await t.order(alice, LONG2);
    expect(r.status).toBe(200);
    const fee = 2000 * 0.0006;
    expect(r.body.balance).toBeCloseTo(10000 - 1000 - fee, 9);
    expect(r.body.position).toMatchObject({ side: "long", margin: 1000, lev: 2, notional: 2000, entry: 982.2, liq: Engine.liqPrice("long", 982.2, 2) });
    const a = await t.account(alice);
    expect(a.body.account.balance).toBeCloseTo(10000 - 1000 - fee, 9);
    expect(a.body.account.equity).toBeCloseTo(10000 - fee, 9);
  });

  test("the mark must be at most 15 s old ('price updating'); pause and cap use the stored ch24 / ch1", async () => {
    const t = setup();
    const alice = await t.signIn();
    expect((await t.order(alice, LONG2)).body.error).toBe("price updating"); // no mark yet
    await t.mark(1000);
    t.tick(16_000);
    const stale = await t.order(alice, LONG2);
    expect(stale.status).toBe(503);
    expect(stale.body.error).toBe("price updating");
    await t.mark(1000, { ch1: 0.05 });
    expect((await t.order(alice, LONG2)).body.error).toBe("trading paused");
    t.tick(5000);
    await t.mark(1000, { ch24: 0.3 });
    expect((await t.order(alice, LONG2)).body.error).toBe("leverage above the current cap");
    expect((await t.order(alice, { ...LONG2, lev: 1 })).status).toBe(200);
  });

  test("bad bodies and engine refusals", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    expect((await t.order(alice, { side: "up", margin: 100, lev: 1 })).status).toBe(400);
    expect((await t.order(alice, { side: "long", margin: "100", lev: 1 })).status).toBe(400);
    expect((await t.order(alice, { side: "long", margin: 5, lev: 1 })).body.error).toBe("margin below minimum");
    expect((await t.order(alice, { side: "long", margin: 100, lev: 4 })).body.error).toBe("leverage not allowed");
    expect((await t.order(alice, { side: "long", margin: 20000, lev: 1 })).body.error).toBe("insufficient balance");
    expect((await t.order("", LONG2)).status).toBe(401);
    const noOrigin = new Request(`${ORIGIN}/api/pilot/order`, { method: "POST", headers: { "content-type": "application/json", cookie: alice }, body: JSON.stringify(LONG2) });
    expect((await handleOrder(noOrigin, t.env, t.deps)).status).toBe(403);
  });

  test("close at the mark: margin + PnL − close fee returned; history shows it", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.order(alice, { side: "short", margin: 1000, lev: 3 });
    t.tick(5000);
    await t.mark(990);
    const c = await t.close(alice, o.body.position.id);
    expect(c.status).toBe(200);
    const pos = { side: "short" as const, margin: 1000, notional: 3000, entry: 1000 };
    const e = Engine.close(pos, 990);
    expect(c.body.position).toMatchObject({ reason: "close", exit: 990, pnl: e.pnl, returned: e.payout });
    expect(c.body.balance).toBeCloseTo(10000 - 1000 - 3000 * 0.0006 + e.payout, 9);
    const h = await t.history(alice);
    expect(h.body.history).toHaveLength(1);
    expect(h.body.history[0].net).toBeCloseTo(e.payout - 1000 - 3000 * 0.0006, 9);
    expect(h.body.history[0].fee).toBeCloseTo(3000 * 0.0006 + e.fee, 9);
  });

  test("someone else's position cannot be closed", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    const o = await t.order(alice, LONG2);
    expect((await t.close(bob, o.body.position.id)).status).toBe(404);
  });

  test("positions endpoint: open positions with PnL at the mark", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    await t.order(alice, LONG2);
    t.tick(5000);
    await t.mark(1010);
    const p = await t.call(handlePositions, t.req("/api/pilot/positions", "GET", undefined, { cookie: alice }));
    expect(p.body.positions).toHaveLength(1);
    expect(p.body.positions[0].pnl).toBeCloseTo(20, 9);
  });
});

describe("concurrency (R3)", () => {
  test("two simultaneous orders cannot overspend", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    t.db.q("UPDATE accounts SET balance = 1500");
    const before = t.db.batches;
    const [a, b] = await Promise.all([t.order(alice, LONG2), t.order(alice, LONG2)]);
    expect(t.db.batches - before).toBe(2); // both passed the engine check and raced to the write
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.error, b.body.error]).toContain("insufficient balance");
    expect(t.balanceOf(ALICE.address)).toBeCloseTo(1500 - 1000 - 1.2, 9);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions")[0]).toEqual({ n: 1 });
  });

  test("two simultaneous orders cannot exceed 5 open positions", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    for (let i = 0; i < 4; i++) expect((await t.order(alice, { side: "long", margin: 10, lev: 1 })).status).toBe(200);
    const rs = await Promise.all([t.order(alice, { side: "long", margin: 10, lev: 1 }), t.order(alice, { side: "short", margin: 10, lev: 1 })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")[0]).toEqual({ n: 5 });
  });

  test("a double close settles once", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.order(alice, LONG2);
    const mid = t.balanceOf(ALICE.address);
    t.tick(5000);
    await t.mark(1010);
    const [a, b] = await Promise.all([t.close(alice, o.body.position.id), t.close(alice, o.body.position.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const e = Engine.close({ side: "long", margin: 1000, notional: 2000, entry: 1000 }, 1010);
    expect(t.balanceOf(ALICE.address)).toBeCloseTo(mid + e.payout, 9);
  });
});

describe("liquidation (R5)", () => {
  test("lazy: an account read settles a position crossed by a stored bar since it opened, at the liquidation price, nothing returned", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.order(alice, { side: "long", margin: 1000, lev: 3 });
    const liq = o.body.position.liq as number;
    const opened = o.body.position.openedAt as number;
    const bal = t.balanceOf(ALICE.address);
    const m0 = Math.floor(opened / 60) * 60;
    // written behind the ingest's back: only the lazy path can see them
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1000, ?, 1000)", m0 - 60, liq - 50); // before the open: ignored
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1000, 990, 995)", m0 + 60);
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 995, ?, 700)", m0 + 120, liq - 1);
    t.db.q("INSERT INTO bars (minute, h, l, c) VALUES (?, 995, ?, 650)", m0 + 180, liq - 2);
    const a = await t.account(alice);
    expect(a.body.positions).toEqual([]);
    const row = t.db.q<Json>("SELECT closed_at, exit, pnl, returned, reason FROM positions")[0];
    const pos = { side: "long" as const, notional: 3000, entry: 1000, margin: 1000, liq, openedAt: opened };
    expect(row).toEqual({ closed_at: m0 + 120, exit: liq, pnl: Engine.pnl(pos, liq), returned: 0, reason: "liquidation" });
    expect(t.balanceOf(ALICE.address)).toBe(bal);
    // idempotent: later reads and a close change nothing
    await t.account(alice);
    t.tick(5000);
    await t.mark(1000);
    const c = await t.close(alice, o.body.position.id);
    expect(c.status).toBe(409);
    expect(t.balanceOf(ALICE.address)).toBe(bal);
    expect((await t.history(alice)).body.history[0]).toMatchObject({ reason: "liquidation", returned: 0, net: -1000 - 3000 * 0.0006 });
  });

  test("a bar in the opening minute does not count (the engine skips bars that start before the open)", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.order(alice, { side: "short", margin: 1000, lev: 2 });
    const m0 = Math.floor(o.body.position.openedAt / 60) * 60;
    t.db.q("INSERT OR REPLACE INTO bars (minute, h, l, c) VALUES (?, 2000, 1000, 1000)", m0);
    expect((await t.account(alice)).body.positions).toHaveLength(1);
  });

  test("ingest: a mark post settles the positions its bars cross, with the same values as the engine", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    const a = await t.order(alice, { side: "long", margin: 1000, lev: 3 });
    const b = await t.order(bob, { side: "short", margin: 500, lev: 3 });
    const keep = await t.order(alice, { side: "long", margin: 100, lev: 1 });
    t.tick(70_000);
    const m = Math.floor(t.nowS() / 60) * 60;
    const res = await t.mark(1000, { bars: [[m, 1400, 600, 1000]] });
    expect(((await res.json()) as Json).liquidated).toBe(2);
    const rows = t.db.q<Json>("SELECT id, closed_at, exit, pnl, returned, reason FROM positions ORDER BY id");
    for (const [p, id] of [[a.body.position, a.body.position.id], [b.body.position, b.body.position.id]] as const) {
      const r = rows.find((x) => x.id === id)!;
      expect(r).toEqual({ id, closed_at: m, exit: p.liq, pnl: Engine.pnl(p, p.liq), returned: 0, reason: "liquidation" });
    }
    expect(rows.find((x) => x.id === keep.body.position.id)!.closed_at).toBeNull();
  });
});

describe("rate limits (R8)", () => {
  test("orders: 30 per minute per wallet; the next minute starts over", async () => {
    const t = setup();
    const alice = await t.signIn();
    for (let i = 0; i < 30; i++) expect((await t.order(alice, { side: "up" })).status).toBe(400);
    expect((await t.order(alice, { side: "up" })).status).toBe(429);
    const bob = await t.signIn(BOB);
    expect((await t.order(bob, { side: "up" })).status).toBe(400); // per wallet
    t.tick(60_000);
    expect((await t.order(alice, { side: "up" })).status).toBe(400);
  });

  test("closes: 60 per minute per wallet", async () => {
    const t = setup();
    const alice = await t.signIn();
    for (let i = 0; i < 60; i++) expect((await t.close(alice, 999)).status).toBe(404);
    expect((await t.close(alice, 999)).status).toBe(429);
  });
});

describe("leaderboard and history (R8)", () => {
  test("top 50 by equity at the latest mark, shortened addresses only, cached 30 s", async () => {
    const t = setup();
    const alice = await t.signIn();
    const bob = await t.signIn(BOB);
    await t.mark(1000);
    await t.order(alice, { side: "long", margin: 1000, lev: 3 });
    await t.order(bob, { side: "short", margin: 1000, lev: 3 });
    for (let i = 0; i < 60; i++) {
      const w = "0x" + i.toString(16).padStart(40, "0");
      t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, ?, 1, 0)", w, 5000 + i);
      t.db.q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, fee, returned, reason, exit, pnl) VALUES (?, 'long', 10, 1, 10, 1000, 1, 0, 1, 0, 10, 'close', 1000, 0)", w);
    }
    t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES ('0x00000000000000000000000000000000000000ff', 99999, 1, 0)"); // never opened: not listed
    t.tick(5000);
    await t.mark(1100);
    const cache = new MemoryCache();
    const res = await handleLeaderboard(t.req("/api/pilot/leaderboard"), t.env, { ...t.deps, cache: cache as unknown as Cache });
    const text = await res.text();
    const body = JSON.parse(text) as Json;
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0]).toEqual({ rank: 1, address: `${ALICE.address.toLowerCase().slice(0, 6)}…${ALICE.address.toLowerCase().slice(-4)}`, equity: expect.any(Number) });
    expect(body.rows[0].equity).toBeCloseTo(10000 - 1.8 + 300, 6);
    expect(text).not.toContain(ALICE.address.toLowerCase());
    expect(text).not.toContain("99999");
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
    t.db.q("UPDATE accounts SET balance = 1e9 WHERE wallet = ?", BOB.address.toLowerCase());
    const again = (await (await handleLeaderboard(t.req("/api/pilot/leaderboard"), t.env, { ...t.deps, cache: cache as unknown as Cache })).json()) as Json;
    expect(again.rows[0].rank).toBe(1);
    expect(again.rows[0].address).toBe(body.rows[0].address); // served from the cache
  });

  test("history: the last 100 closed positions, newest first", async () => {
    const t = setup();
    const alice = await t.signIn();
    const w = ALICE.address.toLowerCase();
    for (let i = 0; i < 120; i++) {
      t.db.q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, fee, returned, reason, exit, pnl) VALUES (?, 'long', 10, 1, 10, 1000, 1, ?, ?, 0.012, 10, 'close', 1000, 0)", w, i, 1000 + i);
    }
    const h = await t.history(alice);
    expect(h.body.history).toHaveLength(100);
    expect(h.body.history[0].closedAt).toBe(1119);
    expect(h.body.history[99].closedAt).toBe(1020);
    expect((await t.history("")).status).toBe(401);
  });
});
