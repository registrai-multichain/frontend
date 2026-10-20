import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { ABI_INDICES } from "../../src/lib/builders-index";
import { MemoryKV } from "./memory-kv";

const E = [
  { slug: "a", name: "A", category: "dexs", status: "live", summary: "x", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://a.b/" }], index_ids: ["domain:a.b"], last_reviewed: "2026-10-20" },
  { slug: "b", name: "B", category: "dexs", status: "announced", summary: "x", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://b.c/" }], last_reviewed: "2026-10-20" },
  { slug: "c", name: "C", category: "banks", status: "deployed", summary: "x", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://c.d/" }], last_reviewed: "2026-10-20" },
] as ArcEntity[];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E) }));

const NOW = Date.parse("2026-10-20T17:30:00Z");
const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;

/** A fetcher standing in for the Arc RPC and DefiLlama. */
function fakeFetch(opts: { llamaDown?: boolean; rpcDown?: boolean } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("llama.fi")) {
      if (opts.llamaDown) throw new Error("timeout");
      if (u.includes("historicalChainTvl")) return new Response(JSON.stringify([{ date: 1792368000, tvl: 1 }, { date: 1792454400, tvl: 528831654 }]));
      return new Response(JSON.stringify([{ date: "1792454400", totalCirculatingUSD: { peggedUSD: 742300000 } }]));
    }
    if (opts.rpcDown) throw new Error("rpc down");
    const body = JSON.parse(String(init?.body));
    const res = (r: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: r }));
    if (body.method === "eth_getBlockByNumber") {
      return body.params[0] === "latest" ? res({ number: hex(26976520), timestamp: hex(1792516227) }) : res({ number: body.params[0], timestamp: hex(1792511158) });
    }
    if (body.method === "eth_call") {
      const to = body.params[0].to.toLowerCase();
      return res(hex(to === "0x3600000000000000000000000000000000000000" ? 758938840361892n : 21500000000000n));
    }
    return new Response("{}", { status: 400 });
  });
}

async function kvWithIndices() {
  const kv = new MemoryKV();
  const file = (members: number, close: number) => JSON.stringify({ data_until: "2026-10-20T17:00:00Z", projects: Array.from({ length: members }, (_, k) => ({ source: `s${k}` })),
    candles: [["2026-10-20T16:00:00Z", 1, 1, 1, close]],
    volume_24h: { USDC: { members_usd: 12810996.76, members_payments: 123945, base_usd_est: 430908916.2, base_transfers_est: 458700 }, EURC: { members_usd: 1, members_payments: 1, base_usd_est: 66035801.1, base_transfers_est: 19980 } } });
  await kv.put(ABI_INDICES.abi.key, file(19, 934.91));
  await kv.put(ABI_INDICES.aii.key, file(23, 964.5));
  await kv.put(ABI_INDICES.aei.key, file(42, 975.7));
  return kv;
}

describe("Arc in numbers", () => {
  test("collects every section from the RPC, DefiLlama, the index files and the directory", async () => {
    const { collectArcNumbers } = await import("../lib/arc-numbers");
    const n = await collectArcNumbers({ INVITES: await kvWithIndices() } as never, fakeFetch() as never, NOW);
    expect(n.version).toBe(1);
    expect(n.network).toMatchObject({ chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: 26976520 });
    expect(n.network.block_time_s).toBeCloseTo(0.5069, 3);
    expect(n.stablecoins).toMatchObject({ usdc_supply: 758938840.361892, eurc_supply: 21500000, tvl_usd: 528831654, all_stablecoins_usd: 742300000, defillama_date: "2026-10-20" });
    expect(n.activity_24h).toMatchObject({ data_until: "2026-10-20T17:00:00Z", usdc_moved_usd_est: 430908916.2, eurc_moved_usd_est: 66035801.1, usdc_transfers_est: 458700,
      app_payments: 123945, app_usd: 12810996.76, attributed_share_pct: 2.97 });
    expect(n.ecosystem).toMatchObject({ projects: 3, live: 1, deployed: 1, announced: 1, index_members: { abi: 19, aii: 23, aei: 42 }, index_close: { abi: 934.91, aii: 964.5, aei: 975.7 } });
    expect(n.ecosystem.top_categories[0]).toEqual({ id: "dexs", label: "DEXs on Arc", count: 2 });
    expect(n.timeline.map((t) => t.date)).toEqual(["2025-10-28", "2026-08-05", "2026-09-16"]);
    expect(n.errors).toEqual([]);
  });

  test("one source down: its fields are null with an error; the rest is still there", async () => {
    const { collectArcNumbers } = await import("../lib/arc-numbers");
    const n = await collectArcNumbers({ INVITES: await kvWithIndices() } as never, fakeFetch({ llamaDown: true }) as never, NOW);
    expect(n.stablecoins.tvl_usd).toBeNull();
    expect(n.stablecoins.all_stablecoins_usd).toBeNull();
    expect(n.stablecoins.usdc_supply).toBe(758938840.361892);
    expect(n.errors.join()).toMatch(/defillama/);
    const r = await collectArcNumbers({ INVITES: new MemoryKV() } as never, fakeFetch({ rpcDown: true }) as never, NOW);
    expect(r.network.block_height).toBeNull();
    expect(r.activity_24h.usdc_moved_usd_est).toBeNull();
    expect(r.ecosystem.projects).toBe(3);
    expect(r.errors.join()).toMatch(/rpc/);
    expect(r.errors.join()).toMatch(/index/);
  });
});

describe("review fixes", () => {
  test("I1: an overall deadline: a hanging source resolves as an error, not a hang", async () => {
    const { collectArcNumbers } = await import("../lib/arc-numbers");
    const hang = vi.fn(() => new Promise<Response>(() => undefined));
    const t0 = Date.now();
    const n = await collectArcNumbers({ INVITES: new MemoryKV() } as never, hang as never, NOW, { deadlineMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(n.network.block_height).toBeNull();
    expect(n.errors.join()).toMatch(/deadline/);
  });
  test("I1: the AEI file can be passed in (the push has it) instead of being read back from KV", async () => {
    const { collectArcNumbers } = await import("../lib/arc-numbers");
    const aei = { data_until: "2026-10-21T00:00:00Z", projects: [{}, {}], candles: [["x", 1, 1, 1, 970]], volume_24h: { USDC: { members_usd: 1, members_payments: 1, base_usd_est: 100, base_transfers_est: 5 } } };
    const n = await collectArcNumbers({ INVITES: new MemoryKV() } as never, fakeFetch() as never, NOW, { aei: aei as never });
    expect(n.activity_24h).toMatchObject({ data_until: "2026-10-21T00:00:00Z", usdc_moved_usd_est: 100, attributed_share_pct: 1 });
    expect(n.ecosystem.index_members.aei).toBe(2);
  });
  test("I2: all stablecoins sums every peg DefiLlama reports", async () => {
    const { collectArcNumbers } = await import("../lib/arc-numbers");
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("stablecoincharts")) return new Response(JSON.stringify([{ date: "1792454400", totalCirculatingUSD: { peggedUSD: 742300000, peggedEUR: 8000000, peggedGBP: 500000 } }]));
      return fakeFetch()(url, init);
    });
    const n = await collectArcNumbers({ INVITES: await kvWithIndices() } as never, f as never, NOW);
    expect(n.stablecoins.all_stablecoins_usd).toBe(750800000);
  });
  test("M1 (regraded): a failed old-block lookup loses only the block time; the supplies stay", async () => {
    const { collectArcNumbers } = await import("../lib/arc-numbers");
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : null;
      if (b?.method === "eth_getBlockByNumber" && b.params[0] !== "latest") throw new Error("old block unavailable");
      return fakeFetch()(url, init);
    });
    const n = await collectArcNumbers({ INVITES: await kvWithIndices() } as never, f as never, NOW);
    expect(n.network.block_time_s).toBeNull();
    expect(n.network.block_height).toBe(26976520);
    expect(n.stablecoins.usdc_supply).toBe(758938840.361892);
  });
});
