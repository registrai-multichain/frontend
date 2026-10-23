import { describe, expect, test } from "vitest";
import { indexCorrections, validateCorrections } from "./arc-ecosystem-corrections";
import { validateEntities } from "./arc-ecosystem";

const ok = { id: 1, date: "2026-10-22", slug: "visa", field: "summary", change: "Summary now says the pilot settles in USDC.", source: "https://visa.com/x", from: "project" };
const slugs = new Set(["visa", "aave"]);

describe("corrections log", () => {
  test("a valid entry passes; an empty log passes", () => {
    expect(validateCorrections([ok], slugs)).toMatchObject({ ok: true });
    expect(validateCorrections([], slugs)).toMatchObject({ ok: true });
  });
  test("each rule", () => {
    const bad = (o: Record<string, unknown>) => { const r = validateCorrections([{ ...ok, ...o }], slugs); return r.ok ? [] : r.errors; };
    expect(bad({ date: "22-10-2026" }).join()).toMatch(/date/);
    expect(bad({ field: "price" }).join()).toMatch(/field/);
    expect(bad({ change: "abc" }).join()).toMatch(/change/);
    expect(bad({ change: "x".repeat(201) }).join()).toMatch(/change/);
    expect(bad({ source: "http://visa.com" }).join()).toMatch(/source/);
    expect(bad({ source: "javascript:alert(1)" }).join()).toMatch(/source/);
    expect(bad({ from: "someone" }).join()).toMatch(/from/);
    expect(bad({ slug: "nobody" }).join()).toMatch(/slug/);
    expect(bad({ extra: 1 }).join()).toMatch(/unknown field/);
    const dup = validateCorrections([ok, { ...ok }], slugs);
    expect(dup.ok ? [] : dup.errors.join()).toMatch(/duplicate id/);
  });
  test("a removed slug is allowed only with a removal entry", () => {
    const rm = { ...ok, id: 2, slug: "gone", field: "removal", change: "Removed at the project's request." };
    expect(validateCorrections([rm], slugs)).toMatchObject({ ok: true });
    expect(validateCorrections([{ ...rm, id: 3, field: "summary" }], slugs).ok).toBe(false);
    expect(validateCorrections([rm, { ...ok, id: 4, slug: "gone" }], slugs)).toMatchObject({ ok: true });
  });
  test("index: newest first, by slug, removed", () => {
    const a = { ...ok, id: 1, date: "2026-10-22" }, b = { ...ok, id: 2, date: "2026-10-23" }, c = { ...ok, id: 3, slug: "gone", field: "removal" as const, date: "2026-10-23" };
    const ix = indexCorrections([a, b, c] as never);
    expect(ix.all.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(ix.bySlug.get("visa")!.map((x) => x.id)).toEqual([2, 1]);
    expect(ix.removed.get("gone")!.id).toBe(3);
  });
  test("'corrections' is a reserved entity slug", () => {
    const e = { slug: "corrections", name: "X", category: "dexs", status: "announced", summary: "x", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://x.y/" }], last_reviewed: "2026-10-21" };
    const r = validateEntities([e]);
    expect(r.ok ? [] : r.errors.join()).toMatch(/reserved/);
  });
  test("accepts Registrai's own review as a source of corrections", () => {
    const r = validateCorrections([{ id: 1, date: "2026-10-23", slug: "a", field: "dates", change: "Live since 2026-09-16, from the launch post", source: "https://x.y/", from: "review" }], new Set(["a"]));
    expect(r.ok).toBe(true);
    expect(validateCorrections([{ id: 1, date: "2026-10-23", slug: "a", field: "dates", change: "Live since 2026-09-16", from: "bot" }], new Set(["a"])).ok).toBe(false);
  });
});
