/**
 * The payment gate for paid extras (spec 2026-10-16-x402-data-api-design.md). One pipeline for HTTP and MCP:
 *   decode → check (no side effects: signature/payee/exact amount/window/ledger/onchain nonce, or Circle verify)
 *   → build the product (nothing is charged if it can't be delivered) → settle (EIP-3009 one at a time, under the settler
 *   lock) → serve. A payment whose outcome was unclear is served on retry only once our own receipt proves it, for the same
 *   product. Every failure is a JSON 402/503, never a 500.
 */
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { createPublicClient, fallback, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkGateway, gatewayClient, submitGateway, type GatewayClient, type PaymentPayload } from "./x402-gateway";
import { checkEip3009, isEip3009Payload, submitEip3009, viemChainIO, type ChainIO, type Eip3009Payload } from "./x402-eip3009";
import { gatewayExtra, paymentRequired, respond402, usdcDomain, type PaymentRequired } from "./x402-requirements";
import { acquireSettler, claimSettled, releaseSettler } from "./x402-ledger";
import { readX402Config, USDC, type ProductId, type X402Config } from "./x402-config";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";

export type GateDeps = EdgeCacheDeps & {
  io?: ChainIO; gateway?: GatewayClient; noCache?: boolean; lockWaitMs?: number; receiptWaitMs?: number;
  supported?: () => Promise<{ kinds: { scheme: string; network: string; extra?: Record<string, unknown> }[] }>;
  domainRead?: (fn: "name" | "version") => Promise<string>;
};
export type SettleOutcome =
  | { ok: true; tx: string | null; payer: string; network: string }
  | { ok: false; status: 402 | 503; reason: string; pr: PaymentRequired | null }
  | { ok: false; status: number; response: Response };

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" } });
const busy = "Settlement is busy. Retry in a moment; nothing was charged.";

export async function requirementsFor(cfg: X402Config, product: ProductId, url: string, deps: GateDeps): Promise<PaymentRequired> {
  const [gw, domain] = await Promise.all([gatewayExtra(cfg, deps.supported, deps.noCache), cfg.settlerKey ? usdcDomain(cfg, deps.domainRead) : Promise.resolve(null)]);
  return paymentRequired(product, url, cfg, gw, domain);
}

async function withSettler<T>(db: NonNullable<Env["DATA_DB"]>, waitMs: number, run: () => Promise<T>): Promise<T | null> {
  const holder = crypto.randomUUID(), until = Date.now() + waitMs;
  while (!(await acquireSettler(db, holder))) {
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
  try { return await run(); } finally { await releaseSettler(db, holder).catch(() => undefined); }
}

/** Shared by HTTP and MCP: check, build (precheck), settle one decoded payment for one product. */
export async function settlePayment(env: Env, deps: GateDeps, product: ProductId, url: string, payment: PaymentPayload | null,
  precheck?: () => Promise<Response | null>): Promise<SettleOutcome> {
  const cfg = readX402Config(env);
  const db = env.DATA_DB;
  if (!cfg || !db) return { ok: false, status: 503, reason: "Payments are not configured yet.", pr: null };
  try {
    const pr = await requirementsFor(cfg, product, url, deps);
    if (pr.accepts.length === 0) return { ok: false, status: 503, reason: "Payments are temporarily unavailable. Retry later.", pr: null };
    if (!payment) return { ok: false, status: 402, reason: "Payment required", pr };
    const isGateway = (payment.accepted?.extra as { name?: string } | undefined)?.name === "GatewayWalletBatched";
    const req = pr.accepts.find((a) => ((a.extra as { name?: string }).name === "GatewayWalletBatched") === isGateway);
    if (!req) return { ok: false, status: 402, reason: "This payment option is not offered for this product.", pr };
    const blocked = async () => (precheck ? await precheck() : null);

    if (isGateway) {
      const client = deps.gateway ?? gatewayClient(cfg);
      const c = await checkGateway(db, payment, req, product, client);
      if (c.kind === "error") return { ok: false, status: 402, reason: c.reason, pr };
      const b = await blocked();
      if (b) return { ok: false, status: b.status, response: b };
      const s = await submitGateway(db, payment, req, product, client);
      return s.ok ? { ok: true, tx: s.tx, payer: s.payer, network: cfg.caip2 } : { ok: false, status: 402, reason: s.reason, pr };
    }

    if (!isEip3009Payload(payment.payload)) return { ok: false, status: 402, reason: "malformed payment", pr };
    const p = payment.payload as Eip3009Payload;
    const io = deps.io ?? viemChainIO(cfg);
    const c = await checkEip3009(db, p, req, product, io, { chainId: cfg.chainId });
    if (c.kind === "error") return { ok: false, status: 402, reason: c.reason, pr };
    const b = await blocked();
    if (b) return { ok: false, status: b.status, response: b }; // built nothing deliverable: nothing charged, nothing changed
    if (c.kind === "reconcile") {
      // our own transaction already paid for exactly this product: serve once
      return (await claimSettled(db, "eip3009", p.authorization.from, p.authorization.nonce))
        ? { ok: true, tx: c.tx, payer: c.payer, network: cfg.caip2 }
        : { ok: false, status: 402, reason: "payment already used", pr };
    }
    const s = await withSettler(db, deps.lockWaitMs ?? 6000, () => submitEip3009(db, p, product, io, { waitMs: deps.receiptWaitMs }));
    if (!s) return { ok: false, status: 503, reason: busy, pr: null };
    return s.ok ? { ok: true, tx: s.tx, payer: s.payer, network: cfg.caip2 } : { ok: false, status: 402, reason: s.reason, pr };
  } catch (err) {
    console.warn("x402 payment error", product, err instanceof Error ? err.message.slice(0, 200) : err);
    return { ok: false, status: 503, reason: "The payment could not be processed right now. Retry later.", pr: null };
  }
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
