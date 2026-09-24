import type { Address, Hex } from "viem";

// Kill switch for Perennial writes. Reads stay live when this is false.
export const PERENNIAL_WRITES_ENABLED = true;

// Perennial display metadata. The builder list itself is read from the
// BuilderRegistry on the selected network; this only names builders the
// registry knows by address + id. Markets are discovered on-chain
// (MarketCreated), never listed here.

export interface PerennialBuilder {
  address: Address;
  builderId: number;
  name: string;
  repo: string; // owner/name
  /** The builder's own milestone feed (value = cumulative verified artifacts,
   *  attested by the protocol operator). Mirrors keeper/builders.json
   *  `milestoneFeedId`; when absent it is derived from the operator's markets. */
  milestoneFeedId?: Hex;
}

// Arc testnet directory. Builder #1 (the deployer) was set inactive on
// 2026-09-21; it is kept here only so its existing markets read by name.
export const PERENNIAL_BUILDERS: PerennialBuilder[] = [
  {
    address: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e",
    builderId: 1,
    name: "Registrai / Otus",
    repo: "registrai-multichain/oracle-primitives",
  },
];
