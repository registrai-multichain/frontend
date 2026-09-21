import type { Address } from "viem";

// Redeployed to Arc testnet 2026-09-17 from current source, with the full
// lifecycle verified on-chain: createMarket -> buy -> fee routed to the commons
// -> resolve -> redeem -> claimLP (contract drained to 0), and separately
// addProgress -> closeEpoch -> claim -> stream -> settle. Active-builder
// enforcement is present (createMarket against an unregistered builderId
// reverts BuilderInactive). Both preconditions for enabling writes are met.
export const PERENNIAL_WRITES_ENABLED = true;
export const PERENNIAL_DEPLOYMENT_NOTICE =
  "Live on Arc testnet. Testnet parameters: epoch length 0, stream window 60s.";

// Perennial config. The builder directory mirrors the keeper's directory.json
// (display layer); on-chain progress weight is read live. Markets are tagged to
// a builderId and resolve via the bonded oracle.

export interface PerennialBuilder {
  address: Address;
  builderId: number;
  name: string;
  repo: string;          // owner/name
  latestRelease?: string;
  latestTag?: string;
  latestCommit?: string;
  marketId?: `0x${string}`; // a live market about this builder
  marketQuestion?: string;
  milestoneMarketId?: `0x${string}`; // a per-builder milestone market ("ships a release by <expiry>?")
  milestoneQuestion?: string;
}

// Perennial runs on Arc testnet (redeployed 2026-09-17). Builder #1 is
// registered on-chain with an open 7-day market and a bet already routing fees
// to the commons. Progress weight is read live from the
// chain; the GitHub keeper credits releases/tags for the registered repo.
export const PERENNIAL_BUILDERS: PerennialBuilder[] = [
  {
    address: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e",
    builderId: 1,
    name: "Registrai / Otus",
    repo: "registrai-multichain/oracle-primitives",
    latestTag: "v0.1.0",
    marketId: "0x5e7e88c1e7e16ec469bf6089c22309d7f5983069332e8ba6e1bc43c344ae6296",
    marketQuestion: "Ships a release by expiry?",
  },
];

// The bonded feed new markets resolve against on Arc. User-created markets
// share this feed and are TAGGED to a builder so their fees flow to the commons
// under that builder. The agent of record is the registered feed agent.
export const CREATE_FEED = {
  feedId: "0x5feff482b8ba79c844c057b4420ec15aee6d050ad645a79c919223b14d7c195a" as `0x${string}`,
  agent: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e" as Address,
};
