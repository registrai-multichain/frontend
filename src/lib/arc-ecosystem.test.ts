import { describe, expect, test } from "vitest";
import { CATEGORIES, categoryHref, categoryOf, entityHref, indexEntities, parseStatus, sortByName, validateEntities, whatItDoes, type ArcEntity } from "./arc-ecosystem";

const ok = (o: Partial<ArcEntity> = {}): ArcEntity => ({
  slug: "archery", name: "Archery", category: "consumer", status: "live",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }],
  summary: "Archery is a game on Arc where players pay entry fees in USDC.",
  sources: [{ url: "https://archery.wtf/" }], last_reviewed: "2026-10-20", ...o,
});
const errs = (list: unknown) => { const r = validateEntities(list); return r.ok ? [] : r.errors; };

describe("taxonomy", () => {
  test("21 categories, kebab ids, unique, plain labels", () => {
    expect(CATEGORIES).toHaveLength(21);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(21);
    for (const c of CATEGORIES) { expect(c.id).toMatch(/^[a-z]+(-[a-z]+)*$/); expect(c.label).toMatch(/Arc/); }
    expect(categoryOf("dexs")?.label).toBe("DEXs on Arc");
    expect(categoryOf("wallets")?.label).toBe("Wallets that support Arc");
    expect(categoryOf("nope")).toBeNull();
    expect(categoryHref("dexs")).toBe("/ecosystem/dexs/");
    expect(entityHref("aave")).toBe("/ecosystem/aave/");
  });
  test("parseStatus accepts the three statuses only", () => {
    expect(parseStatus("live")).toBe("live");
    expect(parseStatus("evil")).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });
});

describe("validateEntities", () => {
  test("a complete entry passes", () => expect(errs([ok()])).toEqual([]));
  test("slug: kebab-case, unique, not a category id or reserved word", () => {
    expect(errs([ok({ slug: "Archery" })]).join()).toMatch(/kebab/);
    expect(errs([ok(), ok({ name: "B" })]).join()).toMatch(/duplicate slug/);
    expect(errs([ok({ slug: "dexs" })]).join()).toMatch(/category/);
    for (const s of ["api", "category", "entities", "status"]) expect(errs([ok({ slug: s })]).join(), s).toMatch(/reserved/);
  });
  test("sources and status evidence are required and https", () => {
    expect(errs([ok({ sources: [] })]).join()).toMatch(/sources are required/);
    expect(errs([ok({ status_evidence: [] })]).join()).toMatch(/status_evidence is required/);
    expect(errs([ok({ sources: [{ url: "http://x.y/" }] })]).join()).toMatch(/https/);
  });
  test("live needs mainnet evidence: a contract, an index id or an explorer.arc.io link", () => {
    expect(errs([ok({ status_evidence: [{ url: "https://archery.wtf/" }] })]).join()).toMatch(/mainnet evidence/);
    expect(errs([ok({ status_evidence: [{ url: "https://archery.wtf/" }], index_ids: ["domain:archery.wtf"] })])).toEqual([]);
    expect(errs([ok({ status: "announced", status_evidence: [{ url: "https://www.arc.io/pressroom/x" }] })])).toEqual([]);
    // integrations without their own contracts (exchanges, RPC providers): the project's own page stating Arc mainnet support
    expect(errs([ok({ status_evidence: [{ url: "https://www.kraken.com/support/arc", type: "mainnet-support" }] })])).toEqual([]);
    expect(errs([ok({ status_evidence: [{ url: "https://x.y/", type: "rumour" as never }] })]).join()).toMatch(/evidence type/);
  });
  test("summary: required, at most 280 characters, no verdict word", () => {
    expect(errs([ok({ summary: "x".repeat(281) })]).join()).toMatch(/280/);
    expect(errs([ok({ summary: "Archery is a scam on Arc." })]).join()).toMatch(/verdict/);
  });
  test("category, tags, dates, links, contracts, ids", () => {
    expect(errs([ok({ category: "gaming" as never })]).join()).toMatch(/unknown category/);
    expect(errs([ok({ tags: ["nope" as never] })]).join()).toMatch(/unknown tag/);
    expect(errs([ok({ first_live: "16 Sep 2026" })]).join()).toMatch(/YYYY-MM-DD/);
    expect(errs([ok({ website: "http://archery.wtf" })]).join()).toMatch(/website/);
    expect(errs([ok({ github: "https://gitlab.com/x" })]).join()).toMatch(/github/);
    expect(errs([ok({ x: "@archery" })]).join()).toMatch(/handle/);
    expect(errs([ok({ contracts: [{ address: "0xABC", role: "Game", source: "https://x.y/" }] })]).join()).toMatch(/address/);
    expect(errs([ok({ index_ids: ["archery"] })]).join()).toMatch(/index id/);
    expect(errs([ok({ index_ids: ["domain:a.b"] }), ok({ slug: "b", index_ids: ["domain:a.b"] })]).join()).toMatch(/also on archery/);
  });
  test("control: read at a dated block, sourced, plain sentences with lowercase addresses and no verdicts", () => {
    const control = { date: "2026-10-25", block: 27860760, source: "https://explorer.arc.io/block/27860760",
      facts: ["owner() of 0x0000000000000000000000000000000000000001 returns 0x0000000000000000000000000000000000000002, an EOA."] };
    expect(errs([ok({ control })])).toEqual([]);
    expect(errs([ok({ control: { ...control, date: "25 Oct" } })]).join()).toMatch(/control date/);
    expect(errs([ok({ control: { ...control, block: -1 } })]).join()).toMatch(/control block/);
    expect(errs([ok({ control: { ...control, source: "http://x.y/" } })]).join()).toMatch(/control source/);
    expect(errs([ok({ control: { ...control, facts: [] } })]).join()).toMatch(/control facts/);
    expect(errs([ok({ control: { ...control, facts: ["owner() returns 0xABCdef0000000000000000000000000000000001."] } })]).join()).toMatch(/lowercase/);
    expect(errs([ok({ control: { ...control, facts: ["The contracts are safe."] } })]).join()).toMatch(/verdict/);
  });
  test("unknown fields are rejected (tracker revenue, wallets, notes never publish)", () => {
    expect(errs([{ ...ok(), revenue_usd: 5 }]).join()).toMatch(/unknown field revenue_usd/);
    expect(errs([{ ...ok(), wallets: [] }]).join()).toMatch(/unknown field wallets/);
  });
  test("not an array → one error", () => expect(errs({})).toEqual(["expected an array of entities"]));
});

describe("indexes", () => {
  test("by slug, index id and facts source; names sorted case-insensitively", () => {
    const ix = indexEntities([ok({ index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf" }), ok({ slug: "aave", name: "aave" })]);
    expect(ix.bySlug.get("aave")?.name).toBe("aave");
    expect(ix.byIndexId.get("domain:archery.wtf")?.slug).toBe("archery");
    expect(ix.byFactsSource.get("domain:archery.wtf")?.slug).toBe("archery");
    expect(sortByName(ix.entities).map((e) => e.slug)).toEqual(["aave", "archery"]);
  });
});

import { staleEntries } from "./arc-ecosystem";
test("stale: announced entries not reviewed for more than 90 days", () => {
  const l = [ok({ slug: "a", status: "announced", status_evidence: [{ url: "https://www.arc.io/x" }], last_reviewed: "2026-07-01" }), ok({ slug: "b", last_reviewed: "2026-07-01" }), ok({ slug: "c", status: "announced", status_evidence: [{ url: "https://www.arc.io/x" }], last_reviewed: "2026-10-01" })];
  expect(staleEntries(l, "2026-10-20").map((e) => e.slug)).toEqual(["a"]);
});

describe("official Arc evidence", () => {
  test("an official Arc/Circle post stating a project is live counts as mainnet evidence, only from arc.io or circle.com", () => {
    const base = { slug: "x", name: "X", category: "exchanges", status: "live", summary: "An exchange.", sources: [{ url: "https://x.io/" }], last_reviewed: "2026-10-23" };
    expect(validateEntities([{ ...base, status_evidence: [{ url: "https://www.arc.io/blog/arc-economic-os-internet", date: "2026-09-16", type: "arc-official-live" }] }]).ok).toBe(true);
    expect(validateEntities([{ ...base, status_evidence: [{ url: "https://www.circle.com/pressroom/p", type: "arc-official-live" }] }]).ok).toBe(true);
    const r = validateEntities([{ ...base, status_evidence: [{ url: "https://news.example/arc", type: "arc-official-live" }] }]);
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join()).toMatch(/arc-official-live must be an arc.io or circle.com page/);
  });
});

describe("whatItDoes (spec 2026-10-23-replace-competitor-citations §2)", () => {
  const w = (summary: string) => whatItDoes({ summary });
  test("first sentence; abbreviations, versions, decimals and URLs don't end it", () => {
    expect(w("Decentralized exchange protocol and app. Uniswap v2, v3, v4 went live.")).toBe("Decentralized exchange protocol and app.");
    expect(w("Blocks every 0.5 s on Arc. More.")).toBe("Blocks every 0.5 s on Arc.");
    expect(w("Wallets, e.g. Rabby, on Arc. More.")).toBe("Wallets, e.g. Rabby, on Arc.");
    expect(w("Docs at docs.arc.io describe it. More.")).toBe("Docs at docs.arc.io describe it.");
    expect(w("No full stop here")).toBe("No full stop here");
  });
  test("cut at 140 characters on a word boundary with …", () => {
    const r = w(`${"word ".repeat(40)}end.`);
    expect(r.length).toBeLessThanOrEqual(141);
    expect(r.endsWith("…")).toBe(true);
    expect(r).not.toMatch(/\s…$/);
  });
});

describe("whatItDoes review I4", () => {
  test("a leading 'Named/Listed/Announced … announcement' sentence is skipped for the product sentence", () => {
    expect(whatItDoes({ summary: "Named among digital wallets in Circle's 2026-09-16 Arc mainnet announcement. Self-custody multi-chain wallet app for crypto." })).toBe("Self-custody multi-chain wallet app for crypto.");
    expect(whatItDoes({ summary: "Named among exchanges in Circle's announcement." })).toBe("Named among exchanges in Circle's announcement.");   // nothing better to show
  });
});

