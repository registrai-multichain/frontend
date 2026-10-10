/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate loosely typed JSON */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";
import { CHUNK, createEngine, httpRpc, LOG_CAP, StaleError, WIDE_CHUNK } from "./abi-live";
import { ARGUS_DEPLOYER, EURC, GBPA, HB, HS, INDEX, JPYC, mockRpc, NOT_REGISTERED, scIndex, SEEN, tsOf } from "./abi-live-mock";
import { INTEG_LOGS, integIndex, ROUTER, POOL, wideIntegIndex } from "./abi-live-mock";
import type { LiveData } from "./abi-live-mock";

const L = INDEX.live!;
const REF = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/terminal/live.js";

function engine(head: number, stats?: { calls: string[] }) {
  const e = createEngine({ call: mockRpc(head, stats) as never });
  e.load(INDEX, SEEN);
  return e;
}

describe("replaying an empty range", () => {
  test("gives the server value (982.208204) at the start of the open hour", async () => {
    const e = engine(HB + 10);
    expect(e.evaluate(0).index).toBe(982.2082037374452);
    const r = await e.tick(); // head is 10 blocks into the hour: f = 5 s / 3600 s... but no payments
    expect(r.closedHours).toEqual([]);
    expect(r.head).toBe(HB + 10);
    expect(r.index).toBeCloseTo(982.2082037374452 * 1, 1); // decay of 5 s only
    expect(r.index).toBeLessThan(982.2082037374452);
    expect(r.index).toBeGreaterThan(944.7);
    expect(Object.keys(r.act)).toEqual([]);
  });
  test("a full hour with no payments only decays", () => {
    const e = engine(HB + 10);
    expect(e.evaluate(1).index).toBe(981.5330243515509);
  });
});

describe("one open hour", () => {
  test("counts external payments, the per-wallet cap and new payers; ignores own deployers, tracked contracts and mints", async () => {
    const e = engine(HB + 4100); // the second getLogs window is not needed, the first covers it
    const r = await e.tick();
    const a = r.act["domain:argus.world"];
    expect(a.payments).toBe(3);
    expect([...a.wallets].sort()).toEqual(["0x" + "a".repeat(40), "0x" + "b".repeat(40)]);
    expect(a.new_payers).toBe(1);
    // log2(1+5) + log2(1+995) + 1 new payer + log2(1+12)
    expect(a.points).toBeCloseTo(Math.log2(6) + Math.log2(996) + 1 + Math.log2(13), 9);
    expect(r.act["domain:peach.ag"].points).toBeCloseTo(Math.log2(51) + 1, 9);
    expect(r.head).toBe(HB + 4100);
  });
  test("base layer is sampled once 240 blocks have passed", async () => {
    const before = await engine(HB + 100).tick();
    expect(before.baseSampled).toBe(false);
    const after = await engine(HB + 300).tick();
    expect(after.baseSampled).toBe(true);
  });
});

describe("hour roll", () => {
  test("closes the open hour itself, queries logs in chunks under 10,000 blocks and opens the next", async () => {
    const calls: string[] = [];
    const rpcLogsRanges: number[] = [];
    const inner = mockRpc(HB + 7300, { calls });
    const e = createEngine({
      call: (async (m: string, p: unknown[]) => {
        if (m === "eth_getLogs") { const f = (p[0] as { fromBlock: string; toBlock: string }); rpcLogsRanges.push(parseInt(f.toBlock, 16) - parseInt(f.fromBlock, 16) + 1); }
        return inner(m, p);
      }) as never,
    });
    e.load(INDEX, SEEN);
    const r = await e.tick();
    expect(r.closedHours).toHaveLength(1);
    expect(r.closedHours[0].t).toBe(HS + 3600);
    expect(e.hourStart).toBe(HS + 3600);
    expect(r.hourStart).toBe(HS + 3600);
    expect(Math.max(...rpcLogsRanges)).toBeLessThanOrEqual(CHUNK);
    expect(rpcLogsRanges.filter((n) => n === CHUNK).length).toBeGreaterThanOrEqual(1);
    // wallet A paid in the closed hour, so its payment in the new hour is not new
    expect(r.act["domain:argus.world"].new_payers).toBe(0);
    expect(r.f).toBeCloseTo((HS + 3650 - (HS + 3600)) / 3600, 9);
  });
});

// produced by the reference live.js on the same mock chain (the equivalence tests below re-check them when it is present)
const GOLD = { closed: 981.5627449901694, open: 981.5554347816068 };

describe("golden values (from the reference live.js)", () => {
  test("after the roll", async () => {
    const r = await engine(HB + 7300).tick();
    expect(r.closedHours[0].index).toBeCloseTo(GOLD.closed, 9);
    expect(r.index).toBeCloseTo(GOLD.open, 9);
  });
});

describe.skipIf(!existsSync(REF))("equivalence with the reference live.js", () => {
  async function ref(head: number, index: LiveData = INDEX, extra: Parameters<typeof mockRpc>[2] = [], doc?: object) {
    const mod = createRequire(import.meta.url)(REF) as { createEngine: (o: object) => { load: (a: unknown, b: unknown, c?: unknown) => void; tick: () => Promise<any> } };
    const inner = mockRpc(head, undefined, extra);
    let id = 0;
    vi.stubGlobal("fetch", async (_u: string, o: { body: string }) => {
      const b = JSON.parse(o.body);
      try { return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: ++id, result: await inner(b.method, b.params) }) }; }
      catch (e) { return { ok: true, status: 200, json: async () => ({ error: { message: String(e) } }) }; }
    });
    const e = mod.createEngine({});
    e.load(JSON.parse(JSON.stringify(index)), SEEN, doc && JSON.parse(JSON.stringify(doc)));
    const out = await e.tick();
    vi.unstubAllGlobals();
    return out;
  }
  const cases = [10, 100, 300, 1000, 4100, 5450, 7300].flatMap((off) => [[off, "USDC only"], [off, "stablecoins + milestones"], [off, "integrated products"], [off, "wide member list"]] as const);
  test.each(cases)("head +%i blocks, %s: identical numbers", async (off, kind) => {
    const wide = kind === "wide member list" ? wideIntegIndex() : null;
    const index = kind === "USDC only" ? INDEX : kind === "integrated products" ? integIndex() : wide ? wide.index : scIndex();
    const extra = kind === "integrated products" || wide ? INTEG_LOGS : [];
    const a = await ref(HB + off, index, extra, wide?.doc);
    const e = createEngine({ call: mockRpc(HB + off, undefined, extra) as never });
    e.load(wide ? { ...index, contracts: wide.doc } : index, SEEN);
    const b = await e.tick();
    expect(b.index).toBe(a.index);
    expect(b.total).toBe(a.total);
    expect(b.roots).toEqual(a.roots);
    expect(b.P).toEqual(a.P);
    expect(b.capped).toEqual(a.capped);
    expect(b.closedHours).toEqual(a.closedHours);
    expect(b.candle).toEqual(a.candle);
    expect(b.tape).toEqual(a.tape);
    expect(b.rootsPrev).toEqual(a.rootsPrev);
    expect(b.head).toBe(a.head);
    expect(b.f).toBe(a.f);
    expect(Object.keys(b.act)).toEqual(Object.keys(a.act));
    for (const k of Object.keys(a.act)) expect({ ...b.act[k], wallets: [...b.act[k].wallets] }).toEqual({ ...a.act[k], wallets: [...a.act[k].wallets] });
  });
});

describe("fiat stablecoins (registry coins, ECB fix of the day before)", () => {
  const scEngine = (head: number, stats?: { calls: string[]; ranges?: unknown[] }) => {
    const inner = mockRpc(head, stats);
    const e = createEngine({ call: (async (m: string, p: unknown[]) => { if (m === "eth_getLogs") stats?.ranges?.push(p[0]); return inner(m, p); }) as never });
    e.load(scIndex(), SEEN);
    return e;
  };
  test("member inflows score like USDC, in USD at the 8 Oct fix; deployers, mints and coins before `added` do not count", async () => {
    const r = await scEngine(HB + 300).tick();
    const tape = r.tape.filter((t) => t.ts === tsOf(HB + 25) || t.ts === tsOf(HB + 45));
    const eur = (Number(BigInt(100_000_000)) / 10 ** 6) * 1.1186;
    const jpy = (Number(10n ** 21n) / 10 ** 18) * 0.0063179893;
    expect(tape).toEqual([
      { ts: tsOf(HB + 25), src: "domain:argus.world", v: eur, pts: Math.log2(1 + eur) + 1, isNew: true },
      { ts: tsOf(HB + 45), src: "domain:peach.ag", v: jpy, pts: Math.log2(1 + jpy) + 1, isNew: true },
    ]);
    // Argus: USDC from A (5, 1500) and B (12), EURC from C; the deployer's EURC, the EURC mint and GBPA (added next hour) are dropped
    expect(r.act["domain:argus.world"].payments).toBe(4);
    expect(r.act["domain:argus.world"].usdc).toBeCloseTo(5 + 995 + 12 + eur, 9);
    expect([...r.act["domain:argus.world"].wallets]).not.toContain(ARGUS_DEPLOYER);
  });
  test("the per-wallet cap applies to the USD value", async () => {
    const r = await scEngine(HB + 4100).tick();
    const big = r.tape.find((t) => t.ts === tsOf(HB + 4050))!;
    expect(big.v).toBeCloseTo(2500 * 1.1186, 9);
    expect(big.pts).toBeCloseTo(Math.log2(1 + 1000) + 1, 12);
  });
  test("one extra getLogs per chunk for the registry coins, member topics only, ranges within the chunk", async () => {
    const stats = { calls: [] as string[], ranges: [] as unknown[] };
    await scEngine(HB + 4100, stats).tick();
    const q = stats.ranges as { fromBlock: string; toBlock: string; address: string | string[]; topics: unknown[] }[];
    const coinQs = q.filter((x) => Array.isArray(x.address));
    expect(coinQs.filter((x) => x.topics.length === 3)).toHaveLength(1); // one chunk (4,101 blocks)
    expect(coinQs[0].address).toEqual([EURC, JPYC, GBPA]);
    expect(coinQs[0].address).not.toContain(NOT_REGISTERED);
    expect((coinQs[0].topics[2] as string[]).every((t) => t.length === 66)).toBe(true);
    for (const x of q) expect(parseInt(x.toBlock, 16) - parseInt(x.fromBlock, 16) + 1).toBeLessThanOrEqual(CHUNK);
    const r2 = { calls: [] as string[], ranges: [] as unknown[] };
    await scEngine(HB + 7300, r2).tick();
    expect((r2.ranges as { address: unknown; topics: unknown[] }[]).filter((x) => Array.isArray(x.address) && x.topics.length === 3)).toHaveLength(2); // two chunks
  });
  test("the base sample adds each sender's stablecoin USD after their USDC, coins added by the hour's start only", async () => {
    // rise limits lifted so P[base] = decayed P + the sample exactly
    const open = (d: LiveData) => { d.live!.proj_up = 1e9; d.live!.rel_up = 0; return d; };
    const run = async (d: LiveData) => { const e = createEngine({ call: mockRpc(HB + 300) as never }); e.load(open(d), SEEN); return e.tick(); };
    const plainIdx = open(JSON.parse(JSON.stringify(INDEX))), scIdx = scIndex();
    const plain = await run(plainIdx), withSc = await run(scIdx);
    const L2 = scIdx.live;
    const usd = (v: number, rate: number, dec: number) => (Number(BigInt(Math.round(v * 1e6)) * 10n ** BigInt(dec - 6)) / 10 ** dec) * rate;
    // USDC per sender in the first 240 blocks: A 1505, B 12, Argus's deployer 40, Peach 40, d 120, e 7.5.
    // Coins: deployer + 500 EURC, d + 50 EURC (merged after their USDC), C 100 EURC, 9 1,000 JPYC, 8 30,000 JPYC;
    // the self-transfer, the mints and GBPA (added after the hour's start) do not count
    const pts = (vals: number[]) => L2.base_scale * vals.reduce((a, v) => a + Math.log2(1 + Math.min(Math.round(v * 1e6) / 1e6, L2.cap)), 0);
    const decayed = L2.P[L2.base] * Math.pow(L2.decay_h, plain.f);
    expect(plain.capped).toEqual([]);
    const eur = (v: number) => usd(v, 1.1186, 6), jpy = (v: number) => usd(v, 0.0063179893, 18);
    expect(plain.P[L2.base]).toBeCloseTo(decayed + pts([1505, 12, 40, 40, 120, 7.5]), 6);
    expect(withSc.P[L2.base]).toBeCloseTo(decayed + pts([1505, 12, 40 + eur(500), 40, 120 + eur(50), 7.5, eur(100), jpy(1000), jpy(30000)]), 6);
  });
  test("a coin added after the open hour starts counts from the next hour (after the roll)", async () => {
    const r = await scEngine(HB + 7300).tick();
    const g = r.tape.find((t) => t.ts === tsOf(HB + 7260))!;
    expect(g).toMatchObject({ src: "domain:argus.world", isNew: false });
    expect(g.v).toBeCloseTo(20 * 1.3206923422, 12);
  });
});

describe("milestones (after the rise limit, exempt from it)", () => {
  const run = async (off: number, index: LiveData) => { const e = createEngine({ call: mockRpc(HB + off) as never }); e.load(index, SEEN); return e.tick(); };
  const noMs = () => { const d = scIndex(); d.milestones = []; return d; };
  test("before its time a milestone changes nothing", async () => {
    const a = await run(1000, scIndex()), b = await run(1000, noMs()); // head ts = HS + 500
    expect(a.index).toBe(b.index);
    expect(a.candle).toEqual(b.candle);
  });
  test("once t ≤ head: the target's √P is multiplied by √mult after the limit", async () => {
    const a = await run(4100, scIndex()), b = await run(4100, noMs()); // head ts = HS + 2050: the base-layer upgrade only
    const base = INDEX.live.base;
    expect(a.roots[base]).toBeCloseTo(b.roots[base] * Math.sqrt(1.25), 9);
    expect(a.roots["domain:argus.world"]).toBe(b.roots["domain:argus.world"]);
    const c = await run(5450, scIndex()), d0 = await run(5450, noMs()); // HS + 2725: the Argus release too
    expect(c.roots["domain:argus.world"]).toBeCloseTo(d0.roots["domain:argus.world"] * Math.sqrt(1.1), 9);
    expect(c.P["domain:argus.world"]).toBeCloseTo(d0.P["domain:argus.world"] * 1.1, 6);
  });
  test("the milestone is its own path point: the candle's high includes the jump", async () => {
    const a = await run(4100, scIndex());
    expect(a.candle[2]).toBeGreaterThanOrEqual(a.index);
    expect(a.index).toBeGreaterThan((await run(4100, noMs())).index * 1.01);
  });
  test("the hour closes with its milestones; the next hour's milestone applies once its time passes", async () => {
    const a = await run(7300, scIndex()), b = await run(7300, noMs());
    expect(a.closedHours[0].index).toBeGreaterThan(b.closedHours[0].index);
    expect(a.rootsPrev[INDEX.live.base]).toBeCloseTo(b.rootsPrev[INDEX.live.base] * Math.sqrt(1.25), 6);
    expect(a.closedHours[0].candle[2]).toBeGreaterThanOrEqual(a.closedHours[0].index);
  });
});

// produced by the reference live.js on the stablecoin + milestone scenario
const GOLD_SC = { open4100: 1006.1994645145858, closed7300: 1015.0371904744302, open7300: 1022.9113151469047 };

describe("golden values, stablecoins + milestones (from the reference live.js)", () => {
  test("open hour and roll", async () => {
    const run = async (off: number) => { const e = createEngine({ call: mockRpc(HB + off) as never }); e.load(scIndex(), SEEN); return e.tick(); };
    const a = await run(4100), b = await run(7300);
    expect(a.index).toBeCloseTo(GOLD_SC.open4100, 9);
    expect(b.closedHours[0].index).toBeCloseTo(GOLD_SC.closed7300, 9);
    expect(b.index).toBeCloseTo(GOLD_SC.open7300, 9);
  });
});

describe("candle, tape and roll-off inputs", () => {
  test("the open candle starts at the previous close and tracks the path of each payment", async () => {
    const r = await engine(HB + 4100).tick();
    const [t, o, h, l, c, n, u, p] = r.candle;
    expect(t).toBe(new Date(HS * 1000).toISOString().slice(0, 19) + "Z");
    expect(o).toBeCloseTo(L.K * Object.values(L.roots_prev).reduce((x, y) => x + y, 0), 9);
    expect(h).toBeGreaterThanOrEqual(Math.max(o, c));
    expect(l).toBeLessThanOrEqual(Math.min(o, c));
    expect(c).toBe(r.index);
    expect(n).toBe(4);
    expect(u).toBeCloseTo(5 + 995 + 12 + 50, 6); // counted USDC, after the per-wallet cap
    expect(p).toBeCloseTo(Object.values(r.act).reduce((x, a) => x + a.points, 0), 9);
    expect(r.tape).toHaveLength(4);
    expect(r.tape[1]).toMatchObject({ v: 1500, isNew: false }); // raw amount on the tape, not the capped one
    expect(r.rootsPrev).toEqual(L.roots_prev);
  });
  test("a self-closed hour carries its candle; the next candle opens at its close", async () => {
    const r = await engine(HB + 7300).tick();
    const c = r.closedHours[0].candle;
    expect(c[4]).toBe(r.closedHours[0].index);
    expect(c[0]).toBe(new Date(HS * 1000).toISOString().slice(0, 19) + "Z");
    expect(r.candle[1]).toBe(c[4]);
    expect(r.candle[0]).toBe(new Date((HS + 3600) * 1000).toISOString().slice(0, 19) + "Z");
  });
});

describe("stale server data", () => {
  test("more than 3 hours behind the chain: no catch-up, no log fetch", async () => {
    const calls: string[] = [];
    const e = createEngine({ call: mockRpc(HB + 2 * (3 * 3600 + 60), { calls }) as never });
    e.load(INDEX, SEEN);
    await expect(e.tick()).rejects.toBeInstanceOf(StaleError);
    expect(calls).toEqual(["eth_getBlockByNumber"]);
  });
  test("exactly 3 hours behind still catches up", async () => {
    const e = createEngine({ call: mockRpc(HB + 2 * 3 * 3600) as never });
    e.load(INDEX, SEEN);
    await expect(e.tick()).resolves.toMatchObject({ closedHours: expect.any(Array) });
  });
});

describe("rpc transport", () => {
  test("429 and 5xx back off and retry; other errors throw", async () => {
    const sleeps: number[] = [];
    const answers = [{ status: 429 }, { status: 502 }, { status: 200, body: { result: "0x1" } }];
    vi.stubGlobal("fetch", async () => { const a = answers.shift()!; return { ok: a.status === 200, status: a.status, json: async () => a.body }; });
    const call = httpRpc("https://rpc.example", async (ms) => { sleeps.push(ms); });
    expect(await call("eth_blockNumber", [])).toBe("0x1");
    expect(sleeps).toEqual([800, 1600]);
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "bad" } }) }));
    await expect(call("x", [])).rejects.toThrow("RPC bad");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await expect(call("x", [])).rejects.toThrow("RPC HTTP 403");
    vi.unstubAllGlobals();
  });
  test("gives up after 5 retries on a rate limit", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(httpRpc("https://rpc.example", async () => undefined)("x", [])).rejects.toThrow("RPC HTTP 429");
    vi.unstubAllGlobals();
  });
});

describe("integrated products (§15): open senders", () => {
  test("their payments count for other members, never for their own; the old rule still holds without open_senders", async () => {
    const run = async (index: LiveData) => {
      const e = createEngine({ call: mockRpc(HB + 300, undefined, INTEG_LOGS) as never });
      e.load(index, SEEN);
      return e.tick();
    };
    const R = await run(integIndex());
    const u = R.act["integration:uniswap"];
    expect([u.payments, u.usdc, [...u.wallets]]).toEqual([1, 30, ["0x" + "1".repeat(40)]]);
    expect([...R.act["domain:argus.world"].wallets]).toContain(ROUTER);
    expect([...R.act["domain:peach.ag"].wallets]).toContain(POOL);
    // the same contracts tracked but not open: every hop from them is internal
    const closed = integIndex(); delete closed.live.open_senders;
    const C = await run(closed);
    expect([...C.act["domain:argus.world"].wallets]).not.toContain(ROUTER);
    expect(C.act["domain:peach.ag"]?.wallets ? [...C.act["domain:peach.ag"].wallets] : []).not.toContain(POOL);
    expect(C.act["integration:uniswap"].payments).toBe(1);
  });
});

describe('"close the gaps": the member map in its own document, a wide member list', () => {
  const tick = async (input: Parameters<ReturnType<typeof createEngine>["load"]>[0], call = mockRpc(HB + 300, undefined, INTEG_LOGS)) => {
    const e = createEngine({ call: call as never });
    e.load(input, SEEN);
    return e.tick();
  };
  test("a separate map (contracts_sha256) and > WIDE_ABOVE idle contracts give exactly the inline result", async () => {
    const inline = await tick(integIndex());
    const { index, doc } = wideIntegIndex();
    const wide = await tick({ ...index, contracts: doc });
    for (const k of ["index", "total", "roots", "P", "candle", "tape"] as const) expect(wide[k]).toEqual(inline[k]);
  });
  test("wide mode asks for every transfer (no topic list) in chunks of at most WIDE_CHUNK blocks", async () => {
    const calls: { from: number; to: number; topics: unknown[] }[] = [];
    const inner = mockRpc(HB + 4100, undefined, INTEG_LOGS);
    const spy = async (m: string, p: unknown[]) => {
      if (m === "eth_getLogs") { const f = p[0] as { fromBlock: string; toBlock: string; topics: unknown[] }; calls.push({ from: parseInt(f.fromBlock, 16), to: parseInt(f.toBlock, 16), topics: f.topics }); }
      return inner(m, p);
    };
    const { index, doc } = wideIntegIndex();
    await tick({ ...index, contracts: doc }, spy as never);
    const member = calls.filter((c) => c.to - c.from + 1 > 240 || c.from !== HB); // leave out the base-layer sample
    expect(member.length).toBeGreaterThan(1);
    for (const c of member) { expect(c.topics.length).toBe(1); expect(c.to - c.from + 1).toBeLessThanOrEqual(WIDE_CHUNK); }
  });
  test("a page that errors or comes back at the result cap is split; the numbers are unchanged", async () => {
    const want = await tick(integIndex(), mockRpc(HB + 4100, undefined, INTEG_LOGS));
    const inner = mockRpc(HB + 4100, undefined, INTEG_LOGS);
    let refused = 0;
    const flaky = async (m: string, p: unknown[]) => {
      if (m === "eth_getLogs") {
        const f = p[0] as { fromBlock: string; toBlock: string };
        const span = parseInt(f.toBlock, 16) - parseInt(f.fromBlock, 16) + 1;
        if (span > 700) { refused++; throw new Error("range too large"); }
        if (span > 300) { refused++; return Array.from({ length: LOG_CAP }, () => ({})); } // a full page: maybe cut
      }
      return inner(m, p);
    };
    const { index, doc } = wideIntegIndex();
    const got = await tick({ ...index, contracts: doc }, flaky as never);
    expect(refused).toBeGreaterThan(0);
    for (const k of ["index", "roots", "P", "tape"] as const) expect(got[k]).toEqual(want[k]);
  });
});

describe("audit OPS-1: the base-layer sample survives a window that one request cannot return", () => {
  test("a refused or full page for the 240-block sample is split; the base points are unchanged", async () => {
    const run = async (call: unknown) => { const e = createEngine({ call: call as never }); e.load(INDEX, SEEN); return e.tick(); };
    const want = await run(mockRpc(HB + 300));
    const inner = mockRpc(HB + 300);
    let refused = 0;
    const capped = async (m: string, p: unknown[]) => {
      const f = p[0] as { fromBlock: string; toBlock: string; topics: unknown[] } | undefined;
      if (m === "eth_getLogs" && f && f.topics.length === 1 && parseInt(f.toBlock, 16) - parseInt(f.fromBlock, 16) + 1 > 60) { refused++; throw new Error("query exceeds max results 20000"); }
      return inner(m, p);
    };
    const got = await run(capped);
    expect(refused).toBeGreaterThan(0);
    expect(got.baseSampled).toBe(true);
    for (const k of ["index", "roots", "P"] as const) expect(got[k]).toEqual(want[k]);
  });
});
