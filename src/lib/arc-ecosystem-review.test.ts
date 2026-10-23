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
});
