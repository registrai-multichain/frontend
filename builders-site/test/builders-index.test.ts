import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handlePublicIndex, handlePublicSeen, handlePushIndex, handlePushSeen } from "../lib/builders-index";
import { onRequest as seenRoute } from "../functions/api/index/seen";
import { onRequest as route } from "../functions/api/index/index";
import { ABI_INDICES, ABI_KEY, ABI_LIMITS, ABI_SEEN_KEY } from "../../src/lib/builders-index";
import { onRequest as aiiRoute } from "../functions/api/index/aii/index";
import { onRequest as aiiSeenRoute } from "../functions/api/index/aii/seen";
import { onRequest as aeiRoute } from "../functions/api/index/aei/index";
import { onRequest as aeiSeenRoute } from "../functions/api/index/aei/seen";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import { MemoryCache } from "./memory-cache";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const TOKEN = "t".repeat(40);

class CountingKV extends MemoryKV {
  puts = 0;
  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) { this.puts++; return super.put(key, value, options); }
}
function setup(...args: [string?]) {
  const token = args.length ? args[0] : TOKEN;
  const kv = new CountingKV(() => 0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN, ABI_PUSH_TOKEN: token };
  const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`, method = "POST") =>
    new Request(`${ORIGIN}/api/index`, { method, headers: auth ? { authorization: auth } : {}, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const push = async (body: unknown, auth?: string | null) => { const r = await handlePushIndex(post(body, auth), env); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  return { kv, env, post, push };
}

describe("POST /api/index auth", () => {
  test("503 when the token is unset or under 32 characters", async () => {
    expect((await setup(undefined).push(indexFixture())).status).toBe(503);
    expect((await setup("short").push(indexFixture())).status).toBe(503);
  });
  test("401 for a missing, wrong or non-Bearer token; nothing is written", async () => {
    const s = setup();
    expect((await s.push(indexFixture(), null)).status).toBe(401);
    expect((await s.push(indexFixture(), `Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect((await s.push(indexFixture(), `Bearer ${TOKEN.slice(0, 39)}`)).status).toBe(401);
    expect((await s.push(indexFixture(), `Basic ${TOKEN}`)).status).toBe(401);
    expect(s.kv.puts).toBe(0);
  });
  test("405 for a non-POST handled by the guard", async () => {
    const s = setup();
    const r = await handlePushIndex(s.post(null, `Bearer ${TOKEN}`, "PUT"), s.env);
    expect(r.status).toBe(405);
  });
});

describe("POST /api/index body", () => {
  test("a good file is stored with exactly one write, without unpublished fields", async () => {
    const s = setup();
    const r = await s.push(indexFixture());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, updated: "2026-10-09T15:47:56Z" });
    expect(s.kv.puts).toBe(1);
    const stored = JSON.parse((await s.kv.get(ABI_KEY))!);
    expect(stored.index).toBe(944.76);
    expect(stored.extra).toBeUndefined();
  });
  test("400 for bad JSON and for a schema failure", async () => {
    const s = setup();
    expect((await s.push("{nope")).status).toBe(400);
    const d = indexFixture(); d.index = "x";
    const r = await s.push(d);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/index/);
    expect(s.kv.puts).toBe(0);
  });
  test("413 over 256 KB, by declared length and by actual body", async () => {
    const s = setup();
    const big = JSON.stringify({ pad: "x".repeat(ABI_LIMITS.bytes + 10) });
    expect((await s.push(big)).status).toBe(413);
    const withHeader = new Request(`${ORIGIN}/api/index`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-length": String(ABI_LIMITS.bytes + 1) }, body: "{}" });
    expect((await handlePushIndex(withHeader, s.env)).status).toBe(413);
    expect(s.kv.puts).toBe(0);
  });
});

describe("GET /api/index", () => {
  test("404 {error:'no data'} when empty", async () => {
    const s = setup();
    const r = await handlePublicIndex(new Request(`${ORIGIN}/api/index`), s.env, { cache: null });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no data" });
  });
  test("serves the stored file with public, max-age=30 and never writes", async () => {
    const s = setup();
    await s.push(indexFixture());
    const before = s.kv.puts;
    const r = await handlePublicIndex(new Request(`${ORIGIN}/api/index`), s.env, { cache: null });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=30");
    expect(((await r.json()) as { index: number }).index).toBe(944.76);
    expect(s.kv.puts).toBe(before);
  });
  test("the edge cache answers the second read", async () => {
    const s = setup();
    await s.push(indexFixture());
    const cache = new MemoryCache() as unknown as Cache;
    await handlePublicIndex(new Request(`${ORIGIN}/api/index`), s.env, { cache });
    await s.kv.delete(ABI_KEY);
    expect((await handlePublicIndex(new Request(`${ORIGIN}/api/index`), s.env, { cache })).status).toBe(200);
  });
  test("405 for other methods", async () => {
    const r = await handlePublicIndex(new Request(`${ORIGIN}/api/index`, { method: "DELETE" }), setup().env, { cache: null });
    expect(r.status).toBe(405);
  });
});

describe("the Pages route", () => {
  test("POST goes to the publisher, GET to the reader", async () => {
    const s = setup();
    const ctx = (req: Request) => ({ request: req, env: s.env, params: {}, data: {}, waitUntil: () => undefined, next: async () => new Response() }) as never;
    expect((await route(ctx(s.post(indexFixture())))).status).toBe(200);
    expect((await route(ctx(s.post(null, null, "POST")))).status).toBe(401);
    expect((await route(ctx(new Request(`${ORIGIN}/api/index`)))).status).toBe(200);
  });
});

describe("/api/index with the real producer file", () => {
  test("stores the live block (about 55 KB) in one write", async () => {
    const s = setup();
    const real = JSON.parse(readFileSync(resolve(__dirname, "../../src/lib/fixtures/builders-index.json"), "utf8"));
    const r = await s.push(real);
    expect(r.status).toBe(200);
    expect(s.kv.puts).toBe(1);
    const stored = JSON.parse((await s.kv.get(ABI_KEY))!);
    expect(stored.live.hour_start).toBe(real.live.hour_start);
    expect(stored.method).toBeUndefined();
  });
  const REF_FILE = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/terminal/data/index.json";
  test.skipIf(!existsSync(REF_FILE))("the reference file with stablecoins and fx fits the 256 KB cap and keeps them", async () => {
    const s = setup();
    const text = readFileSync(REF_FILE, "utf8");
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(ABI_LIMITS.bytes);
    const ref = JSON.parse(text);
    const r = await s.push(text);
    expect(r.status).toBe(200);
    const stored = JSON.parse((await s.kv.get(ABI_KEY))!);
    expect(stored.stablecoins).toHaveLength(ref.stablecoins.length);
    expect(stored.volume_24h).toEqual(ref.volume_24h);
    expect(Object.keys(stored.live.stablecoins)).toEqual(Object.keys(ref.live.stablecoins));
    expect(Object.keys(stored.live_fx)).toEqual(Object.keys(ref.live_fx));
  });
});

describe("/api/index milestones and stablecoins", () => {
  const withMs = (evidence: string[]) => ({
    ...indexFixture(),
    milestones: [{ id: "20261010-063000-arc-upgrade", t: 1791613800, target: "base:arc", tier: "arc-upgrade", mult: 1.25, title: "Arc network upgrade", evidence }],
    stablecoins: [{ symbol: "EURC", currency: "EUR", issuer: "Circle", address: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1", decimals: 6, added: 1791619200 }],
    volume_24h: { EURC: { members_usd: 10, members_payments: 1, base_usd_est: 0, base_transfers_est: 0 } },
    live_fx: { "2026-10-09": { EUR: 1.1206, GBP: 1.322 } },
  });
  test("stored in one write and served back", async () => {
    const s = setup();
    const r = await s.push(withMs(["https://docs.arc.io/", "0x" + "ab".repeat(32)]));
    expect(r.status).toBe(200);
    expect(s.kv.puts).toBe(1);
    const res = await handlePublicIndex(new Request(`${ORIGIN}/api/index`), s.env);
    const got = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(got.milestones[0]).toMatchObject({ tier: "arc-upgrade", mult: 1.25, evidence: ["https://docs.arc.io/", "0x" + "ab".repeat(32)] });
    expect(got.live_fx).toEqual({ "2026-10-09": { EUR: 1.1206 } });
  });
  test.each([["javascript:alert(1)"], ["http://docs.arc.io/"], ["docs.arc.io"]])("400 for evidence %s; nothing written", async (e) => {
    const s = setup();
    const r = await s.push(withMs([e]));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/evidence/);
    expect(s.kv.puts).toBe(0);
  });
});

describe("/api/index/seen", () => {
  const seenBody = { hour_start: 1791558000, seen: { "domain:argus.world": "0123456789abcdef0123" } };
  const req = (body: unknown, auth: string | null = `Bearer ${TOKEN}`, method = "POST") =>
    new Request(`${ORIGIN}/api/index/seen`, { method, headers: auth ? { authorization: auth } : {}, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  test("503 unset, 401 wrong, nothing written", async () => {
    expect((await handlePushSeen(req(seenBody), setup(undefined).env)).status).toBe(503);
    const s = setup();
    expect((await handlePushSeen(req(seenBody, null), s.env)).status).toBe(401);
    expect((await handlePushSeen(req(seenBody, `Bearer ${"z".repeat(40)}`), s.env)).status).toBe(401);
    expect(s.kv.puts).toBe(0);
  });
  test("stores a valid file under abi:seen with one write; GET serves it for 30 s", async () => {
    const s = setup();
    const r = await handlePushSeen(req(seenBody), s.env);
    expect(r.status).toBe(200);
    expect(s.kv.puts).toBe(1);
    expect(JSON.parse((await s.kv.get(ABI_SEEN_KEY))!)).toEqual(seenBody);
    const g = await handlePublicSeen(new Request(`${ORIGIN}/api/index/seen`), s.env, { cache: null });
    expect(g.status).toBe(200);
    expect(g.headers.get("cache-control")).toBe("public, max-age=30");
    expect(await g.json()).toEqual(seenBody);
  });
  test("404 when empty", async () => {
    const g = await handlePublicSeen(new Request(`${ORIGIN}/api/index/seen`), setup().env, { cache: null });
    expect(g.status).toBe(404);
    expect(await g.json()).toEqual({ error: "no data" });
  });
  test("400 for a malformed file, 413 over 1 MB (and 300 KB passes)", async () => {
    const s = setup();
    expect((await handlePushSeen(req({ hour_start: 1, seen: { a: "xyz" } }), s.env)).status).toBe(400);
    expect((await handlePushSeen(req("not json"), s.env)).status).toBe(400);
    const big = { hour_start: 1, seen: { a: "0".repeat(ABI_LIMITS.seenBytes) } };
    expect((await handlePushSeen(req(big), s.env)).status).toBe(413);
    const ok = { hour_start: 1, seen: { a: "0".repeat(300_000), b: "1".repeat(10) } };
    expect((await handlePushSeen(req(ok), s.env)).status).toBe(200);
  });
  test("the Pages route dispatches POST and GET", async () => {
    const s = setup();
    const ctx = (r: Request) => ({ request: r, env: s.env, params: {}, data: {}, waitUntil: () => undefined, next: async () => new Response() }) as never;
    expect((await seenRoute(ctx(req(seenBody)))).status).toBe(200);
    expect((await seenRoute(ctx(new Request(`${ORIGIN}/api/index/seen`)))).status).toBe(200);
  });
});

describe("body size is enforced while reading", () => {
  const enc = new TextEncoder();
  const chunked = (parts: number, size: number, pulled: { n: number }) =>
    new ReadableStream<Uint8Array>({ pull(c) { if (pulled.n >= parts) return c.close(); pulled.n++; c.enqueue(enc.encode("x".repeat(size))); } });
  const streamReq = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/index`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, ...headers }, body, duplex: "half" } as RequestInit);

  test("a chunked oversize body with no content-length is cut off with 413 before it is all read", async () => {
    const s = setup();
    const pulled = { n: 0 };
    const r = await handlePushIndex(streamReq(chunked(1000, 64 * 1024, pulled)), s.env);
    expect(r.status).toBe(413);
    expect(pulled.n).toBeLessThan(20); // 256 KB / 64 KB = 4 chunks, plus stream read-ahead
    expect(s.kv.puts).toBe(0);
  });
  test("a non-numeric or fractional content-length is 400", async () => {
    const s = setup();
    for (const v of ["NaN", "abc", "1.5", "-5", "Infinity"]) {
      const req = new Request(`${ORIGIN}/api/index`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-length": v }, body: "{}" });
      // the platform may normalise the header away; when it keeps it, the handler must refuse it
      const r = await handlePushIndex(req, s.env);
      expect([400, 200].includes(r.status) || r.status === 413).toBe(true);
      if (req.headers.get("content-length") === v) expect(r.status).toBe(400);
    }
  });
  test("a stubbed NaN content-length is 400 and an oversize one 413", async () => {
    const s = setup();
    const fake = (cl: string) => ({ method: "POST", body: null, text: async () => "{}", headers: new Headers({ authorization: `Bearer ${TOKEN}`, "content-length": cl }) }) as unknown as Request;
    expect((await handlePushIndex(fake("NaN"), s.env)).status).toBe(400);
    expect((await handlePushIndex(fake(String(ABI_LIMITS.bytes + 1)), s.env)).status).toBe(413);
  });
});

describe("§17: AII and AEI endpoints", () => {
  const routes = {
    aii: { index: aiiRoute, seen: aiiSeenRoute },
    aei: { index: aeiRoute, seen: aeiSeenRoute },
  };
  const ctx = (env: Env, r: Request) => ({ request: r, env, params: {}, data: {}, waitUntil: () => undefined, next: async () => new Response() }) as never;
  const post = (path: string, body: unknown) => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  test.each(["aii", "aei"] as const)("%s: stored under its own keys, served on its own path; ABI untouched", async (id) => {
    const s = setup();
    const ix = ABI_INDICES[id];
    expect((await routes[id].index(ctx(s.env, post(ix.path, indexFixture())))).status).toBe(200);
    expect(await s.kv.get(ix.key)).not.toBeNull();
    expect(await s.kv.get(ABI_KEY)).toBeNull();
    const g = await routes[id].index(ctx(s.env, new Request(`${ORIGIN}${ix.path}`)));
    expect(g.status).toBe(200);
    expect(((await g.json()) as { index: number }).index).toBe(indexFixture().index);
    expect((await route(ctx(s.env, new Request(`${ORIGIN}/api/index`)))).status).toBe(404);
    const seen = { hour_start: 1791558000, seen: { "integration:uniswap": "0123456789" } };
    expect((await routes[id].seen(ctx(s.env, post(ix.seenPath, seen)))).status).toBe(200);
    expect(JSON.parse((await s.kv.get(ix.seenKey))!)).toEqual(seen);
    expect(await s.kv.get(ABI_SEEN_KEY)).toBeNull();
  });
  test("seen size: AII/AEI take up to 6 MB, ABI stays at 1 MB", async () => {
    const s = setup();
    const mb = (n: number) => ({ hour_start: 1, seen: { a: "0".repeat(Math.floor(n * 1024 * 1024 / 10) * 10) } });
    expect((await handlePushSeen(post("/api/index/aii/seen", mb(3.7)), s.env, "aii")).status).toBe(200);
    expect((await handlePushSeen(post("/api/index/aei/seen", mb(6.1)), s.env, "aei")).status).toBe(413);
    expect((await handlePushSeen(post("/api/index/seen", mb(1.1)), s.env)).status).toBe(413);
  });
});
