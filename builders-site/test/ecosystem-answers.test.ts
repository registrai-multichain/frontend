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
    expect(d).toContain("<title>Every project building on Arc, Circle&#39;s blockchain · Registrai</title>");
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

describe("/ecosystem/ answers 'is there an Arc directory' (spec 2026-10-23-replace-competitor-citations §1)", () => {
  test("question title, three sections, four FAQs mirrored in FAQPage JSON-LD; no week → three, no activity section", async () => {
    const { renderDirectory, directoryFaq } = await import("../lib/ecosystem-pages");
    const wk = week([{ id: "domain:b.io", usd: 9 }]);
    const h = renderDirectory(ALL, null, wk);
    expect(h).toContain("<title>Every project building on Arc, Circle&#39;s blockchain · Registrai</title>");
    expect(h).toContain("<h1>Every project building on Arc</h1>");
    for (const s of ["What counts as on Arc", "How a status is decided", "Measured activity", "Questions"]) expect(h, s).toContain(`<h2>${s}</h2>`);
    const faq = directoryFaq(ALL, wk);
    expect(faq.map((f) => f.q)).toEqual(["How many projects are building on Arc?", "Which apps on Arc are used the most?", "Is the data free to use?", "How do I add or correct a project?"]);
    expect(faq[1].a).toContain("B");
    const ld = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    const faqLd = (ld["@graph"] ?? [ld]).find((x: { "@type": string }) => x["@type"] === "FAQPage");
    expect(faqLd.mainEntity.map((m: { acceptedAnswer: { text: string } }) => m.acceptedAnswer.text)).toEqual(faq.map((f) => f.a));
    expect(directoryFaq(ALL, null)).toHaveLength(3);
    expect(renderDirectory(ALL, null, null)).not.toContain("<h2>Measured activity</h2>");
    expect(h).not.toContain('<p class="muted">4 projects ·');   // the repeated muted count line is gone
  });
});

describe("review I2: one set of status definitions", () => {
  test("/ecosystem/ and /methodology/ use the same wording, including official Arc posts for live", async () => {
    const { STATUS_RULES } = await import("../../src/lib/arc-ecosystem");
    const { renderDirectory } = await import("../lib/ecosystem-pages");
    const { renderMethodology } = await import("../lib/methodology-page");
    const d = renderDirectory(ALL, null, null), m = renderMethodology({ params: null, share: null as never, until: null });
    for (const k of ["live", "deployed", "announced"] as const) { const t = STATUS_RULES[k].replace(/'/g, "&#39;"); expect(d, k).toContain(t); expect(m, k).toContain(t); }
    expect(STATUS_RULES.live).toMatch(/official Arc or Circle post/);
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
