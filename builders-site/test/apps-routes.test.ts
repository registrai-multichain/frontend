import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { ABI_INDICES, type AbiData } from "../../src/lib/builders-index";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set(["domain:archery.wtf"]) }));
const H = (s: string) => Date.parse(s) / 3600e3;
void readFileSync;

async function seeded() {
  const kv = new MemoryKV();
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  const f = indexFixture() as unknown as AbiData;
  const projects = [
    { ...f.projects[0], source: "domain:archery.wtf", name: "Archery", kind: "project", share: 2, contracts: 3, pts_24h: 10, pay_24h: 5, usdc_24h: 50 },
    { ...f.projects[0], source: "integration:uniswap", name: "Uniswap", kind: "integration", share: 9, contracts: 900, pts_24h: 99, pay_24h: 50, usdc_24h: 5000 },
  ];
  const P = { "domain:archery.wtf": 9.2, "integration:uniswap": 4000 };
  const file = (ps: typeof projects) => JSON.stringify({ ...f, data_until: "2026-10-14T21:00:00Z", projects: ps, live: { P },
    volume_24h: { USDC: { members_usd: 5050, members_payments: 55, base_usd_est: 500000, base_transfers_est: 900 } } });
  await kv.put(ABI_INDICES.aei.key, file(projects));
  await kv.put(ABI_INDICES.abi.key, file([projects[0]]));
  await kv.put(ABI_INDICES.aii.key, file([projects[1]]));
  await kv.put("facts:domain:archery.wtf", JSON.stringify({ source: "domain:archery.wtf", facts: [{ id: "f1", kind: "control", text: "x", evidence: [] }], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 1 }));
  db.sqlite.prepare("INSERT INTO index_hour VALUES ('aei', ?, 990)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_hour VALUES ('aei', 'domain:archery.wtf', ?, 9.2, 11, 5, 3, 1, 50)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_first VALUES ('aei', 'domain:archery.wtf', ?)").all(H("2026-10-11T19:00:00Z"));
  return { env: { INVITES: kv, DATA_DB: db } as never };
}

describe("routes", () => {
test("/apps/ 200 HTML with numbers; ?sort=evil same as default; /apps redirects; unknown app 404; POST 405", async () => {
  const { onRequest } = await import("../functions/apps/[[path]]");
  const { env } = await seeded();
  const ctx = (path: string, params: string[], method = "GET") => ({ request: new Request(`https://builder.registrai.cc${path}`, { method }), env, params: { path: params }, waitUntil: () => undefined }) as never;
  const r = await onRequest(ctx("/apps/", []));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/html");
  const html = await r.text();
  expect(html).toContain("Archery");
  expect(await (await onRequest(ctx("/apps/?sort=evil", []))).text()).toBe(html);
  expect((await onRequest(ctx("/apps", []))).status).toBe(301);
  expect((await onRequest(ctx("/apps/domain/nope.example/", ["domain", "nope.example"]))).status).toBe(404);
  expect((await onRequest(ctx("/apps/domain/archery.wtf/", ["domain", "archery.wtf"]))).status).toBe(200);
  expect((await onRequest(ctx("/apps/", [], "POST"))).status).toBe(405);
});
test("sitemap lists every app page; llms.txt names the API and MCP", async () => {
  const { onRequest: sm } = await import("../functions/sitemap.xml");
  const { onRequest: llms } = await import("../functions/llms.txt");
  const { env } = await seeded();
  const ctx = (p: string) => ({ request: new Request(`https://builder.registrai.cc${p}`), env, params: {}, waitUntil: () => undefined }) as never;
  const xml = await (await sm(ctx("/sitemap.xml"))).text();
  expect(xml).toContain("<loc>https://builder.registrai.cc/apps/domain/archery.wtf/</loc>");
  expect(xml).toContain("<loc>https://builder.registrai.cc/apps/</loc>");
  const t = await (await llms(ctx("/llms.txt"))).text();
  expect(t).toContain("https://builder.registrai.cc/api/v1/openapi.json");
  expect(t).toContain("https://builder.registrai.cc/api/mcp");
});

});

test("I1: sitemap is GET/HEAD only; llms.txt makes no claim the pages don't keep", async () => {
  const { onRequest: sm } = await import("../functions/sitemap.xml");
  const { LLMS_TXT } = await import("../functions/llms.txt");
  const { env } = await seeded();
  expect((await sm({ request: new Request("https://builder.registrai.cc/sitemap.xml", { method: "POST" }), env, params: {}, waitUntil: () => undefined } as never)).status).toBe(405);
  expect(LLMS_TXT).not.toContain("Every number links to the chain");
});

test("sitemap: data pages carry lastmod = data_until; noindexed /verify/ is out; guide, terms, privacy are in", async () => {
  const { onRequest: sm } = await import("../functions/sitemap.xml");
  const { env } = await seeded();
  const xml = await (await sm({ request: new Request("https://builder.registrai.cc/sitemap.xml"), env, params: {}, waitUntil: () => undefined } as never)).text();
  expect(xml).toContain("<url><loc>https://builder.registrai.cc/apps/domain/archery.wtf/</loc><lastmod>2026-10-14T21:00:00Z</lastmod></url>");
  expect(xml).toContain("<url><loc>https://builder.registrai.cc/builders-index/</loc><lastmod>2026-10-14T21:00:00Z</lastmod></url>");
  expect(xml).not.toContain("/verify/");
  for (const p of ["/guide/", "/terms/", "/privacy/"]) expect(xml).toContain(`<loc>https://builder.registrai.cc${p}</loc>`);
});
