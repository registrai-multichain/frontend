import { describe, expect, test } from "vitest";

const P = { half_life_days: 21, decay_per_hour_pct: 0.137, cap_per_wallet_hour_usdc: 10000, volume_usdc_per_point: 100, new_payer_points: 1,
  new_payer_min_usdc: 10, new_payer_max_per_hour: 25, base_window: 240, base_scale: 30 };
const S = { window_days: 7, until: "2026-10-28T00:00:00Z", pct: 5.01, daily_min: 1, daily_max: 34, complete: true };

describe("review fixes: definitions match the indexer", () => {
  test("C1/C2/I1/I2/M2/M5/M6", async () => {
    const { renderMethodology } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: P, share: S, until: null });
    expect(h).not.toContain("verified builders");
    expect(h).toContain("Arc Builders Index (apps that started on Arc, plus the Arc base layer)");
    expect(h).toContain("log2(1 + c) + c / $100");                       // C2: the main term of the points formula
    expect(h).toContain("USDC paid into the attributed contracts of Arc Ecosystem Index members (no per-wallet cap)");   // I1
    expect(h).toContain("has not paid the app in the last 30 days");       // I2
    expect(h).toContain("per wallet, per app, per hour");                  // M5
    expect(h).not.toContain("See the attributed share section below.");     // M2
    expect(h).toContain("Deployed: built on Arc but not yet open for use on mainnet");   // M6
  });
});

describe("/methodology/", () => {
  test("sections, version, live parameters with as-of, the share, JSON-LD", async () => {
    const { renderMethodology } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: P, share: S, until: "2026-10-22T18:00:00Z" });
    expect(h).toContain("<h1>Methodology</h1>");
    expect(h).toContain("Version 1 · 22 Oct 2026 · Data until 22 Oct 2026, 18:00 UTC");
    for (const id of ["glossary", "sources", "attributed-share", "limits", "changelog"]) expect(h, id).toContain(`id="${id}"`);
    expect(h).toContain("half-life of 21 days");
    expect(h).toContain("$10,000");
    expect(h).toContain("first 240 blocks of each hour, scaled ×30");
    expect(h).toContain("5.01% over 7 days to 28 Oct 2026 (daily 1.00–34.00%)");
    expect(h).toContain("v1 (22 Oct 2026): first published version.");
    expect(h).toContain('"@type":"DefinedTermSet"');
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/methodology/">');
  });
  test("glossary ids are unique and include every linked anchor", async () => {
    const { renderMethodology, GLOSSARY_IDS } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: P, share: S, until: null });
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ["payment", "paying-wallet", "new-paying-wallet", "received-usd", "attributed-contract", "index-member", "index-points", "data-until", "window", "statuses", "attributed-share"]) expect(ids, a).toContain(a);
    expect(GLOSSARY_IDS.length).toBeGreaterThanOrEqual(10);
  });
  test("no params and no share: numbers dropped, stays grammatical", async () => {
    const { renderMethodology } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: null, share: null, until: null });
    expect(h).not.toMatch(/undefined|NaN|null/);
    expect(h).toContain("up to a cap per wallet, per app, per hour");
    expect(h).toContain("Not available right now");
  });
  test("route: 200, slash 301, subpath 404, HEAD empty; links elsewhere point at real anchors", async () => {
    const { onRequest } = await import("../functions/methodology/[[path]]");
    const call = (path: string, method = "GET") => { const u = new URL(`https://builder.registrai.cc${path}`);
      return onRequest({ request: new Request(u, { method }), env: { INVITES: { get: async () => null } }, params: { path: u.pathname.replace(/^\/methodology\/?/, "").split("/").filter(Boolean) }, waitUntil: () => undefined } as never); };
    expect((await call("/methodology/")).status).toBe(200);
    expect((await call("/methodology")).status).toBe(301);
    expect((await call("/methodology/x/")).status).toBe(404);
    expect(await (await call("/methodology/", "HEAD")).text()).toBe("");
    const { renderMethodology } = await import("../lib/methodology-page");
    const ids = new Set([...renderMethodology({ params: P, share: S, until: null }).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of ["../lib/apps-pages.ts", "../lib/arc-pages.ts", "../lib/arc-question-pages.ts"]) {
      for (const m of readFileSync(resolve(__dirname, f), "utf8").matchAll(/\/methodology\/#([a-z-]+)/g)) expect(ids, `${f} → #${m[1]}`).toContain(m[1]);
    }
  });
  test("footer Method link, sitemap and llms.txt", async () => {
    const { page } = await import("../lib/apps-pages");
    expect(page({ title: "t", canonical: "https://x/", description: "d", body: "" })).toContain('href="/methodology/">Method</a>');
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    expect(readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8")).toContain("https://builder.registrai.cc/methodology/");
    expect(readFileSync(resolve(__dirname, "../lib/sitemap-urls.ts"), "utf8")).toContain('"/methodology/"');
  });
});
