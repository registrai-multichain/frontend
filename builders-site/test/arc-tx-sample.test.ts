import { describe, expect, test, vi } from "vitest";

type Call = { id: number; method: string; params: unknown[] };
const batchFetch = (handler: (call: Call, url: string) => unknown) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call[] | Call;
    const one = (c: Call) => { const r = handler(c, String(url)); return r instanceof Error ? { jsonrpc: "2.0", id: c.id, error: { code: -32005, message: r.message } } : { jsonrpc: "2.0", id: c.id, result: r }; };
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)));
  });

describe("transaction sample", () => {
  test("240 blocks over 24 h in three Blockdaemon batches of 80; estimate = mean × blocks in 24 h, to the nearest 1,000", async () => {
    const { sampleTransactions, RPC_BLOCKDAEMON } = await import("../lib/arc-numbers");
    const f = batchFetch(() => "0x2");   // 2 tx per block
    const r = await sampleTransactions(f as never, 1_000_000, 0.5);
    expect(f).toHaveBeenCalledTimes(3);
    for (const c of f.mock.calls) { expect(String(c[0])).toBe(RPC_BLOCKDAEMON); expect(JSON.parse(String(c[1]!.body))).toHaveLength(80); }
    expect(r).toEqual({ estimate: 346_000, blocks: 240, from_block: 1_000_000 - 172_800 + 720, to_block: 1_000_000 });
  });
  test("error items are skipped; fewer than 200 answers → null; Blockdaemon down → null (never the public RPC)", async () => {
    const { sampleTransactions } = await import("../lib/arc-numbers");
    let n = 0;
    expect((await sampleTransactions(batchFetch(() => (n++ % 10 === 0 ? new Error("rate limit exceeded") : "0x1")) as never, 1_000_000, 0.5))?.blocks).toBe(216);
    n = 0;
    expect(await sampleTransactions(batchFetch(() => (n++ % 4 === 0 ? new Error("rate limit exceeded") : "0x1")) as never, 1_000_000, 0.5)).toBeNull();
    const down = vi.fn(async (_url: string) => { throw new Error("down"); });
    expect(await sampleTransactions(down as never, 1_000_000, 0.5)).toBeNull();
    expect(down.mock.calls.every((c) => String(c[0]).includes("blockdaemon"))).toBe(true);
  });
  test("token supplies: one batch, divided by decimals; a failed item or a null address is null; falls back to the public RPC", async () => {
    const { tokenSupplies } = await import("../lib/arc-numbers");
    const f = batchFetch((c, url) => (url.includes("blockdaemon") ? new Error("down") : (c.params[0] as { to: string }).to.endsWith("1") ? "0xf4240" : new Error("rate limit exceeded")));
    const s = await tokenSupplies(f as never, [{ address: "0x0000000000000000000000000000000000000001", decimals: 6 }, { address: "0x0000000000000000000000000000000000000002", decimals: 6 }, { address: null, decimals: 6 }]);
    expect(s).toEqual([1, null, null]);
  });
});
