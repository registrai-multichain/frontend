/**
 * Standard x402 "exact" on Arc USDC via EIP-3009, settled by us (spec 2026-10-16-x402-data-api-design.md; no third-party
 * facilitator). The buyer signs TransferWithAuthorization(from → payTo, value, window, nonce). Pipeline:
 *   checkEip3009 (no side effects: ledger state, signature, payee, exact amount, window, onchain nonce)
 *   → [caller builds the product]
 *   → submitEip3009 (reserve the nonce, sign locally, store the tx hash, broadcast, wait for the receipt).
 * A payment whose outcome is unclear is settled later only from OUR transaction's receipt, and only for the same product.
 */
import { createPublicClient, createWalletClient, encodeFunctionData, fallback, http, keccak256, parseAbi, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { findPayment, markFailed, markSettled, markSubmitting, reserve } from "./x402-ledger";
import { USDC, type ProductId, type X402Config } from "./x402-config";
import type { Requirement } from "./x402-requirements";
import type { D1Database } from "./env";

export const EIP3009_TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] } as const;
/** An authorization must stay valid this long after we accept it (time to sign, send and mine). */
export const EXPIRY_BUFFER_S = 6;
/** A reserved row with no transaction after this long was never sent: nothing moved. */
const STALE_PENDING_S = 60;

export type Eip3009Payload = { signature: Hex; authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: Hex } };
export interface ChainIO {
  authorizationState(from: string, nonce: Hex): Promise<boolean>;
  /** Estimate, then sign locally. Throws if the transfer would revert (nothing is sent). */
  prepare(p: Eip3009Payload): Promise<{ hash: Hex; raw: Hex }>;
  /** Broadcast. May throw although the transaction got through: the receipt decides. */
  send(raw: Hex): Promise<void>;
  receipt(tx: Hex): Promise<"success" | "reverted" | "pending">;
}
export type Check = { kind: "fresh"; payer: string } | { kind: "reconcile"; payer: string; tx: string } | { kind: "error"; reason: string };
export type Settled = { ok: true; tx: string; payer: string } | { ok: false; reason: string };

const lc = (s: string) => s.toLowerCase();
const isAddr = (s: unknown) => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
const nowS = () => Math.floor(Date.now() / 1000);

export function isEip3009Payload(p: unknown): p is Eip3009Payload {
  const x = p as Eip3009Payload;
  return !!x && typeof x.signature === "string" && !!x.authorization && isAddr(x.authorization.from) && isAddr(x.authorization.to)
    && /^\d+$/.test(String(x.authorization.value)) && /^\d+$/.test(String(x.authorization.validAfter)) && /^\d+$/.test(String(x.authorization.validBefore))
    && /^0x[0-9a-fA-F]{64}$/.test(x.authorization.nonce);
}

/** Signature, payee, exact amount, validity window (with buffer), unused onchain nonce. No side effects. */
export async function verifyEip3009(p: Eip3009Payload, req: Requirement, chainId: number, now: number, io: ChainIO): Promise<{ ok: true; payer: string } | { ok: false; reason: string }> {
  if (!isEip3009Payload(p)) return { ok: false, reason: "malformed payment" };
  const a = p.authorization;
  if (lc(a.to) !== lc(req.payTo)) return { ok: false, reason: "wrong payee" };
  if (BigInt(a.value) !== BigInt(req.amount)) return { ok: false, reason: BigInt(a.value) < BigInt(req.amount) ? "amount below price" : "amount must equal the price" };
  if (BigInt(a.validBefore) <= BigInt(now + EXPIRY_BUFFER_S)) return { ok: false, reason: "authorization expired" };
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

/** What to do with this payment for this product. Reads the ledger and the chain; never writes, except to close out a
 * payment that provably failed (reverted receipt, or reserved but never sent). */
export async function checkEip3009(db: D1Database, p: Eip3009Payload, req: Requirement, product: ProductId, io: ChainIO, opts: { chainId: number; now?: number }): Promise<Check> {
  if (!isEip3009Payload(p)) return { kind: "error", reason: "malformed payment" };
  const { from, nonce } = p.authorization;
  const prior = await findPayment(db, "eip3009", from, nonce);
  if (prior) {
    if (prior.product !== product || prior.status === "settled" || prior.status === "failed") return { kind: "error", reason: "payment already used" };
    if (!prior.tx_hash) {
      if ((opts.now ?? nowS()) - prior.created_at < STALE_PENDING_S) return { kind: "error", reason: "settlement_unknown" };
      await markFailed(db, "eip3009", from, nonce, "failed"); // reserved but never broadcast: nothing moved
      return { kind: "error", reason: "settlement_failed" };
    }
    const r = await io.receipt(prior.tx_hash as Hex);
    if (r === "success") return { kind: "reconcile", payer: from, tx: prior.tx_hash };
    if (r === "reverted") { await markFailed(db, "eip3009", from, nonce, "failed"); return { kind: "error", reason: "settlement_failed" }; }
    return { kind: "error", reason: "settlement_unknown" };
  }
  const v = await verifyEip3009(p, req, opts.chainId, opts.now ?? nowS(), io);
  return v.ok ? { kind: "fresh", payer: v.payer } : { kind: "error", reason: v.reason };
}

/** Reserve, sign locally, store the hash, broadcast, wait. Call only after checkEip3009 said "fresh" and the product is built. */
export async function submitEip3009(db: D1Database, p: Eip3009Payload, product: ProductId, io: ChainIO, opts: { waitMs?: number; pollMs?: number } = {}): Promise<Settled> {
  const { from, nonce } = p.authorization;
  if ((await reserve(db, { scheme: "eip3009", payer: from, nonce, product, amount: Number(p.authorization.value) })) === "duplicate") return { ok: false, reason: "payment already used" };
  let signed: { hash: Hex; raw: Hex };
  try { signed = await io.prepare(p); } catch (err) {
    console.warn("x402 eip3009 prepare failed (nothing sent)", lc(from), err instanceof Error ? err.message.slice(0, 200) : err);
    await markFailed(db, "eip3009", from, nonce, "failed");
    return { ok: false, reason: "settlement_failed" };
  }
  await markSubmitting(db, "eip3009", from, nonce, signed.hash);
  try { await io.send(signed.raw); } catch (err) {
    console.warn("x402 eip3009 send error (outcome from the receipt)", lc(from), signed.hash, err instanceof Error ? err.message.slice(0, 200) : err);
  }
  const deadline = Date.now() + (opts.waitMs ?? 8000);
  for (;;) {
    const r = await io.receipt(signed.hash).catch(() => "pending" as const);
    if (r === "success") { await markSettled(db, "eip3009", from, nonce, signed.hash); return { ok: true, tx: signed.hash, payer: from }; }
    if (r === "reverted") { await markFailed(db, "eip3009", from, nonce, "failed"); return { ok: false, reason: "settlement_failed" }; }
    if (Date.now() >= deadline) { await markFailed(db, "eip3009", from, nonce, "unknown"); return { ok: false, reason: "settlement_unknown" }; }
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 400));
  }
}

const RPCS = { arc: ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"], arcTestnet: ["https://rpc.blockdaemon.testnet.arc.io", "https://rpc.testnet.arc.io"] };
const USDC_ABI = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
]);

/** The real chain access: reads over public RPCs; the gas wallet (X402_SETTLER_KEY) signs locally, so the hash is known before broadcast. */
export function viemChainIO(cfg: X402Config): ChainIO {
  if (!cfg.settlerKey) throw new Error("x402 settler key not configured");
  const transport = fallback(RPCS[cfg.network].map((u) => http(u, { retryCount: 1, retryDelay: 300 })));
  const chain = { id: cfg.chainId, name: cfg.network, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: RPCS[cfg.network] } } } as const;
  const account = privateKeyToAccount(cfg.settlerKey);
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account });
  return {
    authorizationState: async (from, nonce) => (await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "authorizationState", args: [from as Hex, nonce] })) as boolean,
    prepare: async (p) => {
      const a = p.authorization;
      const data = encodeFunctionData({ abi: USDC_ABI, functionName: "transferWithAuthorization",
        args: [a.from as Hex, a.to as Hex, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, p.signature] });
      const request = await wallet.prepareTransactionRequest({ account, chain, to: USDC, data, nonceManager: undefined }); // estimates gas: a revert throws here
      const raw = await wallet.signTransaction(request as never);
      return { hash: keccak256(raw), raw };
    },
    send: async (raw) => { await pub.sendRawTransaction({ serializedTransaction: raw }); },
    receipt: async (tx) => {
      const r = await pub.getTransactionReceipt({ hash: tx }).catch(() => null);
      return r ? (r.status === "success" ? "success" : "reverted") : "pending";
    },
  };
}
