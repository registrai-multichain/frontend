/**
 * The 402: x402 v2 PaymentRequired with up to two ways to pay (spec 2026-10-16-x402-data-api-design.md):
 *   1. standard EIP-3009 "exact" on USDC, settled by us, at the standard price (only when the gas wallet key is set). First,
 *      because generic x402 clients take accepts[0]; Circle's GatewayClient finds its entry by extra.name wherever it is.
 *   2. Circle Gateway batched ("exact", GatewayWalletBatched), at the gateway price, with the same timeout and extra
 *      Circle's own server library builds (604900 s; name, version, verifyingContract).
 */
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { createPublicClient, fallback, http, parseAbi } from "viem";
import { PRODUCTS, USDC, type ProductId, type X402Config } from "./x402-config";

export type Requirement = { scheme: "exact"; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra: Record<string, unknown> };
export type PaymentRequired = { x402Version: 2; error: string; resource: { url: string; description: string; mimeType: "application/json" }; accepts: Requirement[] };
type Supported = { kinds: { scheme: string; network: string; extra?: Record<string, unknown> }[] };

export const MAX_TIMEOUT_S = 300;
/** What @circle-fin/x402-batching/server uses for Gateway requirements (7 days + 100 s). */
export const GATEWAY_TIMEOUT_S = 604900;
const FAILED_TTL_MS = 60e3;
const SUPPORTED_TTL_MS = 3600e3;
const cache = new Map<string, { at: number; extra: Record<string, unknown> | null }>();

/** The Circle facilitator's GatewayWalletBatched kind for this network (cached 1 h per isolate); null when it can't be read. */
export async function gatewayExtra(cfg: X402Config, fetchSupported?: () => Promise<Supported>, noCache = false): Promise<Record<string, unknown> | null> {
  const hit = cache.get(cfg.facilitator);
  if (!noCache && hit && Date.now() - hit.at < (hit.extra ? SUPPORTED_TTL_MS : FAILED_TTL_MS)) return hit.extra;
  let extra: Record<string, unknown> | null = null;
  try {
    const s = await (fetchSupported ?? (() => new BatchFacilitatorClient({ url: cfg.facilitator }).getSupported() as Promise<Supported>))();
    const k = s.kinds.find((x) => x.network === cfg.caip2 && x.extra?.name === "GatewayWalletBatched")?.extra;
    extra = k && typeof k.verifyingContract === "string" ? { name: k.name, version: k.version, verifyingContract: k.verifyingContract } : null;
  } catch (err) {
    console.warn("x402 gateway getSupported failed", err);
  }
  cache.set(cfg.facilitator, { at: Date.now(), extra });
  return extra;
}

const domainCache = new Map<string, { name: string; version: string }>();
const ARC_RPCS = ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"];
const TESTNET_RPCS = ["https://rpc.blockdaemon.testnet.arc.io", "https://rpc.testnet.arc.io"];
/** USDC's EIP-712 domain name/version, read from the chain once per isolate (never hard-coded). */
export async function usdcDomain(cfg: X402Config, read?: (fn: "name" | "version") => Promise<string>): Promise<{ name: string; version: string } | null> {
  const hit = domainCache.get(cfg.caip2);
  if (hit) return hit;
  try {
    const r = read ?? (async (fn: "name" | "version") => {
      const client = createPublicClient({ transport: fallback((cfg.network === "arc" ? ARC_RPCS : TESTNET_RPCS).map((u) => http(u, { retryCount: 2, retryDelay: 400 }))) });
      return (await client.readContract({ address: USDC, abi: parseAbi(["function name() view returns (string)", "function version() view returns (string)"]), functionName: fn })) as string;
    });
    const d = { name: await r("name"), version: await r("version") };
    domainCache.set(cfg.caip2, d);
    return d;
  } catch (err) {
    console.warn("x402 usdc domain read failed", err);
    return null;
  }
}

export function paymentRequired(product: ProductId, url: string, cfg: X402Config, gw: Record<string, unknown> | null, domain: { name: string; version: string } | null): PaymentRequired {
  const p = PRODUCTS[product];
  const base = { scheme: "exact" as const, network: cfg.caip2, asset: USDC, payTo: cfg.payTo };
  const accepts: Requirement[] = [];
  if (cfg.settlerKey && domain) accepts.push({ ...base, amount: p.standard.toString(), maxTimeoutSeconds: MAX_TIMEOUT_S, extra: { name: domain.name, version: domain.version } });
  if (gw) accepts.push({ ...base, amount: p.gateway.toString(), maxTimeoutSeconds: GATEWAY_TIMEOUT_S, extra: { name: gw.name, version: gw.version, verifyingContract: gw.verifyingContract } });
  return { x402Version: 2, error: "Payment required", resource: { url, description: p.description, mimeType: "application/json" }, accepts };
}

export function respond402(pr: PaymentRequired, reason?: string): Response {
  const body = reason ? { ...pr, error: reason } : pr;
  return new Response(JSON.stringify(body), { status: 402, headers: {
    "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
    "cache-control": "no-store", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body as never) } });
}
