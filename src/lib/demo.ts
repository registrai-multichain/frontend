import type { Feed } from "./types";
import live from "./live-data.json";

/**
 * The "demo" feed is the live Warsaw feed read from Arc testnet by
 * `scripts/sync.ts`. We keep the `DEMO_FEED` name so existing imports keep
 * working, but the data here is real onchain state.
 *
 * History is sparse on day 1 (one attestation). The sparkline component
 * handles that by showing the single real point. As the agent attests
 * daily, history grows organically.
 */
export const DEMO_FEED: Feed = {
  id: live.feed.id as `0x${string}`,
  symbol: live.feed.symbol,
  description: live.feed.description,
  unit: live.feed.unit,
  methodologyCid: "ipfs://warsaw-resi-v1-placeholder",
  minBond: Number(live.feed.minBond) / 1e6,
  disputeWindowSec: live.feed.disputeWindow,
  resolver: live.feed.resolver as `0x${string}`,
  resolverLabel: "deployer (v1 bootstrap)",
  agents: [
    {
      address: live.agent.address as `0x${string}`,
      bond: Number(live.agent.bond) / 1e6,
      registeredAt: live.agent.registeredAt,
      attestations: live.attestations.map((a) => ({
        id: a.id as `0x${string}`,
        value: a.value,
        timestamp: a.timestamp,
        finalizedAt: a.finalizedAt,
        status:
          a.status === 0
            ? "none"
            : a.status === 1
              ? "pending"
              : a.status === 2
                ? "valid"
                : "invalid",
        inputHash: a.inputHash as `0x${string}`,
      })),
    },
  ],
};

/**
 * The verifiable Warsaw feed (rule-bound, v1.1 stack). Built from the
 * static manifest entry rather than synced chain history — until
 * scripts/sync.ts is taught about the v1.1 Attestation, we render a
 * stub agent with no attestation history so the page doesn't 404.
 * The verifiable badge + rule contract link still surface correctly.
 */
const verifiableFeedMeta = ((live as unknown as {
  feeds?: Array<{ id: string; symbol: string; name?: string; description: string; unit: string; rule?: string }>;
}).feeds ?? []).find((f) => f.symbol === "WARSAW_RESI_MEDIAN_VERIFIABLE");

export const VERIFIABLE_FEED: Feed | undefined = verifiableFeedMeta
  ? {
      id: verifiableFeedMeta.id as `0x${string}`,
      symbol: verifiableFeedMeta.symbol,
      description: verifiableFeedMeta.description,
      unit: verifiableFeedMeta.unit,
      methodologyCid: "ipfs://warsaw-resi-median-v1",
      minBond: 10,
      disputeWindowSec: 3600,
      resolver: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e",
      resolverLabel: "deployer (v1.1 bootstrap)",
      rule: verifiableFeedMeta.rule as `0x${string}` | undefined,
      agents: [
        {
          address: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e",
          bond: 10,
          registeredAt: Math.floor(Date.now() / 1000) - 86400,
          attestations: [{
            id: "0xce87ee21b461cf40f452d6a0cce63ebaca04c87d2558ed6367a7ee83cbb487b4" as `0x${string}`,
            value: 17371,
            timestamp: 1778961657,
            finalizedAt: 1778961657 + 3600,
            status: "valid",
            inputHash: "0x03d3ac5a36d292ccc5295ac20e1b3c863d79ac9c1058069f64b48a1c1e389a83" as `0x${string}`,
          }],
        },
      ],
    }
  : undefined;

export const ALL_FEEDS: Feed[] = [DEMO_FEED, ...(VERIFIABLE_FEED ? [VERIFIABLE_FEED] : [])];

export const LIVE_META = {
  syncedAt: live.syncedAt,
  chainId: live.chainId,
  explorer: live.explorer,
  contracts: live.contracts,
};
