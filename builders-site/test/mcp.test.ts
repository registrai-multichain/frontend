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
  await kv.put("facts:domain:archery.wtf", JSON.stringify({ source: "domain:archery.wtf", facts: [{ id: "f1", kind: "control", text: "x", evidence: [] }], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 1 }));
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
    expect(list.result.tools).toHaveLength(13); // 7 free + 6 paid (x402)
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

describe("review fixes", () => {
  test("I4: every tool is annotated read-only", () => {
    for (const t of MCP_TOOLS) expect((t as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint, t.name).toBe(true);
  });
  test("I2: API-backed tools share the API's edge cache", async () => {
    const { MemoryCache } = await import("./memory-cache");
    const { env } = await seeded();
    const cache = new MemoryCache();
    await handleMcp(new Request("https://builder.registrai.cc/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "arc_index_history", arguments: { index: "aei" } } }) }), env as never, { cache: cache as unknown as Cache });
    expect([...cache.store.keys()].some((k) => k.includes("/api/v1/indices/aei/hourly"))).toBe(true);
  });
});

describe("paid MCP tools (x402 over MCP)", () => {
  const PAY = "0x000000000000000000000000000000000000dEaD", USDC = "0x3600000000000000000000000000000000000000";
  const now = Math.floor(Date.now() / 1000);
  async function paidEnv() {
    const { env } = await seeded();
    const db = (env as { DATA_DB: { sqlite: { prepare(s: string): { all(...a: unknown[]): unknown } } } }).DATA_DB;
    for (let h = H("2026-08-01T00:00:00Z"); h <= H("2026-10-14T21:00:00Z"); h += 24) db.sqlite.prepare("INSERT OR IGNORE INTO index_hour VALUES ('abi', ?, 990)").all(h);
    return { ...(env as object), X402_PAY_TO: PAY, X402_SETTLER_KEY: `0x${"22".repeat(32)}` } as never;
  }
  function chainIO() { let used = false; const calls = { submit: 0 }; return { calls, io: { authorizationState: async () => used, submit: async () => { calls.submit++; used = true; return "0xfeed" as const; }, receipt: async () => "success" as const } }; }
  const gdeps = (io: unknown) => ({ cache: null, noCache: true, io, supported: async () => ({ kinds: [] }), domainRead: async (fn: "name" | "version") => (fn === "name" ? "USDC" : "2") }) as never;
  async function payment(value = "10000", nonce = `0x${"ce".repeat(32)}`) {
    const { privateKeyToAccount } = await import("viem/accounts");
    const { EIP3009_TYPES } = await import("../lib/x402-eip3009");
    const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const a = { from: buyer.address, to: PAY, value, validAfter: String(now - 10), validBefore: String(now + 300), nonce };
    const signature = await buyer.signTypedData({ domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: USDC }, types: EIP3009_TYPES, primaryType: "TransferWithAuthorization",
      message: { from: buyer.address, to: PAY, value: BigInt(value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: nonce as `0x${string}` } });
    return { x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042", asset: USDC, amount: value, payTo: PAY, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }, payload: { signature, authorization: a } };
  }
  const call = (env: unknown, deps: never, name: string, args: unknown, meta?: unknown) =>
    handleMcp(new Request("https://builder.registrai.cc/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }) }), env as never, deps).then((r) => r.json());

  test("13 tools; the six paid ones say x402 and are read-only", () => {
    expect(MCP_TOOLS).toHaveLength(13);
    const paid = MCP_TOOLS.filter((t) => t.description.includes("x402"));
    expect(paid.map((t) => t.name)).toEqual(["arc_index_history_deep", "arc_app_history_deep", "arc_members_day", "arc_events", "arc_contract", "arc_project_scope"]);
    for (const t of paid) expect(t.annotations.readOnlyHint).toBe(true);
  });
  test("unpaid call: isError with the x402 payment requirements", async () => {
    const r = await call(await paidEnv(), gdeps(chainIO().io), "arc_index_history_deep", { index: "abi", from: "2026-08-01T00:00:00Z" });
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.x402.accepts[0]).toMatchObject({ scheme: "exact", amount: "10000", payTo: PAY });
  });
  test("paid call: data plus the payment response; a replay is refused", async () => {
    const env = await paidEnv(), c = chainIO(), p = await payment();
    const r = await call(env, gdeps(c.io), "arc_index_history_deep", { index: "abi", from: "2026-08-01T00:00:00Z" }, { "x402/payment": p });
    expect(r.result.isError).toBeUndefined();
    expect(r.result.structuredContent.rows.length).toBeGreaterThan(744 / 24);
    expect(r.result._meta["x402/payment-response"]).toMatchObject({ success: true, transaction: "0xfeed" });
    const again = await call(env, gdeps(c.io), "arc_index_history_deep", { index: "abi", from: "2026-08-01T00:00:00Z" }, { "x402/payment": p });
    expect(again.result.isError).toBe(true);
    expect(again.result.content[0].text).toContain("payment already used");
    expect(c.calls.submit).toBe(1);
  });
  test("unconfigured: paid tools say so; free tools unaffected", async () => {
    const { env } = await seeded();
    const r = await call(env, gdeps(chainIO().io), "arc_members_day", { date: "2026-10-14" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("not configured");
  });
});
