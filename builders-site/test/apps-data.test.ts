import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { idToPath, loadApp, loadAppList, pathToId } from "../lib/apps-data";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { ABI_INDICES, type AbiData } from "../../src/lib/builders-index";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set(["domain:archery.wtf"]) }));
const H = (s: string) => Date.parse(s) / 3600e3;

describe("ids ↔ paths", () => {
  test("round-trips, keeps slashes in the rest, decodes encoded segments", () => {
    expect(idToPath("domain:archery.wtf")).toBe("/apps/domain/archery.wtf/");
    expect(idToPath("github:owner/repo")).toBe("/apps/github/owner/repo/");
    expect(idToPath("integration:0x")).toBe("/apps/integration/0x/");
    expect(idToPath("no-colon")).toBeNull();
    expect(pathToId(["domain", "archery.wtf"])).toBe("domain:archery.wtf");
    expect(pathToId(["github", "owner", "repo"])).toBe("github:owner/repo");
    expect(pathToId(["domain", "arch%65ry.wtf"])).toBe("domain:archery.wtf");
    expect(pathToId(["domain"])).toBeNull();
    expect(pathToId(["domain", "%E0%A4%A"])).toBeNull();
  });
});

async function seeded() {
  const kv = new MemoryKV();
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  const f = indexFixture() as unknown as AbiData;
  const projects = [
    { ...f.projects[0], source: "domain:archery.wtf", name: "Archery", kind: "project", share: 2, contracts: 3, pts_24h: 10, pay_24h: 5, usdc_24h: 50 },
    { ...f.projects[0], source: "integration:uniswap", name: "Uniswap", kind: "integration", share: 9, contracts: 900, pts_24h: 99, pay_24h: 50, usdc_24h: 5000 },
  ];
  const P = { "domain:archery.wtf": 9.2, "integration:uniswap": 4000 };
  const file = (ps: typeof projects) => JSON.stringify({ ...f, data_until: "2026-10-14T21:00:00Z", projects: ps, live: { P },
    volume_24h: { USDC: { members_usd: 5050, members_payments: 55, base_usd_est: 500000, base_transfers_est: 900 } } });
  await kv.put(ABI_INDICES.aei.key, file(projects));
  await kv.put(ABI_INDICES.abi.key, file([projects[0]]));
  await kv.put(ABI_INDICES.aii.key, file([projects[1]]));
  // one fact with no embargo: public now, so the page links it
  await kv.put("facts:domain:archery.wtf", JSON.stringify({ source: "domain:archery.wtf", facts: [{ id: "f1", kind: "control", text: "x", evidence: [] }], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 1 }));
  db.sqlite.prepare("INSERT INTO index_hour VALUES ('aei', ?, 990)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_hour VALUES ('aei', 'domain:archery.wtf', ?, 9.2, 11, 5, 3, 1, 50)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_first VALUES ('aei', 'domain:archery.wtf', ?)").all(H("2026-10-11T19:00:00Z"));
  return { env: { INVITES: kv, DATA_DB: db } as never };
}

describe("loaders", () => {
  test("loadAppList: AEI rows with memberships, verified, contracts count and totals", async () => {
    const { env } = await seeded();
    const l = (await loadAppList(env, {}))!;
    expect(l.data_until).toBe("2026-10-14T21:00:00Z");
    const a = l.rows.find((r) => r.id === "domain:archery.wtf")!;
    expect(a).toMatchObject({ name: "Archery", kind: "builder", verified: true, points: 9.2, contracts: 3, indices: ["abi", "aei"], first_hour: "2026-10-11T19:00:00Z" });
    expect(l.rows.find((r) => r.id === "integration:uniswap")!.indices).toEqual(["aii", "aei"]);
    expect(l.totals).toEqual({ apps: 2, payments_24h: 55, usdc_24h: 5050, arc_usdc_24h_est: 500000 });
  });
  test("loadApp: hourly rows, facts link; unknown id; new member without history", async () => {
    const { env } = await seeded();
    const a = await loadApp(env, {}, "domain:archery.wtf");
    expect(a).not.toBe("unknown");
    expect((a as { hourly: unknown[] }).hourly).toHaveLength(1);
    expect((a as { facts_url: string }).facts_url).toBe("/project/?source=domain%3Aarchery.wtf");
    expect(await loadApp(env, {}, "domain:nope.example")).toBe("unknown");
    const u = await loadApp(env, {}, "integration:uniswap");
    expect((u as { hourly: unknown[]; facts_url: null }).hourly).toEqual([]);
    expect((u as { facts_url: null }).facts_url).toBeNull();
  });
  test("no DB or no index file: null (the route answers 503)", async () => {
    expect(await loadAppList({ INVITES: new MemoryKV() } as never, {})).toBeNull();
  });
});

describe("review fixes", () => {
  test("I1: the app list is read once per cache window; unknown ids cost no KV or D1 reads after that", async () => {
    const { MemoryCache } = await import("./memory-cache");
    const { env } = await seeded();
    const kv = (env as { INVITES: MemoryKV }).INVITES, get = vi.spyOn(kv, "get");
    const cache = new MemoryCache() as unknown as Cache;
    expect(await loadApp(env, { cache }, "domain:nope1.example")).toBe("unknown");
    const after = get.mock.calls.length;
    expect(await loadApp(env, { cache }, "domain:nope2.example")).toBe("unknown");
    expect(await loadApp(env, { cache }, "domain:nope3.example")).toBe("unknown");
    expect(get.mock.calls.length).toBe(after);
  });
  test("M5: a facts record with nothing public yet gives no facts link", async () => {
    const { env } = await seeded();
    await (env as { INVITES: MemoryKV }).INVITES.put("facts:integration:uniswap", JSON.stringify({ source: "integration:uniswap", facts: [{ id: "f1", publishAt: "2099-01-01T00:00:00Z", kind: "control", text: "x", evidence: [] }], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 1 }));
    expect(((await loadApp(env, {}, "integration:uniswap")) as { facts_url: string | null }).facts_url).toBeNull();
  });
});
