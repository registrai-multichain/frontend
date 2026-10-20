import { describe, expect, test } from "vitest";
import raw from "../data/arc-ecosystem/entities.json";
import { validateEntities } from "./arc-ecosystem";
import { ECOSYSTEM } from "./arc-ecosystem-data";

describe("the published directory file", () => {
  test("every entry passes validation (a bad entry fails the build, never the site)", () => {
    const r = validateEntities(raw);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  test("ECOSYSTEM indexes every entry", () => expect(ECOSYSTEM.entities.length).toBe((raw as unknown[]).length));
});
