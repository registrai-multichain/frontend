import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { EIP3009_TYPES, type ChainIO } from "../lib/x402-eip3009";
import { payGate, paidHealth, type GateDeps } from "../lib/x402-gate";
import { MemoryD1 } from "./memory-d1";

const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const PAY = "0x000000000000000000000000000000000000dEaD";
const USDC = "0x3600000000000000000000000000000000000000";
const GW = { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" };
const URL = "https://builder.registrai.cc/api/v1/paid/events";
const now = Math.floor(Date.now() / 1000);

function env(o: Record<string, unknown> = {}) {
  return { INVITES: {} as never, DATA_DB: new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f))), X402_PAY_TO: PAY, X402_SETTLER_KEY: `0x${"22".repeat(32)}`, ...o } as never;
}
function chain(o: { receipt?: "success" | "reverted" } = {}) {
  let used = false; const calls = { submit: 0 };
  const io: ChainIO = { authorizationState: async () => used, prepare: async () => ({ hash: "0xfeed", raw: "0xraw" }), send: async () => { calls.submit++; if ((o.receipt ?? "success") === "success") used = true; }, receipt: async () => o.receipt ?? "success" };
  return { io, calls };
}
const gwClient = (o: { valid?: boolean; settle?: boolean } = {}) => ({
  verify: vi.fn(async () => (o.valid ?? true) ? { isValid: true, payer: buyer.address } : { isValid: false, invalidReason: "insufficient_balance" }),
  settle: vi.fn(async () => ({ success: o.settle ?? true, transaction: "0xgw", network: "eip155:5042", payer: buyer.address })),
});
const deps = (o: Partial<GateDeps> = {}): GateDeps => ({ cache: null, noCache: true, supported: async () => ({ kinds: [{ scheme: "exact", network: "eip155:5042", extra: GW }] }), domainRead: async (fn) => (fn === "name" ? "USDC" : "2"), ...o });

async function eip3009Header(nonce = `0x${"cd".repeat(32)}`) {
  const authorization = { from: buyer.address, to: PAY, value: "10000", validAfter: String(now - 10), validBefore: String(now + 300), nonce };
  const signature = await buyer.signTypedData({ domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: USDC }, types: EIP3009_TYPES, primaryType: "TransferWithAuthorization",
    message: { ...authorization, to: PAY, value: 10000n, validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: nonce as `0x${string}` } });
  return encodePaymentSignatureHeader({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042", asset: USDC, amount: "10000", payTo: PAY, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }, payload: { signature, authorization } } as never);
}
const gwHeader = () => encodePaymentSignatureHeader({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042", asset: USDC, amount: "2000", payTo: PAY, maxTimeoutSeconds: 300, extra: GW },
  payload: { signature: "0xsig", authorization: { from: buyer.address, to: PAY, value: "2000", validAfter: "0", validBefore: String(now + 300), nonce: `0x${"ef".repeat(32)}` } } } as never);
const serve = vi.fn(async () => new Response(JSON.stringify({ version: 1, rows: [] }), { headers: { "content-type": "application/json" } }));
const req = (h?: string) => new Request(URL, { headers: h ? { "PAYMENT-SIGNATURE": h } : {} });

describe("payGate", () => {
  test("unconfigured: 503, no 402", async () => {
    const r = await payGate(req(), env({ X402_PAY_TO: undefined }), deps(), "events", serve);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("Payments are not configured yet.");
  });
  test("no payment: 402 with both options; the header decodes", async () => {
    const r = await payGate(req(), env(), deps(), "events", serve);
    expect(r.status).toBe(402);
    expect(decodePaymentRequiredHeader(r.headers.get("PAYMENT-REQUIRED")!).accepts.map((a: { amount: string }) => a.amount)).toEqual(["10000", "2000"]);
  });
  test("standard EIP-3009: settles, serves once, PAYMENT-RESPONSE carries the tx; a replay is 402", async () => {
    serve.mockClear(); const c = chain(); const e = env(); const h = await eip3009Header();
    const r = await payGate(req(h), e, deps({ io: c.io }), "events", serve);
    expect(r.status).toBe(200);
    expect(decodePaymentResponseHeader(r.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, transaction: "0xfeed", network: "eip155:5042" });
    expect(serve).toHaveBeenCalledTimes(1);
    const again = await payGate(req(h), e, deps({ io: c.io }), "events", serve);
    expect(again.status).toBe(402);
    expect((await again.json()).error).toBe("payment already used");
    expect(c.calls.submit).toBe(1);
  });
  test("Circle Gateway: verify + settle through the client; invalid → 402 with the reason", async () => {
    serve.mockClear(); const g = gwClient();
    const r = await payGate(req(gwHeader()), env(), deps({ gateway: g }), "events", serve);
    expect(r.status).toBe(200);
    expect(g.settle).toHaveBeenCalledTimes(1);
    const bad = await payGate(req(gwHeader()), env(), deps({ gateway: gwClient({ valid: false }) }), "events", serve);
    expect(bad.status).toBe(402);
    expect((await bad.json()).error).toBe("insufficient_balance");
  });
  test("precheck failure: 503 and nothing charged or recorded", async () => {
    serve.mockClear(); const c = chain(); const e = env();
    const r = await payGate(req(await eip3009Header()), e, deps({ io: c.io }), "events", serve, { precheck: async () => new Response("down", { status: 503 }) });
    expect(r.status).toBe(503);
    expect(c.calls.submit).toBe(0);
    expect(serve).not.toHaveBeenCalled();
    expect((e as { DATA_DB: MemoryD1 }).DATA_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM x402_payments").all()[0]).toEqual({ n: 0 });
  });
  test("settlement failure: 402 settlement_failed, not served", async () => {
    serve.mockClear();
    const r = await payGate(req(await eip3009Header(`0x${"99".repeat(32)}`)), env(), deps({ io: chain({ receipt: "reverted" }).io }), "events", serve);
    expect(r.status).toBe(402);
    expect((await r.json()).error).toBe("settlement_failed");
    expect(serve).not.toHaveBeenCalled();
  });
  test("an unreadable payment header is a 402, not a 500", async () => {
    const r = await payGate(req("%%%not-base64"), env(), deps(), "events", serve);
    expect(r.status).toBe(402);
  });
});

describe("paidHealth", () => {
  test("reports configuration and a low settler balance, never the key", async () => {
    const h = await paidHealth(env(), async () => 1.5);
    expect(h).toMatchObject({ configured: true, network: "eip155:5042", standard_enabled: true, settler_balance_usdc: 1.5, low: true });
    expect(JSON.stringify(h)).not.toContain("2222");
    expect(await paidHealth(env({ X402_PAY_TO: undefined }), async () => 0)).toMatchObject({ configured: false });
  });
});
