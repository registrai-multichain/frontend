import { encodeAbiParameters, keccak256, toEventSelector, toFunctionSelector } from "viem";
import { describe, expect, test } from "vitest";
import {
  LOCK_CONFIRM_BLOCKS as C, median, POOL_MANAGER, REGI_POOL_ID, REGI_POOL_SLOT0, regiFor, SELECTORS, sqrtPriceOfSlot0, usdPerRegiOf, WITHDRAWN_TOPIC,
} from "../../src/lib/abi-pilot-api";
import { handleLeaderboard, LOCK_NOT_LIVE, LOCK_UNCHECKED, lockWatch, regiHolders } from "../lib/pilot";
import { clearPriceCache, PRICE_CACHE_S, priceSlot, readPoolPrice, regiPrice } from "../lib/pilot-regi";
import { ALICE, BOB, FACTORY, lc, ONE, PRICE, setup, slot0For, type Json } from "./pilot-harness";

/** Plan docs/superpowers/plans/2026-10-13-pilot-regi-usd-gate-and-lock.md R1–R5: REGI in dollars and the REGI lock. */

const LONG = (lev: number, margin = 1000) => ({ side: "long", margin, lev });
/** The $50 lock at the harness price (5,000,000 REGI). */
const LOCK = 5n * ONE;

// Pinned from the live pool (read-only eth_call PoolManager.extsload(slot0) on rpc.mainnet.arc.io, block 25,727,045,
// 2026-10-13): 79,835.76 REGI per USDC.
const LIVE_SLOT0 = "0x00000000271000000005f0560000000010d767a64fea2acac37a5f58f78f396d";
const LIVE_SQRT = 22386094021940201893925019461283166573n;

describe("R1: the REGI price from the pool", () => {
  test("the slot and the selectors are what the contracts define", () => {
    expect(REGI_POOL_SLOT0).toBe(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [REGI_POOL_ID, 6n])));
    expect(SELECTORS.extsload).toBe(toFunctionSelector("extsload(bytes32)"));
    expect(SELECTORS.lockedOf).toBe(toFunctionSelector("lockedOf(address)"));
    expect(WITHDRAWN_TOPIC).toBe(toEventSelector("Withdrawn(address,address,uint256)"));
  });

  test("sqrtPriceX96 → USD per REGI: the live pin, the audit's 59,772 REGI per USDC, and no price", () => {
    expect(sqrtPriceOfSlot0(LIVE_SLOT0)).toBe(LIVE_SQRT);
    const live = usdPerRegiOf(LIVE_SQRT)!;
    expect(1 / live).toBeCloseTo(79_835.76285, 4); // REGI per USD
    expect(live).toBeCloseTo(1.2525714845663806e-5, 18);
    // the audit's figure (10 Oct): 59,772 REGI per USDC is sqrtPriceX96 = √(59,772 × 10^12) × 2^96
    const audit = BigInt(Math.round(Math.sqrt(59_772e12) * 2 ** 40)) << 56n;
    expect(1 / usdPerRegiOf(audit)!).toBeCloseTo(59_772, 6);
    // $10 at the live price: 798,357.628544 REGI (rounded up to a millionth)
    expect(regiFor(10, live)).toBe(798_357_628_544n * 10n ** 12n);
    expect(usdPerRegiOf(0n)).toBeNull();
    expect(usdPerRegiOf(BigInt(slot0For(PRICE)) & ((1n << 160n) - 1n))! / PRICE).toBeCloseTo(1, 12);
  });

  test("regiFor rounds up to a millionth of a REGI, without float noise; the median", () => {
    expect(regiFor(10, 1e-5)).toBe(ONE);
    expect(regiFor(50, 1e-5)).toBe(LOCK);
    expect(regiFor(10, 3e-5)).toBe(333_333_333_334n * 10n ** 12n);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test("readPoolPrice: one eth_call of PoolManager.extsload(slot0); a failure throws", async () => {
    const t = setup();
    expect(await readPoolPrice(t.deps.fetch!)).toBeCloseTo(PRICE, 17);
    expect(t.rpc.pool).toBe(1);
    t.rpc.fail.add("eth_call:pool");
    await expect(readPoolPrice(t.deps.fetch!)).rejects.toThrow();
    expect(POOL_MANAGER).toBe("0x8366a39CC670B4001A1121B8F6A443A643e40951");
  });

  test("ABI posts sample once per 10-minute slot; AII and AEI posts never; an RPC failure stores nothing and the next post retries", async () => {
    const t = setup({ autoPrice: false });
    const samples = () => t.db.q<{ ts: number; usd_per_regi: number }>("SELECT ts, usd_per_regi FROM regi_price ORDER BY ts");
    expect((await t.markJson(1000, { index: "aii" })).body.priceSampled).toBe(false);
    expect(t.rpc.pool).toBe(0);
    const first = await t.markJson(1000);
    expect(first.body.priceSampled).toBe(true);
    expect(samples()).toEqual([{ ts: priceSlot(t.nowS()), usd_per_regi: expect.closeTo(PRICE, 17) }]);
    t.tick(5000);
    expect((await t.markJson(1000)).body.priceSampled).toBe(false);
    expect(t.rpc.pool).toBe(1); // the slot has its sample: no read
    t.tick((priceSlot(t.nowS()) + 601 - t.nowS()) * 1000); // into the next slot
    t.rpc.fail.add("eth_call:pool");
    const failed = await t.markJson(1000);
    expect([failed.status, failed.body.priceSampled]).toEqual([200, false]); // the ingest goes on
    t.rpc.fail.delete("eth_call:pool");
    t.tick(5000);
    expect((await t.markJson(1000)).body.priceSampled).toBe(true);
    expect(samples()).toHaveLength(2);
  });

  test("the price is the median of the last 24 h, and unknown with fewer than 6 samples", async () => {
    const t = setup({ autoPrice: false });
    const now = t.nowS(), s = priceSlot(now);
    const put = (k: number, p: number) => t.db.q("INSERT INTO regi_price (ts, usd_per_regi) VALUES (?, ?)", s - k * 600, p);
    [1e-5, 2e-5, 3e-5, 4e-5, 100e-5].forEach((p, k) => put(k, p));
    expect(await regiPrice(t.db, now)).toBeNull(); // 5 samples
    put(5, 0.5e-5);
    expect(await regiPrice(t.db, now)).toBeNull(); // cached for PRICE_CACHE_S (per isolate and database)
    expect(await regiPrice(t.db, now + PRICE_CACHE_S)).toBeCloseTo(2.5e-5, 18); // one wild sample doesn't move the median far
    put(200, 9e-5); // older than 24 h: not counted
    clearPriceCache(t.db);
    expect(await regiPrice(t.db, now)).toBeCloseTo(2.5e-5, 18);
    expect(await regiPrice(t.db, now + 86_400)).toBeNull();
  });

  test("an unknown price refuses sign-in and orders ('REGI price updating'); the account view says so", async () => {
    const t = setup({ autoPrice: false });
    const no = await t.loginWith(ALICE);
    expect([no.status, await no.json()]).toEqual([503, { error: "REGI price updating" }]);
    t.topUpPrice(true);
    clearPriceCache(t.db);
    const alice = await t.signIn();
    await t.mark(1000);
    t.db.q("DELETE FROM regi_price");
    clearPriceCache(t.db);
    expect((await t.account(alice)).body).toMatchObject({ price: null, admitRegi: null, lockRegi: null, regi: { ok: null } });
    const calls = t.rpc.calls;
    const r = await t.submit(alice, LONG(1));
    expect([r.status, r.body]).toEqual([503, { error: "REGI price updating" }]);
    expect(t.rpc.calls).toBe(calls); // refused before any REGI read
  });
});

describe("R2: $10 of REGI at sign-in", () => {
  test("refused below, admitted at the amount; an RPC failure refuses (fail closed)", async () => {
    const t = setup({ snapshot: null });
    t.balances.set(`${lc(BOB)}@latest`, ONE - 1n);
    const low = await t.loginWith(BOB);
    expect([low.status, await low.json()]).toEqual([403, { error: "Hold at least $10 of REGI to join the points pilot." }]);
    t.balances.set(`${lc(BOB)}@latest`, ONE);
    t.rpc.down = true;
    const down = await t.loginWith(BOB);
    expect([down.status, await down.json()]).toEqual([503, { error: "Couldn't check REGI right now" }]);
    t.rpc.down = false;
    expect((await t.loginWith(BOB)).status).toBe(200);
  });

  test("PILOT_ADMIT_USD moves the amount; the account view shows it in REGI at the median", async () => {
    const t = setup({ admitUsd: "12.5", snapshot: null });
    t.balances.set(`${lc(BOB)}@latest`, ONE); // $10
    expect((await t.loginWith(BOB)).status).toBe(403);
    expect(await (await t.loginWith(BOB)).json()).toEqual({ error: "Hold at least $12.50 of REGI to join the points pilot." });
    const alice = await t.signIn();
    expect((await t.account(alice)).body).toMatchObject({ admitUsd: 12.5, lockUsd: 50, price: PRICE, admitRegi: (1_250_000n * 10n ** 18n).toString(), lockRegi: LOCK.toString(), lockFactory: FACTORY });
  });

  test("a wallet with open positions may sign in without REGI (closes never need it), and close", async () => {
    const t = setup({ snapshot: null });
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, LONG(1));
    t.balances.set(`${lc(ALICE)}@latest`, 0n);
    t.rpc.down = true;
    const again = await t.signIn(); // a new session, no REGI, the RPC down
    expect((await t.submit(again, LONG(1))).status).toBe(503);
    t.rpc.down = false;
    t.tick(31_000); // past the RPC back-off
    await t.mark(1000);
    expect((await t.submit(again, LONG(1))).body.error).toBe("Hold at least $10 of REGI to join the points pilot.");
    expect((await t.close(again, o.body.order.positionId)).body.order.status).toBe("filled");
    // with nothing open any more, sign-in needs the REGI again
    expect((await t.loginWith(ALICE)).status).toBe(403);
  });
});

describe("R3: leverage needs $50 of REGI locked", () => {
  test("refused without a lock, below the requirement and without a factory; allowed at the requirement; 1× needs no lock", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    t.rpc.locks.set(lc(ALICE), 0n);
    const none = await t.submit(alice, LONG(2));
    expect([none.status, none.body]).toEqual([403, { error: "Lock at least $50 of REGI to trade with leverage." }]);
    t.rpc.locks.set(lc(ALICE), LOCK - 1n);
    expect((await t.submit(alice, LONG(2))).body.error).toBe("Lock at least $50 of REGI to trade with leverage.");
    const lockReads = t.rpc.lock;
    expect((await t.submit(alice, LONG(1))).status).toBe(202); // 1×: admission only
    expect(t.rpc.lock).toBe(lockReads);
    t.rpc.locks.set(lc(ALICE), LOCK);
    expect((await t.submit(alice, LONG(2))).status).toBe(202);
    expect(t.rpc.lock).toBe(lockReads + 1); // read fresh at the order
    t.env.PILOT_LOCK_FACTORY = "";
    const off = await t.submit(alice, LONG(2));
    expect([off.status, off.body]).toEqual([403, { error: LOCK_NOT_LIVE }]);
    expect(LOCK_NOT_LIVE).toBe("Leverage above 1× opens when the REGI lock is live.");
  });

  test("a lockedOf failure refuses (fail closed); PILOT_MAX_LEV still applies", async () => {
    const t = setup({ maxLev: "10" });
    const alice = await t.signIn();
    await t.mark(1000);
    t.rpc.fail.add("eth_call:lock");
    const r = await t.submit(alice, LONG(2));
    expect([r.status, r.body]).toEqual([503, { error: LOCK_UNCHECKED }]);
    t.rpc.fail.delete("eth_call:lock");
    expect((await t.submit(alice, LONG(20))).body.error).toBe("leverage above the current cap");
  });

  test("each position keeps the lock requirement in force when it opened ('0' at 1×), in the API too", async () => {
    const t = setup();
    const alice = await t.signIn();
    await t.mark(1000);
    await t.open(alice, LONG(2));
    t.env.PILOT_LOCK_USD = "20";
    await t.open(alice, LONG(3));
    await t.open(alice, LONG(1));
    expect(t.db.q("SELECT lev, lock_req FROM positions ORDER BY id")).toEqual([
      { lev: 2, lock_req: LOCK.toString() }, { lev: 3, lock_req: (2n * ONE).toString() }, { lev: 1, lock_req: "0" },
    ]);
    expect((await t.account(alice)).body.positions.map((p: Json) => p.lockReq)).toEqual([LOCK.toString(), (2n * ONE).toString(), "0"]);
  });
});

describe("R4: a withdrawal closes the leveraged positions above the remaining lock", () => {
  /** Signed in, a mark, the first watch run (one chunk back from head − 5), then three ABI positions. */
  async function opened() {
    const t = setup();
    const alice = await t.signIn();
    expect((await t.markJson(1000)).body.lockWatch).toMatchObject({ cursor: t.rpc.head - C, done: true });
    expect(t.rpc.ranges).toEqual([[t.rpc.head - C - 4999, t.rpc.head - C]]);
    const a = await t.open(alice, LONG(2)); // lock_req 5,000,000
    t.env.PILOT_LOCK_USD = "20";
    const b = await t.open(alice, LONG(3)); // lock_req 2,000,000
    const c = await t.open(alice, LONG(1)); // lock_req 0
    t.env.PILOT_LOCK_USD = "50";
    return { t, alice, ids: [a, b, c].map((x) => x.body.order.positionId as number) };
  }
  /** A withdrawal that leaves `left` locked, `back` blocks before the new head (≥ C: the watch sees it). */
  const withdraw = (t: ReturnType<typeof setup>, owner: string, left: bigint, back = C + 10) => {
    t.rpc.head += 50 + C;
    t.rpc.locks.set(owner, left);
    t.rpc.withdrawals.push({ block: t.rpc.head - back, owner });
  };
  const nextMinute = async (t: ReturnType<typeof setup>, px = 1000) => { t.tick(61_000); return t.markJson(px); };
  const due = (t: ReturnType<typeof setup>) => t.db.q<{ owner: string }>("SELECT owner FROM lock_due ORDER BY owner").map((r) => r.owner);
  const cursorOf = (t: ReturnType<typeof setup>) => t.db.q<{ block: number }>("SELECT block FROM lock_cursor")[0].block;
  /** (Test only) reopens the closed leveraged positions, with their settlement rows gone, to run a scenario again. */
  const reopen = (t: ReturnType<typeof setup>) => {
    t.db.q("UPDATE positions SET closed_at = NULL, close_note = NULL, reason = NULL, settle = NULL WHERE lev > 1");
    t.db.q("DELETE FROM ledger WHERE ref LIKE 'close:%' OR ref LIKE 'settle:%' OR ref LIKE 'borrow:%' OR ref LIKE 'gap:%' OR ref LIKE 'draw:%'");
  };

  test("closes only the positions whose requirement is above the remaining lock, at the mark, as a close (fee, funding, borrow), once", async () => {
    const { t, alice, ids } = await opened();
    withdraw(t, lc(ALICE), 3n * ONE);
    const before = t.balanceOf(lc(ALICE));
    const r = await nextMinute(t, 1010);
    expect(r.body.lockWatch).toMatchObject({ owners: 1, closed: 1, due: 0, done: true, cursor: t.rpc.head - C, pinned: t.rpc.head - C });
    // review S2: lockedOf read at the pinned block, never "latest"
    expect(t.rpc.lockTags.at(-1)).toBe(`0x${(t.rpc.head - C).toString(16)}`);
    const rows = t.db.q<Json>("SELECT id, closed_at, exit, reason, close_note, returned, fee FROM positions ORDER BY id");
    expect(rows.map((x) => [x.id, x.closed_at !== null, x.reason, x.close_note])).toEqual([[ids[0], true, "close", "lock withdrawn"], [ids[1], false, null, null], [ids[2], false, null, null]]);
    expect(rows[0].exit).toBe(1010);
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(before + rows[0].returned, 9);
    // the normal close settlement's ledger rows: the exit fee and the borrow (fee pool), the house's remaining claim
    expect(t.db.q("SELECT kind FROM ledger WHERE ref IN (?, ?, ?) ORDER BY kind", `close:${ids[0]}`, `borrow:${ids[0]}`, `settle:${ids[0]}`).map((x) => x.kind)).toEqual(expect.arrayContaining(["fee", "house_trueup"]));
    const hist = (await t.history(alice)).body.history;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ id: ids[0], reason: "lock withdrawn", exit: 1010 });
    expect(due(t)).toEqual([]);
    // the same owner due again (a log read twice) settles nothing twice
    t.db.q("INSERT INTO lock_due (owner, from_block, last_block) VALUES (?, 1, 1)", lc(ALICE));
    expect((await nextMinute(t, 1010)).body.lockWatch).toMatchObject({ owners: 1, closed: 0, due: 0, done: true });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NOT NULL")).toEqual([{ n: 1 }]);
    // everything withdrawn: the other leveraged position closes; the 1× one never
    withdraw(t, lc(ALICE), 0n);
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ closed: 1 });
    expect(t.db.q("SELECT id FROM positions WHERE closed_at IS NULL")).toEqual([{ id: ids[2] }]);
  });

  test("a price move alone closes nothing; a withdrawal that leaves enough closes nothing", async () => {
    const { t } = await opened();
    // REGI halves: the requirement doubles, but lock_req was fixed at open, and no Withdrawn log names the wallet
    t.db.q("UPDATE regi_price SET usd_per_regi = ?", PRICE / 2);
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ closed: 0 }); // the sweep re-checks Alice: the lock still covers
    withdraw(t, lc(ALICE), LOCK); // withdrew the extra: exactly the largest requirement left
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ owners: 1, closed: 0, due: 0, done: true });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")).toEqual([{ n: 3 }]);
  });

  test("at most once a minute; logs in chunks of at most 5,000 blocks up to head − C; the cursor moves once logs are read", async () => {
    const { t } = await opened();
    const ranges = () => t.rpc.ranges.length;
    const n0 = ranges();
    t.tick(5000);
    expect((await t.markJson(1000)).body.lockWatch).toBeNull(); // same minute
    expect(ranges()).toBe(n0);
    // the head ran 12,000 blocks ahead: chunks of 5,000, up to 5 blocks behind the head
    const start = cursorOf(t);
    t.rpc.head += 12_000;
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ cursor: t.rpc.head - C, done: true });
    expect(t.rpc.ranges.slice(n0)).toEqual([[start + 1, start + 5000], [start + 5001, start + 10_000], [start + 10_001, start + 12_000]]);
    // a withdrawal in the last blocks: its log isn't read yet, but the sweep re-checks the lock of everyone holding
    // leverage (the mock's lockedOf has no history, so it shows the withdrawal at the pinned block already)
    withdraw(t, lc(ALICE), 0n, 2);
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ cursor: t.rpc.head - C, closed: 2 });
    t.rpc.head += C;
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ closed: 0, done: true });
    // getLogs down (Arc's public RPC throttles it from Workers): the cursor stays, the sweep still closes
    reopen(t);
    const held = cursorOf(t);
    withdraw(t, lc(ALICE), 0n);
    t.rpc.fail.add("eth_getLogs");
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ cursor: held, closed: 2, done: false });
    t.rpc.fail.delete("eth_getLogs");
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ cursor: t.rpc.head - C, closed: 0, done: true });
    // lockedOf down: the logs are read and the cursor moves on; the owner stays due and is handled next run
    reopen(t);
    withdraw(t, lc(ALICE), 0n);
    t.rpc.fail.add("eth_call:lock");
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ cursor: t.rpc.head - C, closed: 0, due: 1, done: false });
    expect(due(t)).toEqual([lc(ALICE)]);
    t.rpc.fail.delete("eth_call:lock");
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ closed: 2, due: 0, done: true });
  });

  test("review S1: a market that can't settle now holds back only its own positions, never the cursor or other owners", async () => {
    const { t } = await opened();
    // Bob: a 2× AEI position; then AEI's producer stops (its mark goes stale)
    const bob = await t.signIn(BOB);
    t.tick(1000);
    await t.markJson(1000, { index: "aei" });
    const s = await t.submit(bob, { market: "aei", ...LONG(2) });
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    t.tick(1000);
    await t.markJson(1000, { index: "aei" });
    expect((await t.status(bob, s.body.order.id)).body.order.status).toBe("filled");
    // Bob withdraws first, Alice after him
    withdraw(t, lc(BOB), 0n, C + 20);
    t.rpc.locks.set(lc(ALICE), 0n);
    t.rpc.withdrawals.push({ block: t.rpc.head - C - 10, owner: lc(ALICE) });
    const r = await nextMinute(t);
    expect(r.body.lockWatch).toMatchObject({ cursor: t.rpc.head - C, owners: 2, closed: 2, due: 1, done: false });
    expect(t.db.q("SELECT wallet, market FROM positions WHERE closed_at IS NULL AND lev > 1")).toEqual([{ wallet: lc(BOB), market: "aei" }]);
    expect(due(t)).toEqual([lc(BOB)]);
    // a later withdrawal by Alice (another chunk) is still handled while Bob waits
    expect((await nextMinute(t)).body.lockWatch).toMatchObject({ due: 1 });
    // AEI posts again: Bob's position closes, and he leaves the due list
    t.tick(61_000);
    const back = await t.markJson(1000, { index: "aei" });
    expect(back.body.lockWatch).toMatchObject({ closed: 1, due: 0, done: true });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL AND lev > 1")).toEqual([{ n: 0 }]);
  });

  test("review B1: an order placed before a withdrawal never fills into a leveraged position without the lock", async () => {
    // the reviewer's sequence: the order is pending while the watch processes the withdrawal, then a post fills
    for (const visible of [true, false]) {
      const { t, alice } = await opened();
      t.db.q("UPDATE lock_cursor SET checked = ?", t.nowS()); // the next watch is due in 60 s
      t.tick(59_000);
      await t.markJson(1000); // a fresh ABI mark, no watch yet
      const s = await t.submit(alice, LONG(5));
      expect(s.status, JSON.stringify(s.body)).toBe(202); // lockedOf passes at submission
      // the withdrawal lands; `visible`: deep enough for the watch to read now, else only the fill's own read sees it
      withdraw(t, lc(ALICE), 0n, visible ? C + 10 : 1);
      t.tick(1000);
      const aii = await t.markJson(1000, { index: "aii" }); // the watch runs (a minute since the last)
      expect(aii.body.lockWatch).not.toBeNull();
      if (visible) expect(aii.body.lockWatch).toMatchObject({ refused: 1 });
      t.tick(1000);
      const abi = await t.markJson(1000);
      expect(abi.body.filled).toBe(0);
      const o = (await t.status(alice, s.body.order.id)).body.order;
      expect([o.status, o.error]).toEqual(["refused", "Lock at least $50 of REGI to trade with leverage."]);
      expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE lev = 5")).toEqual([{ n: 0 }]);
    }
  });

  test("review B1: the fill re-reads the lock fresh; a failed read refuses (fail closed); 1× fills need none", async () => {
    const { t, alice } = await opened();
    const s = await t.submit(alice, LONG(2));
    t.rpc.fail.add("eth_call:lock");
    t.tick(1000);
    await t.markJson(1000);
    expect((await t.status(alice, s.body.order.id)).body.order).toMatchObject({ status: "refused", error: LOCK_UNCHECKED });
    const flat = await t.submit(alice, LONG(1));
    const reads = t.rpc.lock;
    t.tick(1000);
    await t.markJson(1000);
    expect((await t.status(alice, flat.body.order.id)).body.order.status).toBe("filled");
    expect(t.rpc.lock).toBe(reads);
    t.rpc.fail.delete("eth_call:lock");
    const ok = await t.submit(alice, LONG(2));
    t.tick(1000);
    await t.markJson(1000);
    expect((await t.status(alice, ok.body.order.id)).body.order.status).toBe("filled");
    expect(t.rpc.lockTags.at(-1)).toBe("latest");
  });

  test("idempotent under two concurrent watches and two concurrent ingests: each position settles once", async () => {
    const { t } = await opened();
    withdraw(t, lc(ALICE), 0n);
    t.tick(61_000);
    // two ingests of the same minute (ABI and AII): one claims the watch
    const [x, y] = await Promise.all([t.markJson(1000), t.markJson(1000, { index: "aii" })]);
    expect([x.body.lockWatch, y.body.lockWatch].filter(Boolean)).toHaveLength(1);
    // two watches at once for the same due owner (as if both had claimed): the guards settle each position once
    reopen(t);
    t.db.q("INSERT INTO lock_due (owner, from_block, last_block) VALUES (?, 1, 1)", lc(ALICE));
    const bal = t.balanceOf(lc(ALICE));
    const cursor = cursorOf(t);
    const [a, b] = await Promise.all([
      lockWatch(t.db, FACTORY, t.nowS(), t.deps.fetch!, cursor, () => 800),
      lockWatch(t.db, FACTORY, t.nowS(), t.deps.fetch!, cursor, () => 800),
    ]);
    expect(a.closed + b.closed).toBe(2);
    const closed = t.db.q<{ returned: number }>("SELECT returned FROM positions WHERE lev > 1");
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(bal + closed.reduce((s, r) => s + r.returned, 0), 9);
    expect(t.db.q("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'close:%' AND kind = 'fee'")).toEqual([{ n: 2 }]);
    expect(due(t)).toEqual([]);
  });

  test("the watch respects the statement budget: what doesn't fit stays due for the next run", async () => {
    const { t } = await opened();
    withdraw(t, lc(ALICE), 0n);
    const cursor = cursorOf(t);
    const tight = await lockWatch(t.db, FACTORY, t.nowS(), t.deps.fetch!, cursor, () => 10);
    expect(tight).toMatchObject({ cursor: t.rpc.head - C, closed: 0, due: 1, done: false });
    const roomy = await lockWatch(t.db, FACTORY, t.nowS(), t.deps.fetch!, tight.cursor, () => 800);
    expect(roomy).toMatchObject({ cursor: t.rpc.head - C, closed: 2, due: 0, done: true });
  });

  test("no factory configured: no watch, no RPC", async () => {
    const t = setup({ lockFactory: null });
    await t.signIn();
    t.tick(61_000);
    const r = await t.markJson(1000);
    expect(r.body.lockWatch).toBeNull();
    expect(t.rpc.ranges).toEqual([]);
  });
  test("eth_getLogs throttled (rpc 429): the sweep still closes the positions above the remaining lock", async () => {
    const { t } = await opened();
    t.rpc.fail.add("eth_getLogs");
    withdraw(t, lc(ALICE), 0n);
    const r = await nextMinute(t);
    expect(r.body.lockWatch).toMatchObject({ closed: 2 });
    expect(t.db.q<{ n: number }>("SELECT COUNT(*) AS n FROM positions WHERE lock_req != '0' AND closed_at IS NULL")[0].n).toBe(0);
  });
  test("eth_getLogs throttled, the lock still covers: the sweep closes nothing and nobody stays due", async () => {
    const { t } = await opened();
    t.rpc.fail.add("eth_getLogs");
    const r = await nextMinute(t);
    expect(r.body.lockWatch).toMatchObject({ closed: 0, due: 0 });
  });
});

describe("R2: the leaderboard on the $10 admission", () => {
  test("only wallets holding $10 of REGI now; while the price is unknown, only recent checks count", async () => {
    const t = setup({ snapshot: null });
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    await t.open(alice, LONG(1));
    await t.open(bob, LONG(1));
    t.balances.set(`${lc(BOB)}@latest`, ONE - 1n);
    t.tick(11 * 60_000); // the sign-in checks are stale
    await t.mark(1000);
    const board = await t.call(handleLeaderboard, t.req("/api/pilot/leaderboard"));
    expect(board.body.rows.map((r: Json) => r.address)).toEqual([`${lc(ALICE).slice(0, 6)}…${lc(ALICE).slice(-4)}`]);
    // unknown price: the fresh (≤ 10 min) check of Alice still counts, a stale one can't be re-read
    t.db.q("DELETE FROM regi_price");
    clearPriceCache(t.db);
    const ranked = t.db.q<{ wallet: string; regi_ok: number; regi_checked: number }>("SELECT wallet, regi_ok, regi_checked FROM accounts").map((a) => ({ ...a, equity: 1 }));
    expect((await regiHolders(t.db, t.env, t.nowS(), t.deps, ranked, 50)).map((r) => r.wallet)).toEqual([lc(ALICE)]);
    t.tick(11 * 60_000);
    const calls = t.rpc.calls;
    expect(await regiHolders(t.db, t.env, t.nowS(), t.deps, ranked, 50)).toEqual([]);
    expect(t.rpc.calls).toBe(calls);
  });
});

describe("lock watch: start block and a throttled RPC", () => {
  test("lockFromBlockOf parses PILOT_LOCK_FROM_BLOCK", async () => {
    const { lockFromBlockOf } = await import("../lib/pilot-regi");
    expect(lockFromBlockOf({ PILOT_LOCK_FROM_BLOCK: "25737926" } as never)).toBe(25737926);
    expect(lockFromBlockOf({ PILOT_LOCK_FROM_BLOCK: "" } as never)).toBeNull();
    expect(lockFromBlockOf({ PILOT_LOCK_FROM_BLOCK: "0x1" } as never)).toBeNull();
  });
  test("rpcCall retries once on 429, then reports it", async () => {
    const { rpcCall } = await import("../lib/pilot-regi");
    let n = 0;
    const once429 = (async () => (++n === 1 ? new Response("", { status: 429 }) : Response.json({ jsonrpc: "2.0", id: 1, result: "0x10" }))) as unknown as typeof fetch;
    expect(await rpcCall(once429, "eth_blockNumber", [])).toBe("0x10");
    expect(n).toBe(2);
    const always429 = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(rpcCall(always429, "eth_blockNumber", [])).rejects.toThrow("rpc 429");
  });
});
