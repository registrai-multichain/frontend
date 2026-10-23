import { describe, expect, test } from "vitest";
import raw from "../data/arc-ecosystem/entities.json";
import { validateEntities } from "./arc-ecosystem";
import { ECOSYSTEM } from "./arc-ecosystem-data";
import corrRaw from "../data/arc-ecosystem/corrections.json";
import { validateCorrections } from "./arc-ecosystem-corrections";

describe("the published directory file", () => {
  test("every entry passes validation (a bad entry fails the build, never the site)", () => {
    const r = validateEntities(raw);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  test("ECOSYSTEM indexes every entry", () => expect(ECOSYSTEM.entities.length).toBe((raw as unknown[]).length));
  test("the corrections log passes validation against the published slugs", () => {
    const r = validateCorrections(corrRaw, new Set(ECOSYSTEM.entities.map((e) => e.slug)));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  test("every launch date is backed by a source dated that day (spec 2026-10-23-ai-search-gaps §2)", () => {
    const unbacked = ECOSYSTEM.entities.filter((e) => e.first_live && ![...e.status_evidence, ...e.sources].some((s) => s.date === e.first_live)).map((e) => `${e.slug} ${e.first_live}`);
    expect(unbacked).toEqual([]);
  });
  test("review: only live entries show a launch date; arc.io's 'live on Arc' / 'from day one' entries are live", () => {
    expect(ECOSYSTEM.entities.filter((e) => e.first_live && e.status !== "live").map((e) => `${e.slug} ${e.status}`)).toEqual([]);
    for (const slug of ["coins-ph", "ether-fi"]) expect(ECOSYSTEM.bySlug.get(slug)?.status, slug).toBe("live");
  });
  test("no live entry's summary starts with 'Announced' (spec 2026-10-23-replace-competitor-citations §2)", () => {
    expect(ECOSYSTEM.entities.filter((e) => e.status === "live" && /^Announced/.test(e.summary)).map((e) => e.slug)).toEqual([]);
  });
  test("review I4: every live entry's 'what it does' line says what it does, not where it was announced", async () => {
    const { whatItDoes } = await import("./arc-ecosystem");
    expect(ECOSYSTEM.entities.filter((e) => e.status === "live" && /^(Named|Listed|Announced)\b/.test(whatItDoes(e))).map((e) => e.slug)).toEqual([]);
  });
});

