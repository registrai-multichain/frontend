import { describe, expect, test, vi } from "vitest";
import { handleMcp, MCP_TOOLS } from "../lib/mcp";
vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set<string>(), handleVerified: async () => new Response(JSON.stringify({ version: 1, updated: "x", verified: [] }), { status: 200 }) }));
import { resolve } from "node:path";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { ABI_INDICES, type AbiData } from "../../src/lib/builders-index";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";
const H = (s: string) => Date.parse(s) / 3600e3;
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
  await kv.put("facts:domain:archery.wtf", JSON.stringify({ source: "domain:archery.wtf", facts: [] }));
  db.sqlite.prepare("INSERT INTO index_hour VALUES ('aei', ?, 990)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_hour VALUES ('aei', 'domain:archery.wtf', ?, 9.2, 11, 5, 3, 1, 50)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_first VALUES ('aei', 'domain:archery.wtf', ?)").all(H("2026-10-11T19:00:00Z"));
  return { env: { INVITES: kv, DATA_DB: db } as never };
}


const rpc = (env: unknown, body: unknown) => handleMcp(new Request("https://builder.registrai.cc/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env as never, { cache: null });

describe("MCP", () => {
  test("initialize, tools/list (7 tools), notification 202, ping", async () => {
    const { env } = await seeded();
    const init = await (await rpc(env, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } })).json();
    expect(init.result.serverInfo.name).toBe("registrai-arc-data");
    expect(init.result.capabilities).toEqual({ tools: {} });
    const list = await (await rpc(env, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(list.result.tools).toHaveLength(7);
    const n = await rpc(env, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(n.status).toBe(202);
    expect((await (await rpc(env, { jsonrpc: "2.0", id: 3, method: "ping" })).json()).result).toEqual({});
  });
  test("tools/call arc_apps and arc_app return data with source_url; unknown app is isError", async () => {
    const { env } = await seeded();
    const apps = await (await rpc(env, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "arc_apps", arguments: {} } })).json();
    expect(apps.result.structuredContent.source_url).toBe("https://builder.registrai.cc/apps/");
    expect(apps.result.structuredContent.rows.length).toBeGreaterThan(0);
    const one = await (await rpc(env, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "arc_app", arguments: { id: "domain:archery.wtf" } } })).json();
    expect(one.result.structuredContent.source_url).toBe("https://builder.registrai.cc/apps/domain/archery.wtf/");
    const bad = await (await rpc(env, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "arc_app", arguments: { id: "domain:nope.example" } } })).json();
    expect(bad.result.isError).toBe(true);
  });
  test("errors: unknown tool -32602, unknown method -32601, bad JSON -32700, GET 405, batch -32600", async () => {
    const { env } = await seeded();
    expect((await (await rpc(env, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope", arguments: {} } })).json()).error.code).toBe(-32602);
    expect((await (await rpc(env, { jsonrpc: "2.0", id: 8, method: "nope" })).json()).error.code).toBe(-32601);
    const raw = await handleMcp(new Request("https://builder.registrai.cc/api/mcp", { method: "POST", body: "{" }), env as never, { cache: null });
    expect((await raw.json()).error.code).toBe(-32700);
    expect((await handleMcp(new Request("https://builder.registrai.cc/api/mcp"), env as never, { cache: null })).status).toBe(405);
    expect((await (await rpc(env, [{ jsonrpc: "2.0", id: 9, method: "ping" }])).json()).error.code).toBe(-32600);
  });
  test("an API-backed tool returns exactly the API's JSON (plus source_url)", async () => {
    const { env } = await seeded();
    const r = await (await rpc(env, { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "arc_index_history", arguments: { index: "aei" } } })).json();
    expect(r.result.structuredContent).toMatchObject({ version: 1, index: "aei" });
    expect(r.result.structuredContent.source_url).toContain("/api/v1/indices/aei/hourly");
  });
});
