/** Circle Gateway (Nanopayments) path: verify and settle through Circle's batch facilitator; the ledger makes each payment single-use. */
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { markFailed, markSettled, reserve } from "./x402-ledger";
import { sha256Hex } from "../../src/lib/builders-index";
import type { ProductId, X402Config } from "./x402-config";
import type { Requirement } from "./x402-requirements";
import type { D1Database } from "./env";

export type GatewayClient = {
  verify(payload: never, req: never): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
  settle(payload: never, req: never): Promise<{ success: boolean; errorReason?: string; transaction: string; payer?: string }>;
};
export type PaymentPayload = { x402Version: number; accepted?: Record<string, unknown>; payload: Record<string, unknown> };

export const gatewayClient = (cfg: X402Config): GatewayClient => new BatchFacilitatorClient({ url: cfg.facilitator }) as unknown as GatewayClient;

export async function settleGateway(db: D1Database, p: PaymentPayload, req: Requirement, product: ProductId, client: GatewayClient):
  Promise<{ ok: true; tx: string; payer: string } | { ok: false; reason: string }> {
  let v: Awaited<ReturnType<GatewayClient["verify"]>>;
  try { v = await client.verify(p as never, req as never); } catch (err) {
    console.warn("x402 gateway verify failed", err instanceof Error ? err.message : err);
    return { ok: false, reason: "verification_failed" };
  }
  if (!v.isValid) return { ok: false, reason: v.invalidReason ?? "invalid payment" };
  const auth = (p.payload.authorization ?? {}) as { from?: string; nonce?: string };
  const payer = (v.payer ?? auth.from ?? "").toLowerCase();
  const nonce = typeof auth.nonce === "string" ? auth.nonce : `0x${await sha256Hex(JSON.stringify(p.payload))}`;
  if ((await reserve(db, { scheme: "gateway", payer, nonce, product, amount: Number(req.amount) })) === "duplicate") return { ok: false, reason: "payment already used" };
  try {
    const s = await client.settle(p as never, req as never);
    if (!s.success) { await markFailed(db, "gateway", payer, nonce, "failed"); return { ok: false, reason: s.errorReason ?? "settlement_failed" }; }
    await markSettled(db, "gateway", payer, nonce, s.transaction);
    return { ok: true, tx: s.transaction, payer };
  } catch (err) {
    console.warn("x402 gateway settle failed", payer, err instanceof Error ? err.message : err);
    await markFailed(db, "gateway", payer, nonce, "unknown");
    return { ok: false, reason: "settlement_unknown" };
  }
}
