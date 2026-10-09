import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";
import { CHUNK, createEngine, httpRpc, StaleError } from "./abi-live";
import { HB, HS, INDEX, mockRpc, SEEN } from "./abi-live-mock";

const L = INDEX.live!;
const REF = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/terminal/live.js";

function engine(head: number, stats?: { calls: string[] }) {
  const e = createEngine({ call: mockRpc(head, stats) as never });
  e.load(L, SEEN);
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
    e.load(L, SEEN);
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
  async function ref(head: number) {
    const mod = createRequire(import.meta.url)(REF) as { createEngine: (o: object) => { load: (a: unknown, b: unknown) => void; tick: () => Promise<any> } };
    const inner = mockRpc(head);
    let id = 0;
    vi.stubGlobal("fetch", async (_u: string, o: { body: string }) => {
      const b = JSON.parse(o.body);
      try { return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: ++id, result: await inner(b.method, b.params) }) }; }
      catch (e) { return { ok: true, status: 200, json: async () => ({ error: { message: String(e) } }) }; }
    });
    const e = mod.createEngine({});
    e.load(JSON.parse(JSON.stringify(INDEX)), SEEN);
    const out = await e.tick();
    vi.unstubAllGlobals();
    return out;
  }
  test.each([10, 100, 300, 4100, 7300])("head +%i blocks: identical numbers", async (off) => {
    const a = await ref(HB + off);
    const b = await engine(HB + off).tick();
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
    e.load(L, SEEN);
    await expect(e.tick()).rejects.toBeInstanceOf(StaleError);
    expect(calls).toEqual(["eth_getBlockByNumber"]);
  });
  test("exactly 3 hours behind still catches up", async () => {
    const e = createEngine({ call: mockRpc(HB + 2 * 3 * 3600) as never });
    e.load(L, SEEN);
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
