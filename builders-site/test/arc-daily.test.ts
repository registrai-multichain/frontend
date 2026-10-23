import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { handlePushIndex } from "../lib/builders-index";
import { INDEX } from "../../src/lib/abi-live-mock";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const TOKEN = "t".repeat(40);
const db = () => new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
const n = (tag: string) => ({ version: 1, generated_at: tag }) as never;

function withHour(iso: string) {
  const f = JSON.parse(JSON.stringify(INDEX)) as typeof INDEX;
  f.data_until = iso;
  f.candles = [[new Date(Date.parse(iso) - 3600e3).toISOString().replace(".000Z", "Z"), 990, 991, 989, 990.1, 1, 1, 1]];
  return f;
}
const post = (body: unknown) => new Request("https://builder.registrai.cc/api/index/aei", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });

describe("Arc in numbers: daily snapshots", () => {
  test("one row per day: a second store the same day replaces it; newest first", async () => {
    const { readArcDaily, storeArcDaily } = await import("../lib/arc-daily");
    const d = db();
    await storeArcDaily(d as never, "2026-10-19", n("a"));
    await storeArcDaily(d as never, "2026-10-20", n("b"));
    await storeArcDaily(d as never, "2026-10-20", n("c"));
    const rows = await readArcDaily(d as never, 30);
    expect(rows.map((r) => (r as { generated_at: string }).generated_at)).toEqual(["c", "a"]);
  });

  test("days is clamped to 1..365; junk falls back to 30", async () => {
    const { clampDays } = await import("../lib/arc-daily");
    expect([clampDays("0"), clampDays("-5"), clampDays("abc"), clampDays("9999"), clampDays(null), clampDays("7")]).toEqual([1, 1, 30, 365, 30, 7]);
  });

  test("the AEI push of the 00:00 close stores a snapshot; other hours do not; a failing snapshot never fails the push", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 }));
    try {
      const d = db();
      const env = { INVITES: new MemoryKV(), ABI_PUSH_TOKEN: TOKEN, DATA_DB: d } as never;
      expect((await handlePushIndex(post(withHour("2026-10-20T13:00:00Z")), env, "aei")).status).toBe(200);
      expect(d.sqlite.prepare("SELECT COUNT(*) AS c FROM arc_daily").all()[0]).toEqual({ c: 0 });
      expect((await handlePushIndex(post(withHour("2026-10-21T00:00:00Z")), env, "aei")).status).toBe(200);
      const row = d.sqlite.prepare("SELECT day, json FROM arc_daily").all()[0] as { day: string; json: string };
      expect(row.day).toBe("2026-10-21");
      expect(JSON.parse(row.json).errors.join()).toMatch(/rpc/);   // RPC returned nothing: recorded, not thrown
      d.sqlite.exec("INSERT INTO corrections (slug, field, text, email, domain_match, ip_hash, created_at, status, decided_at) VALUES ('x','other','old one here','o@x.com',0,'h',1,'rejected',1)");
      expect((await handlePushIndex(post(withHour("2026-10-23T00:00:00Z")), env, "aei")).status).toBe(200);
      expect(d.sqlite.prepare("SELECT email FROM corrections").all()[0]).toEqual({ email: null });   // purged in the daily job
      const broken = { INVITES: new MemoryKV(), ABI_PUSH_TOKEN: TOKEN, DATA_DB: { prepare: () => { throw new Error("d1 down"); } } } as never;
      expect((await handlePushIndex(post(withHour("2026-10-22T00:00:00Z")), broken, "aei")).status).toBe(200);
    } finally { vi.unstubAllGlobals(); }
  });
});

test("I1: the snapshot and the IndexNow ping run after the response (waitUntil), so a slow RPC cannot fail the 00:00 publish", async () => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));   // every outside call hangs
  try {
    const later: Promise<unknown>[] = [];
    const env = { INVITES: new MemoryKV(), ABI_PUSH_TOKEN: TOKEN, DATA_DB: db() } as never;
    const t0 = Date.now();
    const r = await handlePushIndex(post(withHour("2026-10-21T00:00:00Z")), env, "aei", { waitUntil: (p) => { later.push(p); } });
    expect(r.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(later.length).toBeGreaterThanOrEqual(1);
  } finally { vi.unstubAllGlobals(); }
});
