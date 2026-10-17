import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DATA_MIGRATIONS, ingestIndexFile } from "../lib/data-api-ingest";
import { handlePushIndex } from "../lib/builders-index";
import { ABI_KEY } from "../../src/lib/builders-index";
import { INDEX } from "../../src/lib/abi-live-mock";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc", TOKEN = "t".repeat(40);
const dataDb = () => new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
/** A valid index file (abi-live-mock's INDEX, which has a live block) closed at `iso`, with live.P overridden. */
const SRC = INDEX.projects[0].source;
function withHour(iso: string, P: Record<string, number>) {
  const f = JSON.parse(JSON.stringify(INDEX)) as typeof INDEX;
  const start = new Date(Date.parse(iso) - 3600e3).toISOString().replace(".000Z", "Z");
  f.data_until = iso;
  f.candles = [[start, 990, 991, 989, 990.123, 1, 1, 1]];
  f.events = [{ t: start, source: SRC, name: f.projects[0].name, kind: "activity", payments: 3, wallets: 2, new_payers: 1, points: 7.5, usdc: 12.5 }];
  Object.assign(f.live.P, P);
  return f;
}
const post = (body: unknown) => new Request(`${ORIGIN}/api/index`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
const rows = (db: MemoryD1, sql: string) => db.sqlite.prepare(sql).all();

describe("ingest on push", () => {
  test("a push writes that hour's close and member rows; a re-push of the same hour replaces them", async () => {
    const db = dataDb(), kv = new MemoryKV();
    const env = { INVITES: kv, ABI_PUSH_TOKEN: TOKEN, DATA_DB: db } as never;
    const src = SRC;
    expect((await handlePushIndex(post(withHour("2026-10-14T21:00:00Z", { [src]: 1.5 })), env)).status).toBe(200);
    expect((await handlePushIndex(post(withHour("2026-10-14T21:00:00Z", { [src]: 2.5 })), env)).status).toBe(200);
    expect(rows(db, "SELECT idx, hour, close FROM index_hour")).toEqual([{ idx: "abi", hour: 497781, close: 990.123 }]);
    const m = rows(db, "SELECT id, hour, points, points_earned, payments FROM member_hour ORDER BY id");
    expect(m).toHaveLength(INDEX.projects.filter((p) => typeof INDEX.live.P[p.source] === "number").length);
    expect(m.find((r) => r.id === src)).toEqual({ id: src, hour: 497781, points: 2.5, points_earned: 7.5, payments: 3 });
  });
  test("a push refused as older (409) writes nothing to D1", async () => {
    const db = dataDb(), kv = new MemoryKV();
    const env = { INVITES: kv, ABI_PUSH_TOKEN: TOKEN, DATA_DB: db } as never;
    const src = SRC;
    await handlePushIndex(post(withHour("2026-10-14T21:00:00Z", { [src]: 1 })), env);
    const before = rows(db, "SELECT COUNT(*) AS n FROM member_hour");
    expect((await handlePushIndex(post(withHour("2026-10-14T20:00:00Z", { [src]: 9 })), env)).status).toBe(409);
    expect(rows(db, "SELECT COUNT(*) AS n FROM member_hour")).toEqual(before);
  });
  test("a D1 failure never fails the publish: the KV file is stored, 200, and a warning is logged", async () => {
    const kv = new MemoryKV(), warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { prepare: () => { throw new Error("d1 down"); }, batch: async () => { throw new Error("d1 down"); } };
    const env = { INVITES: kv, ABI_PUSH_TOKEN: TOKEN, DATA_DB: broken } as never;
    expect((await handlePushIndex(post(withHour("2026-10-14T21:00:00Z", { [SRC]: 1 })), env)).status).toBe(200);
    expect(await kv.get(ABI_KEY)).not.toBeNull();
    expect(warn).toHaveBeenCalledWith("data-api ingest failed", "abi", expect.anything());
    warn.mockRestore();
  });
  test("no DATA_DB binding: the push works as before", async () => {
    expect(await ingestIndexFile(undefined, "abi", withHour("2026-10-14T21:00:00Z", {}) as never)).toBeNull();
  });
});

describe("IndexNow ping on the daily close", () => {
  test("the AEI push of the 00:00 UTC close pings IndexNow with the sitemap URLs; other hours and indices do not", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { calls.push(`${url} ${JSON.parse(String(init?.body)).urlList.length > 0}`); return new Response(null, { status: 202 }); });
    try {
      const env = { INVITES: new MemoryKV(), ABI_PUSH_TOKEN: TOKEN, DATA_DB: dataDb() } as never;
      await handlePushIndex(post(withHour("2026-10-17T13:00:00Z", { [SRC]: 1 })), env, "aei");
      await handlePushIndex(post(withHour("2026-10-17T00:00:00Z", { [SRC]: 1 })), { ...(env as object), INVITES: new MemoryKV() } as never, "abi");
      expect(calls).toEqual([]);
      await handlePushIndex(post(withHour("2026-10-18T00:00:00Z", { [SRC]: 1 })), env, "aei");
      expect(calls).toEqual(["https://api.indexnow.org/indexnow true"]);
    } finally { vi.unstubAllGlobals(); }
  });
});
