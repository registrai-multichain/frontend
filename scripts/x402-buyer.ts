/**
 * x402 buyer smoke test for Registrai's paid extras (spec docs/superpowers/specs/2026-10-16-x402-data-api-design.md).
 * The buyer key comes ONLY from the BUYER_KEY environment variable and is never printed.
 *
 *   Standard EIP-3009 (any x402 wallet):
 *     BUYER_KEY=0x… npx tsx scripts/x402-buyer.ts --rail standard --url "https://<preview>/api/v1/paid/indices/abi/hourly?from=2026-10-01T00:00:00Z"
 *   Circle Gateway (deposit once, then pay):
 *     BUYER_KEY=0x… npx tsx scripts/x402-buyer.ts --rail circle --chain arcTestnet --deposit 1 --url "…"
 */
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const EIP3009_TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] } as const;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

type Requirement = { scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra: Record<string, unknown> };

async function show(label: string, r: Response) {
  const pr = r.headers.get("PAYMENT-RESPONSE");
  const text = await r.text();
  console.log(`${label}: HTTP ${r.status}`);
  if (pr) console.log("  settlement:", JSON.stringify(decodePaymentResponseHeader(pr)));
  console.log("  body:", text.slice(0, 300).replace(/\s+/g, " "));
}

async function standard(url: string, key: Hex) {
  const buyer = privateKeyToAccount(key);
  console.log("buyer", buyer.address);
  const first = await fetch(url);
  if (first.status !== 402) return show("expected 402, got", first);
  const pr = (await first.json()) as { accepts: Requirement[] };
  const req = pr.accepts.find((a) => a.extra?.name !== "GatewayWalletBatched");
  if (!req) { console.log("no standard option offered:", JSON.stringify(pr.accepts)); return; }
  console.log(`paying ${Number(req.amount) / 1e6} USDC to ${req.payTo} on ${req.network}`);
  const chainId = Number(req.network.split(":")[1]);
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  const authorization = { from: buyer.address, to: req.payTo, value: req.amount, validAfter: String(now - 5), validBefore: String(now + req.maxTimeoutSeconds), nonce };
  const signature = await buyer.signTypedData({
    domain: { name: req.extra.name as string, version: req.extra.version as string, chainId, verifyingContract: req.asset as Hex },
    types: EIP3009_TYPES, primaryType: "TransferWithAuthorization",
    message: { from: buyer.address, to: req.payTo as Hex, value: BigInt(req.amount), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce },
  });
  const header = encodePaymentSignatureHeader({ x402Version: 2, accepted: req, payload: { signature, authorization } } as never);
  await show("paid request", await fetch(url, { headers: { "PAYMENT-SIGNATURE": header } }));
  await show("replay (must be refused)", await fetch(url, { headers: { "PAYMENT-SIGNATURE": header } }));
}

async function circle(url: string, key: Hex, chain: string, deposit?: string) {
  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  const gw = new GatewayClient({ chain: chain as never, privateKey: key });
  console.log("buyer", gw.account.address);
  if (deposit) {
    const d = await gw.deposit(deposit);
    console.log("deposited", deposit, "USDC into Gateway, tx", d.depositTxHash);
  }
  console.log("gateway balances", JSON.stringify(await gw.getBalances(), (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const r = await gw.pay(url);
  console.log("paid via Circle Gateway:", JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400));
}

const url = arg("url");
const key = process.env.BUYER_KEY as Hex | undefined;
if (!url || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("usage: BUYER_KEY=0x<64 hex> npx tsx scripts/x402-buyer.ts --rail standard|circle --url <paid url> [--chain arcTestnet] [--deposit <USDC>]");
  process.exit(1);
}
const rail = arg("rail", "standard");
(rail === "circle" ? circle(url, key, arg("chain", "arcTestnet")!, arg("deposit")) : standard(url, key)).catch((e) => {
  console.error("buyer failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
