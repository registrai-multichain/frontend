/**
 * Circle Gateway (Nanopayments) path. checkGateway (no side effects: our own payee/amount check, the ledger, Circle verify)
 * → [caller builds the product] → submitGateway (reserve, settle; one retry on an error; the ledger makes each payment single-use).
 */
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { findPayment, markFailed, markSettled, reserve } from "./x402-ledger";
import { sha256Hex } from "../../src/lib/builders-index";
import type { ProductId, X402Config } from "./x402-config";
import type { Requirement } from "./x402-requirements";
import type { D1Database } from "./env";

export type GatewayClient = {
  verify(payload: never, req: never): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
  settle(payload: never, req: never): Promise<{ success: boolean; errorReason?: string; transaction: string; payer?: string }>;
};
export type PaymentPayload = { x402Version: number; accepted?: Record<string, unknown>; payload: Record<string, unknown> };
type Auth = { from?: string; to?: string; value?: string; nonce?: string };

export const gatewayClient = (cfg: X402Config): GatewayClient => new BatchFacilitatorClient({ url: cfg.facilitator }) as unknown as GatewayClient;

async function idOf(p: PaymentPayload): Promise<{ payer: string; nonce: string }> {
  const a = (p.payload.authorization ?? {}) as Auth;
  return { payer: (a.from ?? "").toLowerCase(), nonce: typeof a.nonce === "string" ? a.nonce : `0x${await sha256Hex(JSON.stringify(p.payload))}` };
}

export async function checkGateway(db: D1Database, p: PaymentPayload, req: Requirement, product: ProductId, client: GatewayClient):
  Promise<{ kind: "fresh"; payer: string } | { kind: "error"; reason: string }> {
  const a = (p.payload?.authorization ?? {}) as Auth;
  // our own check first (second line behind Circle's): the signed payee and amount must be ours exactly
  if (typeof a.to === "string" && a.to.toLowerCase() !== req.payTo.toLowerCase()) return { kind: "error", reason: "wrong payee" };
  if (typeof a.value === "string" && a.value !== req.amount) return { kind: "error", reason: "amount must equal the price" };
  const { payer, nonce } = await idOf(p);
  const prior = payer ? await findPayment(db, "gateway", payer, nonce) : null;
  if (prior) return { kind: "error", reason: prior.status === "unknown" ? "settlement_unknown" : "payment already used" };
  let v: Awaited<ReturnType<GatewayClient["verify"]>>;
  try { v = await client.verify(p as never, req as never); } catch (err) {
    console.warn("x402 gateway verify failed", err instanceof Error ? err.message : err);
    return { kind: "error", reason: "verification_failed" };
  }
  return v.isValid ? { kind: "fresh", payer: (v.payer ?? payer).toLowerCase() } : { kind: "error", reason: v.invalidReason ?? "invalid payment" };
}

export async function submitGateway(db: D1Database, p: PaymentPayload, req: Requirement, product: ProductId, client: GatewayClient):
  Promise<{ ok: true; tx: string; payer: string } | { ok: false; reason: string }> {
  const { payer: p0, nonce } = await idOf(p);
  const payer = p0 || "unknown";
  if ((await reserve(db, { scheme: "gateway", payer, nonce, product, amount: Number(req.amount) })) === "duplicate") return { ok: false, reason: "payment already used" };
  for (let attempt = 1; ; attempt++) {
    try {
      const s = await client.settle(p as never, req as never);
      if (!s.success) { await markFailed(db, "gateway", payer, nonce, "failed"); return { ok: false, reason: s.errorReason ?? "settlement_failed" }; }
      await markSettled(db, "gateway", payer, nonce, s.transaction);
      return { ok: true, tx: s.transaction, payer };
    } catch (err) {
      if (attempt < 2) continue;
      // outcome unknown: kept for the owner to reconcile with Circle (payer + nonce identify the authorization)
      console.warn("x402 gateway settle unknown — reconcile manually", payer, nonce, err instanceof Error ? err.message : err);
      await markFailed(db, "gateway", payer, nonce, "unknown");
      return { ok: false, reason: "settlement_unknown" };
    }
  }
}
