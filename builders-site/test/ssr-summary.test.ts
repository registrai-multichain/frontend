import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { injectSummary, renderIndexSummary, renderTrackSummary } from "../lib/ssr-summary";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { ABI_INDICES, type AbiData } from "../../src/lib/builders-index";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";
import indices from "../../docs/superpowers/specs/data-api-v1-fixtures/indices.json";

vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set<string>() }));

const STATIC = `<!DOCTYPE html><html lang="en"><head><title>Arc indices · Registrai</title></head><body class="min-h-screen antialiased"><div id="app"><p class="pa-muted">Loading…</p></div></body></html>`;
const apps = { data_until: "2026-10-14T21:00:00Z", totals: { apps: 2, payments_24h: 55, usdc_24h: 5050, arc_usdc_24h_est: 500000 },
  rows: [{ id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: false, points: 9, share: 2, first_hour: "2026-10-11T19:00:00Z", last_24h: { points_earned: 1, payments: 5, usdc: 50 }, contracts: 3, indices: ["abi", "aei"] },
    { id: "integration:uniswap", name: "Uniswap", kind: "integration", verified: false, points: 4000, share: 9, first_hour: "2026-10-11T19:00:00Z", last_24h: { points_earned: 1, payments: 50, usdc: 5000 }, contracts: 900, indices: ["aii", "aei"] }] } as never;

describe("server-rendered summaries for pages that load their numbers in the browser", () => {
  test("index summary: the three closes with 24 h change, data-until, top apps by payments linked to their pages", () => {
    const h = renderIndexSummary(indices as never, apps);
    expect(h).toContain("Data until 14 Oct 2026, 21:00 UTC");
    expect(h).toContain("Arc Builders Index");
    expect(h).toContain("961.01");
    expect(h).toContain("-0.17%");
    expect(h.indexOf("Uniswap")).toBeLessThan(h.indexOf("Archery"));
    expect(h).toContain('href="/apps/integration/uniswap/"');
    expect(h).toContain('href="/api/v1/indices"');
  });

  test("track summary: watching count and 30-day stats, items listed", () => {
    expect(renderTrackSummary({ watching: 25, updatedAt: "2026-10-02T20:07:50.115Z", stats: { published30: 0, retracted30: 0, medianSeconds30: null }, items: [] }))
      .toMatch(/Watching 25 projects.*0 alerts published in the last 30 days/s);
    const h = renderTrackSummary({ watching: 1, updatedAt: null, stats: { published30: 1, retracted30: 0, medianSeconds30: 60 },
      items: [{ alertTime: "2026-10-10T10:00:00Z", source: "domain:a.b", text: "Owner changed <b>" }] as never });
    expect(h).toContain("2026-10-10");
    expect(h).toContain("Owner changed &lt;b&gt;");
    expect(h).toContain('href="/project/domain/a.b/"');
  });

  test("injection: summary right after <body>; hidden by a head style when scripts run, shown by <noscript>; page otherwise untouched", () => {
    const out = injectSummary(STATIC, "<p>x</p>");
    expect(out).toContain('<body class="min-h-screen antialiased"><section id="ssr-summary"');
    expect(out).toContain('<style>#ssr-summary{display:none}</style><noscript><style>#ssr-summary{display:block}</style></noscript></head>');
    expect(out).not.toContain("<script");
    expect(out.replace(/<style>#ssr-summary.*?<\/noscript>/s, "").replace(/<section id="ssr-summary".*?<\/section>/s, "")).toBe(STATIC);
    expect(injectSummary("<html>no body</html>", "<p>x</p>")).toBe("<html>no body</html>");
  });

  test("HEAD: the static page, no data reads", async () => {
    const { onRequest } = await import("../functions/builders-index/index");
    let reads = 0;
    const env = { INVITES: { get: async () => { reads++; return null; } } };
    const r = await onRequest({ request: new Request("https://builder.registrai.cc/builders-index/", { method: "HEAD" }), env, params: {}, waitUntil: () => undefined,
      next: async () => new Response(STATIC, { headers: { "content-type": "text/html" } }) } as never);
    expect(await r.text()).toBe(STATIC);
    expect(reads).toBe(0);
  });

  test("route: GET /builders-index/ returns the static page with the summary; data down → static page unchanged", async () => {
    const { onRequest } = await import("../functions/builders-index/index");
    const kv = new MemoryKV();
    const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    const ctx = (env: unknown) => ({ request: new Request("https://builder.registrai.cc/builders-index/"), env, params: {}, waitUntil: () => undefined,
      next: async () => new Response(STATIC, { headers: { "content-type": "text/html; charset=utf-8" } }) }) as never;
    const down = await onRequest(ctx({ INVITES: kv, DATA_DB: db }));
    expect(await down.text()).toBe(STATIC);
    const f = indexFixture() as unknown as AbiData;
    for (const id of ["abi", "aii", "aei"] as const) await kv.put(ABI_INDICES[id].key, JSON.stringify({ ...f, data_until: "2026-10-14T21:00:00Z", candles: [[1792000000, 990, 996, 989, 995.976]] }));
    const up = await onRequest(ctx({ INVITES: kv, DATA_DB: db }));
    expect(up.headers.get("content-type")).toContain("text/html");
    const html = await up.text();
    expect(html).toContain('id="ssr-summary"');
    expect(html).toContain("Arc Ecosystem Index");
  });
});
