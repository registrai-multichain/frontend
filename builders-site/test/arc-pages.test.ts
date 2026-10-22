import { describe, expect, test, vi } from "vitest";
import type { ArcNumbers } from "../lib/arc-numbers";
import { ARC_TIMELINE } from "../lib/arc-numbers";

const full = (o: Partial<ArcNumbers> = {}): ArcNumbers => ({
  version: 1, generated_at: "2026-10-20T17:30:00.000Z",
  network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: 26976520, block_time_s: 0.5069, as_of: "2026-10-20T17:30:00.000Z" },
  stablecoins: { usdc_supply: 758938840.36, eurc_supply: 21500000, as_of: "2026-10-20T17:30:00.000Z", all_stablecoins_usd: 742300000, tvl_usd: 528831654, defillama_date: "2026-10-20" },
  activity_24h: { data_until: "2026-10-20T17:00:00Z", usdc_moved_usd_est: 430908916.2, eurc_moved_usd_est: 66035801.1, usdc_transfers_est: 458700, app_payments: 123945, app_usd: 12810996.76, attributed_share_pct: 2.97 },
  ecosystem: { projects: 258, live: 83, deployed: 20, announced: 155, top_categories: [{ id: "payments", label: "Payment apps on Arc", count: 35 }],
    index_members: { abi: 19, aii: 23, aei: 42 }, index_close: { abi: 934.91, aii: 964.5, aei: 975.7 }, data_until: "2026-10-20T17:00:00Z" },
  timeline: ARC_TIMELINE, errors: [], ...o,
});
const ld = (h: string) => JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

describe("Arc in numbers page", () => {
  test("every section with its source and date; DefiLlama labelled; the method behind an i", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const h = renderArc(full(), []);
    expect(h).toContain("<title>Arc in numbers · Registrai</title>");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/arc/">');
    for (const s of ["<h1>Arc in numbers</h1>", "<h2>Network</h2>", "<h2>Stablecoins on Arc</h2>", "<h2>Activity, last 24 h</h2>", "<h2>Ecosystem</h2>", "<h2>Timeline</h2>", "<h2>History</h2>"]) expect(h, s).toContain(s);
    expect(h).toContain("26,976,520");
    expect(h).toContain("0.51 s");
    expect(h).toContain("758,938,840 USDC");
    expect(h).toMatch(/\$742,300,000[^<]*<\/td><td[^>]*>Source: DefiLlama, 20 Oct 2026/);
    expect(h).toContain("2.97%");
    expect(h).toContain("Data until 20 Oct 2026, 17:00 UTC");
    expect(h).toMatch(/<details><summary>i<\/summary>[^<]*estimated/);
    expect(h).toContain('<a href="/ecosystem/">258 projects</a>');
    expect(h).toContain('href="https://www.arc.io/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet"');
    expect(h).toContain("Daily snapshots start at the next 00:00 UTC close.");
    expect(h).toContain("<h2>Questions</h2>");
    expect(h).toContain('<a href="/arc/most-used-apps/">Most-used apps on Arc, last 7 days</a>');
    expect(ld(h)["@type"]).toBe("Dataset");
  });

  test("a source that is down shows 'Not available' for its rows only", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const n = full({ stablecoins: { usdc_supply: 1, eurc_supply: 1, as_of: "2026-10-20T17:30:00.000Z", all_stablecoins_usd: null, tvl_usd: null, defillama_date: null } });
    const h = renderArc(n, []);
    expect(h).toMatch(/All stablecoins[^]*?Not available right now/);
    expect(h).toContain("<h2>Network</h2>");
    expect(h).toContain("26,976,520");
  });

  test("history: newest first, one row per day", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const h = renderArc(full(), [full({ generated_at: "2026-10-21T00:02:00.000Z" }), full({ generated_at: "2026-10-20T00:02:00.000Z" })]);
    expect(h.indexOf("21 Oct 2026")).toBeLessThan(h.indexOf("20 Oct 2026, 00"));
    expect(h).not.toContain("Daily snapshots start");
  });

  test("route: /arc 301s, /arc/x 404, POST 405, HEAD empty; the page answers 200 even with no data", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    try {
      const { onRequest } = await import("../functions/arc/[[path]]");
      const ctx = (path: string, method = "GET") => ({ request: new Request(`https://builder.registrai.cc${path}`, { method }), env: { INVITES: { get: async () => null } },
        params: { path: new URL(`https://x${path}`).pathname.replace(/^\/arc\/?/, "").split("/").filter(Boolean) }, waitUntil: () => undefined }) as never;
      expect((await onRequest(ctx("/arc"))).status).toBe(301);
      expect((await onRequest(ctx("/arc/x/"))).status).toBe(404);
      expect((await onRequest(ctx("/arc/", "POST"))).status).toBe(405);
      expect(await (await onRequest(ctx("/arc/", "HEAD"))).text()).toBe("");
      const r = await onRequest(ctx("/arc/"));
      expect(r.status).toBe(200);
      expect(await r.text()).toContain("Not available right now");
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("review fixes (page)", () => {
  test("M2 (regraded): live reads show minutes, not the hour", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const h = renderArc(full({ generated_at: "2026-10-20T18:17:11.351Z", network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: 1, block_time_s: 0.5, as_of: "2026-10-20T18:17:11.351Z" } }), []);
    expect(h).toContain("Generated 20 Oct 2026, 18:17 UTC");
    expect(h).toContain("Arc RPC, 20 Oct 2026, 18:17 UTC");
  });
  test("I2: the stablecoin row says it is DefiLlama's circulating total, with an i note", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const h = renderArc(full(), []);
    expect(h).toContain("All stablecoins, circulating (USD value)");
    expect(h).toMatch(/<details><summary>i<\/summary>[^<]*circulating supply[^<]*totalSupply/);
  });
});
