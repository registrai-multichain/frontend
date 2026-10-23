import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";
import arcFixture from "../../docs/superpowers/specs/data-api-v1-fixtures/arc-now.json";
import dailyFixture from "../../docs/superpowers/specs/data-api-v1-fixtures/arc-daily.json";

const get = async (path: string, env: Record<string, unknown>) => {
  const { handleArc } = await import("../lib/data-api-arc");
  const u = new URL(`https://builder.registrai.cc/api/v1/arc${path}`);
  return handleArc(new Request(u), { INVITES: { get: async () => null }, ...env } as never, { cache: null }, u.pathname.replace(/^\/api\/v1\/arc\/?/, "").split("/").filter(Boolean));
};

describe("/api/v1/arc", () => {
  test("live: the fixture's shape, even with every source down", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    try {
      const r = await get("", {});
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(Object.keys(b).sort()).toEqual(Object.keys(arcFixture).sort());
      expect(b.errors.length).toBeGreaterThan(0);
    } finally { vi.unstubAllGlobals(); }
  });
  test("daily: newest first, days clamped; no database → 503; unknown path → 404", async () => {
    const { storeArcDaily } = await import("../lib/arc-daily");
    const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) await storeArcDaily(db as never, d, { version: 1, generated_at: `${d}T00:02:00.000Z` } as never);
    const b = await (await get("/daily?days=2", { DATA_DB: db })).json();
    expect(Object.keys(b).sort()).toEqual(Object.keys(dailyFixture).sort());
    expect(b.days.map((x: { generated_at: string }) => x.generated_at.slice(0, 10))).toEqual(["2026-10-21", "2026-10-20"]);
    expect((await (await get("/daily?days=abc", { DATA_DB: db })).json()).days).toHaveLength(3);
    expect((await get("/daily", {})).status).toBe(503);
    const noTable = new MemoryD1([]);   // the migration not applied yet
    const r = await get("/daily", { DATA_DB: noTable });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/not available/);
    expect((await get("/nope", {})).status).toBe(404);
  });
});
