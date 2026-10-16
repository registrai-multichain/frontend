/**
 * Standard x402 "exact" on Arc USDC via EIP-3009, settled by us (spec 2026-10-16-x402-data-api-design.md; no third-party
 * facilitator). The buyer signs TransferWithAuthorization(from → payTo, value, window, nonce); we verify it, reserve the
 * nonce in the ledger, and our gas wallet submits transferWithAuthorization. USDC moves straight from buyer to payTo.
 */
import { createPublicClient, createWalletClient, fallback, http, parseAbi, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { findPayment, markFailed, markSettled, reserve } from "./x402-ledger";
import { USDC, type ProductId, type X402Config } from "./x402-config";
import type { Requirement } from "./x402-requirements";
import type { D1Database } from "./env";

export const EIP3009_TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] } as const;

export type Eip3009Payload = { signature: Hex; authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: Hex } };
export interface ChainIO {
  authorizationState(from: string, nonce: Hex): Promise<boolean>;
  submit(p: Eip3009Payload): Promise<Hex>;
  receipt(tx: Hex): Promise<"success" | "reverted" | "pending">;
}
type Verified = { ok: true; payer: string } | { ok: false; reason: string };
export type Settled = { ok: true; tx: string | null; payer: string } | { ok: false; reason: "payment already used" | "settlement_failed" | "settlement_unknown" | string };

const lc = (s: string) => s.toLowerCase();
const isAddr = (s: unknown) => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

export function isEip3009Payload(p: unknown): p is Eip3009Payload {
  const x = p as Eip3009Payload;
  return !!x && typeof x.signature === "string" && !!x.authorization && isAddr(x.authorization.from) && isAddr(x.authorization.to)
    && /^\d+$/.test(String(x.authorization.value)) && /^\d+$/.test(String(x.authorization.validAfter)) && /^\d+$/.test(String(x.authorization.validBefore))
    && /^0x[0-9a-fA-F]{64}$/.test(x.authorization.nonce);
}

export async function verifyEip3009(p: Eip3009Payload, req: Requirement, chainId: number, now: number, io: ChainIO): Promise<Verified> {
  if (!isEip3009Payload(p)) return { ok: false, reason: "malformed payment" };
  const a = p.authorization;
  if (lc(a.to) !== lc(req.payTo)) return { ok: false, reason: "wrong payee" };
  if (BigInt(a.value) < BigInt(req.amount)) return { ok: false, reason: "amount below price" };
  if (BigInt(a.validBefore) <= BigInt(now)) return { ok: false, reason: "authorization expired" };
  if (BigInt(a.validAfter) > BigInt(now)) return { ok: false, reason: "authorization not valid yet" };
  const extra = req.extra as { name?: string; version?: string };
  let good = false;
  try {
    good = await verifyTypedData({ address: a.from as Hex, domain: { name: extra.name, version: extra.version, chainId, verifyingContract: req.asset as Hex },
      types: EIP3009_TYPES, primaryType: "TransferWithAuthorization", signature: p.signature,
      message: { from: a.from as Hex, to: a.to as Hex, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce } });
  } catch { good = false; }
  if (!good) return { ok: false, reason: "bad signature" };
  if (await io.authorizationState(a.from, a.nonce)) return { ok: false, reason: "payment already used" };
  return { ok: true, payer: a.from };
}

export async function settleEip3009(db: D1Database, p: Eip3009Payload, req: Requirement, product: ProductId, io: ChainIO,
  opts: { chainId: number; now?: number; waitMs?: number; pollMs?: number }): Promise<Settled> {
  if (!isEip3009Payload(p)) return { ok: false, reason: "malformed payment" };
  const { from, nonce } = p.authorization;
  // a retry of a payment whose outcome was unknown: settle it from the chain, never submit twice
  const prior = await findPayment(db, "eip3009", from, nonce);
  if (prior) {
    if (prior.status === "unknown" && (await io.authorizationState(from, nonce))) {
      await markSettled(db, "eip3009", from, nonce, prior.tx_hash);
      return { ok: true, tx: prior.tx_hash, payer: from };
    }
    return { ok: false, reason: prior.status === "unknown" ? "settlement_unknown" : "payment already used" };
  }
  const v = await verifyEip3009(p, req, opts.chainId, opts.now ?? Math.floor(Date.now() / 1000), io);
  if (!v.ok) return v;
  if ((await reserve(db, { scheme: "eip3009", payer: from, nonce, product, amount: Number(p.authorization.value) })) === "duplicate") return { ok: false, reason: "payment already used" };
  let tx: Hex;
  try { tx = await io.submit(p); } catch (err) {
    console.warn("x402 eip3009 submit failed", lc(from), err instanceof Error ? err.message : err);
    await markFailed(db, "eip3009", from, nonce, "failed");
    return { ok: false, reason: "settlement_failed" };
  }
  const deadline = Date.now() + (opts.waitMs ?? 8000);
  for (;;) {
    const r = await io.receipt(tx).catch(() => "pending" as const);
    if (r === "success") { await markSettled(db, "eip3009", from, nonce, tx); return { ok: true, tx, payer: from }; }
    if (r === "reverted") { await markFailed(db, "eip3009", from, nonce, "failed"); return { ok: false, reason: "settlement_failed" }; }
    if (Date.now() >= deadline) {
      await db.prepare("UPDATE x402_payments SET status = 'unknown', tx_hash = ? WHERE scheme = 'eip3009' AND payer = ? AND nonce = ?").bind(tx, lc(from), lc(nonce)).run();
      return { ok: false, reason: "settlement_unknown" };
    }
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 400));
  }
}

const RPCS = { arc: ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"], arcTestnet: ["https://rpc.blockdaemon.testnet.arc.io", "https://rpc.testnet.arc.io"] };
const USDC_ABI = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
]);

/** The real chain access: reads over public RPCs, writes signed by the gas wallet (X402_SETTLER_KEY). */
export function viemChainIO(cfg: X402Config): ChainIO {
  if (!cfg.settlerKey) throw new Error("x402 settler key not configured");
  const transport = fallback(RPCS[cfg.network].map((u) => http(u, { retryCount: 2, retryDelay: 400 })));
  const chain = { id: cfg.chainId, name: cfg.network, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: RPCS[cfg.network] } } } as const;
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account: privateKeyToAccount(cfg.settlerKey) });
  return {
    authorizationState: async (from, nonce) => (await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "authorizationState", args: [from as Hex, nonce] })) as boolean,
    submit: async (p) => wallet.writeContract({ address: USDC, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [p.authorization.from as Hex, p.authorization.to as Hex, BigInt(p.authorization.value), BigInt(p.authorization.validAfter), BigInt(p.authorization.validBefore), p.authorization.nonce, p.signature] }),
    receipt: async (tx) => {
      const r = await pub.getTransactionReceipt({ hash: tx }).catch(() => null);
      return r ? (r.status === "success" ? "success" : "reverted") : "pending";
    },
  };
}
