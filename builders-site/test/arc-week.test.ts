// builders-site/test/arc-week.test.ts
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { ABI_INDICES } from "../../src/lib/builders-index";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const E: ArcEntity[] = [
  { slug: "archery", name: "Archery", category: "dexs", status: "live", summary: "x", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://archery.wtf/" }], index_ids: ["domain:archery.wtf"], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const U = 500_000;   // the AEI's last closed hour (unix hours)
async function setup() {
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  db.q("INSERT INTO index_hour (idx, hour, close) VALUES ('aei', ?, 1000)", U);
  const row = (id: string, hour: number, usdc: number, payments: number, newp: number) =>
    db.q("INSERT INTO member_hour (idx, id, hour, points, points_earned, payments, wallets, new_payers, usdc) VALUES ('aei', ?, ?, 1, 0, ?, 9, ?, ?)", id, hour, payments, newp, usdc);
  row("domain:archery.wtf", U, 100, 2, 1); row("domain:archery.wtf", U - 100, 50, 1, 1);
  row("domain:big.example", U - 1, 900, 3, 2);
  row("domain:old.example", U - 168, 5000, 9, 9);          // exactly at the edge: outside the window
  row("domain:quiet.example", U, 0, 0, 0);
  db.q("INSERT INTO member_first (idx, id, first_hour) VALUES ('aei','domain:archery.wtf',?), ('aei','domain:big.example',?), ('aei','domain:quiet.example',?)", U - 400, U - 10, U - 168);
  const kv = new MemoryKV();
  await kv.put(ABI_INDICES.aei.key, JSON.stringify({ data_until: "2026-10-22T16:00:00Z", projects: [
    { source: "domain:archery.wtf", name: "Archery" }, { source: "domain:big.example", name: "Big <b>App</b>" }, { source: "domain:quiet.example", name: "Quiet" }, { source: "domain:old.example", name: "Old" }] }));
  return { DATA_DB: db, INVITES: kv } as never;
}

describe("computeArcWeek", () => {
  test("sums the 168 hours ending at the last AEI close, sorted by USD; edge hour excluded; names from directory or AEI file", async () => {
    const { computeArcWeek } = await import("../lib/arc-week");
    const w = (await computeArcWeek(await setup()))!;
    expect(w.until_hour).toBe(U);
    expect(w.until).toBe(new Date(U * 3600e3).toISOString().replace(".000Z", "Z"));
    expect(w.apps.map((a) => a.id)).toEqual(["domain:big.example", "domain:archery.wtf", "domain:quiet.example"]);
    expect(w.apps[1]).toEqual({ id: "domain:archery.wtf", name: "Archery", href: "/ecosystem/archery/", category: "dexs", usd: 150, payments: 3, new_payers: 2, first_hour: U - 400 });
    expect(w.apps[0]).toMatchObject({ name: "Big <b>App</b>", category: null, usd: 900, first_hour: U - 10 });
    expect(w.apps.find((a) => a.id === "domain:old.example")).toBeUndefined();
  });
  test("no DATA_DB, no AEI close, or a D1 error → null (never throws)", async () => {
    const { computeArcWeek } = await import("../lib/arc-week");
    expect(await computeArcWeek({ INVITES: new MemoryKV() } as never)).toBeNull();
    const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    expect(await computeArcWeek({ DATA_DB: db, INVITES: new MemoryKV() } as never)).toBeNull();
    expect(await computeArcWeek({ DATA_DB: { prepare: () => { throw new Error("d1 down"); } }, INVITES: new MemoryKV() } as never)).toBeNull();
  });
});

describe("API /api/v1/arc/apps-week", () => {
  test("returns the week; 503 without data", async () => {
    const { handleArc } = await import("../lib/data-api-arc");
    const req = new Request("https://builder.registrai.cc/api/v1/arc/apps-week");
    const r = await handleArc(req, await setup(), { cache: null }, ["apps-week"]);
    expect(r.status).toBe(200);
    const b = await r.json() as { version: number; window_hours: number; apps: { id: string }[] };
    expect(b).toMatchObject({ version: 1, window_hours: 168 });
    expect(b.apps[0].id).toBe("domain:big.example");
    const none = await handleArc(req, { INVITES: new MemoryKV() } as never, { cache: null }, ["apps-week"]);
    expect(none.status).toBe(503);
  });
});
