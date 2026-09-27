import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import {
  SUGGEST_MAX_BODY,
  SUGGEST_RATE_LIMIT,
  SUGGEST_TTL_S,
  handleAdminSuggestions,
  handleSuggest,
  listSuggestions,
} from "../lib/suggestions";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const acme = { name: "Acme Tool", website: "https://acme.dev", x: "@acmetool", github: "acme/tool" };

function setup() {
  let now = T0;
  const kv = new MemoryKV(() => now);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN, NONCE_SECRET: "test-secret" };
  const post = async (body: unknown, o: { ip?: string; origin?: string; type?: string } = {}) => {
    const res = await handleSuggest(
      new Request(`${ORIGIN}/api/suggestions`, {
        method: "POST",
        headers: { "content-type": o.type ?? "application/json", origin: o.origin ?? ORIGIN, "cf-connecting-ip": o.ip ?? "203.0.113.1" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
      { now },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const admin = async (method: string, query = "") => {
    const res = await handleAdminSuggestions(new Request(`${ORIGIN}/api/admin/suggestions${query}`, { method }), env);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { kv, env, post, admin, advance: (ms: number) => (now += ms) };
}

describe("POST /api/suggestions", () => {
  test("a valid suggestion is stored under the project's key, with one suggester", async () => {
    const { post, kv } = setup();
    const r = await post(acme);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, source: "github:acme/tool", count: 1 });
    const stored = kv.store.get("suggest:github:acme/tool")!;
    const rec = JSON.parse(stored.value);
    expect(rec).toMatchObject({
      source: "github:acme/tool",
      name: "Acme Tool",
      website: "https://acme.dev",
      github: "github:acme/tool",
      x: "@acmetool",
      count: 1,
      firstAt: new Date(T0).toISOString(),
      lastAt: new Date(T0).toISOString(),
    });
    expect(stored.expiresAt).toBe(T0 + SUGGEST_TTL_S * 1000);
    // the visitor is stored only as a keyed hash, never the IP
    expect(stored.value).not.toContain("203.0.113.1");
  });

  test("an invalid suggestion is refused with the field to fix, and nothing is stored", async () => {
    const { post, kv } = setup();
    const r = await post({ name: "Acme", website: "https://acme.dev" });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ field: "x" });
    expect([...kv.store.keys()].filter((k) => k.startsWith("suggest:"))).toEqual([]);
  });

  test("CSRF: cross-origin or non-JSON posts are refused", async () => {
    const { post } = setup();
    expect((await post(acme, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(acme, { type: "text/plain" })).status).toBe(403);
  });

  test("an oversized body is refused", async () => {
    const { post } = setup();
    expect((await post({ ...acme, why: "a".repeat(SUGGEST_MAX_BODY) })).status).toBe(413);
  });

  test("more people suggesting a project raise its count; the same visitor does not", async () => {
    const { post, advance } = setup();
    await post(acme, { ip: "203.0.113.1" });
    advance(60_000);
    expect((await post(acme, { ip: "203.0.113.1" })).body).toMatchObject({ count: 1 });
    expect((await post(acme, { ip: "203.0.113.2" })).body).toMatchObject({ count: 2 });
    expect((await post({ ...acme, github: "https://github.com/Acme/Tool" }, { ip: "203.0.113.3" })).body).toMatchObject({ count: 3 });
  });

  test("the first suggestion's details stand; a later one only fills what was missing", async () => {
    const { post, kv } = setup();
    await post({ name: "Acme Tool", website: "https://acme.dev", x: "@acmetool" }, { ip: "203.0.113.1" });
    await post({ name: "SCAM", website: "https://acme.dev", x: "@impostor", social: "https://t.me/acme", by: "@bob" }, { ip: "203.0.113.2" });
    const rec = JSON.parse(kv.store.get("suggest:domain:acme.dev")!.value);
    expect(rec).toMatchObject({ name: "Acme Tool", x: "@acmetool", social: "https://t.me/acme", by: ["@bob"], count: 2 });
  });

  test("a project already invited is acknowledged without a write", async () => {
    const { post, kv } = setup();
    await kv.put("invite:github:acme/tool", JSON.stringify({ source: "github:acme/tool", code: "x" }));
    const r = await post(acme);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, invited: true });
    expect(kv.store.has("suggest:github:acme/tool")).toBe(false);
  });

  test(`one visitor can send at most ${SUGGEST_RATE_LIMIT} suggestions an hour`, async () => {
    const { post, advance } = setup();
    for (let i = 0; i < SUGGEST_RATE_LIMIT; i++) {
      expect((await post({ ...acme, github: undefined, website: `https://p${i}.dev` })).status).toBe(200);
    }
    expect((await post({ ...acme, github: undefined, website: "https://one-more.dev" })).status).toBe(429);
    expect((await post({ ...acme, github: undefined, website: "https://other-visitor.dev" }, { ip: "203.0.113.9" })).status).toBe(200);
    advance(3600_000 + 1);
    expect((await post({ ...acme, github: undefined, website: "https://later.dev" })).status).toBe(200);
  });
});

describe("/api/admin/suggestions", () => {
  test("GET lists every suggestion, most suggested first; the visitor hashes stay private", async () => {
    const { post, admin, env } = setup();
    await post({ name: "Once", website: "https://once.dev", x: "@once" }, { ip: "203.0.113.1" });
    await post(acme, { ip: "203.0.113.1" });
    await post(acme, { ip: "203.0.113.2" });
    const r = await admin("GET");
    expect(r.status).toBe(200);
    const list = r.body.suggestions as Record<string, unknown>[];
    expect(list.map((s) => s.source)).toEqual(["github:acme/tool", "domain:once.dev"]);
    expect(list[0]).not.toHaveProperty("voters");
    expect(await listSuggestions(env.INVITES)).toHaveLength(2);
  });

  test("DELETE dismisses one suggestion", async () => {
    const { post, admin, kv } = setup();
    await post(acme);
    expect((await admin("DELETE", "?source=github:acme/tool")).status).toBe(200);
    expect(kv.store.has("suggest:github:acme/tool")).toBe(false);
    expect((await admin("DELETE", "?source=nonsense")).status).toBe(400);
  });
});
