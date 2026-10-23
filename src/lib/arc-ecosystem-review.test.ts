import { describe, expect, test } from "vitest";
import { validateEntities, type ArcEntity } from "./arc-ecosystem";
import { validateCorrections, type CorrectionEntry } from "./arc-ecosystem-corrections";
import { applyReview, type ReviewItem } from "./arc-ecosystem-review";

const E = (): ArcEntity[] => [
  { slug: "a", name: "A", category: "dexs", status: "live", first_live: "2026-10-10", summary: "A DEX.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://a.io/" }], last_reviewed: "2026-10-20" },
  { slug: "b", name: "B", category: "exchanges", status: "announced", summary: "An exchange.", status_evidence: [{ url: "https://www.arc.io/pressroom/x" }], sources: [{ url: "https://b.io/" }], last_reviewed: "2026-10-20" },
];
const C: CorrectionEntry[] = [{ id: 4, date: "2026-10-22", slug: "a", field: "summary", change: "Summary fixed.", from: "project" }];
const dated: ReviewItem = { slug: "a", field: "dates", set: { first_live: "2026-09-16" }, evidence: { url: "https://www.arc.io/blog/launch", title: "Arc launch post", date: "2026-09-16" },
  change: "Live since 2026-09-16, from the Arc launch post", source: "https://www.arc.io/blog/launch" };

describe("applyReview", () => {
  test("a dated launch: sets first_live, adds the evidence once, last_reviewed, one review correction with the next id", () => {
    const r = applyReview(E(), C, [dated], "2026-10-23");
    const a = r.entities.find((e) => e.slug === "a")!;
    expect(a.first_live).toBe("2026-09-16");
    expect(a.status_evidence).toContainEqual({ url: "https://www.arc.io/blog/launch", title: "Arc launch post", date: "2026-09-16" });
    expect(a.last_reviewed).toBe("2026-10-23");
    expect(r.corrections.at(-1)).toEqual({ id: 5, date: "2026-10-23", slug: "a", field: "dates", change: dated.change, source: dated.source, from: "review" });
    const again = applyReview(r.entities, r.corrections, [dated], "2026-10-23");
    expect(again.entities.find((e) => e.slug === "a")!.status_evidence.filter((s) => s.url === "https://www.arc.io/blog/launch")).toHaveLength(1);
    expect(validateEntities(r.entities).ok).toBe(true);
    expect(validateCorrections(r.corrections, new Set(r.entities.map((e) => e.slug))).ok).toBe(true);
  });
  test("first_live null removes the date; status needs evidence; a date must match its evidence; unknown slug throws", () => {
    const r = applyReview(E(), C, [{ slug: "a", field: "dates", set: { first_live: null }, change: "Launch date removed: no source states it", source: "https://a.io/" }], "2026-10-23");
    expect(r.entities[0].first_live).toBeUndefined();
    expect(() => applyReview(E(), C, [{ slug: "b", field: "status", set: { status: "live" }, change: "Announced → Live on mainnet", source: "https://www.arc.io/x" }], "2026-10-23")).toThrow(/status needs evidence/);
    expect(() => applyReview(E(), C, [{ ...dated, evidence: { url: "https://x.io/", date: "2026-09-20" } }], "2026-10-23")).toThrow(/date must match its evidence/);
    expect(() => applyReview(E(), C, [{ ...dated, slug: "nope" }], "2026-10-23")).toThrow(/unknown slug nope/);
  });
  test("status and category changes, extra tags without duplicating the category", () => {
    const r = applyReview(E(), C, [
      { slug: "b", field: "status", set: { status: "live", first_live: "2026-09-16" }, evidence: { url: "https://www.arc.io/blog/arc-economic-os-internet", title: "Arc mainnet post", date: "2026-09-16" }, change: "Announced → Live on mainnet, per the Arc mainnet post", source: "https://www.arc.io/blog/arc-economic-os-internet" },
      { slug: "a", field: "category", set: { category: "bridges", add_tags: ["bridges", "dexs"] }, change: "Moved from DEXs to Bridges and cross-chain, per its site", source: "https://a.io/" },
    ], "2026-10-23");
    expect(r.entities[1]).toMatchObject({ status: "live", first_live: "2026-09-16" });
    expect(r.entities[0].category).toBe("bridges");
    expect(r.entities[0].tags).toEqual(["dexs"]);
    expect(r.corrections.map((c) => c.id)).toEqual([4, 5, 6]);
  });
  test("evidence already on the entry gets the item's type, title and date", () => {
    const e = E(); e[1].status_evidence = [{ url: "https://docs.b.io/networks" }];
    const r = applyReview(e, C, [{ slug: "b", field: "status", set: { status: "live" }, evidence: { url: "https://docs.b.io/networks", title: "Docs list Arc mainnet", type: "mainnet-support" }, change: "Announced → Live on mainnet, per its docs", source: "https://docs.b.io/networks" }], "2026-10-23");
    expect(r.entities[1].status_evidence).toEqual([{ url: "https://docs.b.io/networks", title: "Docs list Arc mainnet", type: "mainnet-support" }]);
  });
  test("a launch date from evidence already on the entry (read on another day) takes the stated launch date", () => {
    const e = E(); e[0].status_evidence.push({ url: "https://www.arc.io/blog/launch", title: "Arc launch post", date: "2026-10-20" });
    const r = applyReview(e, C, [dated], "2026-10-23");
    expect(r.entities[0].status_evidence.filter((s) => s.url === "https://www.arc.io/blog/launch")).toEqual([{ url: "https://www.arc.io/blog/launch", title: "Arc launch post", date: "2026-09-16" }]);
  });
  test("review I3: the item's evidence title replaces a stale one (e.g. 'testnet' docs now cited for mainnet)", () => {
    const e = E(); e[0].status_evidence.push({ url: "https://www.arc.io/blog/launch", title: "Arc testnet docs", date: "2026-10-20" });
    const r = applyReview(e, C, [dated], "2026-10-23");
    expect(r.entities[0].status_evidence.find((s) => s.url === "https://www.arc.io/blog/launch")?.title).toBe("Arc launch post");
  });
  test("a summary item replaces the summary and logs field summary; too long throws", () => {
    const r = applyReview(E(), C, [{ slug: "b", field: "summary", set: { summary: "B, an exchange, supports Arc mainnet." }, change: "Summary updated: live on Arc per the launch post", source: "https://www.arc.io/x" }], "2026-10-23");
    expect(r.entities[1].summary).toBe("B, an exchange, supports Arc mainnet.");
    expect(r.corrections.at(-1)).toMatchObject({ field: "summary", from: "review" });
    expect(() => applyReview(E(), C, [{ slug: "b", field: "summary", set: { summary: "x".repeat(281) }, change: "too long summary", source: "https://x.io/" }], "2026-10-23")).toThrow(/summary/);
  });
});

