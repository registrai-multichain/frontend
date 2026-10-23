import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { EIP3009_TYPES, type ChainIO } from "../lib/x402-eip3009";
import { handlePaid } from "../lib/x402-products";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set<string>() }));
const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const PAY = "0x000000000000000000000000000000000000dEaD", USDC = "0x3600000000000000000000000000000000000000";
const O = "https://builder.registrai.cc";
const H = (s: string) => Date.parse(s) / 3600e3;
const now = Math.floor(Date.now() / 1000);
afterEach(() => vi.unstubAllGlobals());

function setup(extra: Record<string, unknown> = {}) {
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  const until = H("2026-10-14T21:00:00Z");
  for (const idx of ["abi", "aii", "aei"]) for (let h = until - 1999; h <= until; h++) db.sqlite.prepare("INSERT INTO index_hour VALUES (?, ?, ?)").all(idx, h, 1000 - (until - h) / 1000);
  for (let h = H("2026-10-14T01:00:00Z"); h <= H("2026-10-15T00:00:00Z") && h <= until; h++)
    db.sqlite.prepare("INSERT INTO member_hour VALUES ('aii', 'integration:uniswap', ?, 5, 1, 2, 1, 0, 10)").all(h);
  return { INVITES: new MemoryKV(), DATA_DB: db, X402_PAY_TO: PAY, X402_SETTLER_KEY: `0x${"22".repeat(32)}`, ...extra } as never;
}
const chain = (): { io: ChainIO; calls: { submit: number } } => { let used = false; const calls = { submit: 0 }; return { calls, io: { authorizationState: async () => used, prepare: async () => ({ hash: "0xfeed", raw: "0xraw" }), send: async () => { calls.submit++; used = true; }, receipt: async () => "success" } }; };
const deps = (io: ChainIO) => ({ cache: null, noCache: true, io, readBalance: async () => 5, supported: async () => ({ kinds: [] }), domainRead: async (fn: "name" | "version") => (fn === "name" ? "USDC" : "2") });
async function header(value: string, nonce = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`) {
  const a = { from: buyer.address, to: PAY, value, validAfter: String(now - 10), validBefore: String(now + 300), nonce };
  const signature = await buyer.signTypedData({ domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: USDC }, types: EIP3009_TYPES, primaryType: "TransferWithAuthorization",
    message: { from: buyer.address, to: PAY, value: BigInt(value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: nonce as `0x${string}` } });
  return encodePaymentSignatureHeader({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042", asset: USDC, amount: value, payTo: PAY, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }, payload: { signature, authorization: a } } as never);
}
const get = (path: string, h?: string) => new Request(`${O}${path}`, { headers: h ? { "PAYMENT-SIGNATURE": h } : {} });

describe("paid products", () => {
  test("deep index history: a 2,000-hour window is paid and served (the free route caps at 744)", async () => {
    const env = setup(), c = chain();
    const path = "/api/v1/paid/indices/abi/hourly?from=2026-09-02T22:00:00Z&to=2026-10-14T21:00:00Z";
    expect((await handlePaid(get(path), env, deps(c.io), ["indices", "abi", "hourly"])).status).toBe(402);
    const r = await handlePaid(get(path, await header("10000")), env, deps(c.io), ["indices", "abi", "hourly"]);
    expect(r.status).toBe(200);
    expect((await r.json()).rows.length).toBe(1008); // 2 Sep 22:00 → 14 Oct 21:00, inclusive
  });
  test("an invalid request is answered before any charge", async () => {
    const env = setup(), c = chain();
    const r = await handlePaid(get("/api/v1/paid/indices/abi/hourly?from=bad", await header("10000")), env, deps(c.io), ["indices", "abi", "hourly"]);
    expect(r.status).toBe(400);
    expect(c.calls.submit).toBe(0);
    const u = await handlePaid(get("/api/v1/paid/members/day?date=2026-13-40", await header("50000")), env, deps(c.io), ["members", "day"]);
    expect(u.status).toBe(400);
    expect(c.calls.submit).toBe(0);
  });
  test("members/day: all three indices' closes and every member's rows for the UTC day", async () => {
    const env = setup(), c = chain();
    const r = await handlePaid(get("/api/v1/paid/members/day?date=2026-10-14", await header("50000")), env, deps(c.io), ["members", "day"]);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(Object.keys(b.indices)).toEqual(["abi", "aii", "aei"]);
    expect(b.indices.aii.rows.every((x: { id: string }) => x.id === "integration:uniswap")).toBe(true);
    expect(b.indices.abi.closes[0].hour_close).toBe("2026-10-14T01:00:00Z");
  });
  test("watch-feed proxy: forwards the secret, passes JSON through; upstream down → 503, no charge; unset → 503", async () => {
    const c = chain();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Registrai-Internal")).toBe("s3cret");
      return new Response(JSON.stringify({ events: [{ kind: "deploy" }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = setup({ WATCHFEED_URL: "https://wf.internal", WATCHFEED_SECRET: "s3cret" });
    const r = await handlePaid(get("/api/v1/paid/events?kind=deploy&limit=5", await header("10000")), env, deps(c.io), ["events"]);
    expect(r.status).toBe(200);
    expect((await r.json()).events[0].kind).toBe("deploy");
    expect(fetchMock.mock.calls[0][0]).toBe("https://wf.internal/v1/events?kind=deploy&limit=5");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    const c2 = chain();
    const d = await handlePaid(get("/api/v1/paid/events", await header("10000")), env, deps(c2.io), ["events"]);
    expect(d.status).toBe(503);
    expect(c2.calls.submit).toBe(0);
    expect((await handlePaid(get("/api/v1/paid/events"), setup(), deps(chain().io), ["events"])).status).toBe(503);
  });
  test("catalogue lists six products with both prices; stats never show payers; health is free", async () => {
    const env = setup(), c = chain();
    const cat = await (await handlePaid(get("/api/v1/paid"), env, deps(c.io), [])).json();
    expect(cat.products).toHaveLength(6);
    expect(cat.products[0]).toMatchObject({ id: "deep_index_history", price_circle: "$0.002", price_standard: "$0.01" });
    await handlePaid(get("/api/v1/paid/indices/abi/hourly", await header("10000")), env, deps(c.io), ["indices", "abi", "hourly"]);
    const stats = await (await handlePaid(get("/api/v1/paid/stats"), env, deps(c.io), ["stats"])).json();
    expect(stats.sales[0]).toMatchObject({ product: "deep_index_history", sales: 1 });
    expect(JSON.stringify(stats).toLowerCase()).not.toContain(buyer.address.toLowerCase());
    expect((await handlePaid(get("/api/v1/paid/health"), env, deps(c.io), ["health"])).status).toBe(200);
  });
});

describe("HTTP edge cases", () => {
  test("browser preflight: OPTIONS 204 allows the payment headers", async () => {
    const r = await handlePaid(new Request(`${O}/api/v1/paid/events`, { method: "OPTIONS" }), setup(), deps(chain().io), ["events"]);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-headers")).toMatch(/PAYMENT-SIGNATURE/i);
    expect(r.headers.get("access-control-expose-headers")).toMatch(/PAYMENT-RESPONSE/i);
  });
  test("a malformed %-escape in a path is a 400, not a 500", async () => {
    const env = setup({ WATCHFEED_URL: "https://wf.internal", WATCHFEED_SECRET: "s3cret" });
    expect((await handlePaid(get("/api/v1/paid/projects/%E0%A4%A/scope"), env, deps(chain().io), ["projects", "%E0%A4%A", "scope"])).status).toBe(400);
    expect((await handlePaid(get("/api/v1/paid/members/%E0%A4%A/hourly?index=abi"), env, deps(chain().io), ["members", "%E0%A4%A", "hourly"])).status).toBe(400);
  });
  test("an unexpected error is a JSON 503, not a 500", async () => {
    const env = { ...(setup() as object), DATA_DB: { prepare: () => { throw new Error("d1 down"); } } } as never;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await handlePaid(get("/api/v1/paid/stats"), env, deps(chain().io), ["stats"]);
    expect(r.status).toBe(503);
    warn.mockRestore();
  });
});
