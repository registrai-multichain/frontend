import { describe, expect, test, vi } from "vitest";
import { categoryOf, type ArcEntity } from "../../src/lib/arc-ecosystem";
import type { ArcWeek } from "../lib/arc-week";

const ent = (slug: string, o: Partial<ArcEntity>): ArcEntity => ({ slug, name: slug.toUpperCase(), category: "dexs", status: "live", summary: `${slug} a summary.`,
  status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: `https://${slug}.io/` }], last_reviewed: "2026-10-23", ...o });
const ALL = [ent("a", { index_ids: ["domain:a.io"] }), ent("b", { index_ids: ["domain:b.io"] }), ent("c", { status: "announced" }), ent("l", { category: "lending", index_ids: ["domain:z.io"] })];
const week = (apps: { id: string; usd: number }[]): ArcWeek => ({ until_hour: 1, until: "2026-10-23T12:00:00Z",
  apps: apps.map((x) => ({ id: x.id, name: x.id, href: "/apps/x/", category: null, usd: x.usd, payments: 1, new_payers: 0, first_hour: null })) });
const dexs = categoryOf("dexs")!, lending = categoryOf("lending")!;

describe("category answers", () => {
  test("count sentence, then the most used of this category over 7 days, linked; other categories' apps ignored", async () => {
    const { categoryAnswer } = await import("../lib/ecosystem-pages");
    const h = categoryAnswer(dexs, ALL, week([{ id: "domain:b.io", usd: 9 }, { id: "domain:a.io", usd: 5 }, { id: "domain:z.io", usd: 99 }]));
    expect(h).toContain("3 DEXs listed on Arc, Circle&#39;s blockchain: 2 live on mainnet, 0 deployed, 1 announced.");
    expect(h).toContain('Most used over the last 7 days, by stablecoin payments received: <a href="/ecosystem/b/">B</a> and <a href="/ecosystem/a/">A</a>.');
  });
  test("no week, or no measured app: count sentence only; one project reads '1 project listed'", async () => {
    const { categoryAnswer } = await import("../lib/ecosystem-pages");
    expect(categoryAnswer(dexs, ALL, null)).not.toContain("Most used");
    expect(categoryAnswer(dexs, ALL, week([{ id: "domain:a.io", usd: 0 }]))).not.toContain("Most used");
    expect(categoryAnswer(lending, ALL, null)).toContain("1 project listed on Arc, Circle&#39;s blockchain: 1 live on mainnet, 0 deployed, 0 announced.");
  });
  test("titles and descriptions name Circle's Arc; the directory opens with a sentence", async () => {
    const { renderCategory, renderDirectory, renderEntity } = await import("../lib/ecosystem-pages");
    const c = renderCategory(dexs, ALL, null);
    expect(c).toContain("<title>DEXs on Arc, Circle&#39;s blockchain · Registrai</title>");
    expect(c).toMatch(/<meta name="description" content="DEXs on Arc, the blockchain by Circle: 3 listed, 2 live on mainnet/);
    const d = renderDirectory(ALL, null);
    expect(d).toContain("Registrai's Arc ecosystem directory lists 4 projects on Circle's Arc blockchain with their status and evidence: 3 live on mainnet, 0 deployed, 1 announced.");
    expect(d).toContain("<title>Arc ecosystem: projects on Circle&#39;s blockchain · Registrai</title>");
    expect(renderEntity({ entity: ALL[0], app: null, facts: null })).toContain("<title>A on Arc, Circle&#39;s blockchain · Registrai</title>");
  });
});

describe("what each project does on Arc", () => {
  test("tables show it; category pages drop the Category column", async () => {
    const { renderCategory, renderDirectory } = await import("../lib/ecosystem-pages");
    const c = renderCategory(dexs, ALL, null);
    expect(c).toContain("<th>What it does on Arc</th>");
    expect(c).not.toContain("<th>Category</th>");
    expect(c).toContain("a summary.");
    expect(renderDirectory(ALL, null)).toContain("<th>What it does on Arc</th>");
  });
});

vi.mock("../lib/arc-week", async (orig) => ({ ...(await orig<typeof import("../lib/arc-week")>()), loadArcWeek: async () => { throw new Error("kv down"); } }));
describe("category route", () => {
  test("the week loader failing still serves the category page with its count sentence", async () => {
    const { onRequest } = await import("../functions/ecosystem/[[path]]");
    const r = await onRequest({ request: new Request("https://builder.registrai.cc/ecosystem/dexs/"), env: {}, params: { path: ["dexs"] }, waitUntil: () => undefined } as never);
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/DEXs listed on Arc, Circle&#39;s blockchain/);
  });
});
