import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { EIP3009_TYPES, settleEip3009, verifyEip3009, type ChainIO, type Eip3009Payload } from "../lib/x402-eip3009";
import { findPayment } from "../lib/x402-ledger";
import type { Requirement } from "../lib/x402-requirements";
import { MemoryD1 } from "./memory-d1";

const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const PAY = "0x000000000000000000000000000000000000dEaD";
const USDC = "0x3600000000000000000000000000000000000000";
const REQ: Requirement = { scheme: "exact", network: "eip155:5042", asset: USDC, amount: "10000", payTo: PAY, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } };
const NOW = 1_792_000_000;
const db = () => new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));

async function pay(o: Partial<{ to: string; value: string; validAfter: string; validBefore: string; nonce: `0x${string}`; chainId: number }> = {}): Promise<Eip3009Payload> {
  const authorization = { from: buyer.address, to: o.to ?? PAY, value: o.value ?? "10000", validAfter: o.validAfter ?? String(NOW - 10), validBefore: o.validBefore ?? String(NOW + 300), nonce: o.nonce ?? (`0x${"ab".repeat(32)}` as `0x${string}`) };
  const signature = await buyer.signTypedData({ domain: { name: "USDC", version: "2", chainId: o.chainId ?? 5042, verifyingContract: USDC }, types: EIP3009_TYPES, primaryType: "TransferWithAuthorization",
    message: { ...authorization, to: authorization.to as `0x${string}`, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) } });
  return { signature, authorization };
}

function io(o: Partial<{ used: boolean; receipt: "success" | "reverted" | "pending"; usedAfterSubmit: boolean }> = {}) {
  const calls = { submit: 0 };
  let used = o.used ?? false;
  const chain: ChainIO = {
    authorizationState: async () => used,
    submit: async () => { calls.submit++; await new Promise((r) => setTimeout(r, 5)); if (o.usedAfterSubmit !== false && (o.receipt ?? "success") === "success") used = true; return "0xfeed" as `0x${string}`; },
    receipt: async () => o.receipt ?? "success",
  };
  return { chain, calls, setUsed: (v: boolean) => { used = v; } };
}

describe("verify", () => {
  test("a good signature for the right payee, amount, window and chain passes", async () => {
    expect(await verifyEip3009(await pay(), REQ, 5042, NOW, io().chain)).toEqual({ ok: true, payer: buyer.address });
  });
  test("wrong payee, underpay, expired, not yet valid, wrong chain, tampered value, used onchain nonce: each refused", async () => {
    const cases: [Promise<Eip3009Payload>, string][] = [
      [pay({ to: "0x0000000000000000000000000000000000000001" }), "wrong payee"],
      [pay({ value: "9999" }), "amount below price"],
      [pay({ validBefore: String(NOW - 1) }), "authorization expired"],
      [pay({ validAfter: String(NOW + 60) }), "authorization not valid yet"],
      [pay({ chainId: 1 }), "bad signature"],
    ];
    for (const [p, reason] of cases) expect(await verifyEip3009(await p, REQ, 5042, NOW, io().chain)).toEqual({ ok: false, reason });
    const t = await pay(); t.authorization.value = "20000";
    expect(await verifyEip3009(t, REQ, 5042, NOW, io().chain)).toEqual({ ok: false, reason: "bad signature" });
    expect(await verifyEip3009(await pay(), REQ, 5042, NOW, io({ used: true }).chain)).toEqual({ ok: false, reason: "payment already used" });
  });
});

describe("settle", () => {
  test("success: one transfer submitted, ledger settled with the tx", async () => {
    const d = db(), x = io(), p = await pay();
    expect(await settleEip3009(d, p, REQ, "events", x.chain, { chainId: 5042, now: NOW })).toEqual({ ok: true, tx: "0xfeed", payer: buyer.address });
    expect(x.calls.submit).toBe(1);
    expect(await findPayment(d, "eip3009", buyer.address, p.authorization.nonce)).toEqual({ status: "settled", tx_hash: "0xfeed" });
  });
  test("replay, including concurrent: charged and served once", async () => {
    const d = db(), x = io(), p = await pay();
    const [a, b] = await Promise.all([settleEip3009(d, p, REQ, "events", x.chain, { chainId: 5042, now: NOW }), settleEip3009(d, p, REQ, "events", x.chain, { chainId: 5042, now: NOW })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ reason: "payment already used" });
    expect(x.calls.submit).toBe(1);
    expect(await settleEip3009(d, p, REQ, "events", x.chain, { chainId: 5042, now: NOW })).toMatchObject({ ok: false, reason: "payment already used" });
  });
  test("reverted: settlement_failed, ledger failed; nothing served", async () => {
    const d = db(), p = await pay();
    expect(await settleEip3009(d, p, REQ, "events", io({ receipt: "reverted" }).chain, { chainId: 5042, now: NOW })).toMatchObject({ ok: false, reason: "settlement_failed" });
    expect((await findPayment(d, "eip3009", buyer.address, p.authorization.nonce))!.status).toBe("failed");
  });
  test("no receipt in time: settlement_unknown; a retry reconciles from authorizationState", async () => {
    const d = db(), p = await pay(), x = io({ receipt: "pending", usedAfterSubmit: false });
    expect(await settleEip3009(d, p, REQ, "events", x.chain, { chainId: 5042, now: NOW, waitMs: 20 })).toMatchObject({ ok: false, reason: "settlement_unknown" });
    expect((await findPayment(d, "eip3009", buyer.address, p.authorization.nonce))!.status).toBe("unknown");
    x.setUsed(true); // the transfer landed after all
    expect(await settleEip3009(d, p, REQ, "events", x.chain, { chainId: 5042, now: NOW })).toMatchObject({ ok: true });
    expect((await findPayment(d, "eip3009", buyer.address, p.authorization.nonce))!.status).toBe("settled");
    expect(x.calls.submit).toBe(1);
  });
  test("a failed payment can't be retried into a free response", async () => {
    const d = db(), p = await pay();
    await settleEip3009(d, p, REQ, "events", io({ receipt: "reverted" }).chain, { chainId: 5042, now: NOW });
    expect(await settleEip3009(d, p, REQ, "events", io().chain, { chainId: 5042, now: NOW })).toMatchObject({ ok: false, reason: "payment already used" });
  });
});
