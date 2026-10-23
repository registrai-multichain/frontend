import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { EIP3009_TYPES, checkEip3009, submitEip3009, verifyEip3009, type ChainIO, type Eip3009Payload } from "../lib/x402-eip3009";
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

function io(o: Partial<{ used: boolean; receipt: "success" | "reverted" | "pending" }> = {}) {
  const calls = { send: 0 };
  let used = o.used ?? false;
  const state = { receipt: o.receipt ?? ("success" as "success" | "reverted" | "pending") };
  const chain: ChainIO = {
    authorizationState: async () => used,
    prepare: async () => ({ hash: "0xfeed", raw: "0xraw" }),
    send: async () => { calls.send++; await new Promise((r) => setTimeout(r, 5)); if (state.receipt === "success") used = true; },
    receipt: async () => state.receipt,
  };
  return { chain, calls, state, setUsed: (v: boolean) => { used = v; } };
}
const OPTS = { chainId: 5042, now: NOW };
/** The gate's order: check, then (product built), then submit. */
async function settle(d: MemoryD1, p: Eip3009Payload, x: ReturnType<typeof io>, product: "events" | "members_day" = "events", waitMs?: number) {
  const c = await checkEip3009(d as never, p, REQ, product, x.chain, OPTS);
  if (c.kind === "error") return { ok: false as const, reason: c.reason };
  if (c.kind === "reconcile") return { ok: true as const, tx: c.tx, reconciled: true };
  return submitEip3009(d as never, p, product, x.chain, { waitMs, pollMs: 5 });
}

describe("verify", () => {
  test("a good signature for the right payee, exact amount, window and chain passes", async () => {
    expect(await verifyEip3009(await pay(), REQ, 5042, NOW, io().chain)).toEqual({ ok: true, payer: buyer.address });
  });
  test("wrong payee, underpay, overpay, expired (incl. inside the 6 s buffer), not yet valid, wrong chain, tampered value, used onchain nonce", async () => {
    const cases: [Promise<Eip3009Payload>, string][] = [
      [pay({ to: "0x0000000000000000000000000000000000000001" }), "wrong payee"],
      [pay({ value: "9999" }), "amount below price"],
      [pay({ value: "10001" }), "amount must equal the price"],
      [pay({ validBefore: String(NOW - 1) }), "authorization expired"],
      [pay({ validBefore: String(NOW + 5) }), "authorization expired"],
      [pay({ validAfter: String(NOW + 60) }), "authorization not valid yet"],
      [pay({ chainId: 1 }), "bad signature"],
    ];
    for (const [p, reason] of cases) expect(await verifyEip3009(await p, REQ, 5042, NOW, io().chain)).toEqual({ ok: false, reason });
    const t = await pay(); t.signature = (t.signature.slice(0, -4) + "0000") as `0x${string}`;
    expect(await verifyEip3009(t, REQ, 5042, NOW, io().chain)).toEqual({ ok: false, reason: "bad signature" });
    expect(await verifyEip3009(await pay(), REQ, 5042, NOW, io({ used: true }).chain)).toEqual({ ok: false, reason: "payment already used" });
  });
});

describe("settle", () => {
  test("success: one transfer sent, ledger settled with the locally computed hash", async () => {
    const d = db(), x = io(), p = await pay();
    expect(await settle(d, p, x)).toEqual({ ok: true, tx: "0xfeed", payer: buyer.address });
    expect(x.calls.send).toBe(1);
    expect(await findPayment(d as never, "eip3009", buyer.address, p.authorization.nonce)).toMatchObject({ status: "settled", tx_hash: "0xfeed" });
  });
  test("replay, including concurrent: one send; the others are refused", async () => {
    const d = db(), x = io(), p = await pay();
    const [a, b] = await Promise.all([settle(d, p, x), settle(d, p, x)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ reason: "payment already used" });
    expect(x.calls.send).toBe(1);
    expect(await settle(d, p, x)).toMatchObject({ ok: false, reason: "payment already used" });
  });
  test("reverted: settlement_failed and the ledger row is failed", async () => {
    const d = db(), p = await pay();
    expect(await settle(d, p, io({ receipt: "reverted" }))).toMatchObject({ ok: false, reason: "settlement_failed" });
    expect((await findPayment(d as never, "eip3009", buyer.address, p.authorization.nonce))!.status).toBe("failed");
  });
  test("no receipt in time: unknown; a retry is served only once our receipt succeeds", async () => {
    const d = db(), p = await pay(), x = io({ receipt: "pending" });
    expect(await settle(d, p, x, "events", 20)).toMatchObject({ ok: false, reason: "settlement_unknown" });
    expect((await findPayment(d as never, "eip3009", buyer.address, p.authorization.nonce))!.status).toBe("unknown");
    expect(await settle(d, p, x)).toMatchObject({ ok: false, reason: "settlement_unknown" }); // still pending
    x.state.receipt = "success";
    expect(await settle(d, p, x)).toMatchObject({ ok: true, reconciled: true });
    expect(x.calls.send).toBe(1);
  });
  test("a failed payment can't be retried into a free response", async () => {
    const d = db(), p = await pay();
    await settle(d, p, io({ receipt: "reverted" }));
    expect(await settle(d, p, io())).toMatchObject({ ok: false, reason: "payment already used" });
  });
});
