/** x402 paid extras: products, prices and settings (spec docs/superpowers/specs/2026-10-16-x402-data-api-design.md). */
import type { Env } from "./env";

export type ProductId = "deep_index_history" | "deep_member_history" | "members_day" | "events" | "contract" | "project_scope";

/** Prices in micro-USDC (6 decimals): Circle Gateway (batched, gasless) and standard EIP-3009 (we pay ~$0.002 gas per settlement). */
export const PRODUCTS: Record<ProductId, { gateway: bigint; standard: bigint; description: string }> = {
  deep_index_history: { gateway: 2000n, standard: 10000n, description: "Hourly closes of one Arc index for any window." },
  deep_member_history: { gateway: 2000n, standard: 10000n, description: "One app's hourly points and activity for any window." },
  members_day: { gateway: 30000n, standard: 50000n, description: "Every member's hourly rows and the closes of ABI, AII and AEI for one UTC day." },
  events: { gateway: 2000n, standard: 10000n, description: "Watch-feed events: deploys, upgrades, control changes, pauses and large outflows on Arc." },
  contract: { gateway: 5000n, standard: 10000n, description: "Facts for one contract: label, project, recent events and USDC balance." },
  project_scope: { gateway: 10000n, standard: 20000n, description: "Every contract attributed to one project." },
};

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
  const key = (env.X402_SETTLER_KEY ?? "").trim();
  return { payTo: payTo as `0x${string}`, network, ...NETWORKS[network], settlerKey: KEY.test(key) ? (key as `0x${string}`) : null };
}

export const formatUsd = (micro: bigint) => {
  const s = (Number(micro) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s.includes(".") && s.split(".")[1].length < 2 ? s.padEnd(s.indexOf(".") + 3, "0") : s}`;
};
