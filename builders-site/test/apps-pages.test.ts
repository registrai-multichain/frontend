import { describe, expect, test } from "vitest";
import { esc, parseSort, renderApp, renderAppList, renderNotFound } from "../lib/apps-pages";
import type { AppDetail, AppList } from "../lib/apps-data";

const row = (o: Partial<AppDetail> = {}) => ({ id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: true, points: 9.2, share: 2, first_hour: "2026-10-11T19:00:00Z",
  last_24h: { points_earned: 1174.9, payments: 158, usdc: 24725.94 }, contracts: 3, indices: ["abi", "aei"], ...o }) as AppDetail;
const list = (rows = [row(), row({ id: "integration:uniswap", name: "Uniswap", kind: "integration", last_24h: { points_earned: 1, payments: 9999, usdc: 1 } })]): AppList =>
  ({ data_until: "2026-10-14T21:00:00Z", rows, totals: { apps: rows.length, payments_24h: 10157, usdc_24h: 24726.94, arc_usdc_24h_est: 508515262 } });

describe("renderers", () => {
  test("list: title, data-until, sort default by payments, numbers in plain HTML, licence, canonical", () => {
    const h = renderAppList(list(), "payments");
    expect(h).toContain("<title>Stablecoin apps on Arc · Registrai</title>");
    expect(h).toContain("Data until 14 Oct 2026, 21:00 UTC");
    expect(h.indexOf("Uniswap")).toBeLessThan(h.indexOf("Archery"));
    expect(h).toContain("9,999");
    expect(h).toContain('href="/apps/domain/archery.wtf/"');
    expect(h).toContain("CC BY 4.0");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/apps/">');
    expect(h).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });
  test("unknown sort falls back to payments", () => {
    expect(parseSort("evil")).toBe("payments");
    expect(parseSort("usdc")).toBe("usdc");
  });
  test("hostile names are escaped in text, attributes, JSON-LD and SVG", () => {
    const evil = `<script>alert(1)</script>"&'`;
    const a = renderApp({ ...row({ name: evil }), hourly: [{ hour_close: "2026-10-14T21:00:00Z", points: 9.2, points_earned: 1, payments: 1, wallets: 1, new_payers: 0, usdc: 1 }], facts_url: null, data_until: "2026-10-14T21:00:00Z" });
    expect(a).not.toContain("<script>alert");
    expect(a).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const ld = a.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(ld).not.toContain("</script");
    expect(JSON.parse(ld)["@type"]).toBe("Dataset");
    expect(renderAppList(list([row({ name: evil })]), "payments")).not.toContain("<script>alert");
    expect(esc(`a<b>"c"&'d'`)).toBe("a&lt;b&gt;&quot;c&quot;&amp;&#39;d&#39;");
  });
  test("app page: last 24 h, contracts link, API link; empty history says so", () => {
    const a = renderApp({ ...row(), hourly: [], facts_url: "/project/?source=domain%3Aarchery.wtf", data_until: "2026-10-14T21:00:00Z" });
    expect(a).toContain("<h1>Archery</h1>");
    expect(a).toContain("no hourly history yet");
    expect(a).toContain("/api/v1/members/domain%3Aarchery.wtf/hourly?index=aei");
    expect(a).toContain("/project/?source=domain%3Aarchery.wtf");
    expect(a).toContain("1,174.9");
    expect(a).toContain("Contracts: 3");
  });
  test("404 page links back to the list", () => {
    expect(renderNotFound()).toContain('href="/apps/"');
  });
});

test("M6: the totals line names USDC, the currency the totals are in", () => {
  expect(renderAppList(list(), "payments")).toMatch(/USDC payments/);
});
