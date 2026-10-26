import { describe, expect, test, vi } from "vitest";
import { indexEntities as ix } from "../../src/lib/arc-ecosystem";
import { FACTS_SITEMAP_KEY, INDEXNOW_KEY, factPages, pingIndexNow, shouldPing } from "../lib/sitemap-urls";
import { handleAdminFacts } from "../lib/facts";
import { handleAdminProject } from "../lib/projects";
import { MemoryKV } from "./memory-kv";

const fact = (o: Record<string, unknown> = {}) => ({ id: "f1", topic: "control", text: "x", evidence: ["0x29316db42ff99f640fd4d1bb169635b6318cd430"], observedAt: "2026-10-01T00:00:00Z", ...o });
const rec = (source: string, facts: unknown[]) => JSON.stringify({ source, facts, changelog: [], lastReviewedAt: "2026-10-02T00:00:00Z", reviewedBy: "x", rev: 1 });
const NOW = Date.parse("2026-10-17T12:00:00Z");

class CountingKV extends MemoryKV { lists = 0; override async list<M>(o?: { prefix?: string; cursor?: string; limit?: number }) { this.lists++; return super.list<M>(o); } }

describe("facts pages in the sitemap", () => {
  test("only projects with public facts; built once, then read from one key until it is a day old", async () => {
    const kv = new CountingKV();
    await kv.put("facts:domain:a.b", rec("domain:a.b", [fact()]), { metadata: { source: "domain:a.b" } });
    await kv.put("facts:domain:later.b", rec("domain:later.b", [fact({ publishAt: "2026-12-01T00:00:00Z" })]), { metadata: { source: "domain:later.b" } });
    await kv.put("facts:domain:empty.b", rec("domain:empty.b", []), { metadata: { source: "domain:empty.b" } });
    const env = { INVITES: kv } as never;
    const got = await factPages(env, NOW);
    expect(got).toEqual([{ path: "/project/domain/a.b/", lastmod: "2026-10-01T00:00:00.000Z" }]);
    const perBuild = kv.lists; // facts: and project: listings
    expect(perBuild).toBe(2);
    await factPages(env, NOW + 3600e3);
    expect(kv.lists).toBe(perBuild);
    await factPages(env, NOW + 25 * 3600e3);
    expect(kv.lists).toBe(2 * perBuild);
  });

  test("a project with only a public profile is listed too (its page shows the profile)", async () => {
    const kv = new MemoryKV();
    await kv.put("project:domain:p.b", JSON.stringify({ source: "domain:p.b", name: "P", metrics: [], deployers: [], contracts: [], declaredBy: "0x", declaredAt: "2026-10-05T00:00:00.000Z" }), { metadata: { source: "domain:p.b" } });
    expect(await factPages({ INVITES: kv } as never, NOW)).toEqual([{ path: "/project/domain/p.b/", lastmod: "2026-10-05T00:00:00.000Z" }]);
  });

  test("an admin profile save resets the list", async () => {
    const kv = new MemoryKV();
    await kv.put(FACTS_SITEMAP_KEY, JSON.stringify({ built: NOW, pages: [] }));
    const req = new Request("https://builder.registrai.cc/api/admin/projects/domain%3Ap.b", { method: "PUT", body: JSON.stringify({ source: "domain:p.b", name: "P", website: "https://p.b", metrics: [], deployers: [], contracts: [] }) });
    const r = await handleAdminProject(req, { INVITES: kv } as never, "domain:p.b", "0xabc", { now: NOW });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await kv.get(FACTS_SITEMAP_KEY)).toBeNull();
  });

  test("an admin save resets the list", async () => {
    const kv = new MemoryKV();
    await kv.put(FACTS_SITEMAP_KEY, JSON.stringify({ built: NOW, pages: [] }));
    const req = new Request("https://builder.registrai.cc/api/admin/facts/domain%3Aa.b", { method: "PUT", body: JSON.stringify({ rev: 0, facts: [fact()] }) });
    expect((await handleAdminFacts(req, { INVITES: kv } as never, "domain:a.b", "0xabc", "admin", { now: NOW })).status).toBe(200);
    expect(await kv.get(FACTS_SITEMAP_KEY)).toBeNull();
  });
});

describe("IndexNow", () => {
  test("pings once a day, after the 00:00 UTC close", () => {
    expect(shouldPing("2026-10-17T00:00:00Z")).toBe(true);
    expect(shouldPing("2026-10-17T13:00:00Z")).toBe(false);
  });

  test("posts the URL list with the key and its location; a failure never throws", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    await pingIndexNow(["https://builder.registrai.cc/apps/"], async (url, init) => { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(null, { status: 202 }); });
    expect(sent[0].url).toBe("https://api.indexnow.org/indexnow");
    expect(sent[0].body).toEqual({ host: "builder.registrai.cc", key: INDEXNOW_KEY, keyLocation: `https://builder.registrai.cc/${INDEXNOW_KEY}.txt`, urlList: ["https://builder.registrai.cc/apps/"] });
    await expect(pingIndexNow(["x"], async () => { throw new Error("down"); })).resolves.toBeUndefined();
  });

  test("the key file is served at /<key>.txt", async () => {
    const { onRequest } = await import("../functions/10dec8b5c4706a0c957248ee188ce526.txt");
    expect(await (await onRequest({ request: new Request(`https://builder.registrai.cc/${INDEXNOW_KEY}.txt`) } as never)).text()).toBe(INDEXNOW_KEY);
  });
});

vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: ix([{ slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "A game.",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://archery.wtf/" }],
  index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf", last_reviewed: "2026-10-20" }]), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

describe("entity lastmod", () => {
  test("an index member's page follows the hourly data; any other page its review date", async () => {
    const { entityLastmod } = await import("../lib/sitemap-urls");
    expect(entityLastmod({ last_reviewed: "2026-10-20", index_ids: ["domain:a.b"] }, "2026-10-26T12:00:00Z")).toBe("2026-10-26T12:00:00Z");
    expect(entityLastmod({ last_reviewed: "2026-10-20" }, "2026-10-26T12:00:00Z")).toBe("2026-10-20");
    expect(entityLastmod({ last_reviewed: "2026-10-20", index_ids: ["domain:a.b"] }, undefined)).toBe("2026-10-20");
  });
});

describe("ecosystem in the sitemap", () => {
  test("directory, non-empty categories and entity pages; claimed /apps pages are left out", async () => {
    const { sitemapUrls } = await import("../lib/sitemap-urls");
    const kv = new MemoryKV();
    const urls = await sitemapUrls({ INVITES: kv, DATA_DB: undefined } as never, { cache: null }, NOW);
    const locs = urls.map((u) => u.loc);
    expect(urls).toContainEqual({ loc: "https://builder.registrai.cc/ecosystem/", lastmod: "2026-10-20" });
    expect(locs).toContain("https://builder.registrai.cc/ecosystem/consumer/");
    for (const p of ["most-used-apps", "apps-that-accept-usdc", "new", "get-usdc"]) expect(locs).toContain(`https://builder.registrai.cc/arc/${p}/`);
    expect(urls).toContainEqual({ loc: "https://builder.registrai.cc/ecosystem/corrections/", lastmod: "2026-10-20" });
    expect(locs).not.toContain("https://builder.registrai.cc/ecosystem/banks/");
    expect(urls).toContainEqual({ loc: "https://builder.registrai.cc/ecosystem/archery/", lastmod: "2026-10-20" });
    expect(locs).not.toContain("https://builder.registrai.cc/apps/domain/archery.wtf/");
    expect(locs).toContain("https://builder.registrai.cc/arc/");
  });
  test("a project page the directory claims (it 301s) is left out; an unclaimed one stays", async () => {
    const { sitemapUrls } = await import("../lib/sitemap-urls");
    const kv = new MemoryKV();
    const prof = (s: string) => JSON.stringify({ source: s, name: "P", metrics: [], deployers: [], contracts: [], declaredBy: "0x", declaredAt: "2026-10-05T00:00:00.000Z" });
    await kv.put("project:domain:archery.wtf", prof("domain:archery.wtf"), { metadata: { source: "domain:archery.wtf" } });
    await kv.put("project:domain:other.app", prof("domain:other.app"), { metadata: { source: "domain:other.app" } });
    const locs = (await sitemapUrls({ INVITES: kv, DATA_DB: undefined } as never, { cache: null }, NOW)).map((u) => u.loc);
    expect(locs).not.toContain("https://builder.registrai.cc/project/domain/archery.wtf/");
    expect(locs).toContain("https://builder.registrai.cc/project/domain/other.app/");
  });
});
