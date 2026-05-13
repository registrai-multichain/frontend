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

export const LIVE_META = {
  syncedAt: live.syncedAt,
  chainId: live.chainId,
  explorer: live.explorer,
  contracts: live.contracts,
};
