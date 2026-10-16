/**
 * The payment gate for paid extras (spec 2026-10-16-x402-data-api-design.md). No payment → 402 with both options; a payment →
 * pick its rail, run the product's precheck (nothing is charged if the product can't be delivered), settle, and only then serve.
 */
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { createPublicClient, fallback, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gatewayClient, settleGateway, type GatewayClient, type PaymentPayload } from "./x402-gateway";
import { isEip3009Payload, settleEip3009, viemChainIO, type ChainIO } from "./x402-eip3009";
import { gatewayExtra, paymentRequired, respond402, usdcDomain, type PaymentRequired } from "./x402-requirements";
import { readX402Config, USDC, type ProductId, type X402Config } from "./x402-config";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";

export type GateDeps = EdgeCacheDeps & {
  io?: ChainIO; gateway?: GatewayClient; noCache?: boolean;
  supported?: () => Promise<{ kinds: { scheme: string; network: string; extra?: Record<string, unknown> }[] }>;
  domainRead?: (fn: "name" | "version") => Promise<string>;
};
export type SettleOutcome = { ok: true; tx: string | null; payer: string; network: string } | { ok: false; status: 402 | 503; reason: string; pr: PaymentRequired | null };

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" } });

export async function requirementsFor(cfg: X402Config, product: ProductId, url: string, deps: GateDeps): Promise<PaymentRequired> {
  const [gw, domain] = await Promise.all([gatewayExtra(cfg, deps.supported, deps.noCache), cfg.settlerKey ? usdcDomain(cfg, deps.domainRead) : Promise.resolve(null)]);
  return paymentRequired(product, url, cfg, gw, domain);
}

/** Shared by HTTP and MCP: settle one decoded payment for one product. */
export async function settlePayment(env: Env, deps: GateDeps, product: ProductId, url: string, payment: PaymentPayload | null,
  precheck?: () => Promise<Response | null>): Promise<SettleOutcome | { ok: false; status: number; response: Response }> {
  const cfg = readX402Config(env);
  if (!cfg || !env.DATA_DB) return { ok: false, status: 503, reason: "Payments are not configured yet.", pr: null };
  const pr = await requirementsFor(cfg, product, url, deps);
  if (!payment) return { ok: false, status: 402, reason: "Payment required", pr };
  const isGateway = (payment.accepted?.extra as { name?: string } | undefined)?.name === "GatewayWalletBatched";
  const req = pr.accepts.find((a) => ((a.extra as { name?: string }).name === "GatewayWalletBatched") === isGateway);
  if (!req) return { ok: false, status: 402, reason: "This payment option is not offered for this product.", pr };
  if (!isGateway && !isEip3009Payload(payment.payload)) return { ok: false, status: 402, reason: "malformed payment", pr };
  if (precheck) {
    const blocked = await precheck();
    if (blocked) return { ok: false, status: blocked.status, response: blocked };
  }
  const r = isGateway
    ? await settleGateway(env.DATA_DB, payment, req, product, deps.gateway ?? gatewayClient(cfg))
    : await settleEip3009(env.DATA_DB, payment.payload as never, req, product, deps.io ?? viemChainIO(cfg), { chainId: cfg.chainId });
  return r.ok ? { ok: true, tx: r.tx, payer: r.payer, network: cfg.caip2 } : { ok: false, status: 402, reason: r.reason, pr };
}

export async function payGate(req: Request, env: Env, deps: GateDeps, product: ProductId, serve: () => Promise<Response>,
  opts: { precheck?: () => Promise<Response | null> } = {}): Promise<Response> {
  const header = req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT");
  let payment: PaymentPayload | null = null, unreadable = false;
  if (header) {
    try { payment = decodePaymentSignatureHeader(header) as unknown as PaymentPayload; } catch { unreadable = true; }
  }
  const out = await settlePayment(env, deps, product, req.url, payment, opts.precheck);
  if ("response" in out) return out.response;
  if (!out.ok) {
    if (out.status === 503 || !out.pr) return json(503, out.reason);
    return respond402(out.pr, unreadable ? "The payment header could not be read." : out.reason);
  }
  const res = await serve();
  const headers = new Headers(res.headers);
  headers.set("PAYMENT-RESPONSE", encodePaymentResponseHeader({ success: true, transaction: out.tx ?? "", network: out.network, payer: out.payer } as never));
  headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

/** Public payment health: configuration and the gas wallet's balance (low < $2). Never the key or the wallet address. */
export async function paidHealth(env: Env, readBalance?: (addr: `0x${string}`) => Promise<number>) {
  const cfg = readX402Config(env);
  if (!cfg) return { configured: false };
  let balance: number | null = null;
  if (cfg.settlerKey) {
    const addr = privateKeyToAccount(cfg.settlerKey).address;
    try {
      balance = await (readBalance ?? (async (a: `0x${string}`) => {
        const rpcs = cfg.network === "arc" ? ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"] : ["https://rpc.blockdaemon.testnet.arc.io", "https://rpc.testnet.arc.io"];
        const c = createPublicClient({ transport: fallback(rpcs.map((u) => http(u))) });
        return Number(await c.readContract({ address: USDC, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [a] })) / 1e6;
      }))(addr);
    } catch { balance = null; }
  }
  return { configured: true, network: cfg.caip2, standard_enabled: !!cfg.settlerKey, settler_balance_usdc: balance, low: balance !== null && balance < 2 };
}
