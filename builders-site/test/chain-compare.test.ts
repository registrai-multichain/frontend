import { describe, expect, test, vi } from "vitest";

const hex = (n: number) => `0x${n.toString(16)}`;
type Opts = { solanaDown?: boolean; pricesDown?: boolean; stablesDown?: boolean };
/** Arc: 10,000 blocks over 5,100 s (0.51 s), gas price 20e9; Ethereum: 10,000 blocks over 120,000 s (12 s), gas price 1e9;
 *  Solana: 150 slots per 60 s (0.4 s); ETH $2,400, SOL $100; USDC on Arc/Ethereum/Solana 8e8/4e10/9e9. */
function fakeFetch(o: Opts = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("//coins.llama.fi")) { if (o.pricesDown) throw new Error("timeout"); return new Response(JSON.stringify({ coins: { "coingecko:ethereum": { price: 2400 }, "coingecko:solana": { price: 100 } } })); }
    if (u.includes("stablecoins.llama.fi")) { if (o.stablesDown) throw new Error("timeout");
      return new Response(JSON.stringify({ peggedAssets: [{ id: "1", symbol: "USDT", chainCirculating: { Ethereum: { current: { peggedUSD: 1 } } } },
        { id: "2", name: "USD Coin", symbol: "USDC", chainCirculating: { Arc: { current: { peggedUSD: 8e8 } }, Ethereum: { current: { peggedUSD: 4e10 } }, Solana: { current: { peggedUSD: 9e9 } } } }] })); }
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    const res = (r: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: r }));
    if (u.includes("solana")) { if (o.solanaDown) return new Response("rate limited", { status: 429 }); return res([{ numSlots: 150, samplePeriodSecs: 60 }, { numSlots: 150, samplePeriodSecs: 60 }]); }
    const eth = u.includes("ethereum");
    if (body.method === "eth_gasPrice") return res(hex(eth ? 1e9 : 20e9));
    if (body.method === "eth_getBlockByNumber") {
      const head = eth ? 20_000_000 : 27_000_000, span = eth ? 120_000 : 5_100;
      return body.params[0] === "latest" ? res({ number: hex(head), timestamp: hex(1_800_000_000) }) : res({ number: body.params[0], timestamp: hex(1_800_000_000 - span) });
    }
    return new Response("{}", { status: 400 });
  });
}
const env = { INVITES: { get: async () => null } } as never;

describe("Arc vs Ethereum vs Solana collector (spec 2026-10-23-replace-competitor-citations §3)", () => {
  test("block times, fees in USD by formula, USDC per chain", async () => {
    const { collectCompare } = await import("../lib/chain-compare");
    const c = await collectCompare(env, fakeFetch() as never, Date.parse("2026-10-23T18:00:00Z"));
    expect(c.arc.block_time_s).toBeCloseTo(0.51, 3);
    expect(c.ethereum.block_time_s).toBeCloseTo(12, 3);
    expect(c.solana.block_time_s).toBeCloseTo(0.4, 3);
    expect(c.arc.fee_usd).toBeCloseTo(0.00042, 8);            // 20e9 × 21,000 / 1e18 USDC
    expect(c.ethereum.fee_usd).toBeCloseTo(0.156, 6);         // 1e9 × 65,000 / 1e18 ETH × $2,400
    expect(c.solana.fee_usd).toBeCloseTo(0.0005, 8);          // 5,000 lamports = 5e-6 SOL × $100
    expect([c.arc.usdc_supply, c.ethereum.usdc_supply, c.solana.usdc_supply]).toEqual([8e8, 4e10, 9e9]);
    expect(c.errors).toEqual([]);
  });
  test("one source down drops only its figures", async () => {
    const { collectCompare } = await import("../lib/chain-compare");
    const s = await collectCompare(env, fakeFetch({ solanaDown: true }) as never);
    expect(s.solana.block_time_s).toBeNull();
    expect(s.ethereum.block_time_s).toBeCloseTo(12, 3);
    expect(s.errors.join()).toMatch(/solana/);
    const p = await collectCompare(env, fakeFetch({ pricesDown: true }) as never);
    expect(p.ethereum.fee_usd).toBeNull();
    expect(p.solana.fee_usd).toBeNull();
    expect(p.arc.fee_usd).toBeCloseTo(0.00042, 8);           // USDC needs no price
    const q = await collectCompare(env, fakeFetch({ stablesDown: true }) as never);
    expect(q.arc.usdc_supply).toBeNull();
  });
  test("usdcByChain reads only the USDC entry from the large list", async () => {
    const { usdcByChain } = await import("../lib/chain-compare");
    const text = JSON.stringify({ peggedAssets: [{ symbol: "USDT", chainCirculating: { Arc: { current: { peggedUSD: 5 } } } }, { symbol: "USDC", chainCirculating: { Arc: { current: { peggedUSD: 7 } }, Solana: { current: { peggedUSD: 9 } } } }] });
    expect(usdcByChain(text)).toEqual({ Arc: 7, Solana: 9 });
    expect(usdcByChain("{}")).toEqual({});
  });
});

describe("Arc vs Ethereum vs Solana page", () => {
  test("title, five measures, formulas behind i notes, sources; missing figures say Not available; null renders static rows", async () => {
    const { collectCompare } = await import("../lib/chain-compare");
    const { renderCompare } = await import("../lib/arc-question-pages");
    const c = await collectCompare(env, fakeFetch() as never, Date.parse("2026-10-23T18:00:00Z"));
    const h = renderCompare(c);
    expect(h).toContain("<title>Arc vs Ethereum vs Solana for stablecoin payments · Registrai</title>");
    expect(h).toContain("<h1>Arc vs Ethereum vs Solana for stablecoin payments</h1>");
    for (const m of ["Fee currency", "Block time", "Finality", "Fee for a USDC transfer (estimate)", "USDC in circulation"]) expect(h, m).toContain(`<th>${m}</th>`);
    expect(h).toContain("$0.156");
    expect(h).toMatch(/<details><summary>i<\/summary>[^<]*65,000 gas/);
    expect(h).toContain("https://ethereum.org/en/roadmap/single-slot-finality/");
    const s = await collectCompare(env, fakeFetch({ solanaDown: true }) as never);
    expect(renderCompare(s)).toContain("Not available right now");
    const none = renderCompare(null);
    expect(none).toContain("<th>Fee currency</th>");
    expect(none).toContain("Not available right now");
    expect(none).not.toMatch(/undefined|NaN/);
  });
});

describe("route, cache, sitemap, llms", () => {
  test("served under /arc/ for an hour; a failing collector still renders; listed in sitemap and both llms.txt", async () => {
    vi.doMock("../lib/chain-compare", async (orig) => ({ ...(await orig<typeof import("../lib/chain-compare")>()), collectCompare: async () => { throw new Error("down"); } }));
    vi.resetModules();
    const { onRequest } = await import("../functions/arc/[[path]]");
    const r = await onRequest({ request: new Request("https://builder.registrai.cc/arc/arc-vs-ethereum-vs-solana/"), env: { INVITES: { get: async () => null } }, params: { path: ["arc-vs-ethereum-vs-solana"] }, waitUntil: () => undefined } as never);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<h1>Arc vs Ethereum vs Solana for stablecoin payments</h1>");
    const { ARC_QUESTION_TTL } = await import("../lib/arc-routes");
    expect(ARC_QUESTION_TTL["arc-vs-ethereum-vs-solana"]).toBe(3600);
    const fs = await import("node:fs");
    const { QUESTION_PAGES } = await import("../lib/arc-question-pages");   // the sitemap is built from QUESTION_PAGES
    expect(QUESTION_PAGES.map((q) => q.path)).toContain("/arc/arc-vs-ethereum-vs-solana/");
    for (const f of ["../functions/llms.txt.ts", "../../public/llms.txt", "../lib/llms-full.ts"])
      expect(fs.readFileSync(new URL(f, import.meta.url), "utf8"), f).toContain("arc-vs-ethereum-vs-solana");
    vi.doUnmock("../lib/chain-compare");
  });
});
