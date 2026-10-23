import { describe, expect, test } from "vitest";
import { renderCategory, renderDirectory, renderEcosystemNotFound, renderEntity } from "../lib/ecosystem-pages";
import { categoryOf, type ArcEntity } from "../../src/lib/arc-ecosystem";
import type { AppDetail } from "../lib/apps-data";

const ent = (o: Partial<ArcEntity> = {}): ArcEntity => ({
  slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "Archery is a game on Arc with USDC entry fees.",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001", title: "Contract on Arc explorer" }],
  sources: [{ url: "https://archery.wtf/", title: "Archery website", date: "2026-10-20" }], website: "https://archery.wtf/", x: "archerywtf",
  first_live: "2026-10-10", contracts: [{ address: "0x0000000000000000000000000000000000000001", role: "Game", source: "https://archery.wtf/docs" }],
  index_ids: ["domain:archery.wtf"], last_reviewed: "2026-10-20", ...o,
});
const app = { id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: true, points: 9, share: 2, first_hour: "2026-10-10T00:00:00Z",
  last_24h: { points_earned: 1, payments: 158, usdc: 24725.94 }, contracts: 3, indices: ["abi", "aei"], hourly: [], facts_url: null,
  data_until: "2026-10-20T10:00:00Z", contracts_sample: ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"] } as unknown as AppDetail;
const ld = (h: string) => JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

describe("entity page", () => {
  test("name, status, category link, summary, links, status evidence, sources, review date, correction links", () => {
    const h = renderEntity({ entity: ent(), app: null, facts: null });
    expect(h).toContain("<title>Archery on Arc, Circle&#39;s blockchain · Registrai</title>");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/ecosystem/archery/">');
    expect(h).toContain("<h1>Archery</h1>");
    expect(h).toContain("Live on mainnet");
    expect(h).toContain('<a href="/ecosystem/consumer/">Games and consumer</a>');
    expect(h).toContain("Archery is a game on Arc with USDC entry fees.");
    expect(h).toContain('href="https://x.com/archerywtf"');
    expect(h).toContain("Live on Arc mainnet since 2026-10-10");
    expect(h).toContain("Contract on Arc explorer");
    expect(h).toMatch(/<h2>Sources<\/h2>\s*<ol><li><a href="https:\/\/archery.wtf\/"/);
    expect(h).toContain("Last reviewed 2026-10-20");
    expect(h).toContain("mailto:contact@registrai.cc?subject=Registrai%20ecosystem%3A%20archery");
    expect(h).not.toContain("<h2>Activity");
  });
  test("contracts: the hand-checked list, then index contracts not already listed", () => {
    const h = renderEntity({ entity: ent(), app, facts: null });
    expect(h.match(/0x0000000000000000000000000000000000000001/g)!.length).toBeGreaterThanOrEqual(1);
    expect(h).toContain("0x0000000000000000000000000000000000000002");
    expect(h).toContain("<h2>Last 24 h</h2>");
    expect(h).toContain("158");
  });
  test("JSON-LD: Organization, plus a Dataset for index members", () => {
    expect(ld(renderEntity({ entity: ent(), app: null, facts: null }))["@graph"].map((x: { "@type": string }) => x["@type"])).toEqual(["Organization"]);
    const g = ld(renderEntity({ entity: ent(), app, facts: null }))["@graph"];
    expect(g.map((x: { "@type": string }) => x["@type"])).toEqual(["Organization", "Dataset"]);
    expect(g[0]).toMatchObject({ name: "Archery", url: "https://archery.wtf/", sameAs: ["https://archery.wtf/", "https://x.com/archerywtf"] });
  });
  test("hostile names are escaped in text, attributes, JSON-LD and the mailto subject", () => {
    const evil = `Société <Générale> & "Co"`;
    const h = renderEntity({ entity: ent({ name: evil, slug: "societe-generale-co" }), app: null, facts: null });
    expect(h).not.toContain("<Générale>");
    expect(h).toContain("Société &lt;Générale&gt; &amp; &quot;Co&quot;");
    expect(h).not.toMatch(/<\/script>[^]*<\/script>[^]*<\/script>/);
    expect(ld(h)["@graph"][0].name).toBe(evil);
  });
});

describe("directory and category pages", () => {
  const all = [ent(), ent({ slug: "aave", name: "Aave", category: "lending", status: "announced", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], index_ids: [], contracts: [] }),
    ent({ slug: "uniswap", name: "Uniswap", category: "dexs", index_ids: ["integration:uniswap"] })];
  test("directory: counts by status, every category with a count, a table sorted by name, status filter links", () => {
    const h = renderDirectory(all, null);
    expect(h).toContain("<title>Arc ecosystem: projects on Circle&#39;s blockchain · Registrai</title>");
    expect(h).toContain("3 projects · 2 live on mainnet · 0 deployed · 1 announced");
    expect(h).toContain('<a href="/ecosystem/dexs/">DEXs on Arc</a> (1)');
    expect(h.indexOf(">Aave<")).toBeLessThan(h.indexOf(">Archery<"));
    expect(h).toContain('href="/ecosystem/?status=announced"');
    expect(ld(h)["@type"]).toBe("DataCatalog");
  });
  test("directory filtered by status lists only that status", () => {
    const h = renderDirectory(all, "announced");
    expect(h).toContain(">Aave<");
    expect(h).not.toContain(">Uniswap<");
  });
  test("category page: its label as H1, only its projects, tags count too, empty state", () => {
    const h = renderCategory(categoryOf("dexs")!, [...all, ent({ slug: "x", name: "X", category: "trading", tags: ["dexs"] })]);
    expect(h).toContain("<h1>DEXs on Arc</h1>");
    expect(h).toContain(">Uniswap<");
    expect(h).toContain(">X<");
    expect(h).not.toContain(">Aave<");
    expect(renderCategory(categoryOf("banks")!, all)).toContain("No projects in this category yet.");
  });
  test("not found page", () => expect(renderEcosystemNotFound()).toContain("<h1>Not in the Arc ecosystem directory</h1>"));
});

describe("review fixes", () => {
  test("the activity block says when its data is from, and the index verified status", () => {
    const h = renderEntity({ entity: ent(), app, facts: null });
    expect(h).toMatch(/<h2>Activity<\/h2>\s*<p class="muted">Data until 20 Oct 2026, 10:00 UTC · verified builder \(registry\) · indices: ABI, AEI<\/p>/);
  });
  test("index membership is shown as status evidence: a contract on the explorer and the hourly data", () => {
    const e = ent({ status_evidence: [{ url: "https://archery.wtf/", title: "Archery website" }], contracts: [] });
    const h = renderEntity({ entity: e, app, facts: null });
    expect(h).toMatch(/Evidence: .*Contract on the Arc explorer.*Hourly activity in the Arc indices/);
    expect(h).toContain('href="https://explorer.arc.io/address/0x0000000000000000000000000000000000000001"');
    expect(renderEntity({ entity: e, app: null, facts: null })).toContain("Listed in the Arc indices");
  });
});

test("an empty category page is noindex; a non-empty one is not", () => {
  expect(renderCategory(categoryOf("banks")!, [ent()])).toContain('<meta name="robots" content="noindex">');
  expect(renderCategory(categoryOf("consumer")!, [ent()])).not.toContain('name="robots"');
});
