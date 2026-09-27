import { describe, expect, it } from "vitest";
import { createPublicClient, custom, http } from "viem";
import { isRateLimit, makeLogsQueue, paceLogs } from "./rpc-pacing";

/** A fake clock: sleep advances time instantly, and every start time is recorded. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("isRateLimit", () => {
  it("knows a 429, a -32005 and the message, also as a cause", () => {
    expect(isRateLimit({ status: 429 })).toBe(true);
    expect(isRateLimit({ code: -32005, message: "rate limit exceeded" })).toBe(true);
    expect(isRateLimit(new Error("outer", { cause: { status: 429 } }))).toBe(true);
    expect(isRateLimit(new Error("HTTP request failed. Status: 429"))).toBe(true);
  });
  it("does not retry a range error or a revert", () => {
    expect(isRateLimit({ code: -32012, message: "requested range too large" })).toBe(false);
    expect(isRateLimit(new Error("execution reverted"))).toBe(false);
    expect(isRateLimit(undefined)).toBe(false);
  });
});

describe("makeLogsQueue", () => {
  it("runs one at a time, starts gapMs apart, in order", async () => {
    const clock = fakeClock();
    const q = makeLogsQueue({ gapMs: 350, backoffMs: 2500, retries: 4 }, clock);
    const starts: number[] = [];
    let inFlight = 0, maxInFlight = 0;
    const task = (i: number) => async () => {
      starts.push(clock.now()); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); inFlight--; return i;
    };
    const out = await Promise.all([0, 1, 2, 3, 4].map((i) => q(task(i))));
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(maxInFlight).toBe(1);
    expect(starts).toEqual([0, 350, 700, 1050, 1400]);
  });

  it("backs off and retries a rate-limited call, then succeeds", async () => {
    const clock = fakeClock();
    const q = makeLogsQueue({ gapMs: 350, backoffMs: 2500, retries: 4 }, clock);
    const starts: number[] = [];
    let n = 0;
    const r = await q(async () => { starts.push(clock.now()); if (n++ < 2) throw { code: -32005, message: "rate limit exceeded" }; return "ok"; });
    expect(r).toBe("ok");
    expect(starts).toEqual([0, 2500, 5000]);
  });

  it("gives up after `retries`, and a failure does not stall the queue", async () => {
    const clock = fakeClock();
    const q = makeLogsQueue({ gapMs: 350, backoffMs: 2500, retries: 2 }, clock);
    let calls = 0;
    const bad = q(async () => { calls++; throw { status: 429 }; });
    const next = q(async () => "next");
    await expect(bad).rejects.toEqual({ status: 429 });
    expect(calls).toBe(3);
    await expect(next).resolves.toBe("next");
  });

  it("does not retry other errors", async () => {
    const q = makeLogsQueue({ gapMs: 350, backoffMs: 2500, retries: 4 }, fakeClock());
    let calls = 0;
    await expect(q(async () => { calls++; throw { code: -32012, message: "requested range too large" }; })).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });
});

describe("paceLogs", () => {
  it("routes only eth_getLogs through the queue, with the transport's own retries off", async () => {
    const seen: string[] = [];
    const queued: string[] = [];
    const inner = custom({ request: async ({ method }: { method: string }) => { seen.push(method); return method === "eth_getLogs" ? [] : "0x1"; } });
    const queue = <T,>(run: () => Promise<T>) => { queued.push("q"); return run(); };
    const client = createPublicClient({ transport: paceLogs(inner, queue) });
    await client.getBlockNumber({ cacheTime: 0 });
    await client.request({ method: "eth_getLogs", params: [{ fromBlock: "0x1", toBlock: "0x2" }] });
    expect(seen).toEqual(["eth_blockNumber", "eth_getLogs"]);
    expect(queued).toEqual(["q"]);
  });

  it("keeps a batching http transport to one getLogs per batch", async () => {
    const bodies: unknown[] = [];
    const fetchFn = (async (_u: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const reply = (x: { id: number; method: string }) => ({ jsonrpc: "2.0", id: x.id, result: x.method === "eth_getLogs" ? [] : "0x1" });
      return new Response(JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const q = makeLogsQueue({ gapMs: 0, backoffMs: 0, retries: 0 });
    const client = createPublicClient({ transport: paceLogs(http("https://rpc.example", { batch: { batchSize: 8, wait: 5 }, fetchFn }), q) });
    const logs = [1, 2, 3, 4].map((i) => client.request({ method: "eth_getLogs", params: [{ fromBlock: `0x${i}`, toBlock: `0x${i}` }] }));
    await Promise.all(logs);
    const perRequest = bodies.map((b) => (Array.isArray(b) ? b : [b]).filter((x: { method: string }) => x.method === "eth_getLogs").length);
    expect(Math.max(...perRequest)).toBe(1);
    expect(perRequest.reduce((a, b) => a + b, 0)).toBe(4);
  });
});
