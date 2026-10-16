// x402 paid extras: products and prices, shared by the payment code (builders-site/lib/x402-*) and the docs.
// Spec: docs/superpowers/specs/2026-10-16-x402-data-api-design.md.
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

export const formatUsd = (micro: bigint) => {
  const s = (Number(micro) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s.includes(".") && s.split(".")[1].length < 2 ? s.padEnd(s.indexOf(".") + 3, "0") : s}`;
};
