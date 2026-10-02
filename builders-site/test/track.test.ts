import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handleAdminTrackRetract, handleBotTrack, handlePublicTrack } from "../lib/track";
import { onRequest as adminMiddleware } from "../functions/api/admin/_middleware";
import { onRequest as retractRoute } from "../functions/api/admin/track/retract";
import { MemoryCache } from "./memory-cache";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const SECRET = "s".repeat(40);
const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const ADMIN = "0xb7ecf980a4732b75e57e2ec80903dee3964f2573";
const ONBOARDER = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
const hex = (c: string) => c.repeat(64);
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, source: "domain:kairo.market", kind: "OwnershipTransferred", text: "Ownership of the contract moved to a new address.",
  evidence: ["0xdaf97c69eb8fb68ca9f4269eb8c458b3a5a31122"], observedAt: "2026-10-01", alertTime: "2026-10-01T10:00:10.000Z",
  blockTime: "2026-10-01T10:00:00.000Z", ...extra,
});

/** A KV that counts its writes. */
class CountingKV extends MemoryKV {
  puts = 0;
  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) { this.puts++; return super.put(key, value, options); }
}

function setup(secret: string | undefined = SECRET) {
  const kv = new CountingKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN, RADAR_PUBLISH_SECRET: secret, ADMIN_ADDRESSES: ADMIN, ONBOARDER_ADDRESSES: ONBOARDER };
  const post = (body: unknown, token: string | null = SECRET, method = "POST") =>
    new Request(`${ORIGIN}/api/bot/track`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: method === "GET" ? undefined : JSON.stringify(body) });
  const publish = async (body: unknown, token: string | null = SECRET) => {
    const r = await handleBotTrack(post(body, token), env, T0);
    return { status: r.status, body: (await r.json()) as { ok?: boolean; stored?: number; error?: string } };
  };
  const read = async (key: string) => JSON.parse((await kv.get(key)) ?? "null");
  return { kv, env, post, publish, read };
}

describe("POST /api/bot/track", () => {
  test("503 without a long secret, 401 on a bad bearer, 405 for GET", async () => {
    expect((await setup("").publish({ watching: 1, items: [] })).status).toBe(503);
    expect((await setup("short").publish({ watching: 1, items: [] })).status).toBe(503);
    const s = setup();
    expect((await s.publish({ watching: 1, items: [] }, "wrong")).status).toBe(401);
    expect((await s.publish({ watching: 1, items: [] }, null)).status).toBe(401);
    expect((await handleBotTrack(s.post(null, SECRET, "GET"), s.env, T0)).status).toBe(405);
  });
  test("a valid batch is stored with publishedAt; at most 3 writes (2 for one month)", async () => {
    const s = setup();
    const r = await s.publish({ watching: 19, items: [item(hex("a"))] });
    expect(r).toMatchObject({ status: 200, body: { ok: true, stored: 1 } });
    expect(s.kv.puts).toBe(2);
    expect((await s.read("track:2026-10")).items[0]).toMatchObject({ id: hex("a"), publishedAt: new Date(T0).toISOString() });
    expect(await s.read("track:meta")).toMatchObject({ watching: 19 });
    const s2 = setup();
    await s2.publish({ watching: 19, items: [item(hex("a")), item(hex("b"), { alertTime: "2026-09-30T23:59:59.000Z" })] });
    expect(s2.kv.puts).toBe(3);
  });
  test("the same batch again is deduplicated", async () => {
    const s = setup();
    await s.publish({ watching: 19, items: [item(hex("a"))] });
    const again = await s.publish({ watching: 19, items: [item(hex("a"))] });
    expect(again).toMatchObject({ status: 200, body: { stored: 0 } });
    expect((await s.read("track:2026-10")).items).toHaveLength(1);
  });
  test("a non-public kind is 400 and nothing is written", async () => {
    const s = setup();
    expect((await s.publish({ watching: 1, items: [item(hex("a"), { kind: "site-new-target" })] })).status).toBe(400);
    expect(s.kv.puts).toBe(0);
  });
  test("a batch spanning 3 months is 400 and nothing is written", async () => {
    const s = setup();
    const items = [item(hex("a")), item(hex("b"), { alertTime: "2026-09-15T10:00:00.000Z" }), item(hex("c"), { alertTime: "2026-08-15T10:00:00.000Z" })];
    expect((await s.publish({ watching: 1, items })).status).toBe(400);
    expect(s.kv.puts).toBe(0);
  });
});

describe("GET /api/track", () => {
  test("returns merged items newest first and stats; never writes; no secret", async () => {
    const s = setup();
    await s.publish({ watching: 19, items: [item(hex("a")), item(hex("b"), { alertTime: "2026-09-30T23:59:59.000Z" })] });
    const writes = s.kv.puts;
    const res = await handlePublicTrack(new Request(`${ORIGIN}/api/track`), s.env, { now: T0, cache: null });
    const body = (await res.json()) as { watching: number; updatedAt: string; stats: { published30: number }; items: { id: string }[] };
    expect(res.status).toBe(200);
    expect(body.watching).toBe(19);
    expect(body.stats.published30).toBe(2);
    expect(body.items.map((i) => i.id)).toEqual([hex("a"), hex("b")]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(s.kv.puts).toBe(writes);
    expect((await handlePublicTrack(new Request(`${ORIGIN}/api/track`, { method: "POST" }), s.env, { now: T0, cache: null })).status).toBe(405);
    const cache = new MemoryCache();
    await handlePublicTrack(new Request(`${ORIGIN}/api/track`), s.env, { now: T0, cache: cache as unknown as Cache });
    expect(s.kv.puts).toBe(writes);
  });
  test("an empty store answers 200 with zeros", async () => {
    const s = setup();
    const res = await handlePublicTrack(new Request(`${ORIGIN}/api/track`), s.env, { now: T0, cache: null });
    expect(await res.json()).toMatchObject({ watching: 0, items: [], stats: { published30: 0 } });
  });
});

describe("POST /api/admin/track/retract", () => {
  const tok = (c: string) => c.repeat(64);
  async function viaMiddleware(env: Env, token: string, body: unknown) {
    const request = new Request(`${ORIGIN}/api/admin/track/retract`, {
      method: "POST", headers: { cookie: `__Host-rb_admin=${token}`, "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body),
    });
    const ctx = { request, env, params: {}, data: {} as Record<string, unknown>, next: async () => retractRoute(ctx as never), waitUntil: () => {} };
    const r = await adminMiddleware(ctx as never);
    return { status: r.status, body: (await r.json()) as { item?: { retracted?: { reason: string } }; error?: string } };
  }
  test("an admin retracts once; again is 409; unknown is 404; one write", async () => {
    const s = setup();
    await s.publish({ watching: 19, items: [item(hex("a"))] });
    await s.kv.put(`session:${tok("a")}`, ADMIN);
    const before = s.kv.puts;
    const r = await viaMiddleware(s.env, tok("a"), { id: hex("a"), month: "2026-10", reason: "Wrong address in the text." });
    expect(r.status).toBe(200);
    expect(r.body.item?.retracted?.reason).toBe("Wrong address in the text.");
    expect(s.kv.puts).toBe(before + 1);
    expect((await s.read("track:2026-10")).items[0].retracted).toMatchObject({ reason: "Wrong address in the text." });
    expect((await viaMiddleware(s.env, tok("a"), { id: hex("a"), month: "2026-10", reason: "again" })).status).toBe(409);
    expect((await viaMiddleware(s.env, tok("a"), { id: hex("f"), month: "2026-10", reason: "x" })).status).toBe(404);
    expect((await viaMiddleware(s.env, tok("a"), { id: hex("a"), month: "2026-10", reason: "" })).status).toBe(400);
  });
  test("a non-admin is blocked by the middleware, and by the handler itself", async () => {
    const s = setup();
    await s.publish({ watching: 19, items: [item(hex("a"))] });
    await s.kv.put(`session:${tok("b")}`, ONBOARDER);
    expect((await viaMiddleware(s.env, tok("b"), { id: hex("a"), month: "2026-10", reason: "x" })).status).toBe(403);
    const direct = await handleAdminTrackRetract(
      new Request(`${ORIGIN}/api/admin/track/retract`, { method: "POST", body: JSON.stringify({ id: hex("a"), month: "2026-10", reason: "x" }) }), s.env, ONBOARDER, "onboarder", T0);
    expect(direct.status).toBe(403);
    expect((await s.read("track:2026-10")).items[0].retracted).toBeUndefined();
  });
});
