import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { handleIndexHourly, handleIndices, parseWindow } from "../lib/data-api";
import { ABI_INDICES, type AbiData } from "../../src/lib/builders-index";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import fixtureIndices from "../../docs/superpowers/specs/data-api-v1-fixtures/indices.json";
import { MemoryCache } from "./memory-cache";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";
import { handleMemberHourly, handleMembers, handleMembersHourly, handleMembersNew } from "../lib/data-api";
import fixtureMembers from "../../docs/superpowers/specs/data-api-v1-fixtures/members-aii.json";
import fixtureMemberHourly from "../../docs/superpowers/specs/data-api-v1-fixtures/member-hourly.json";
import fixtureMembersHourly from "../../docs/superpowers/specs/data-api-v1-fixtures/members-hourly-aii.json";

// /members joins /verified; keep these tests off the real chain (data-api-verified has its own tests)
vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set<string>() }));

const O = "https://builder.registrai.cc";
const H = (s: string) => Date.parse(s) / 3600e3;
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${O}${path}`, { headers });
/** Recursive key shape, to compare a response with its contract fixture. */
const shape = (v: unknown): unknown => Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]).sort()) : typeof v;

async function seeded() {
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  const kv = new MemoryKV();
  for (const id of ["abi", "aii", "aei"] as const) {
    const f = indexFixture();
    await kv.put(ABI_INDICES[id].key, JSON.stringify({ ...f, data_until: "2026-10-14T21:00:00Z", index_24h_ago: 962.64,
      candles: [["2026-10-13T20:00:00Z", 1, 1, 1, 962.641, 0, 0, 0], ["2026-10-14T20:00:00Z", 1, 1, 1, 961.013, 0, 0, 0]] }));
    for (let h = H("2026-10-13T22:00:00Z"); h <= H("2026-10-14T21:00:00Z"); h++)
      db.sqlite.prepare("INSERT INTO index_hour (idx, hour, close) VALUES (?, ?, ?)").all(id, h, 960 + (h % 7) / 1000);
  }
  return { env: { INVITES: kv, DATA_DB: db } as never, db };
}

describe("v1 helpers", () => {
  test("parseWindow: defaults, inclusive bounds, caps and errors", () => {
    const until = H("2026-10-14T21:00:00Z"), u = (q: string) => new URL(`${O}/x?${q}`);
    expect(parseWindow(u(""), until, 744)).toEqual({ from: until - 743, to: until });
    expect(parseWindow(u("from=2026-10-14T19:00:00Z"), until, 744)).toEqual({ from: until - 2, to: until });
    expect(parseWindow(u("to=2026-10-14T19:00:00Z"), until, 168)).toEqual({ from: until - 2 - 167, to: until - 2 });
    expect(parseWindow(u("from=2026-10-14T19:00:00Z&to=2026-10-14T19:00:00Z"), until, 168)).toEqual({ from: until - 2, to: until - 2 });
    for (const q of ["from=2026-10-14T19:30:00Z", "from=497779", "from=2026-10-14T21:00:00Z&to=2026-10-14T19:00:00Z", "from=2026-09-01T00:00:00Z&to=2026-10-14T21:00:00Z"])
      expect(parseWindow(u(q), until, 168)).toHaveProperty("error");
  });
});

describe("/api/v1/indices", () => {
  test("matches the contract fixture's shape; closes at 3 dp from candles; params; data_until", async () => {
    const { env } = await seeded();
    const r = await handleIndices(get("/api/v1/indices"), env, { cache: null });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const body = await r.json();
    expect(shape(body)).toEqual(shape(fixtureIndices));
    expect(body.indices.abi.close).toBe(961.013);
    expect(body.data_until).toBe("2026-10-14T21:00:00Z");
  });
  test("405 on POST; 503 when an index file is missing", async () => {
    const { env } = await seeded();
    expect((await handleIndices(new Request(`${O}/api/v1/indices`, { method: "POST" }), env, { cache: null })).status).toBe(405);
    await (env as { INVITES: MemoryKV }).INVITES.delete(ABI_INDICES.aei.key);
    expect((await handleIndices(get("/api/v1/indices"), env, { cache: null })).status).toBe(503);
  });
});

describe("/api/v1/indices/{id}/hourly", () => {
  test("rows oldest first, inclusive window; etag and 304", async () => {
    const { env } = await seeded();
    const r = await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T20:00:00Z&to=2026-10-14T21:00:00Z"), env, "abi", { cache: null });
    const body = await r.json();
    expect(body).toMatchObject({ version: 1, index: "abi", data_until: "2026-10-14T21:00:00Z" });
    expect(body.rows.map((x: { hour_close: string }) => x.hour_close)).toEqual(["2026-10-14T20:00:00Z", "2026-10-14T21:00:00Z"]);
    expect(Object.keys(body.rows[0]).sort()).toEqual(["close", "hour", "hour_close"]);
    const etag = r.headers.get("etag")!;
    expect((await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T20:00:00Z&to=2026-10-14T21:00:00Z", { "if-none-match": etag }), env, "abi", { cache: null })).status).toBe(304);
  });
  test("the edge cache keeps different queries apart, and a cached 200 still answers if-none-match with 304", async () => {
    const { env } = await seeded();
    const cache = new MemoryCache() as unknown as Cache;
    const a = await (await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T21:00:00Z"), env, "abi", { cache })).json();
    const b = await (await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T20:00:00Z"), env, "abi", { cache })).json();
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(2);
    const first = await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T21:00:00Z"), env, "abi", { cache });
    expect((await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T21:00:00Z", { "if-none-match": first.headers.get("etag")! }), env, "abi", { cache })).status).toBe(304);
  });
  test("400 on a bad window; 503 without DATA_DB or with no rows", async () => {
    const { env } = await seeded();
    expect((await handleIndexHourly(get("/api/v1/indices/abi/hourly?from=2026-10-14T21:30:00Z"), env, "abi", { cache: null })).status).toBe(400);
    expect((await handleIndexHourly(get("/api/v1/indices/abi/hourly"), { ...(env as object), DATA_DB: undefined } as never, "abi", { cache: null })).status).toBe(503);
    const empty = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    expect((await handleIndexHourly(get("/api/v1/indices/abi/hourly"), { ...(env as object), DATA_DB: empty } as never, "abi", { cache: null })).status).toBe(503);
  });
});

async function seededMembers() {
  const s = await seeded();
  const f = indexFixture() as unknown as AbiData;
  const ids = f.projects.map((p) => p.source);
  const P = Object.fromEntries(ids.map((id, i) => [id, 100 + i + 0.123456789]));
  for (const idx of ["abi", "aii", "aei"] as const)
    await (s.env as { INVITES: MemoryKV }).INVITES.put(ABI_INDICES[idx].key, JSON.stringify({ ...f, data_until: "2026-10-14T21:00:00Z", live: { P }, candles: [["2026-10-14T20:00:00Z", 1, 1, 1, 961.013, 0, 0, 0]] }));
  for (const [i, id] of ids.entries())
    for (let h = H("2026-10-14T19:00:00Z") + (i === 1 ? 2 : 0); h <= H("2026-10-14T21:00:00Z"); h++)
      s.db.sqlite.prepare("INSERT INTO member_hour VALUES ('abi', ?, ?, ?, 1.5, 3, 2, 0, 12.5)").all(id, h, 100 + i);
  return { ...s, ids };
}

describe("/api/v1/members*", () => {
  test("/members: fixture shape, stock from live.P, first_hour from history", async () => {
    const { env, ids } = await seededMembers();
    const body = await (await handleMembers(get("/api/v1/members?index=abi"), env, "abi", { cache: null })).json();
    expect(shape(body)).toEqual(shape(fixtureMembers));
    const m = body.members.find((x: { id: string }) => x.id === ids[1]);
    expect(m.points).toBe(101.123456789);
    expect(m.first_hour).toBe("2026-10-14T21:00:00Z");
  });
  test("/members/{id}/hourly: an encoded id with ':' and '.' decodes; unknown id is 404; fixture shape", async () => {
    const { env, ids } = await seededMembers();
    const enc = encodeURIComponent(ids[0]);
    const r = await handleMemberHourly(get(`/api/v1/members/${enc}/hourly?index=abi`), env, "abi", ids[0], { cache: null });
    const body = await r.json();
    expect(shape(body)).toEqual(shape(fixtureMemberHourly));
    expect(body.rows).toHaveLength(3);
    expect((await handleMemberHourly(get("/api/v1/members/domain%3Anope.example/hourly?index=abi"), env, "abi", "domain:nope.example", { cache: null })).status).toBe(404);
  });
  test("/members/hourly: one call returns every member's rows for a range, ordered by hour then id; 168 h cap", async () => {
    const { env } = await seededMembers();
    const body = await (await handleMembersHourly(get("/api/v1/members/hourly?index=abi&from=2026-10-14T19:00:00Z&to=2026-10-14T21:00:00Z"), env, "abi", { cache: null })).json();
    expect(shape(body)).toEqual(shape(fixtureMembersHourly));
    const keys = body.rows.map((r: { hour: number; id: string }) => `${r.hour}|${r.id}`);
    expect(keys).toEqual([...keys].sort());
    expect((await handleMembersHourly(get("/api/v1/members/hourly?index=abi&from=2026-10-01T00:00:00Z&to=2026-10-14T21:00:00Z"), env, "abi", { cache: null })).status).toBe(400);
  });
  test("/members/new: members first seen after since; since is required", async () => {
    const { env, ids } = await seededMembers();
    const body = await (await handleMembersNew(get("/api/v1/members/new?index=abi&since=2026-10-14T20:00:00Z"), env, "abi", { cache: null })).json();
    expect(body.members.map((m: { id: string }) => m.id)).toEqual([ids[1]]);
    expect((await handleMembersNew(get("/api/v1/members/new?index=abi"), env, "abi", { cache: null })).status).toBe(400);
  });
});
describe("/api/v1/members route", () => {
  test("an encoded id path segment reaches the handler decoded; index is required", async () => {
    const { onRequest } = await import("../functions/api/v1/members/[[path]]");
    const { env, ids } = await seededMembers();
    const ctx = (path: string, params: string[]) => ({ request: get(path), env, params: { path: params }, waitUntil: () => undefined }) as never;
    const enc = encodeURIComponent(ids[0]);
    const r = await onRequest(ctx(`/api/v1/members/${enc}/hourly?index=abi`, [enc, "hourly"]));
    expect(r.status).toBe(200);
    expect((await r.json()).id).toBe(ids[0]);
    expect((await onRequest(ctx(`/api/v1/members/${enc}/hourly`, [enc, "hourly"]))).status).toBe(400);
    expect((await onRequest(ctx("/api/v1/members/x/y/z?index=abi", ["x", "y", "z"]))).status).toBe(404);
  });
});
