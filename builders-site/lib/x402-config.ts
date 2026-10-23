/** x402 paid extras: products, prices and settings (spec docs/superpowers/specs/2026-10-16-x402-data-api-design.md). */
import type { Env } from "./env";

export { PRODUCTS, formatUsd, type ProductId } from "../../src/lib/x402-catalog";

const NETWORKS = {
  arc: { caip2: "eip155:5042", chainId: 5042, facilitator: "https://gateway-api.circle.com" },
  arcTestnet: { caip2: "eip155:5042002", chainId: 5042002, facilitator: "https://gateway-api-testnet.circle.com" },
} as const;
export const USDC = "0x3600000000000000000000000000000000000000" as const;

export type X402Config = { payTo: `0x${string}`; network: keyof typeof NETWORKS; caip2: string; chainId: number; facilitator: string; settlerKey: `0x${string}` | null };

const ADDR = /^0x[0-9a-fA-F]{40}$/, KEY = /^0x[0-9a-fA-F]{64}$/;

/** null = payments not configured: every paid route answers 503 and no 402 is issued. */
export function readX402Config(env: Env): X402Config | null {
  const payTo = (env.X402_PAY_TO ?? "").trim();
  if (!ADDR.test(payTo)) return null;
  const network = env.X402_NETWORK === "arcTestnet" ? "arcTestnet" : "arc";
  // tolerate how keys are usually stored: with or without 0x, quoted, with a trailing newline
  const raw = (env.X402_SETTLER_KEY ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  return { payTo: payTo as `0x${string}`, network, ...NETWORKS[network], settlerKey: KEY.test(key) ? (key as `0x${string}`) : null };
}
