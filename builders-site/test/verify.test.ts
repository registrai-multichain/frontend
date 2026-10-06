import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handleBotFacts, handleBotVerify } from "../lib/verify";
import { onRequest as factsRoute } from "../functions/api/bot/facts";
import { onRequest as verifyRoute } from "../functions/api/bot/facts/verify";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const SECRET = "s".repeat(40);
const T0 = Date.parse("2026-10-06T12:00:00.000Z");
const SRC = "domain:kairo.market";

class CountingKV extends MemoryKV {
  puts = 0;
  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) { this.puts++; return super.put(key, value, options); }
}
const setup = (secret: string = SECRET) => {
  const kv = new CountingKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN, RADAR_PUBLISH_SECRET: secret };
  const req = (path: string, method: string, body?: unknown, token: string | null = SECRET) =>
    new Request(`${ORIGIN}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  return { kv, env, req };
};
const ok = (at: string) => ({ ok: true, at, problems: [] });

describe("POST /api/bot/facts/verify", () => {
  test("merges into verify:<source> with one write", async () => {
    const { kv, env, req } = setup();
    await kv.put(`facts:${SRC}`, "{}");
    kv.puts = 0;
    let r = await handleBotVerify(req("/api/bot/facts/verify", "POST", { source: SRC, results: { f1: ok("2026-10-06T10:00:00Z") } }), env, T0);
    expect(r.status).toBe(200);
    expect(kv.puts).toBe(1);
    r = await handleBotVerify(req("/api/bot/facts/verify", "POST", { source: SRC, results: { f1: { ok: false, at: "2026-10-06T11:00:00Z", problems: ["url 404"] } } }), env, T0);
    expect(kv.puts).toBe(2);
    expect(JSON.parse((await kv.get(`verify:${SRC}`))!)).toEqual({ f1: { ok: false, at: "2026-10-06T11:00:00.000Z", problems: ["url 404"], lastOk: "2026-10-06T10:00:00.000Z" } });
  });
  test("a source with no facts is 404, except track", async () => {
    const { kv, env, req } = setup();
    const r = await handleBotVerify(req("/api/bot/facts/verify", "POST", { source: SRC, results: { f1: ok("2026-10-06T10:00:00Z") } }), env, T0);
    expect(r.status).toBe(404);
    expect(kv.puts).toBe(0);
  });
  test("track goes to verify:track; bad input is 400 and writes nothing", async () => {
    const { kv, env, req } = setup();
    await kv.put(`facts:${SRC}`, "{}");
    const id = "a".repeat(64);
    expect((await handleBotVerify(req("/api/bot/facts/verify", "POST", { source: "track", results: { [id]: ok("2026-10-06T10:00:00Z") } }), env, T0)).status).toBe(200);
    expect(await kv.get("verify:track")).not.toBeNull();
    const before = kv.puts;
    for (const body of [{ source: "nope", results: { f1: ok("2026-10-06T10:00:00Z") } }, { source: SRC, results: { f1: { ok: false, at: "2026-10-06T10:00:00Z", problems: ["a", "b", "c", "d"] } } }, "x"]) {
      expect((await handleBotVerify(req("/api/bot/facts/verify", "POST", body), env, T0)).status).toBe(400);
    }
    expect(kv.puts).toBe(before);
  });
  test("Bearer: 401 without or with a wrong token, 503 when the secret is unset or short, 405 for GET", async () => {
    const { env, req } = setup();
    const body = { source: SRC, results: { f1: ok("2026-10-06T10:00:00Z") } };
    expect((await handleBotVerify(req("/api/bot/facts/verify", "POST", body, null), env, T0)).status).toBe(401);
    expect((await handleBotVerify(req("/api/bot/facts/verify", "POST", body, "x".repeat(40)), env, T0)).status).toBe(401);
    expect((await handleBotVerify(req("/api/bot/facts/verify", "GET"), env, T0)).status).toBe(405);
    for (const secret of ["", "short"]) {
      const s = setup(secret);
      expect((await handleBotVerify(s.req("/api/bot/facts/verify", "POST", body), s.env, T0)).status).toBe(503);
    }
  });
  test("the route is wired", async () => {
    const { env, req } = setup();
    const res = await verifyRoute({ request: req("/api/bot/facts/verify", "POST", {}, null), env, data: {}, next: async () => new Response(), waitUntil: () => {}, params: {} });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/bot/facts", () => {
  const stored = (source: string, extra: Record<string, unknown> = {}) => JSON.stringify({ source, facts: [{ id: "f1", topic: "control", text: "t", evidence: ["0x" + "1".repeat(40)], observedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", publishAt: "2026-12-01T00:00:00.000Z" }], changelog: [], lastReviewedAt: "2026-10-01T00:00:00.000Z", reviewedBy: "0xadmin", rev: 2, ...extra });
  test("lists every source, embargoed facts included, without reviewedBy", async () => {
    const { kv, env, req } = setup();
    await kv.put(`facts:${SRC}`, stored(SRC));
    await kv.put("facts:domain:b.xyz", stored("domain:b.xyz"));
    await kv.put("verify:domain:b.xyz", "{}");
    const r = await handleBotFacts(req("/api/bot/facts", "GET"), env);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { sources: Record<string, unknown>[] };
    expect(body.sources.map((s) => s.source)).toEqual(["domain:b.xyz", SRC]);
    expect(body.sources[1]).not.toHaveProperty("reviewedBy");
    expect((body.sources[1].facts as { publishAt?: string }[])[0].publishAt).toBe("2026-12-01T00:00:00.000Z");
    expect(body.sources[1].rev).toBe(2);
  });
  test("more than 400 sources is a 507", async () => {
    const { kv, env, req } = setup();
    for (let i = 0; i < 401; i++) await kv.put(`facts:domain:s${i}.xyz`, stored(`domain:s${i}.xyz`));
    const r = await handleBotFacts(req("/api/bot/facts", "GET"), env);
    expect(r.status).toBe(507);
    expect(await r.json()).toEqual({ error: "too many sources" });
  });
  test("follows KV pagination", async () => {
    const { kv, env, req } = setup();
    for (let i = 0; i < 400; i++) await kv.put(`facts:domain:s${String(i).padStart(4, "0")}.xyz`, stored(`domain:s${String(i).padStart(4, "0")}.xyz`));
    const body = (await (await handleBotFacts(req("/api/bot/facts", "GET"), env)).json()) as { sources: unknown[] };
    expect(body.sources).toHaveLength(400);
  });
  test("Bearer: 401 / 503 / 405", async () => {
    const { env, req } = setup();
    expect((await handleBotFacts(req("/api/bot/facts", "GET", undefined, null), env)).status).toBe(401);
    expect((await handleBotFacts(req("/api/bot/facts", "POST", {}), env)).status).toBe(405);
    const s = setup("");
    expect((await handleBotFacts(s.req("/api/bot/facts", "GET"), s.env)).status).toBe(503);
    const res = await factsRoute({ request: req("/api/bot/facts", "GET", undefined, null), env, data: {}, next: async () => new Response(), waitUntil: () => {}, params: {} });
    expect(res.status).toBe(401);
  });
});
