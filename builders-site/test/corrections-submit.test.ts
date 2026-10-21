import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const E: ArcEntity[] = [
  { slug: "visa", name: "Visa", category: "payments", status: "announced", summary: "Payments.", website: "https://www.visa.com/", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://visa.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const ORIGIN = "https://builder.registrai.cc";
const db = () => new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
const env = (o: Record<string, unknown> = {}) => ({ INVITES: new MemoryKV(), DATA_DB: db(), SITE_ORIGIN: ORIGIN, NONCE_SECRET: "s", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret", ...o }) as never;
const good = { slug: "visa", field: "summary", text: "The summary should say the pilot is live.", source_url: "https://visa.com/news", email: "ana@visa.com", name: "Ana, comms", "cf-turnstile-response": "tok" };
const post = (fields: Record<string, string> = good, h: Record<string, string> = {}) => new Request(`${ORIGIN}/api/ecosystem/corrections`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": "1.2.3.4", ...h }, body: new URLSearchParams(fields).toString() });
const turnstile = (success: boolean) => vi.fn(async () => new Response(JSON.stringify({ success })));

describe("parseCorrection", () => {
  test("rules", async () => {
    const { parseCorrection } = await import("../lib/corrections");
    const slugs = new Set(["visa"]);
    const p = (o: Record<string, string>) => parseCorrection(new URLSearchParams({ ...good, ...o }), slugs);
    expect(p({})).toMatchObject({ ok: true, value: { slug: "visa", field: "summary", email: "ana@visa.com", name: "Ana, comms" } });
    expect(p({ slug: "nobody" })).toEqual({ ok: false, code: "slug" });
    expect(p({ field: "price" })).toEqual({ ok: false, code: "field" });
    expect(p({ text: "short" })).toEqual({ ok: false, code: "text" });
    expect(p({ text: "x".repeat(1001) })).toEqual({ ok: false, code: "text" });
    expect(p({ field: "status", source_url: "" })).toEqual({ ok: false, code: "source_required" });
    expect(p({ source_url: "javascript:alert(1)" })).toEqual({ ok: false, code: "source" });
    expect(p({ source_url: "http://visa.com" })).toEqual({ ok: false, code: "source" });
    expect(p({ email: "not-an-email" })).toEqual({ ok: false, code: "email" });
    expect(p({ name: "n".repeat(101) })).toEqual({ ok: false, code: "name" });
    expect(p({ source_url: "", name: "" })).toMatchObject({ ok: true, value: { source_url: null, name: null } });
  });
  test("domainMatch: same host, www, subdomain; not a lookalike", async () => {
    const { domainMatch } = await import("../lib/corrections");
    expect(domainMatch("a@visa.com", "https://www.visa.com/")).toBe(true);
    expect(domainMatch("a@eu.visa.com", "https://visa.com/")).toBe(true);
    expect(domainMatch("a@notvisa.com", "https://visa.com/")).toBe(false);
    expect(domainMatch("a@visa.com", undefined)).toBe(false);
  });
});

describe("POST /api/ecosystem/corrections", () => {
  test("stores one open row with domain_match, a hashed IP and no raw IP; 303 to ?sent=1", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const e = env(), f = turnstile(true);
    const r = await handleCorrectionPost(post(), e, f as never, 1_800_000_000_000);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/ecosystem/visa/correct/?sent=1");
    const rows = (e as { DATA_DB: MemoryD1 }).DATA_DB.q<Record<string, unknown>>("SELECT * FROM corrections");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "visa", field: "summary", status: "open", domain_match: 1, email: "ana@visa.com", created_at: 1_800_000_000 });
    expect(String(rows[0].ip_hash)).not.toContain("1.2.3.4");
    expect(f).toHaveBeenCalledTimes(1);
  });
  test("Accept: application/json gets 201 {id}", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const r = await handleCorrectionPost(post(good, { accept: "application/json" }), env(), turnstile(true) as never);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: 1 });
  });
  test("bad field → 303 ?error=field before Turnstile is called; failed Turnstile → ?error=antibot", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const f = turnstile(true);
    const r = await handleCorrectionPost(post({ ...good, field: "price" }), env(), f as never);
    expect(r.headers.get("location")).toBe("/ecosystem/visa/correct/?error=field");
    expect(f).not.toHaveBeenCalled();
    const r2 = await handleCorrectionPost(post(), env(), turnstile(false) as never);
    expect(r2.headers.get("location")).toBe("/ecosystem/visa/correct/?error=antibot");
  });
  test("unknown slug → 400 (nowhere to redirect); body over 4 KB → 400", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    expect((await handleCorrectionPost(post({ ...good, slug: "nobody" }), env(), turnstile(true) as never)).status).toBe(400);
    expect((await handleCorrectionPost(post({ ...good, text: "x".repeat(5000) }), env(), turnstile(true) as never)).status).toBe(400);
  });
  test("rate limits: 4th from one email in a day and 6th from one IP in an hour → ?error=rate", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const e = env(), f = turnstile(true), t = 1_800_000_000_000;
    for (let i = 0; i < 3; i++) expect((await handleCorrectionPost(post(), e, f as never, t)).headers.get("location")).toMatch(/sent=1/);
    expect((await handleCorrectionPost(post(), e, f as never, t)).headers.get("location")).toMatch(/error=rate/);   // email: 3 a day (4th IP attempt)
    expect((await handleCorrectionPost(post({ ...good, email: "b@x.com" }), e, f as never, t)).headers.get("location")).toMatch(/sent=1/);   // 5th IP attempt
    expect((await handleCorrectionPost(post({ ...good, email: "c@x.com" }), e, f as never, t)).headers.get("location")).toMatch(/error=rate/);   // IP: 5 an hour
  });
  test("cross-origin → 403; JSON or other content type → 415; GET → 405", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    expect((await handleCorrectionPost(post(good, { origin: "https://evil.example" }), env(), turnstile(true) as never)).status).toBe(403);
    expect((await handleCorrectionPost(post(good, { "content-type": "application/json" }), env(), turnstile(true) as never)).status).toBe(415);
    expect((await handleCorrectionPost(new Request(`${ORIGIN}/api/ecosystem/corrections`), env(), turnstile(true) as never)).status).toBe(405);
  });
  test("no Turnstile keys or no DATA_DB → 503 and nothing stored", async () => {
    const { handleCorrectionPost, correctionsOpen } = await import("../lib/corrections");
    expect(correctionsOpen(env({ TURNSTILE_SECRET: undefined }))).toBe(false);
    expect(correctionsOpen(env({ DATA_DB: undefined }))).toBe(false);
    expect((await handleCorrectionPost(post(), env({ TURNSTILE_SITE_KEY: undefined }), turnstile(true) as never)).status).toBe(503);
  });
});
