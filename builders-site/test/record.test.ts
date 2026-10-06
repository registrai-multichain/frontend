import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handleBotRecord, handleBotRecordTx, handlePublicRecord } from "../lib/record";
import { canonicalise, sha256Hex } from "../../src/lib/record";
import { onRequest as recordRoute } from "../functions/api/bot/record";
import { onRequest as txRoute } from "../functions/api/bot/record/tx";
import { onRequestGet as publicRoute } from "../functions/api/record/[[day]]";
import { MemoryCache } from "./memory-cache";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const SECRET = "s".repeat(40);
const T0 = Date.parse("2026-10-06T00:30:00.000Z");
const DAY = "2026-10-05";
const SRC = "domain:kairo.market";
const TX = "0x" + "ab".repeat(32);
const hex = (c: string) => c.repeat(64);

class CountingKV extends MemoryKV {
  puts = 0;
  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) { this.puts++; return super.put(key, value, options); }
}
const fact = (id: string, extra: Record<string, unknown> = {}) => ({ id, topic: "control", text: "Ä one account deployed the contracts.", evidence: ["0x" + "1".repeat(40)], observedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...extra });
const stored = (source: string, facts: unknown[]) => JSON.stringify({ source, facts, changelog: [], lastReviewedAt: "2026-10-01T00:00:00.000Z", reviewedBy: "0xadmin", rev: 4 });
const titem = (id: string, extra: Record<string, unknown> = {}) => ({
  id, source: SRC, kind: "OwnershipTransferred", text: "Ownership moved.", evidence: ["0x" + "1".repeat(40)], observedAt: "2026-10-04",
  alertTime: "2026-10-04T10:00:10.000Z", blockTime: "2026-10-04T10:00:00.000Z", publishedAt: "2026-10-04T10:01:00.000Z", ...extra,
});

async function setup(secret: string = SECRET) {
  const kv = new CountingKV(() => T0);
  await kv.put(`facts:${SRC}`, stored(SRC, [fact("f1"), fact("emb", { publishAt: "2026-10-01T00:00:00.000Z" })]));
  await kv.put("facts:domain:hidden.xyz", stored("domain:hidden.xyz", [fact("x1", { publishAt: "2026-12-01T00:00:00.000Z" })]));
  await kv.put("track:2026-10", JSON.stringify({ items: [titem(hex("1")), titem(hex("2"), { publishedAt: "2026-10-05T23:00:00.000Z" }), titem(hex("3"), { publishedAt: "2026-10-06T00:10:00.000Z" })] }));
  await kv.put("track:retracted", JSON.stringify({ [hex("1")]: { at: "2026-10-05T12:00:00.000Z", reason: "duplicate" } }));
  kv.puts = 0;
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN, RADAR_PUBLISH_SECRET: secret };
  const req = (path: string, method: string, body?: unknown, token: string | null = SECRET) =>
    new Request(`${ORIGIN}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  const snapshot = (day = DAY, token: string | null = SECRET) => handleBotRecord(req("/api/bot/record", "POST", { day }, token), env, T0);
  return { kv, env, req, snapshot };
}

describe("POST /api/bot/record", () => {
  test("builds the canonical snapshot, hashes it and writes the record then the index (2 writes)", async () => {
    const { kv, snapshot } = await setup();
    const r = await snapshot();
    expect(r.status).toBe(200);
    const out = (await r.json()) as { day: string; digest: string; url: string };
    expect(out.url).toBe(`https://builder.registrai.cc/api/record/${DAY}.json`);
    expect(kv.puts).toBe(2);
    const rec = JSON.parse((await kv.get(`record:${DAY}`))!) as { json: string; digest: string; tx: null; createdAt: string };
    expect(rec.digest).toBe(out.digest);
    expect(rec.digest).toBe(await sha256Hex(rec.json));
    expect(rec.tx).toBeNull();
    expect(rec.createdAt).toBe("2026-10-06T00:30:00.000Z");
    expect(rec.json).toBe(canonicalise(JSON.parse(rec.json)));
    expect(JSON.parse((await kv.get("record:index"))!)).toEqual([{ day: DAY, digest: out.digest, tx: null }]);
  });
  test("the snapshot holds only what was public that day", async () => {
    const { kv, snapshot } = await setup();
    await snapshot();
    const snap = JSON.parse(JSON.parse((await kv.get(`record:${DAY}`))!).json) as { day: string; facts: Record<string, { facts: { id: string }[]; reviewedBy: string }>; track: { id: string; retracted?: unknown }[] };
    expect(snap.day).toBe(DAY);
    expect(Object.keys(snap.facts)).toEqual([SRC]); // hidden source leaves no trace
    expect(snap.facts[SRC].facts.map((f) => f.id)).toEqual(["f1"]); // embargo passed but never re-checked: hidden
    expect(snap.facts[SRC].reviewedBy).toBe("Registrai");
    expect(snap.facts[SRC]).not.toHaveProperty("rev");
    expect(snap.track.map((i) => i.id).sort()).toEqual([hex("1"), hex("2")]); // hex("3") was published after the day
    expect(snap.track.find((i) => i.id === hex("1"))?.retracted).toEqual({ at: "2026-10-05T12:00:00.000Z", reason: "duplicate" });
  });
  test("an embargoed fact with a passing check since its update is included, with verifiedAt", async () => {
    const { kv, snapshot } = await setup();
    await kv.put(`verify:${SRC}`, JSON.stringify({ emb: { ok: true, at: "2026-10-05T08:00:00.000Z", problems: [], lastOk: "2026-10-05T08:00:00.000Z" }, f1: { ok: true, at: "2026-10-06T08:00:00.000Z", problems: [], lastOk: "2026-10-06T08:00:00.000Z" } }));
    await snapshot();
    const snap = JSON.parse(JSON.parse((await kv.get(`record:${DAY}`))!).json) as { facts: Record<string, { facts: { id: string; verifiedAt?: string }[] }> };
    expect(snap.facts[SRC].facts.map((f) => f.id)).toEqual(["f1", "emb"]);
    expect(snap.facts[SRC].facts[1].verifiedAt).toBe("2026-10-05T08:00:00.000Z");
    expect(snap.facts[SRC].facts[0].verifiedAt).toBeUndefined(); // checked after the day: not part of that day
  });
  test("records are immutable: a second POST returns the same digest and writes nothing", async () => {
    const { kv, snapshot } = await setup();
    const a = (await (await snapshot()).json()) as { digest: string };
    await kv.put(`facts:${SRC}`, stored(SRC, [fact("f1"), fact("f2")]));
    kv.puts = 0;
    const b = (await (await snapshot()).json()) as { digest: string; url: string };
    expect(b.digest).toBe(a.digest);
    expect(b.url).toBe(`https://builder.registrai.cc/api/record/${DAY}.json`);
    expect(kv.puts).toBe(0);
  });
  test("a repeat POST repairs a missing index entry", async () => {
    const { kv, snapshot } = await setup();
    await snapshot();
    await kv.delete("record:index");
    kv.puts = 0;
    await snapshot();
    expect(kv.puts).toBe(1);
    expect(JSON.parse((await kv.get("record:index"))!)).toHaveLength(1);
  });
  test("day validation: future, today, more than 7 days back, malformed", async () => {
    const { snapshot, kv } = await setup();
    for (const d of ["2026-10-06", "2026-10-07", "2026-09-28", "2026-10-5", "x"]) expect((await snapshot(d)).status, d).toBe(400);
    expect((await snapshot("2026-09-29")).status).toBe(200);
    expect(kv.puts).toBe(2);
  });
  test("the index stays sorted by day", async () => {
    const { kv, snapshot } = await setup();
    await snapshot("2026-10-05");
    await snapshot("2026-10-03");
    expect((JSON.parse((await kv.get("record:index"))!) as { day: string }[]).map((e) => e.day)).toEqual(["2026-10-03", "2026-10-05"]);
  });
  test("Bearer: 401, 503 when unset or short, 405 for GET; the route is wired", async () => {
    const { env, req, snapshot } = await setup();
    expect((await snapshot(DAY, null)).status).toBe(401);
    expect((await snapshot(DAY, "x".repeat(40))).status).toBe(401);
    expect((await handleBotRecord(req("/api/bot/record", "GET"), env, T0)).status).toBe(405);
    for (const secret of ["", "short"]) {
      const s = await setup(secret);
      expect((await s.snapshot()).status).toBe(503);
    }
    const res = await recordRoute({ request: req("/api/bot/record", "POST", { day: DAY }, null), env, data: {}, next: async () => new Response(), waitUntil: () => {}, params: {} });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/bot/record/tx", () => {
  const postTx = (s: Awaited<ReturnType<typeof setup>>, body: unknown, token: string | null = SECRET) => handleBotRecordTx(s.req("/api/bot/record/tx", "POST", body, token), s.env);
  test("sets the tx once on the record and the index; a second call is 409", async () => {
    const s = await setup();
    await s.snapshot();
    s.kv.puts = 0;
    const r = await postTx(s, { day: DAY, tx: TX.toUpperCase().replace("0X", "0x") });
    expect(r.status).toBe(200);
    expect(s.kv.puts).toBe(2);
    expect(JSON.parse((await s.kv.get(`record:${DAY}`))!).tx).toBe(TX);
    expect(JSON.parse((await s.kv.get("record:index"))!)[0].tx).toBe(TX);
    const again = await postTx(s, { day: DAY, tx: "0x" + "cd".repeat(32) });
    expect(again.status).toBe(409);
    expect(JSON.parse((await s.kv.get(`record:${DAY}`))!).tx).toBe(TX);
    expect(s.kv.puts).toBe(2);
  });
  test("bad tx or day is 400, an unknown day is 404", async () => {
    const s = await setup();
    await s.snapshot();
    expect((await postTx(s, { day: DAY, tx: "0x1234" })).status).toBe(400);
    expect((await postTx(s, { day: "nope", tx: TX })).status).toBe(400);
    expect((await postTx(s, { day: "2026-10-04", tx: TX })).status).toBe(404);
    expect((await postTx(s, null)).status).toBe(400);
  });
  test("Bearer: 401 / 503 / 405; the route is wired", async () => {
    const s = await setup();
    expect((await postTx(s, { day: DAY, tx: TX }, null)).status).toBe(401);
    expect((await handleBotRecordTx(s.req("/api/bot/record/tx", "GET"), s.env)).status).toBe(405);
    const u = await setup("");
    expect((await postTx(u, { day: DAY, tx: TX })).status).toBe(503);
    const res = await txRoute({ request: s.req("/api/bot/record/tx", "POST", {}, null), env: s.env, data: {}, next: async () => new Response(), waitUntil: () => {}, params: {} });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/record", () => {
  test("serves exactly the stored bytes, immutable for a year", async () => {
    const s = await setup();
    await s.snapshot();
    const rec = JSON.parse((await s.kv.get(`record:${DAY}`))!) as { json: string; digest: string };
    const r = await handlePublicRecord(s.req(`/api/record/${DAY}.json`, "GET"), s.env, `${DAY}.json`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(bytes).toEqual(new TextEncoder().encode(rec.json));
    expect(await sha256Hex(new TextDecoder().decode(bytes))).toBe(rec.digest);
  });
  test("404 for an unknown day, a day without .json, or a malformed one; 405 for POST", async () => {
    const s = await setup();
    for (const d of ["2026-10-04.json", DAY, "nope.json", "2026-02-30.json"]) expect((await handlePublicRecord(s.req(`/api/record/${d}`, "GET"), s.env, d)).status, d).toBe(404);
    expect((await handlePublicRecord(s.req("/api/record", "POST"), s.env, "")).status).toBe(405);
  });
  test("the index is edge-cached for 60 s and empty when nothing is recorded", async () => {
    const s = await setup();
    const cache = new MemoryCache() as unknown as Cache;
    const empty = await handlePublicRecord(s.req("/api/record", "GET"), s.env, "", { cache });
    expect(await empty.json()).toEqual([]);
    const cached = await handlePublicRecord(s.req("/api/record", "GET"), s.env, "", { cache });
    expect(cached.headers.get("cache-control")).toBe("public, max-age=60");
    await s.snapshot();
    const fresh = await handlePublicRecord(s.req("/api/record", "GET"), s.env, "");
    const body = (await fresh.json()) as { day: string; tx: null }[];
    expect(body.map((d) => d.day)).toEqual([DAY]);
    expect(fresh.headers.get("cache-control")).toBe("public, max-age=60");
  });
  test("the route is wired", async () => {
    const s = await setup();
    await s.snapshot();
    const res = await publicRoute({ request: s.req(`/api/record/${DAY}.json`, "GET"), env: s.env, data: {}, next: async () => new Response(), waitUntil: () => {}, params: { day: `${DAY}.json` } });
    expect(res.status).toBe(200);
    const idx = await publicRoute({ request: s.req("/api/record", "GET"), env: s.env, data: {}, next: async () => new Response(), waitUntil: () => {}, params: {} });
    expect(idx.status).toBe(200);
  });
});
