import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import listFixture from "../../docs/superpowers/specs/data-api-v1-fixtures/ecosystem.json";
import entityFixture from "../../docs/superpowers/specs/data-api-v1-fixtures/ecosystem-entity.json";

const E = [
  { slug: "aave", name: "Aave", aliases: ["Aave V4"], category: "lending", status: "live", summary: "Lending on Arc.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }],
    sources: [{ url: "https://aave.com/" }], website: "https://aave.com/", first_live: "2026-10-10", last_reviewed: "2026-10-20" },
  { slug: "circle-wallets", name: "Circle Wallets", category: "wallets", status: "announced", summary: "Wallets.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://www.circle.com/" }], last_reviewed: "2026-10-19" },
] as ArcEntity[];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() }, ECOSYSTEM: indexEntities(E) }));

const get = async (path: string) => {
  const { handleEcosystem } = await import("../lib/data-api-ecosystem");
  const u = new URL(`https://builder.registrai.cc/api/v1/ecosystem${path}`);
  return handleEcosystem(new Request(u), { cache: null }, u.pathname.replace(/^\/api\/v1\/ecosystem\/?/, "").split("/").filter(Boolean));
};

describe("/api/v1/ecosystem", () => {
  test("list: version, updated, count, items in the fixture's shape, sorted by name", async () => {
    const b = await (await get("")).json();
    expect(Object.keys(b).sort()).toEqual(Object.keys(listFixture).sort());
    expect(Object.keys(b.entities[0]).sort()).toEqual(Object.keys(listFixture.entities[0]).sort());
    expect(b).toMatchObject({ version: 1, updated: "2026-10-20", count: 2 });
    expect(b.entities.map((e: { slug: string }) => e.slug)).toEqual(["aave", "circle-wallets"]);
    expect(b.entities[0].url).toBe("https://builder.registrai.cc/ecosystem/aave/");
  });
  test("filters: category, status, q (name or alias, case-insensitive)", async () => {
    expect((await (await get("?category=wallets")).json()).count).toBe(1);
    expect((await (await get("?status=live")).json()).entities[0].slug).toBe("aave");
    expect((await (await get("?q=aave%20v4")).json()).count).toBe(1);
    expect((await (await get("?q=zzz")).json()).count).toBe(0);
  });
  test("bad filters → 400 with a sentence; unknown slug → 404; extra segments → 404", async () => {
    const r = await get("?status=evil");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/status must be/);
    expect((await get("?category=gaming")).status).toBe(400);
    expect((await get("/nobody")).status).toBe(404);
    expect((await get("/aave/x")).status).toBe(404);
  });
  test("one entity: the full entry plus its url, in the fixture's shape", async () => {
    const b = await (await get("/aave")).json();
    expect(Object.keys(b).sort()).toEqual(Object.keys(entityFixture).sort());
    expect(b.entity).toMatchObject({ slug: "aave", url: "https://builder.registrai.cc/ecosystem/aave/" });
  });
});
