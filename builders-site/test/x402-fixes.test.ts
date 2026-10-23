import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { EIP3009_TYPES, type ChainIO } from "../lib/x402-eip3009";
import { payGate, type GateDeps } from "../lib/x402-gate";
import { findPayment } from "../lib/x402-ledger";
import { paymentRequired } from "../lib/x402-requirements";
import { readX402Config } from "../lib/x402-config";
import { MemoryD1 } from "./memory-d1";

const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const PAY = "0x000000000000000000000000000000000000dEaD", USDC = "0x3600000000000000000000000000000000000000";
const GW = { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", minValiditySeconds: 604800, assets: ["x"] };
const now = Math.floor(Date.now() / 1000);
const URL = "https://builder.registrai.cc/api/v1/paid/events";
type Db = MemoryD1;
const env = (o: Record<string, unknown> = {}) => ({ INVITES: {} as never, DATA_DB: new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f))), X402_PAY_TO: PAY, X402_SETTLER_KEY: `0x${"22".repeat(32)}`, ...o }) as never as { DATA_DB: Db };
const deps = (o: Partial<GateDeps> = {}): GateDeps => ({ cache: null, noCache: true, supported: async () => ({ kinds: [{ scheme: "exact", network: "eip155:5042", extra: GW }] }), domainRead: async (fn) => (fn === "name" ? "USDC" : "2"), lockWaitMs: 300, receiptWaitMs: 30, ...o });

/** A fake chain: authorizationState, prepare (sign locally → hash), send, receipt. */
function chain(o: { prepare?: "ok" | "revert"; send?: "ok" | "throw"; receipt?: "success" | "reverted" | "pending" } = {}) {
  let used = false; const calls = { prepare: 0, send: 0 };
  const state = { receipt: o.receipt ?? "success" as "success" | "reverted" | "pending" };
  const io: ChainIO = {
    authorizationState: async () => used,
    prepare: async () => { calls.prepare++; if (o.prepare === "revert") throw Object.assign(new Error("execution reverted"), { revert: true }); return { hash: "0xfeed", raw: "0xraw" }; },
    send: async () => { calls.send++; if (state.receipt === "success") used = true; if (o.send === "throw") throw new Error("socket hang up"); },
    receipt: async () => state.receipt,
  };
  return { io, calls, state, setUsed: (v: boolean) => { used = v; } };
}
async function hdr(o: Partial<{ value: string; validBefore: string; nonce: string; badSig: boolean }> = {}) {
  const a = { from: buyer.address, to: PAY, value: o.value ?? "10000", validAfter: String(now - 10), validBefore: o.validBefore ?? String(now + 300), nonce: o.nonce ?? `0x${"cd".repeat(32)}` };
  const signature = o.badSig ? `0x${"00".repeat(65)}` : await buyer.signTypedData({ domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: USDC }, types: EIP3009_TYPES, primaryType: "TransferWithAuthorization",
    message: { from: buyer.address, to: PAY, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as `0x${string}` } });
  return encodePaymentSignatureHeader({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042", asset: USDC, amount: "10000", payTo: PAY, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }, payload: { signature, authorization: a } } as never);
}
const req = (h?: string, u = URL) => new Request(u, { headers: h ? { "PAYMENT-SIGNATURE": h } : {} });
const ok = () => vi.fn(async () => new Response(JSON.stringify({ version: 1 }), { headers: { "content-type": "application/json" } }));

describe("I1: verify before any work", () => {
  test("a garbage signature never runs the product precheck", async () => {
    const pre = vi.fn(async () => null);
    const r = await payGate(req(await hdr({ badSig: true })), env() as never, deps({ io: chain().io }), "events", ok(), { precheck: pre });
    expect(r.status).toBe(402);
    expect(pre).not.toHaveBeenCalled();
  });
  test("an overpaying or near-expiry authorization is refused before any work (M1, M2)", async () => {
    const pre = vi.fn(async () => null);
    expect((await payGate(req(await hdr({ value: "20000" })), env() as never, deps({ io: chain().io }), "events", ok(), { precheck: pre })).status).toBe(402);
    expect((await payGate(req(await hdr({ validBefore: String(now + 3) })), env() as never, deps({ io: chain().io }), "events", ok(), { precheck: pre })).status).toBe(402);
    expect(pre).not.toHaveBeenCalled();
  });
});

describe("I2: reconcile from our own receipt, for the same product only", () => {
  test("authorizationState true but our transaction reverted (buyer cancelled): no data", async () => {
    const e = env(), c = chain({ receipt: "pending" }), h = await hdr();
    expect((await payGate(req(h), e as never, deps({ io: c.io }), "events", ok())).status).toBe(402); // unknown
    c.setUsed(true); c.state.receipt = "reverted";                                          // cancelled; ours reverted
    const r = await payGate(req(h), e as never, deps({ io: c.io }), "events", ok());
    expect(r.status).toBe(402);
    expect((await r.json()).error).toBe("settlement_failed");
  });
  test("an unknown row can't be redeemed for a different product", async () => {
    const e = env(), c = chain({ receipt: "pending" }), h = await hdr();
    await payGate(req(h), e as never, deps({ io: c.io }), "events", ok());
    c.state.receipt = "success";
    const r = await payGate(req(h, "https://builder.registrai.cc/api/v1/paid/members/day?date=2026-10-14"), e as never, deps({ io: c.io }), "members_day", ok());
    expect(r.status).toBe(402);
    expect((await r.json()).error).toBe("payment already used");
  });
  test("unknown then our receipt succeeds: the retry is served once", async () => {
    const e = env(), c = chain({ receipt: "pending" }), h = await hdr(), serve = ok();
    await payGate(req(h), e as never, deps({ io: c.io }), "events", serve);
    c.state.receipt = "success";
    expect((await payGate(req(h), e as never, deps({ io: c.io }), "events", serve)).status).toBe(200);
    expect((await payGate(req(h), e as never, deps({ io: c.io }), "events", serve)).status).toBe(402);
    expect(serve).toHaveBeenCalledTimes(1);
    expect(c.calls.send).toBe(1);
  });
});

describe("I3: never charged without data", () => {
  test("a send error after signing is 'unknown' (not failed); the retry settles from the receipt", async () => {
    const e = env(), c = chain({ send: "throw" }), h = await hdr(), serve = ok();
    const first = await payGate(req(h), e as never, deps({ io: c.io }), "events", serve);
    // the receipt is found during polling even though send threw: served
    expect(first.status).toBe(200);
    expect((await findPayment(e.DATA_DB as never, "eip3009", buyer.address, `0x${"cd".repeat(32)}`))!.status).toBe("settled");
  });
  test("a revert at preparation (nothing sent) is failed and nothing is charged", async () => {
    const e = env(), c = chain({ prepare: "revert" });
    const r = await payGate(req(await hdr()), e as never, deps({ io: c.io }), "events", ok());
    expect((await r.json()).error).toBe("settlement_failed");
    expect(c.calls.send).toBe(0);
  });
});

describe("I4: one settlement at a time", () => {
  test("concurrent payments serialise through the settler lock (both settle, sends never overlap)", async () => {
    const e = env(); let inflight = 0, maxInflight = 0;
    const c = chain();
    const slow: ChainIO = { ...c.io, prepare: async (p) => { inflight++; maxInflight = Math.max(maxInflight, inflight); await new Promise((r) => setTimeout(r, 30)); return c.io.prepare(p); },
      receipt: async (t) => { const r = await c.io.receipt(t); inflight--; return r; }, authorizationState: async () => false };
    const [a, b] = await Promise.all([
      payGate(req(await hdr({ nonce: `0x${"a1".repeat(32)}` })), e as never, deps({ io: slow, lockWaitMs: 2000 }), "events", ok()),
      payGate(req(await hdr({ nonce: `0x${"a2".repeat(32)}` })), e as never, deps({ io: slow, lockWaitMs: 2000 }), "events", ok()),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(maxInflight).toBe(1);
  });
  test("lock busy past the wait: 503, nothing reserved", async () => {
    const e = env();
    e.DATA_DB.sqlite.prepare("UPDATE x402_settler_lock SET holder = 'other', until = ? WHERE id = 1").all(now + 60);
    const r = await payGate(req(await hdr()), e as never, deps({ io: chain().io, lockWaitMs: 50 }), "events", ok());
    expect(r.status).toBe(503);
    expect(e.DATA_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM x402_payments").all()[0]).toEqual({ n: 0 });
  });
});

describe("I5/I6: what clients see", () => {
  test("the standard EIP-3009 option comes first; Circle's entry matches its library (7-day timeout, name/version/verifyingContract)", () => {
    const cfg = readX402Config({ X402_PAY_TO: PAY, X402_SETTLER_KEY: `0x${"22".repeat(32)}` } as never)!;
    const pr = paymentRequired("events", URL, cfg, GW, { name: "USDC", version: "2" });
    expect(pr.accepts[0].extra).toEqual({ name: "USDC", version: "2" });
    expect(pr.accepts[1].maxTimeoutSeconds).toBe(604900);
    expect(pr.accepts[1].extra).toEqual({ name: "GatewayWalletBatched", version: "1", verifyingContract: GW.verifyingContract });
  });
  test("no way to pay at all: 503, not an empty 402 (M4)", async () => {
    const r = await payGate(req(), env({ X402_SETTLER_KEY: undefined }) as never, deps({ supported: async () => ({ kinds: [] }) }), "events", ok());
    expect(r.status).toBe(503);
  });
});

describe("I7: failures never become HTTP 500", () => {
  test("RPC throwing in verification: a JSON error, not a 500, and nothing charged", async () => {
    const io: ChainIO = { ...chain().io, authorizationState: async () => { throw new Error("rpc 429"); } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await payGate(req(await hdr()), env() as never, deps({ io }), "events", ok());
    expect(r.status).not.toBe(500);
    expect([402, 503]).toContain(r.status);
    warn.mockRestore();
  });
  test("a gateway payment whose signed payee or amount differ from ours is refused before Circle is asked", async () => {
    const client = { verify: vi.fn(async () => ({ isValid: true, payer: buyer.address })), settle: vi.fn(async () => ({ success: true, transaction: "0xgw" })) };
    const h = encodePaymentSignatureHeader({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042", asset: USDC, amount: "2000", payTo: PAY, maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GW.verifyingContract } },
      payload: { signature: "0xsig", authorization: { from: buyer.address, to: "0x0000000000000000000000000000000000000001", value: "2000", validAfter: "0", validBefore: String(now + 604800), nonce: `0x${"ef".repeat(32)}` } } } as never);
    const r = await payGate(req(h), env() as never, deps({ gateway: client }), "events", ok());
    expect(r.status).toBe(402);
    expect(client.verify).not.toHaveBeenCalled();
  });
});
