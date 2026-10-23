import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const ev = [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }];
const E = [
  { slug: "archery", name: "Archery", category: "dexs", status: "live", summary: "x", status_evidence: ev, sources: [{ url: "https://a.b/" }], index_ids: ["domain:archery.wtf"], first_live: "2026-10-20", last_reviewed: "2026-10-20" },
  { slug: "payco", name: "PayCo", category: "payments", status: "announced", summary: "x", status_evidence: [{ url: "https://payco.example/arc" }], sources: [{ url: "https://payco.example/" }], last_reviewed: "2026-10-20" },
  { slug: "rampx", name: "RampX", category: "ramps", status: "live", summary: "x", status_evidence: [{ url: "https://rampx.example/arc" }], sources: [{ url: "https://rampx.example/" }], last_reviewed: "2026-10-20" },
  { slug: "bridgy", name: "Bridgy", category: "bridges", status: "announced", summary: "x", status_evidence: [{ url: "https://bridgy.example/" }], sources: [{ url: "https://bridgy.example/" }], last_reviewed: "2026-10-20" },
] as ArcEntity[];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const U = Date.parse("2026-10-22T16:00:00Z") / 3600e3;
const W = { until_hour: U, until: "2026-10-22T16:00:00Z", apps: [
  { id: "domain:big.example", name: "Big <b>App</b>", href: "/apps/big.example/", category: null, usd: 900.5, payments: 3, new_payers: 2, first_hour: U - 10 },
  { id: "domain:archery.wtf", name: "Archery", href: "/ecosystem/archery/", category: "dexs", usd: 150, payments: 3, new_payers: 2, first_hour: U - 400 },
  { id: "domain:quiet.example", name: "Quiet", href: "/apps/quiet.example/", category: null, usd: 0, payments: 0, new_payers: 0, first_hour: U - 168 },
] };
const ld = (h: string) => JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

describe("review fixes", () => {
  test("#3: a payments app that is an index member with a quiet week is not 'not measured'", async () => {
    const { renderAcceptsUsdc } = await import("../lib/arc-question-pages");
    const w = { ...W, apps: [...W.apps, { id: "domain:payco.example", name: "PayCo", href: "/ecosystem/payco/", category: "payments", usd: 0, payments: 0, new_payers: 0, first_hour: U - 900 }] };
    const ix = await import("../../src/lib/arc-ecosystem-data");
    const payco = ix.ECOSYSTEM.bySlug.get("payco")!;
    (payco as { index_ids?: string[] }).index_ids = ["domain:payco.example"];
    try {
      expect(renderAcceptsUsdc(w)).not.toContain('<a href="/ecosystem/payco/">PayCo</a></td><td>Announced');
    } finally { delete (payco as { index_ids?: string[] }).index_ids; }
  });
  test("methodology I2: new paying wallet is new in 30 days, not ever", async () => {
    const { renderMostUsed } = await import("../lib/arc-question-pages");
    const h = renderMostUsed(W);
    expect(h).not.toContain("paying the app for the first time");
    expect(h).toContain("not paid the app in the last 30 days");
  });
  test("#7: singular forms", async () => {
    const { renderMostUsed } = await import("../lib/arc-question-pages");
    expect(renderMostUsed({ ...W, apps: [W.apps[0]] })).toContain("of the 1 app with payments in Registrai&#39;s Arc index");
  });
  test("#1: MCP and docs no longer claim a first payment", async () => {
    const { MCP_TOOLS } = await import("../lib/mcp");
    const t = MCP_TOOLS.find((x) => x.name === "arc_apps_week")!;
    expect(JSON.stringify(t)).not.toContain("first received payments");
    expect(JSON.stringify(t)).toContain("first seen");
    const { ENDPOINTS } = await import("../../src/lib/data-api-docs");
    const e = ENDPOINTS.find((x) => x.path === "/arc/apps-week")!;
    expect(e.returns).not.toContain("first hour each app received payments");
    expect(e.returns).toContain("first seen");
  });
});

describe("question pages", () => {
  test("most used: dated first sentence, ranked by USD, escaped, source + i, ItemList", async () => {
    const { renderMostUsed } = await import("../lib/arc-question-pages");
    const h = renderMostUsed(W);
    expect(h).toContain("<h1>Most-used apps on Arc, last 7 days</h1>");
    expect(h).toContain("In the 7 days to 22 Oct 2026, 16:00 UTC, Big &lt;b&gt;App&lt;/b&gt; received the most in stablecoin payments of the 2 apps with payments in Registrai&#39;s Arc index: $900.50.");
    expect(h.indexOf("Big &lt;b&gt;App")).toBeLessThan(h.indexOf(">Archery<"));
    expect(h).not.toContain(">Quiet<");
    expect(h).toContain("Received (USD)");
    expect(h).toContain("Source: Arc Ecosystem Index (Registrai), hourly, 7 days to 22 Oct 2026, 16:00 UTC.");
    expect(h).toMatch(/<details><summary>i<\/summary>[^<]*other registered stablecoins/);
    expect(ld(h)["@type"]).toBe("ItemList");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/arc/most-used-apps/">');
  });
  test("quiet week and no data", async () => {
    const { renderMostUsed, renderNew } = await import("../lib/arc-question-pages");
    const quiet = { ...W, apps: [W.apps[2]] };
    expect(renderMostUsed(quiet)).toContain("No measured app received payments in the 7 days to 22 Oct 2026, 16:00 UTC.");
    const none = renderMostUsed(null);
    expect(none).toContain("Data not available right now.");
    expect(none).toContain("Not available right now (source: Registrai index database)");
    expect(renderNew({ ...W, apps: [W.apps[1]] }, "2026-10-22")).toContain("None this week");
  });
  test("accepts USDC: measured table, then listed-not-measured payment apps", async () => {
    const { renderAcceptsUsdc } = await import("../lib/arc-question-pages");
    const h = renderAcceptsUsdc(W);
    expect(h).toContain("2 apps on Arc received stablecoin payments in the 7 days to 22 Oct 2026, 16:00 UTC. 1 more payment project is listed in Registrai&#39;s Arc directory (0 live, 0 deployed, 1 announced) but not measured by Registrai.");
    expect(h).toMatch(/<h2>Listed, not measured<\/h2>[^]*Source: Registrai Arc ecosystem directory/);
    expect(h.indexOf("<h2>Measured</h2>")).toBeLessThan(h.indexOf("<h2>Listed, not measured</h2>"));
    expect(h).toContain('href="/ecosystem/payco/"');
    expect(h).toContain('href="https://payco.example/arc"');
    const down = renderAcceptsUsdc(null);
    expect(down).toContain("Not available right now (source: Registrai index database)");
    expect(down).toContain('href="/ecosystem/payco/"');   // the directory part still renders
  });
  test("new: went live within 7 days, started receiving payments within the window (edge hour excluded)", async () => {
    const { renderNew } = await import("../lib/arc-question-pages");
    const h = renderNew(W, "2026-10-22");
    expect(h).toContain("In the 7 days to 22 Oct 2026, 16:00 UTC, 1 project in the directory went live on Arc and 1 app was added to Registrai&#39;s index.");
    expect(h).toContain("<h2>Added to Registrai&#39;s index</h2>");
    expect(h).toContain("<th>First seen</th>");
    expect(h).not.toContain("started receiving payments");
    expect(h).toMatch(/<h2>Went live<\/h2>[^]*Source: Registrai Arc ecosystem directory/);
    expect(h).toContain('href="/ecosystem/archery/">Archery</a></td><td>DEXs</td><td>2026-10-20');
    expect(h).toContain("Big &lt;b&gt;App&lt;/b&gt;");
    expect(h).not.toContain(">Quiet<");     // first_hour === until - 168: not new
  });
  test("get USDC: three sections, live/deployed in the table, announced listed apart", async () => {
    const { renderGetUsdc } = await import("../lib/arc-question-pages");
    const h = renderGetUsdc();
    expect(h).toContain("USDC reaches Arc three ways: buy it through an on-ramp, withdraw it from an exchange that supports the Arc network, or bridge it from another chain.");
    for (const s of ["<h2>On-ramps</h2>", "<h2>Exchanges</h2>", "<h2>Bridges</h2>"]) expect(h).toContain(s);
    expect(h).toContain('href="/ecosystem/rampx/"');
    expect(h).toMatch(/Announced[^]*Bridgy/);
  });
});

describe("question page routes", () => {
  const call = async (path: string, env: Record<string, unknown> = {}, method = "GET") => {
    const { onRequest } = await import("../functions/arc/[[path]]");
    const u = new URL(`https://builder.registrai.cc${path}`);
    return onRequest({ request: new Request(u, { method }), env: { INVITES: { get: async () => null }, ...env },
      params: { path: u.pathname.replace(/^\/arc\/?/, "").split("/").filter(Boolean) }, waitUntil: () => undefined } as never);
  };
  test("each page answers 200 even without DATA_DB; get-usdc never needs it; slash 301; unknown 404; HEAD empty", async () => {
    for (const p of ["/arc/most-used-apps/", "/arc/apps-that-accept-usdc/", "/arc/new/", "/arc/get-usdc/"]) {
      const r = await call(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("cache-control"), p).toBe("public, max-age=600");
    }
    expect(await (await call("/arc/most-used-apps/")).text()).toContain("Not available right now");
    expect(await (await call("/arc/get-usdc/")).text()).toContain("USDC reaches Arc three ways");
    expect((await call("/arc/new")).status).toBe(301);
    expect((await call("/arc/other/")).status).toBe(404);
    expect(await (await call("/arc/new/", {}, "HEAD")).text()).toBe("");
  });
});
